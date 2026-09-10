/**
 * InterDash Server — Real VPS Lifecycle Operations Service
 *
 * Implements authoritative Proxmox VE operations for:
 *   - Power management (Start, Graceful Shutdown, Hard Stop, Reboot)
 *   - Interactive console session preparation & termproxy
 *   - Display Name & Description metadata updates
 *   - Root password reset (real Proxmox config mutation; never logged or saved to DB)
 *   - Destructive OS Reinstall (with exact hostname verification and state recovery)
 *   - Real-time Proxmox status synchronization & telemetry
 *
 * Concurrency & Locking:
 *   - Enforces atomic server-side operation claims in the database.
 *   - Inspects Proxmox hypervisor locks prior to mutating containers.
 *   - Returns 409 Conflict if a conflicting operation is already active.
 */

import { v4 as uuidv4 } from "uuid";
import { queryOne, queryAll, execute, transaction } from "../db/index.js";
import { ProxmoxService, type ProxmoxNodeConfig } from "./proxmox.js";
import { ProvisioningService } from "./provisioning.js";

export interface OperationResult {
  operationId: string;
  vpsId: string;
  type: string;
  status: "completed" | "failed" | "recovery_required";
  message?: string;
  data?: Record<string, unknown>;
}

export class VpsOperationsService {
  /**
   * Helper: Resolve VPS and associated decrypted Proxmox Node
   */
  public static resolveVpsAndNode(vpsId: string): {
    vps: any;
    node: ProxmoxNodeConfig;
  } {
    const vps = queryOne<any>(
      `SELECT v.*, n.id as node_db_id
       FROM vps v
       JOIN proxmox_nodes n ON v.proxmox_node_id = n.id
       WHERE v.id = ? LIMIT 1`,
      [vpsId]
    );

    if (!vps) {
      const err = new Error("VPS instance not found.");
      (err as any).statusCode = 404;
      throw err;
    }

    const node = ProvisioningService.getNodeConfig(vps.proxmox_node_id);
    if (!node) {
      const err = new Error(`Associated Proxmox node '${vps.proxmox_node_id}' is unavailable.`);
      (err as any).statusCode = 502;
      throw err;
    }

    return { vps, node };
  }

  /**
   * Atomically claim an operation lock for a VPS.
   * Throws 409 Conflict if an active operation is already running.
   */
  public static claimOperation(
    vpsId: string,
    userId: string,
    operationType: string,
    paramsSafe?: Record<string, unknown>
  ): string {
    return transaction(() => {
      // 1. Check for existing active operations in database
      const activeOp = queryOne<any>(
        `SELECT id, operation_type, status, current_step
         FROM vps_operations
         WHERE vps_id = ? AND status IN ('queued', 'running', 'waiting_for_proxmox_task')
         LIMIT 1`,
        [vpsId]
      );

      if (activeOp) {
        const err = new Error(
          `Conflict: Operation '${activeOp.operation_type}' is currently active on this VPS.`
        );
        (err as any).statusCode = 409;
        throw err;
      }

      // 2. Insert new operation
      const operationId = uuidv4();
      const paramsJson = paramsSafe ? JSON.stringify(paramsSafe) : null;

      execute(
        `INSERT INTO vps_operations (
          id, vps_id, requested_by_user_id, operation_type,
          status, current_step, params_json, started_at
        ) VALUES (?, ?, ?, ?, 'running', 'initiating', ?, datetime('now'))`,
        [operationId, vpsId, userId, operationType, paramsJson]
      );

      // 3. Mark VPS lock_state
      execute(
        `UPDATE vps SET lock_state = ?, updated_at = datetime('now') WHERE id = ?`,
        [operationType, vpsId]
      );

      return operationId;
    });
  }

  /**
   * Complete an operation successfully
   */
  public static completeOperation(
    operationId: string,
    vpsId: string,
    resultSafe?: Record<string, unknown>
  ): void {
    const resultJson = resultSafe ? JSON.stringify(resultSafe) : null;
    execute(
      `UPDATE vps_operations SET
        status = 'completed', current_step = 'completed',
        result_json = ?, completed_at = datetime('now')
       WHERE id = ?`,
      [resultJson, operationId]
    );

    execute(
      `UPDATE vps SET lock_state = NULL, updated_at = datetime('now') WHERE id = ?`,
      [vpsId]
    );
  }

