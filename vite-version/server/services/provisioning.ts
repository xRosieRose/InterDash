/**
 * InterDash Server — Asynchronous VPS Provisioning Service & Worker
 *
 * Implements a durable asynchronous job queue for LXC provisioning on Proxmox VE.
 * Enforces:
 *   - Idempotency with request hash verification (prevents double provisioning)
 *   - Step-by-step state machine updates
 *   - Network resource reservation & atomic assignment
 *   - Root password in-memory pass-through (never persisted or logged)
 *   - Automatic rollback and resource cleanup on partial failure
 *   - Post-restart job reconciliation
 *   - Comprehensive audit logging
 */

import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { queryOne, queryAll, execute } from "../db/index.js";
import { ProxmoxService, resolveProxmoxEndpoint, type ProxmoxNodeConfig } from "./proxmox.js";
import { decryptCredential } from "./crypto.js";
import { parseDatabaseTimestampUtc } from "../utils/timestamp.js";
import { StartupScriptService } from "./startup-script.js";

export interface ProvisioningJobRequest {
  ownerUserId: string;
  targetNodeId: string;
  requestedByUserId: string;
  hostname: string;
  name?: string;
  description?: string;
  osTemplate: string;
  cpuCores: number;
  memoryMb: number;
  swapMb?: number;
  diskGb: number;
  storage?: string;
  bridge?: string;
  ipv4PoolId?: string;
  startAfterCreate?: boolean;
  rootPassword?: string;
  sshPublicKey?: string;
  idempotencyKey?: string;
  expiresAt?: string | null;
}

// In-memory store for sensitive credentials during the provisioning lifetime only.
// Plaintext passwords are NEVER persisted to the database or written to disk.
const ephemeralJobCredentials = new Map<
  string,
  { password?: string; sshKey?: string }
>();

export class ProvisioningService {
  /**
   * Helper to retrieve a decrypted Proxmox node config from database
   */
  public static getNodeConfig(nodeId: string): ProxmoxNodeConfig | null {
    const row = queryOne<any>(
      `SELECT id, name, hostname, api_url, port, node_name, region, flag_url,
              auth_token_id, auth_token_secret_encrypted, allow_insecure_tls,
              default_storage, default_template_storage, default_rootfs_storage,
              default_bridge, enabled, status
       FROM proxmox_nodes WHERE id = ? LIMIT 1`,
      [nodeId]
    );

    if (!row) return null;

    const defaultRootfs = row.default_rootfs_storage || row.default_storage || null;
    const endpoint = resolveProxmoxEndpoint(row.api_url, row.hostname, row.port);

    return {
      id: row.id,
      name: row.name,
      hostname: endpoint.hostname,
      apiUrl: row.api_url,
      port: endpoint.port,
      nodeName: row.node_name,
      region: row.region,
      flagUrl: row.flag_url || null,
      authTokenId: row.auth_token_id,
      authTokenSecret: decryptCredential(row.auth_token_secret_encrypted),
      allowInsecureTls: Boolean(row.allow_insecure_tls),
      defaultTemplateStorage: row.default_template_storage || null,
      defaultRootfsStorage: defaultRootfs,
      defaultBridge: row.default_bridge || null,
      defaultStorage: defaultRootfs || undefined,
      enabled: row.enabled !== 0,
      status: row.status,
    };
  }

