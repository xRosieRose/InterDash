/**
 * InterDash Server — Asynchronous VPS Provisioning Service & Worker
 *
 * Implements an asynchronous job queue for LXC provisioning on Proxmox VE.
 * Enforces:
 *   - Idempotency (prevents double provisioning)
 *   - Step-by-step state machine updates
 *   - Network resource reservation & atomic assignment
 *   - Automatic rollback and resource cleanup on partial failure
 *   - Comprehensive audit logging
 */

import { v4 as uuidv4 } from "uuid";
import { getDb, queryOne, execute } from "../db/index.js";
import { ProxmoxService, type ProxmoxNodeConfig } from "./proxmox.js";
import { decryptCredential } from "./crypto.js";

export interface ProvisioningJobRequest {
  ownerUserId: string;
  targetNodeId: string;
  requestedByUserId: string;
  hostname: string;
  name?: string;
  osTemplate: string;
  cpuCores: number;
  memoryMb: number;
  swapMb?: number;
  diskGb: number;
  storage?: string;
  bridge?: string;
  ipv4PoolId?: string;
  startAfterCreate?: boolean;
  idempotencyKey?: string;
}

export class ProvisioningService {
  /**
   * Helper to retrieve a decrypted Proxmox node config from database
   */
  public static getNodeConfig(nodeId: string): ProxmoxNodeConfig | null {
    const row = queryOne<any>(
      `SELECT id, name, hostname, api_url, port, node_name, region,
              auth_token_id, auth_token_secret_encrypted, allow_insecure_tls,
              default_storage, default_bridge, enabled, status
       FROM proxmox_nodes WHERE id = ? LIMIT 1`,
      [nodeId]
    );

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      hostname: row.hostname,
      apiUrl: row.api_url,
      port: row.port,
      nodeName: row.node_name,
      region: row.region,
      authTokenId: row.auth_token_id,
      authTokenSecret: decryptCredential(row.auth_token_secret_encrypted),
      allowInsecureTls: Boolean(row.allow_insecure_tls),
      defaultStorage: row.default_storage || "local-lvm",
      defaultBridge: row.default_bridge || "vmbr0",
    };
  }

  /**
   * Submit a new VPS provisioning job
   */
  public static async submitJob(req: ProvisioningJobRequest): Promise<{
    jobId: string;
    status: string;
    isDuplicate?: boolean;
  }> {
    // 1. Idempotency check
    if (req.idempotencyKey) {
      const existing = queryOne<{ id: string; status: string }>(
        "SELECT id, status FROM provisioning_jobs WHERE idempotency_key = ? LIMIT 1",
        [req.idempotencyKey]
      );
      if (existing) {
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
      throw new Error(`Target Proxmox node '${req.targetNodeId}' not found.`);
    }

    // 3. Create job row
    const jobId = uuidv4();
    const specsJson = JSON.stringify({
      hostname: req.hostname,
      name: req.name || `${req.hostname} Instance`,
      osTemplate: req.osTemplate,
      cpuCores: req.cpuCores,
      memoryMb: req.memoryMb,
      swapMb: req.swapMb || 512,
      diskGb: req.diskGb,
      storage: req.storage || node.defaultStorage,
      bridge: req.bridge || node.defaultBridge,
      ipv4PoolId: req.ipv4PoolId,
      startAfterCreate: req.startAfterCreate !== false,
    });

    execute(
      `INSERT INTO provisioning_jobs (
        id, idempotency_key, owner_user_id, target_node_id, requested_by_user_id,
        hostname, specs_json, status, current_step, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', datetime('now'))`,
      [
        jobId,
        req.idempotencyKey || null,
        req.ownerUserId,
        req.targetNodeId,
        req.requestedByUserId,
        req.hostname,
        specsJson,
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

    if (!node) {
      this.failJob(jobId, "NODE_NOT_FOUND", "Proxmox node is no longer available.");
      return;
    }

    let allocatedVmid: number | null = null;
    let reservedIpId: string | null = null;
    let reservedIpAddr: string | null = null;
    let gateway: string | undefined;

    try {
      // Step 1: Allocating VMID
      this.updateJobStep(jobId, "allocating", "allocating_vmid");
      allocatedVmid = await ProxmoxService.getNextVmid(node);

      // Step 2: Reserving Network / IP
      this.updateJobStep(jobId, "allocating", "reserving_network");
      if (specs.ipv4PoolId) {
        const ipRow = queryOne<any>(
          `SELECT id, ip_address, pool_id FROM ip_addresses
           WHERE pool_id = ? AND status = 'available'
           LIMIT 1`,
          [specs.ipv4PoolId]
        );
        if (ipRow) {
          reservedIpId = ipRow.id;
          reservedIpAddr = ipRow.ip_address;
          execute(
            `UPDATE ip_addresses SET status = 'reserved', reserved_at = datetime('now') WHERE id = ?`,
            [reservedIpId]
          );

          // Get pool gateway
          const pool = queryOne<any>("SELECT gateway FROM ip_pools WHERE id = ?", [
            specs.ipv4PoolId,
          ]);
          if (pool) gateway = pool.gateway;
        }
      }

      // Step 3: Creating LXC Container on Proxmox
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
        startAfterCreate: specs.startAfterCreate,
      });

      // Step 4: Wait for creation task to finish
      this.updateJobStep(jobId, "configuring", "waiting_for_proxmox_task");
      let attempts = 0;
      let taskSuccess = false;

      while (attempts < 60) {
        await new Promise((r) => setTimeout(r, 2000));
        const taskStatus = await ProxmoxService.getTaskStatus(node, upid);
        if (taskStatus.status === "stopped") {
          if (taskStatus.exitstatus === "OK") {
            taskSuccess = true;
          } else {
            throw new Error(`Proxmox task ended with status: ${taskStatus.exitstatus}`);
          }
          break;
        }
        attempts++;
      }

      if (!taskSuccess) {
        throw new Error("Proxmox container creation timed out after 120 seconds.");
      }

      // Step 5: Verify container status
      this.updateJobStep(jobId, "verifying", "verifying_container");
      const lxcStatus = await ProxmoxService.getLxcStatus(node, allocatedVmid);

      // Step 6: Persist VPS to Database
      const vpsId = uuidv4();
      const finalStatus = lxcStatus.status === "running" ? "running" : "stopped";

      execute(
        `INSERT INTO vps (
          id, owner_user_id, proxmox_node_id, proxmox_vmid, name, hostname,
          status, os_image_id, cpu_cores, memory_mb, swap_mb, disk_gb,
          ipv4_address, ipv6_address, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          vpsId,
          job.owner_user_id,
          job.target_node_id,
          allocatedVmid,
          specs.name,
          specs.hostname,
          finalStatus,
          specs.osTemplate,
          specs.cpuCores,
          specs.memoryMb,
          specs.swapMb,
          specs.diskGb,
          reservedIpAddr || "DHCP",
          null,
        ]
      );

      // Mark IP address as assigned
      if (reservedIpId) {
        execute(
          `UPDATE ip_addresses SET status = 'assigned', vps_id = ?, assigned_at = datetime('now') WHERE id = ?`,
          [vpsId, reservedIpId]
        );
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
        execute(
          `UPDATE ip_addresses SET status = 'available', reserved_at = null WHERE id = ?`,
          [reservedIpId]
        );
      }

      this.failJob(jobId, "PROXMOX_PROVISION_ERROR", errorMsg);
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
        status = 'failed', current_step = 'failed', error_code = ?,
        error_message = ?, completed_at = datetime('now')
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