  /**
   * Fail an operation with error code and description
   */
  public static failOperation(
    operationId: string,
    vpsId: string,
    errorCode: string,
    errorMessage: string,
    recoveryRequired = false
  ): void {
    const finalStatus = recoveryRequired ? "recovery_required" : "failed";
    execute(
      `UPDATE vps_operations SET
        status = ?, current_step = 'failed',
        error_code = ?, error_message = ?, completed_at = datetime('now')
       WHERE id = ?`,
      [finalStatus, errorCode, errorMessage, operationId]
    );

    execute(
      `UPDATE vps SET lock_state = NULL, updated_at = datetime('now') WHERE id = ?`,
      [vpsId]
    );
  }

  /**
   * Power action: start
   */
  public static async start(vpsId: string, userId: string): Promise<OperationResult> {
    const { vps, node } = this.resolveVpsAndNode(vpsId);

    // Check hypervisor lock
    const pveLock = await ProxmoxService.checkLxcLocked(node, vps.proxmox_vmid);
    if (pveLock.locked) {
      const err = new Error(`VPS is locked on hypervisor (${pveLock.lockName || "busy"}).`);
      (err as any).statusCode = 409;
      throw err;
    }

    const opId = this.claimOperation(vpsId, userId, "start");

    try {
      // Check current live status
      const current = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid);
      if (current.status === "running") {
        execute(
          `UPDATE vps SET status = 'running', last_proxmox_sync_at = datetime('now') WHERE id = ?`,
          [vpsId]
        );
        this.completeOperation(opId, vpsId, { status: "running", alreadyRunning: true });
        return { operationId: opId, vpsId, type: "start", status: "completed" };
      }

      execute(
        "UPDATE vps_operations SET current_step = 'sending_start_signal' WHERE id = ?",
        [opId]
      );
      const { upid } = await ProxmoxService.startLxc(node, vps.proxmox_vmid);

      execute(
        "UPDATE vps_operations SET status = 'waiting_for_proxmox_task', current_step = 'waiting_for_task' WHERE id = ?",
        [opId]
      );
      await ProxmoxService.waitForProxmoxTask(node, upid, 45_000, 1_500);

      // Verify live status
      const verified = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid);
      const finalStatus = verified.status === "running" ? "running" : "stopped";

      execute(
        `UPDATE vps SET status = ?, last_proxmox_sync_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        [finalStatus, vpsId]
      );

      this.completeOperation(opId, vpsId, { finalStatus });

      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'vps_started', ?)`,
        [userId, JSON.stringify({ vps_id: vpsId, vmid: vps.proxmox_vmid })]
      );