  /**
   * Submit a new VPS provisioning job with submit-time preflight validation
   */
  public static async submitJob(req: ProvisioningJobRequest): Promise<{
    jobId: string;
    status: string;
    isDuplicate?: boolean;
  }> {
    // Validate expiresAt if provided
    let normalizedExpiresAt: string | null = null;
    if (req.expiresAt !== undefined && req.expiresAt !== null && String(req.expiresAt).trim() !== "") {
      const trimmed = String(req.expiresAt).trim();
      const expiryTime = parseDatabaseTimestampUtc(trimmed).getTime();
      if (isNaN(expiryTime) || expiryTime === 0) {
        const err = new Error("Invalid expiration timestamp format. Must be an ISO 8601 string.");
        (err as any).statusCode = 400;
        throw err;
      }
      if (expiryTime <= Date.now()) {
        const err = new Error("Expiration date must be in the future.");
        (err as any).statusCode = 400;
        throw err;
      }
      normalizedExpiresAt = new Date(expiryTime).toISOString();
    }

    // Generate request hash for idempotency integrity check
    const hashData = {
      ownerUserId: req.ownerUserId,
      targetNodeId: req.targetNodeId,
      hostname: req.hostname.trim().toLowerCase(),
      osTemplate: req.osTemplate,
      cpuCores: req.cpuCores,
      memoryMb: req.memoryMb,
      diskGb: req.diskGb,
      storage: req.storage,
      bridge: req.bridge,
      ipv4PoolId: req.ipv4PoolId,
      expiresAt: normalizedExpiresAt,
    };
    const requestHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(hashData))
      .digest("hex");

    // 1. Idempotency check
    if (req.idempotencyKey) {
      const existing = queryOne<{ id: string; status: string; request_hash: string | null }>(
        "SELECT id, status, request_hash FROM provisioning_jobs WHERE idempotency_key = ? LIMIT 1",
        [req.idempotencyKey]
      );
      if (existing) {
        if (existing.request_hash && existing.request_hash !== requestHash) {
          const err = new Error("Idempotency key reused with conflicting parameters.");
          (err as any).statusCode = 409;
          throw err;
        }
        return {
          jobId: existing.id,
          status: existing.status,
          isDuplicate: true,
        };
      }
    }

    // 2. Validate target node exists & is enabled
    const node = this.getNodeConfig(req.targetNodeId);
    if (!node) {
      const err = new Error(`Target Proxmox node '${req.targetNodeId}' not found.`);
      (err as any).statusCode = 404;
      throw err;
    }

    if (node.enabled === false || ["disabled", "draining", "deleting", "offline"].includes(node.status || "")) {
      const err = new Error(
        `Target Proxmox node '${node.name}' is currently ${node.status || "disabled"} and cannot accept new VPS deployments.`
      );
      (err as any).statusCode = 422;
      throw err;
    }

    // 3. Pre-flight Validation: Verify template, storage, bridge, and IP pool
    const effectiveStorage = req.storage || node.defaultRootfsStorage || node.defaultStorage;
    const effectiveBridge = req.bridge || node.defaultBridge;

    // Validate templates on target node
    let discoveredTemplates: Array<{ volid: string }> = [];
    try {
      discoveredTemplates = await ProxmoxService.getTemplates(node);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const e = new Error(`Cannot verify container templates on node '${node.name}': ${msg}`);
      (e as any).statusCode = 422;
      throw e;
    }

    const templateExists = discoveredTemplates.some(
      (t) => t.volid.toLowerCase() === req.osTemplate.trim().toLowerCase()
    );

    if (!templateExists) {
      const e = new Error(
        `Template '${req.osTemplate}' does not exist on target node '${node.name}'. Discovered templates: [${discoveredTemplates.map((t) => t.volid).join(", ")}]`
      );
      (e as any).statusCode = 422;
      throw e;
    }

    // Validate rootfs storage on target node
    if (effectiveStorage) {
      try {
        const storages = await ProxmoxService.getStorageList(node);
        const targetStorage = storages.find(
          (s) => s.storage.toLowerCase() === effectiveStorage.trim().toLowerCase()
        );

        if (!targetStorage) {
          const e = new Error(
            `Rootfs storage pool '${effectiveStorage}' was not found on target node '${node.name}'. Available: [${storages.map((s) => s.storage).join(", ")}]`
          );
          (e as any).statusCode = 422;
          throw e;
        }

        if (!targetStorage.supportsRootfs) {
          const e = new Error(
            `Storage pool '${effectiveStorage}' does not support container root disks ('rootdir' or 'images'). Content types: [${targetStorage.content.join(", ")}]`
          );
          (e as any).statusCode = 422;
          throw e;
        }
      } catch (err: unknown) {
        if ((err as any).statusCode === 422) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        const e = new Error(`Failed to validate rootfs storage on node: ${msg}`);
        (e as any).statusCode = 422;
        throw e;
      }
    }

    // Validate network bridge
    if (effectiveBridge) {
      try {
        const bridges = await ProxmoxService.getNetworkBridges(node);
        const bridgeExists = bridges.some(
          (b) => b.iface.toLowerCase() === effectiveBridge.trim().toLowerCase()
        );
        if (!bridgeExists) {
          const e = new Error(
            `Network bridge '${effectiveBridge}' was not found on target node '${node.name}'. Discovered bridges: [${bridges.map((b) => b.iface).join(", ")}]`
          );
          (e as any).statusCode = 422;
          throw e;
        }
      } catch (err: unknown) {
        if ((err as any).statusCode === 422) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        const e = new Error(`Failed to validate network bridge on node: ${msg}`);
        (e as any).statusCode = 422;
        throw e;
      }
    }

    // Validate IP Pool availability if specified
    if (req.ipv4PoolId) {
      const availableIp = queryOne<any>(
        `SELECT id FROM ip_addresses WHERE pool_id = ? AND status = 'available' LIMIT 1`,
        [req.ipv4PoolId]
      );
      if (!availableIp) {
        const e = new Error("No available IPv4 address is configured for this node in the selected pool.");
        (e as any).statusCode = 422;
        throw e;
      }
    }

    // 4. Create job row
    const jobId = uuidv4();
    const specsJson = JSON.stringify({
      hostname: req.hostname,
      name: req.name || `${req.hostname} Instance`,
      description: req.description || null,
      osTemplate: req.osTemplate.trim(),
      cpuCores: req.cpuCores,
      memoryMb: req.memoryMb,
      swapMb: req.swapMb || 512,
      diskGb: req.diskGb,
      storage: effectiveStorage,
      bridge: effectiveBridge,
      ipv4PoolId: req.ipv4PoolId,
      startAfterCreate: req.startAfterCreate !== false,
      hasSshKey: Boolean(req.sshPublicKey),
      expiresAt: normalizedExpiresAt,
    });

    // Store in-memory credentials for the async worker
    if (req.rootPassword || req.sshPublicKey) {
      ephemeralJobCredentials.set(jobId, {
        password: req.rootPassword,
        sshKey: req.sshPublicKey,
      });
    }

    execute(
      `INSERT INTO provisioning_jobs (
        id, idempotency_key, owner_user_id, target_node_id, requested_by_user_id,
        hostname, specs_json, status, current_step, request_hash, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', ?, datetime('now'))`,
      [
        jobId,
        req.idempotencyKey || null,
        req.ownerUserId,
        req.targetNodeId,
        req.requestedByUserId,
        req.hostname,
        specsJson,
        requestHash,
      ]
    );