      return { operationId: opId, vpsId, type: "start", status: "completed" };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.failOperation(opId, vpsId, "START_FAILED", msg);
      throw err;
    }
  }

  /**
   * Power action: stop (graceful shutdown by default, force stop if requested)
   */
  public static async stop(
    vpsId: string,
    userId: string,
    force = false
  ): Promise<OperationResult> {
    const { vps, node } = this.resolveVpsAndNode(vpsId);

    const pveLock = await ProxmoxService.checkLxcLocked(node, vps.proxmox_vmid);
    if (pveLock.locked) {
      const err = new Error(`VPS is locked on hypervisor (${pveLock.lockName || "busy"}).`);
      (err as any).statusCode = 409;
      throw err;
    }

    const opId = this.claimOperation(vpsId, userId, "stop", { force });

    try {
      const current = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid);
      if (current.status === "stopped") {
        execute(
          `UPDATE vps SET status = 'stopped', last_proxmox_sync_at = datetime('now') WHERE id = ?`,
          [vpsId]
        );
        this.completeOperation(opId, vpsId, { status: "stopped", alreadyStopped: true });
        return { operationId: opId, vpsId, type: "stop", status: "completed" };
      }

      execute(
        `UPDATE vps_operations SET current_step = '${force ? "sending_stop_signal" : "sending_shutdown_signal"}' WHERE id = ?`,
        [opId]
      );

      const { upid } = force
        ? await ProxmoxService.stopLxc(node, vps.proxmox_vmid)
        : await ProxmoxService.shutdownLxc(node, vps.proxmox_vmid);

      execute(
        "UPDATE vps_operations SET status = 'waiting_for_proxmox_task', current_step = 'waiting_for_task' WHERE id = ?",
        [opId]
      );
      await ProxmoxService.waitForProxmoxTask(node, upid, 60_000, 1_500);

      const verified = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid);
      const finalStatus = verified.status === "running" ? "running" : "stopped";

      execute(
        `UPDATE vps SET status = ?, last_proxmox_sync_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        [finalStatus, vpsId]
      );

      this.completeOperation(opId, vpsId, { finalStatus, forced: force });

      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'vps_stopped', ?)`,
        [userId, JSON.stringify({ vps_id: vpsId, vmid: vps.proxmox_vmid, forced: force })]
      );

      return { operationId: opId, vpsId, type: "stop", status: "completed" };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.failOperation(opId, vpsId, "STOP_FAILED", msg);
      throw err;
    }
  }

  /**
   * Power action: reboot
   */
  public static async reboot(vpsId: string, userId: string): Promise<OperationResult> {
    const { vps, node } = this.resolveVpsAndNode(vpsId);

    const pveLock = await ProxmoxService.checkLxcLocked(node, vps.proxmox_vmid);
    if (pveLock.locked) {
      const err = new Error(`VPS is locked on hypervisor (${pveLock.lockName || "busy"}).`);
      (err as any).statusCode = 409;
      throw err;
    }

    const opId = this.claimOperation(vpsId, userId, "reboot");

    try {
      execute(
        "UPDATE vps_operations SET current_step = 'sending_reboot_signal' WHERE id = ?",
        [opId]
      );
      const { upid } = await ProxmoxService.rebootLxc(node, vps.proxmox_vmid);

      execute(
        "UPDATE vps_operations SET status = 'waiting_for_proxmox_task', current_step = 'waiting_for_task' WHERE id = ?",
        [opId]
      );
      await ProxmoxService.waitForProxmoxTask(node, upid, 60_000, 2_000);

      const verified = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid);
      const finalStatus = verified.status === "running" ? "running" : "stopped";

      execute(
        `UPDATE vps SET status = ?, last_proxmox_sync_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        [finalStatus, vpsId]
      );

      this.completeOperation(opId, vpsId, { finalStatus });

      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'vps_rebooted', ?)`,
        [userId, JSON.stringify({ vps_id: vpsId, vmid: vps.proxmox_vmid })]
      );

      return { operationId: opId, vpsId, type: "reboot", status: "completed" };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.failOperation(opId, vpsId, "REBOOT_FAILED", msg);
      throw err;
    }
  }

  /**
   * Settings: Change root password
   */
  public static async changeRootPassword(
    vpsId: string,
    userId: string,
    newPassword: string
  ): Promise<OperationResult> {
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
      const err = new Error("Root password must be at least 8 characters.");
      (err as any).statusCode = 400;
      throw err;
    }

    const { vps, node } = this.resolveVpsAndNode(vpsId);

    const pveLock = await ProxmoxService.checkLxcLocked(node, vps.proxmox_vmid);
    if (pveLock.locked) {
      const err = new Error(`VPS is locked on hypervisor (${pveLock.lockName || "busy"}).`);
      (err as any).statusCode = 409;
      throw err;
    }

    // Notice: password is NEVER saved in paramsSafe or params_json!
    const opId = this.claimOperation(vpsId, userId, "password_reset");

    try {
      execute(
        "UPDATE vps_operations SET current_step = 'applying_password_to_hypervisor' WHERE id = ?",
        [opId]
      );

      await ProxmoxService.setLxcPassword(node, vps.proxmox_vmid, newPassword);

      execute(
        `UPDATE vps SET updated_at = datetime('now') WHERE id = ?`,
        [vpsId]
      );

      this.completeOperation(opId, vpsId, { updated: true });

      // Audit log does NOT contain the password
      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'vps_password_changed', ?)`,
        [userId, JSON.stringify({ vps_id: vpsId, vmid: vps.proxmox_vmid })]
      );

      return { operationId: opId, vpsId, type: "password_reset", status: "completed" };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.failOperation(opId, vpsId, "PASSWORD_RESET_FAILED", msg);
      throw err;
    }
  }

  /**
   * Settings: Update metadata (name, description)
   */
  public static async updateMetadata(
    vpsId: string,
    userId: string,
    fields: { name?: string; description?: string }
  ): Promise<void> {
    const { vps, node } = this.resolveVpsAndNode(vpsId);

    const updates: string[] = [];
    const params: any[] = [];

    if (fields.name !== undefined) {
      const trimmed = String(fields.name).trim();
      if (!trimmed) {
        const err = new Error("Display Name cannot be empty.");
        (err as any).statusCode = 400;
        throw err;
      }
      updates.push("name = ?");
      params.push(trimmed);
    }

    if (fields.description !== undefined) {
      const trimmedDesc = String(fields.description).trim();
      updates.push("description = ?");
      params.push(trimmedDesc || null);

      // Synchronize description to Proxmox container config
      try {
        await ProxmoxService.updateLxcConfig(node, vps.proxmox_vmid, {
          description: trimmedDesc || `Managed by InterDash for ${vps.hostname}`,
        });
      } catch (pveErr) {
        console.warn(`[VPS-OPS] Could not sync description to Proxmox:`, pveErr);
      }
    }

    if (!updates.length) return;

    updates.push("updated_at = datetime('now')");
    params.push(vpsId);

    execute(`UPDATE vps SET ${updates.join(", ")} WHERE id = ?`, params);

    if (fields.name !== undefined) {
      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'vps_name_changed', ?)`,
        [userId, JSON.stringify({ vps_id: vpsId, new_name: fields.name })]
      );
    }
    if (fields.description !== undefined) {
      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'vps_description_changed', ?)`,
        [userId, JSON.stringify({ vps_id: vpsId })]
      );
    }
  }

  /**
   * Destructive OS Reinstall:
   * Requires exact hostname confirmation.
   * Stops, destroys, and recreates the container on Proxmox with identical VMID & network.
   */
  public static async reinstall(
    vpsId: string,
    userId: string,
    params: {
      template: string;
      rootPassword?: string;
      sshKey?: string;
      confirmHostname: string;
    }
  ): Promise<OperationResult> {
    const { vps, node } = this.resolveVpsAndNode(vpsId);

    // Strict validation: exact hostname confirmation required
    if (!params.confirmHostname || params.confirmHostname.trim() !== vps.hostname.trim()) {
      const err = new Error(
        `Confirmation mismatch: You must enter the exact VPS hostname '${vps.hostname}' to reinstall.`
      );
      (err as any).statusCode = 400;
      throw err;
    }

    if (!params.template || typeof params.template !== "string") {
      const err = new Error("A valid OS template must be specified for reinstall.");
      (err as any).statusCode = 400;
      throw err;
    }

    const pveLock = await ProxmoxService.checkLxcLocked(node, vps.proxmox_vmid);
    if (pveLock.locked) {
      const err = new Error(`VPS is locked on hypervisor (${pveLock.lockName || "busy"}).`);
      (err as any).statusCode = 409;
      throw err;
    }

    // Claim operation lock (passwords NEVER stored in params)
    const opId = this.claimOperation(vpsId, userId, "reinstall", {
      template: params.template,
      targetVmid: vps.proxmox_vmid,
    });

    let oldContainerDestroyed = false;

    try {
      // 1. Stop container if running
      execute(
        "UPDATE vps_operations SET current_step = 'stopping_existing_container' WHERE id = ?",
        [opId]
      );
      const currentStatus = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid);
      if (currentStatus.status === "running") {
        try {
          const stopRes = await ProxmoxService.stopLxc(node, vps.proxmox_vmid);
          await ProxmoxService.waitForProxmoxTask(node, stopRes.upid, 45_000, 1_500);
        } catch (stopErr) {
          console.warn(`[REINSTALL] Stop prior to destroy had warning:`, stopErr);
        }
      }

      // 2. Destroy container and purge volumes
      execute(
        "UPDATE vps_operations SET current_step = 'destroying_old_rootfs' WHERE id = ?",
        [opId]
      );
      const destroyRes = await ProxmoxService.destroyLxc(node, vps.proxmox_vmid, true);
      await ProxmoxService.waitForProxmoxTask(node, destroyRes.upid, 60_000, 2_000);
      oldContainerDestroyed = true;

      // 3. Recreate container with same VMID, same IP, and same resource limits
      execute(
        "UPDATE vps_operations SET current_step = 'recreating_container' WHERE id = ?",
        [opId]
      );

      const net0Ip = vps.ipv4_address && vps.ipv4_address !== "DHCP"
        ? `${vps.ipv4_address}/24`
        : undefined;

      const createRes = await ProxmoxService.createLxc(node, {
        vmid: vps.proxmox_vmid,
        hostname: vps.hostname,
        ostemplate: params.template,
        cores: vps.cpu_cores,
        memoryMb: vps.memory_mb,
        swapMb: vps.swap_mb,
        diskGb: vps.disk_gb,
        storage: node.defaultStorage,
        bridge: node.defaultBridge,
        ipv4: net0Ip,
        password: params.rootPassword,
        sshPublicKeys: params.sshKey,
        description: vps.description || `Managed by InterDash for ${vps.hostname}`,
        startAfterCreate: true,
      });

      execute(
        "UPDATE vps_operations SET status = 'waiting_for_proxmox_task', current_step = 'waiting_for_creation' WHERE id = ?",
        [opId]
      );
      await ProxmoxService.waitForProxmoxTask(node, createRes.upid, 180_000, 2_000);

      // 4. Verify new container state
      execute(
        "UPDATE vps_operations SET current_step = 'verifying_reinstalled_container' WHERE id = ?",
        [opId]
      );
      const verified = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid);

      // 5. Update database record
      execute(
        `UPDATE vps SET
          os_image_id = ?, status = ?, last_proxmox_sync_at = datetime('now'),
          updated_at = datetime('now')
         WHERE id = ?`,
        [params.template, verified.status === "running" ? "running" : "stopped", vpsId]
      );

      this.completeOperation(opId, vpsId, {
        template: params.template,
        vmid: vps.proxmox_vmid,
        finalStatus: verified.status,
      });

      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'vps_reinstalled', ?)`,
        [
          userId,
          JSON.stringify({
            vps_id: vpsId,
            vmid: vps.proxmox_vmid,
            template: params.template,
          }),
        ]
      );

      return { operationId: opId, vpsId, type: "reinstall", status: "completed" };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[REINSTALL] VPS ${vpsId} reinstall failed:`, msg);

      // If old container was destroyed and recreation failed, mark recovery_required!
      const recoveryRequired = oldContainerDestroyed;
      this.failOperation(
        opId,
        vpsId,
        recoveryRequired ? "REINSTALL_RECOVERY_REQUIRED" : "REINSTALL_FAILED",
        msg,
        recoveryRequired
      );

      if (recoveryRequired) {
        execute(
          `UPDATE vps SET status = 'error', lock_state = 'recovery_required', updated_at = datetime('now') WHERE id = ?`,
          [vpsId]
        );
      }

      throw err;
    }
  }

  /**
   * Synchronize live status & telemetry directly from Proxmox VE
   */
  public static async syncStatus(vpsId: string): Promise<{
    status: string;
    uptime?: number;
    cpus?: number;
    memoryMb?: number;
    maxmemMb?: number;
    maxdiskGb?: number;
    lastSyncedAt: string;
  }> {
    const { vps, node } = this.resolveVpsAndNode(vpsId);

    try {
      const lxcStatus = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid);
      const nowIso = new Date().toISOString();

      const newStatus =
        lxcStatus.status === "running"
          ? "running"
          : lxcStatus.status === "stopped"
          ? "stopped"
          : "unknown";

      execute(
        `UPDATE vps SET status = ?, last_proxmox_sync_at = ?, updated_at = datetime('now') WHERE id = ?`,
        [newStatus, nowIso, vpsId]
      );

      return {
        status: newStatus,
        uptime: lxcStatus.uptime,
        cpus: lxcStatus.cpus || vps.cpu_cores,
        maxmemMb: lxcStatus.maxmem ? Math.round(lxcStatus.maxmem / (1024 * 1024)) : vps.memory_mb,
        maxdiskGb: lxcStatus.maxdisk ? Math.round(lxcStatus.maxdisk / (1024 * 1024 * 1024)) : vps.disk_gb,
        lastSyncedAt: nowIso,
      };
    } catch {
      return {
        status: "unknown",
        lastSyncedAt: vps.last_proxmox_sync_at || vps.updated_at,
      };
    }
  }

  /**
   * List recent operations for a VPS
   */
  public static getOperations(vpsId: string): any[] {
    return queryAll<any>(
      `SELECT id, vps_id, requested_by_user_id, operation_type,
              status, current_step, result_json, error_code, error_message,
              started_at, completed_at, created_at
       FROM vps_operations
       WHERE vps_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [vpsId]
    );
  }
}