    // Audit log
    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata)
       VALUES (?, 'vps_provision_requested', ?)`,
      [
        req.requestedByUserId,
        JSON.stringify({
          job_id: jobId,
          owner_user_id: req.ownerUserId,
          node_id: req.targetNodeId,
          hostname: req.hostname,
        }),
      ]
    );

    // Trigger asynchronous execution in background
    setImmediate(() => {
      this.executeJob(jobId).catch((err) => {
        console.error(`[PROVISIONING] Background job ${jobId} unhandled error:`, err);
      });
    });

    return { jobId, status: "queued" };
  }

  /**
   * Main asynchronous execution engine for a provisioning job
   */
  public static async executeJob(jobId: string): Promise<void> {
    const job = queryOne<any>(
      "SELECT * FROM provisioning_jobs WHERE id = ? LIMIT 1",
      [jobId]
    );
    if (!job || job.status !== "queued") return;

    const specs = JSON.parse(job.specs_json);
    const node = this.getNodeConfig(job.target_node_id);

    // Retrieve ephemeral in-memory credentials and clear them
    const creds = ephemeralJobCredentials.get(jobId);
    ephemeralJobCredentials.delete(jobId);

    if (!node) {
      this.failJob(jobId, "NODE_NOT_FOUND", "Proxmox node is no longer available.");
      return;
    }

    let allocatedVmid: number | null = null;
    let reservedIpId: string | null = null;
    let reservedIpAddr: string | null = null;
    let gateway: string | undefined;

    try {
      // Step 1: Validating configuration & node
      this.updateJobStep(jobId, "allocating", "validating_configuration");
      const verification = await ProxmoxService.verifyNode(node, true);
      if (!verification.reachable) {
        throw new Error(`Target node '${node.name}' is currently offline or unreachable.`);
      }
      if (!verification.identityVerified) {
        throw new Error(
          `Target node '${node.name}' failed identity verification: ${verification.error || "node identity mismatch"}.`
        );
      }

      // Step 2: Allocating VMID
      this.updateJobStep(jobId, "allocating", "allocating_vmid");
      allocatedVmid = await ProxmoxService.getNextVmid(node);
      execute("UPDATE provisioning_jobs SET vmid = ? WHERE id = ?", [allocatedVmid, jobId]);

      // Step 3: Reserving Network / IP
      this.updateJobStep(jobId, "allocating", "reserving_network");
      if (specs.ipv4PoolId) {
        const ipRow = queryOne<any>(
          `SELECT id, ip_address, pool_id FROM ip_addresses
           WHERE pool_id = ? AND status = 'available'
           LIMIT 1`,
          [specs.ipv4PoolId]
        );
        if (!ipRow) {
          throw new Error("No available IPv4 address is configured for this node in the selected pool.");
        }
        reservedIpId = ipRow.id;
        reservedIpAddr = ipRow.ip_address;
        execute(
          `UPDATE ip_addresses SET status = 'reserved', reserved_at = datetime('now') WHERE id = ?`,
          [reservedIpId]
        );

        const pool = queryOne<any>("SELECT gateway FROM ip_pools WHERE id = ?", [
          specs.ipv4PoolId,
        ]);
        if (pool) gateway = pool.gateway;
      }

      // Step 4: Creating LXC Container on Proxmox
      this.updateJobStep(jobId, "creating", "creating_container");
      const { upid } = await ProxmoxService.createLxc(node, {
        vmid: allocatedVmid,
        hostname: specs.hostname,
        ostemplate: specs.osTemplate,
        cores: specs.cpuCores,
        memoryMb: specs.memoryMb,
        swapMb: specs.swapMb,
        diskGb: specs.diskGb,
        storage: specs.storage,
        bridge: specs.bridge,
        ipv4: reservedIpAddr ? `${reservedIpAddr}/24` : undefined,
        ipv4Gateway: gateway,
        password: creds?.password,
        sshPublicKeys: creds?.sshKey,
        description: specs.description || `Managed by InterDash for ${specs.hostname}`,
        startAfterCreate: specs.startAfterCreate,
      });

      // Step 5: Wait for creation task to complete
      this.updateJobStep(jobId, "creating", "waiting_for_proxmox_task");
      await ProxmoxService.waitForProxmoxTask(node, upid, 180_000, 2_000);

      // Step 6: Configuring container
      this.updateJobStep(jobId, "configuring", "configuring_container");

      // Step 7: Starting container (if requested)
      if (specs.startAfterCreate) {
        this.updateJobStep(jobId, "starting", "starting_container");
        try {
          const startRes = await ProxmoxService.startLxc(node, allocatedVmid);
          await ProxmoxService.waitForProxmoxTask(node, startRes.upid, 30_000, 1_500);
        } catch (startErr) {
          console.warn(`[PROVISIONING] Container ${allocatedVmid} start had non-fatal warning:`, startErr);
        }
      }

      // Step 8: Verify container status
      this.updateJobStep(jobId, "verifying", "verifying_container");
      const lxcStatus = await ProxmoxService.getLxcStatus(node, allocatedVmid);

      // Step 9: Persisting VPS record
      this.updateJobStep(jobId, "verifying", "persisting_record");
      const vpsId = uuidv4();
      const finalStatus = lxcStatus.status === "running" ? "running" : "stopped";

      execute(
        `INSERT INTO vps (
          id, owner_user_id, proxmox_node_id, proxmox_vmid, name, hostname,
          description, status, os_image_id, cpu_cores, memory_mb, swap_mb, disk_gb,
          ipv4_address, ipv6_address, expires_at, last_proxmox_sync_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`,
        [
          vpsId,
          job.owner_user_id,
          job.target_node_id,
          allocatedVmid,
          specs.name,
          specs.hostname,
          specs.description || null,
          finalStatus,
          specs.osTemplate,
          specs.cpuCores,
          specs.memoryMb,
          specs.swapMb,
          specs.diskGb,
          reservedIpAddr || "DHCP",
          null,
          specs.expiresAt ? new Date(parseDatabaseTimestampUtc(specs.expiresAt).getTime()).toISOString() : null,
        ]
      );

      // Mark IP address as assigned
      if (reservedIpId) {
        execute(
          `UPDATE ip_addresses SET status = 'assigned', vps_id = ?, assigned_at = datetime('now') WHERE id = ?`,
          [vpsId, reservedIpId]
        );
      }

      // Step 9b: Execute First-Install Startup Script (if enabled by admin)
      if (finalStatus === "running") {
        this.updateJobStep(jobId, "configuring", "executing_startup_script");
        try {
          await StartupScriptService.executeForVps({
            node,
            vmid: allocatedVmid,
            vpsId,
            hostname: specs.hostname,
            ipv4: reservedIpAddr,
          });
        } catch (scriptErr) {
          console.warn(
            `[PROVISIONING] Startup script had non-fatal warning on VMID ${allocatedVmid}:`,
            scriptErr
          );
        }
      }

      // Mark Job as Completed
      execute(
        `UPDATE provisioning_jobs SET
          vps_id = ?, status = 'completed', current_step = 'completed',
          completed_at = datetime('now')
         WHERE id = ?`,
        [vpsId, jobId]
      );

      // Audit Log
      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'vps_provision_succeeded', ?)`,
        [
          job.requested_by_user_id,
          JSON.stringify({
            job_id: jobId,
            vps_id: vpsId,
            vmid: allocatedVmid,
            node_id: job.target_node_id,
          }),
        ]
      );

      console.log(
        `[PROVISIONING] VPS ${specs.hostname} (VMID ${allocatedVmid}) created successfully on node ${node.name}`
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[PROVISIONING] Job ${jobId} failed:`, errorMsg);

      // Rollback IP reservation
      if (reservedIpId) {
        try {
          execute(
            `UPDATE ip_addresses SET status = 'available', reserved_at = null WHERE id = ?`,
            [reservedIpId]
          );
        } catch {}
      }

      // Rollback Proxmox container if VMID was allocated and container might exist
      if (allocatedVmid) {
        try {
          this.updateJobStep(jobId, "failed", "destroying_container");
          await ProxmoxService.destroyLxc(node, allocatedVmid, true);
          execute("UPDATE provisioning_jobs SET cleanup_status = 'cleaned' WHERE id = ?", [jobId]);
        } catch (cleanupErr) {
          console.error(`[PROVISIONING] Cleanup of VMID ${allocatedVmid} failed:`, cleanupErr);
          execute(
            "UPDATE provisioning_jobs SET cleanup_status = 'cleanup_failed' WHERE id = ?",
            [jobId]
          );
        }
      }

      this.failJob(jobId, "PROXMOX_PROVISION_ERROR", errorMsg);
    }
  }

  /**
   * Reconcile interrupted jobs on server restart
   */
  public static async reconcileInterruptedJobs(): Promise<void> {
    const pendingJobs = queryAll<any>(
      `SELECT * FROM provisioning_jobs
       WHERE status NOT IN ('completed', 'failed', 'cancelled', 'recovery_required')`
    );

    if (!pendingJobs.length) return;

    console.log(`[PROVISIONING] Found ${pendingJobs.length} interrupted provisioning job(s) to reconcile...`);

    for (const job of pendingJobs) {
      const node = this.getNodeConfig(job.target_node_id);
      if (!node) {
        this.failJob(job.id, "NODE_UNAVAILABLE", "Target Proxmox node unavailable during reconciliation.");
        continue;
      }

      if (!job.vmid) {
        // Did not reach VMID allocation; safe to fail cleanly
        this.failJob(job.id, "INTERRUPTED", "Provisioning interrupted prior to resource allocation.");
        continue;
      }

      try {
        const lxcStatus = await ProxmoxService.getLxcStatus(node, job.vmid);
        if (lxcStatus.status === "running" || lxcStatus.status === "stopped") {
          // Container was actually created on Proxmox
          const existingVps = queryOne<any>(
            "SELECT id FROM vps WHERE proxmox_node_id = ? AND proxmox_vmid = ?",
            [node.id, job.vmid]
          );

          if (!existingVps) {
            const specs = JSON.parse(job.specs_json);
            const vpsId = uuidv4();
            execute(
              `INSERT INTO vps (
                id, owner_user_id, proxmox_node_id, proxmox_vmid, name, hostname,
                description, status, os_image_id, cpu_cores, memory_mb, swap_mb, disk_gb,
                ipv4_address, ipv6_address, last_proxmox_sync_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`,
              [
                vpsId,
                job.owner_user_id,
                job.target_node_id,
                job.vmid,
                specs.name || specs.hostname,
                specs.hostname,
                specs.description || null,
                lxcStatus.status,
                specs.osTemplate,
                specs.cpuCores,
                specs.memoryMb,
                specs.swapMb || 512,
                specs.diskGb,
                "DHCP",
                null,
              ]
            );
            execute(
              "UPDATE provisioning_jobs SET vps_id = ?, status = 'completed', current_step = 'completed', completed_at = datetime('now') WHERE id = ?",
              [vpsId, job.id]
            );
          } else {
            execute(
              "UPDATE provisioning_jobs SET vps_id = ?, status = 'completed', current_step = 'completed', completed_at = datetime('now') WHERE id = ?",
              [existingVps.id, job.id]
            );
          }
          console.log(`[PROVISIONING] Reconciled and restored job ${job.id} (VMID ${job.vmid})`);
        } else {
          // Container does not exist on Proxmox, clean up and fail
          this.failJob(job.id, "RECONCILIATION_ABORTED", "Container could not be located on Proxmox during startup reconciliation.");
        }
      } catch (err) {
        execute(
          "UPDATE provisioning_jobs SET status = 'recovery_required', current_step = 'recovery_required' WHERE id = ?",
          [job.id]
        );
      }
    }
  }

  private static updateJobStep(jobId: string, status: string, step: string): void {
    execute(
      `UPDATE provisioning_jobs SET status = ?, current_step = ? WHERE id = ?`,
      [status, step, jobId]
    );
  }

  private static failJob(jobId: string, errorCode: string, errorMsg: string): void {
    execute(
      `UPDATE provisioning_jobs SET
        status = CASE WHEN status = 'recovery_required' THEN 'recovery_required' ELSE 'failed' END,
        current_step = 'failed',
        error_code = ?,
        error_message = ?,
        completed_at = datetime('now')
       WHERE id = ?`,
      [errorCode, errorMsg, jobId]
    );

    // Audit log failure
    const job = queryOne<any>(
      "SELECT requested_by_user_id FROM provisioning_jobs WHERE id = ?",
      [jobId]
    );
    if (job) {
      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'vps_provision_failed', ?)`,
        [job.requested_by_user_id, JSON.stringify({ job_id: jobId, error: errorMsg })]
      );
    }
  }
}
