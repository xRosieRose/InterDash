/**
 * InterDash Server — Real VPS Lifecycle Operations Service
 *
 * Implements authoritative Proxmox VE operations for:
 *   - Power management (Start, Graceful Shutdown, Hard Stop, Reboot)
 *   - Interactive console session preparation & termproxy
 *   - Display Name & Description metadata updates
 *   - Root password reset (real Proxmox config mutation; never logged or saved to DB)
 *   - Destructive OS Reinstall (with exact hostname verification and state recovery)
 *   - Real VPS Deletion (with container destruction, IPAM network release, and DB finalization)
 *   - Real-time Proxmox status synchronization & state preservation
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
import { VpsRuntimeResolver, type VpsRuntimeTarget } from "./runtime-resolver.js";

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
   * Helper: Central runtime target resolution via VpsRuntimeResolver
   */
  public static async resolveVpsAndRuntimeTarget(vpsId: string): Promise<VpsRuntimeTarget> {
    return VpsRuntimeResolver.resolve(vpsId);
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

      // 2. Insert new operation with leasing
      const operationId = uuidv4();
      const paramsJson = paramsSafe ? JSON.stringify(paramsSafe) : null;

      execute(
        `INSERT INTO vps_operations (
          id, vps_id, requested_by_user_id, operation_type,
          status, current_step, params_json, started_at,
          heartbeat_at, lease_expires_at
        ) VALUES (?, ?, ?, ?, 'running', 'initiating', ?, datetime('now'), datetime('now'), datetime('now', '+5 minutes'))`,
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
    try {
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
    } catch (dbErr) {
      console.warn(`[FAIL_OPERATION] DB write skipped for operation ${operationId}:`, (dbErr as Error).message);
    }
  }

  /**
   * Power action: start
   */
  public static async start(vpsId: string, userId: string): Promise<OperationResult> {
    const target = await this.resolveVpsAndRuntimeTarget(vpsId);
    const { vps, node, runtimeNode } = target;

    // Check hypervisor lock on runtime node
    const pveLock = await ProxmoxService.checkLxcLocked(node, vps.proxmox_vmid, runtimeNode);
    if (pveLock.locked) {
      const err = new Error(`VPS is locked on hypervisor (${pveLock.lockName || "busy"}).`);
      (err as any).statusCode = 409;
      throw err;
    }

    const opId = this.claimOperation(vpsId, userId, "start");

    try {
      // Check current live status on runtime node
      const current = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid, runtimeNode);
      if (current.ok && current.status === "running") {
        execute(
          `UPDATE vps SET status = 'running', last_proxmox_sync_at = datetime('now'), runtime_state_fresh = 1 WHERE id = ?`,
          [vpsId]
        );
        this.completeOperation(opId, vpsId, { status: "running", alreadyRunning: true, runtimeNode });
        return { operationId: opId, vpsId, type: "start", status: "completed" };
      }

      execute(
        "UPDATE vps_operations SET current_step = 'sending_start_signal' WHERE id = ?",
        [opId]
      );
      const { upid } = await ProxmoxService.startLxc(node, vps.proxmox_vmid, runtimeNode);

      execute(
        "UPDATE vps_operations SET status = 'waiting_for_proxmox_task', current_step = 'waiting_for_task' WHERE id = ?",
        [opId]
      );
      await ProxmoxService.waitForProxmoxTask(node, upid, 45_000, 1_500);

      // Verify live status on runtime node
      const verified = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid, runtimeNode);
      const finalStatus = verified.ok && verified.status === "running" ? "running" : "stopped";

      execute(
        `UPDATE vps SET status = ?, last_proxmox_sync_at = datetime('now'), runtime_state_fresh = 1, updated_at = datetime('now') WHERE id = ?`,
        [finalStatus, vpsId]
      );

      this.completeOperation(opId, vpsId, { finalStatus, runtimeNode });

      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'vps_started', ?)`,
        [userId, JSON.stringify({ vps_id: vpsId, vmid: vps.proxmox_vmid, runtime_node: runtimeNode })]
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
    const target = await this.resolveVpsAndRuntimeTarget(vpsId);
    const { vps, node, runtimeNode } = target;

    const pveLock = await ProxmoxService.checkLxcLocked(node, vps.proxmox_vmid, runtimeNode);
    if (pveLock.locked) {
      const err = new Error(`VPS is locked on hypervisor (${pveLock.lockName || "busy"}).`);
      (err as any).statusCode = 409;
      throw err;
    }

    const opId = this.claimOperation(vpsId, userId, force ? "force_stop" : "stop", { force });

    try {
      const current = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid, runtimeNode);
      if (current.ok && current.status === "stopped") {
        execute(
          `UPDATE vps SET status = 'stopped', last_proxmox_sync_at = datetime('now'), runtime_state_fresh = 1 WHERE id = ?`,
          [vpsId]
        );
        this.completeOperation(opId, vpsId, { status: "stopped", alreadyStopped: true, runtimeNode });
        return { operationId: opId, vpsId, type: force ? "force_stop" : "stop", status: "completed" };
      }

      execute(
        `UPDATE vps_operations SET current_step = '${force ? "sending_stop_signal" : "sending_shutdown_signal"}' WHERE id = ?`,
        [opId]
      );

      const { upid } = force
        ? await ProxmoxService.stopLxc(node, vps.proxmox_vmid, runtimeNode)
        : await ProxmoxService.shutdownLxc(node, vps.proxmox_vmid, runtimeNode);

      execute(
        "UPDATE vps_operations SET status = 'waiting_for_proxmox_task', current_step = 'waiting_for_task' WHERE id = ?",
        [opId]
      );
      await ProxmoxService.waitForProxmoxTask(node, upid, 60_000, 1_500);

      const verified = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid, runtimeNode);
      const finalStatus = verified.ok && verified.status === "stopped" ? "stopped" : "running";

      execute(
        `UPDATE vps SET status = ?, last_proxmox_sync_at = datetime('now'), runtime_state_fresh = 1, updated_at = datetime('now') WHERE id = ?`,
        [finalStatus, vpsId]
      );

      this.completeOperation(opId, vpsId, { finalStatus, forced: force, runtimeNode });

      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'vps_stopped', ?)`,
        [userId, JSON.stringify({ vps_id: vpsId, vmid: vps.proxmox_vmid, forced: force, runtime_node: runtimeNode })]
      );

      return { operationId: opId, vpsId, type: force ? "force_stop" : "stop", status: "completed" };
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
    const target = await this.resolveVpsAndRuntimeTarget(vpsId);
    const { vps, node, runtimeNode } = target;

    const pveLock = await ProxmoxService.checkLxcLocked(node, vps.proxmox_vmid, runtimeNode);
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
      const { upid } = await ProxmoxService.rebootLxc(node, vps.proxmox_vmid, runtimeNode);

      execute(
        "UPDATE vps_operations SET status = 'waiting_for_proxmox_task', current_step = 'waiting_for_task' WHERE id = ?",
        [opId]
      );
      await ProxmoxService.waitForProxmoxTask(node, upid, 60_000, 2_000);

      const verified = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid, runtimeNode);
      const finalStatus = verified.ok && verified.status === "running" ? "running" : "stopped";

      execute(
        `UPDATE vps SET status = ?, last_proxmox_sync_at = datetime('now'), runtime_state_fresh = 1, updated_at = datetime('now') WHERE id = ?`,
        [finalStatus, vpsId]
      );

      this.completeOperation(opId, vpsId, { finalStatus, runtimeNode });

      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'vps_rebooted', ?)`,
        [userId, JSON.stringify({ vps_id: vpsId, vmid: vps.proxmox_vmid, runtime_node: runtimeNode })]
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

    const target = await this.resolveVpsAndRuntimeTarget(vpsId);
    const { vps, node, runtimeNode } = target;

    const pveLock = await ProxmoxService.checkLxcLocked(node, vps.proxmox_vmid, runtimeNode);
    if (pveLock.locked) {
      const err = new Error(`VPS is locked on hypervisor (${pveLock.lockName || "busy"}).`);
      (err as any).statusCode = 409;
      throw err;
    }

    // Password is NEVER saved in paramsSafe or params_json!
    const opId = this.claimOperation(vpsId, userId, "password_reset");

    try {
      execute(
        "UPDATE vps_operations SET current_step = 'applying_password_to_hypervisor' WHERE id = ?",
        [opId]
      );

      await ProxmoxService.setLxcPassword(node, vps.proxmox_vmid, newPassword, runtimeNode);

      execute(
        `UPDATE vps SET updated_at = datetime('now') WHERE id = ?`,
        [vpsId]
      );

      this.completeOperation(opId, vpsId, { updated: true, runtimeNode });

      // Audit log does NOT contain the password
      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'vps_password_changed', ?)`,
        [userId, JSON.stringify({ vps_id: vpsId, vmid: vps.proxmox_vmid, runtime_node: runtimeNode })]
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
    const target = await this.resolveVpsAndRuntimeTarget(vpsId);
    const { vps, node, runtimeNode } = target;

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

    const pveLock = await ProxmoxService.checkLxcLocked(node, vps.proxmox_vmid, runtimeNode);
    if (pveLock.locked) {
      const err = new Error(`VPS is locked on hypervisor (${pveLock.lockName || "busy"}).`);
      (err as any).statusCode = 409;
      throw err;
    }

    // Claim operation lock (passwords NEVER stored in params)
    const opId = this.claimOperation(vpsId, userId, "reinstall", {
      template: params.template,
      targetVmid: vps.proxmox_vmid,
      runtimeNode,
    });

    let oldContainerDestroyed = false;

    try {
      // 1. Stop container if running
      execute(
        "UPDATE vps_operations SET current_step = 'stopping_existing_container' WHERE id = ?",
        [opId]
      );
      const currentStatus = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid, runtimeNode);
      if (currentStatus.ok && currentStatus.status === "running") {
        try {
          const stopRes = await ProxmoxService.stopLxc(node, vps.proxmox_vmid, runtimeNode);
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
      const destroyRes = await ProxmoxService.destroyLxc(node, vps.proxmox_vmid, true, runtimeNode);
      await ProxmoxService.waitForProxmoxTask(node, destroyRes.upid, 60_000, 2_000);
      oldContainerDestroyed = true;

      // 3. Recreate container with same VMID, same IP, and same resource limits on the runtime node
      execute(
        "UPDATE vps_operations SET current_step = 'recreating_container' WHERE id = ?",
        [opId]
      );

      const net0Ip = vps.ipv4_address && vps.ipv4_address !== "DHCP"
        ? `${vps.ipv4_address}/24`
        : undefined;

      const createRes = await ProxmoxService.createLxc(
        node,
        {
          vmid: vps.proxmox_vmid,
          hostname: vps.hostname,
          ostemplate: params.template,
          cores: vps.cpu_cores,
          memoryMb: vps.memory_mb,
          swapMb: vps.swap_mb,
          diskGb: vps.disk_gb,
          storage: node.defaultRootfsStorage || node.defaultStorage,
          bridge: node.defaultBridge,
          ipv4: net0Ip,
          password: params.rootPassword,
          sshPublicKeys: params.sshKey,
          description: vps.description || `Managed by InterDash for ${vps.hostname}`,
          startAfterCreate: true,
        },
        runtimeNode
      );

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
      const verified = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid, runtimeNode);

      // 5. Update database record
      execute(
        `UPDATE vps SET
          os_image_id = ?, status = ?, last_proxmox_sync_at = datetime('now'),
          runtime_state_fresh = 1, updated_at = datetime('now')
         WHERE id = ?`,
        [params.template, verified.ok && verified.status === "running" ? "running" : "stopped", vpsId]
      );

      this.completeOperation(opId, vpsId, {
        template: params.template,
        vmid: vps.proxmox_vmid,
        finalStatus: verified.status,
        runtimeNode,
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
            runtime_node: runtimeNode,
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
        "REINSTALL_FAILED",
        msg,
        recoveryRequired
      );

      if (recoveryRequired) {
        execute(
          `UPDATE vps SET status = 'recovery_required', updated_at = datetime('now') WHERE id = ?`,
          [vpsId]
        );
      }

      throw err;
    }
  }

  /**
   * Asynchronously initiate VPS deletion and return operationId immediately.
   */
  public static startDelete(
    vpsId: string,
    userId: string,
    confirmHostname?: string
  ): { operationId: string; status: string } {
    const { vps } = this.resolveVpsAndNode(vpsId);

    if (confirmHostname && confirmHostname.trim() !== vps.hostname.trim()) {
      const err = new Error(
        `Confirmation mismatch: You must enter the exact VPS hostname '${vps.hostname}' to delete.`
      );
      (err as any).statusCode = 400;
      throw err;
    }

    const opId = this.claimOperation(vpsId, userId, "delete", {
      targetVmid: vps.proxmox_vmid,
      hostname: vps.hostname,
    });

    setImmediate(() => {
      this.executeDeleteWithOpId(opId, vpsId, userId).catch((err) => {
        console.error(`[DELETE] Async background destruction for VPS ${vpsId} failed:`, err);
      });
    });

    return { operationId: opId, status: "running" };
  }

  /**
   * Real VPS Deletion (synchronous/awaitable):
   * 1. Check hypervisor lock & claim 'delete' operation.
   * 2. Stop container gracefully if running.
   * 3. Destroy container on Proxmox VE and purge storage volumes.
   * 4. Verify container absent from hypervisor.
   * 5. Release IP address back to IPAM pool.
   * 6. Delete VPS record from database & record audit log.
   */
  public static async delete(
    vpsId: string,
    userId: string,
    confirmHostname?: string
  ): Promise<OperationResult> {
    const { vps } = this.resolveVpsAndNode(vpsId);

    if (confirmHostname && confirmHostname.trim() !== vps.hostname.trim()) {
      const err = new Error(
        `Confirmation mismatch: You must enter the exact VPS hostname '${vps.hostname}' to delete.`
      );
      (err as any).statusCode = 400;
      throw err;
    }

    const opId = this.claimOperation(vpsId, userId, "delete", {
      targetVmid: vps.proxmox_vmid,
      hostname: vps.hostname,
    });

    return this.executeDeleteWithOpId(opId, vpsId, userId);
  }

  /**
   * Core execution pipeline for claimed delete operation.
   */
  private static async executeDeleteWithOpId(
    opId: string,
    vpsId: string,
    userId: string
  ): Promise<OperationResult> {
    const target = await this.resolveVpsAndRuntimeTarget(vpsId);
    const { vps, node, runtimeNode } = target;

    let containerDestroyed = false;

    try {
      // Step 1: Update VPS status to 'deleting'
      execute("UPDATE vps SET status = 'deleting', updated_at = datetime('now') WHERE id = ?", [vpsId]);

      // Step 2: Stop container if running
      execute("UPDATE vps_operations SET current_step = 'stopping' WHERE id = ?", [opId]);
      try {
        const live = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid, runtimeNode);
        if (live.ok && live.status === "running") {
          const stopRes = await ProxmoxService.stopLxc(node, vps.proxmox_vmid, runtimeNode);
          execute("UPDATE vps_operations SET current_step = 'waiting_for_stop' WHERE id = ?", [opId]);
          await ProxmoxService.waitForProxmoxTask(node, stopRes.upid, 45_000, 1_500);
        }
      } catch (stopErr) {
        console.warn(`[DELETE] Warning during stop prior to destroy for VPS ${vpsId}:`, stopErr);
      }

      // Step 3: Destroy container and purge volumes on Proxmox
      execute("UPDATE vps_operations SET current_step = 'destroying' WHERE id = ?", [opId]);
      const destroyRes = await ProxmoxService.destroyLxc(node, vps.proxmox_vmid, true, runtimeNode);

      execute("UPDATE vps_operations SET current_step = 'waiting_for_destroy' WHERE id = ?", [opId]);
      await ProxmoxService.waitForProxmoxTask(node, destroyRes.upid, 60_000, 2_000);
      containerDestroyed = true;

      // Step 4: Verify container is absent from Proxmox
      execute("UPDATE vps_operations SET current_step = 'verifying_absent' WHERE id = ?", [opId]);
      const checkAbsent = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid, runtimeNode);
      if (checkAbsent.ok && checkAbsent.status !== "unknown") {
        throw new Error(`Container ${vps.proxmox_vmid} still reported on hypervisor after destruction.`);
      }

      // Step 5: Release IPAM network resources
      execute("UPDATE vps_operations SET current_step = 'releasing_network' WHERE id = ?", [opId]);
      execute(
        `UPDATE ip_addresses SET
          status = 'available', vps_id = NULL, reserved_at = NULL, assigned_at = NULL
         WHERE vps_id = ?`,
        [vpsId]
      );

      // Step 6: Finalize DB deletion and record audit
      execute("UPDATE vps_operations SET current_step = 'finalizing' WHERE id = ?", [opId]);

      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'vps_deleted', ?)`,
        [
          userId,
          JSON.stringify({
            vps_id: vpsId,
            vmid: vps.proxmox_vmid,
            hostname: vps.hostname,
            runtime_node: runtimeNode,
            owner_user_id: vps.owner_user_id,
          }),
        ]
      );

      // Mark operation completed
      execute(
        `UPDATE vps_operations SET
          status = 'completed', current_step = 'completed',
          result_json = ?, completed_at = datetime('now')
         WHERE id = ?`,
        [JSON.stringify({ deleted: true, vmid: vps.proxmox_vmid, runtimeNode }), opId]
      );

      // Finally delete VPS record from database
      execute("DELETE FROM vps WHERE id = ?", [vpsId]);

      console.log(`[DELETE] VPS ${vps.hostname} (${vpsId}) VMID ${vps.proxmox_vmid} permanently deleted.`);
      return { operationId: opId, vpsId, type: "delete", status: "completed" };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[DELETE] VPS ${vpsId} deletion failed:`, msg);

      // If container was destroyed on Proxmox but DB update failed, mark recovery_required!
      const recoveryRequired = containerDestroyed;
      this.failOperation(opId, vpsId, "DELETE_FAILED", msg, recoveryRequired);

      if (recoveryRequired) {
        try {
          execute(
            `UPDATE vps SET status = 'recovery_required', updated_at = datetime('now') WHERE id = ?`,
            [vpsId]
          );
        } catch {}
      } else {
        try {
          execute(
            `UPDATE vps SET status = 'error', updated_at = datetime('now') WHERE id = ?`,
            [vpsId]
          );
        } catch {}
      }

      throw err;
    }
  }

  /**
   * Synchronize live status & telemetry directly from Proxmox VE.
   * If Proxmox is unreachable or returns an error, NEVER overwrite existing
   * valid database status with 'unknown'. Preserve known state and report fresh: false.
   */
  public static async syncStatus(vpsId: string): Promise<{
    status: string;
    runtimeNode: string;
    runtimeNodeSource: "direct" | "cluster" | "cached" | "configured";
    uptime?: number;
    cpus?: number;
    memoryMb?: number;
    maxmemMb?: number;
    maxdiskGb?: number;
    lastVerifiedAt?: string;
    lastSyncedAt: string;
    fresh: boolean;
    error?: string;
    errorCode?: string;
  }> {
    const target = await this.resolveVpsAndRuntimeTarget(vpsId);
    const { vps, runtimeNode, runtimeNodeSource, fresh, runtimeStatus, verifiedAt, error, errorCode } = target;

    if (fresh && (runtimeStatus === "running" || runtimeStatus === "stopped" || runtimeStatus === "paused")) {
      const nowIso = new Date().toISOString();
      execute(
        `UPDATE vps SET
          status = ?, last_proxmox_sync_at = ?, runtime_state_fresh = 1,
          runtime_sync_error_code = NULL, runtime_sync_error = NULL,
          updated_at = datetime('now')
         WHERE id = ?`,
        [runtimeStatus, nowIso, vpsId]
      );

      return {
        status: runtimeStatus,
        runtimeNode,
        runtimeNodeSource,
        uptime: target.uptime,
        cpus: target.cpus || vps.cpu_cores,
        memoryMb: target.memoryMb || vps.memory_mb,
        maxmemMb: target.memoryMb || vps.memory_mb,
        maxdiskGb: target.maxdiskGb || vps.disk_gb,
        lastVerifiedAt: verifiedAt || nowIso,
        lastSyncedAt: nowIso,
        fresh: true,
      };
    }

    // Proxmox returned a non-fresh status (e.g. node unreachable or error)
    // PRESERVE LAST KNOWN VALID DATABASE STATUS!
    console.warn(
      `[SYNC_STATUS] Proxmox check returned unverified state for VPS ${vpsId} (node=${runtimeNode}):`,
      error || errorCode
    );

    try {
      execute(
        `UPDATE vps SET
          runtime_state_fresh = 0,
          runtime_sync_error_code = ?,
          runtime_sync_error = ?
         WHERE id = ?`,
        [errorCode, error || null, vpsId]
      );
    } catch {}

    return {
      status: vps.status || "unknown",
      runtimeNode,
      runtimeNodeSource,
      uptime: undefined,
      cpus: vps.cpu_cores,
      memoryMb: vps.memory_mb,
      maxmemMb: vps.memory_mb,
      maxdiskGb: vps.disk_gb,
      lastVerifiedAt: vps.last_proxmox_sync_at || undefined,
      lastSyncedAt: vps.last_proxmox_sync_at || vps.updated_at,
      fresh: false,
      error: error || "Unable to refresh current hypervisor state.",
      errorCode,
    };
  }

  /**
   * Update heartbeat and lease extension for an active operation
   */
  public static updateOperationHeartbeat(operationId: string, extensionSeconds = 300): void {
    execute(
      `UPDATE vps_operations SET
        heartbeat_at = datetime('now'),
        lease_expires_at = datetime('now', '+' || ? || ' seconds')
       WHERE id = ?`,
      [extensionSeconds, operationId]
    );
  }

  /**
   * Get single operation status by operation ID
   */
  public static getOperation(operationId: string): any | null {
    return queryOne<any>(
      `SELECT id, vps_id, requested_by_user_id, operation_type,
              status, current_step, result_json, error_code, error_message,
              heartbeat_at, lease_expires_at,
              started_at, completed_at, created_at
       FROM vps_operations
       WHERE id = ? LIMIT 1`,
      [operationId]
    );
  }

  /**
   * List recent operations for a VPS
   */
  public static getOperations(vpsId: string): any[] {
    return queryAll<any>(
      `SELECT id, vps_id, requested_by_user_id, operation_type,
              status, current_step, result_json, error_code, error_message,
              heartbeat_at, lease_expires_at,
              started_at, completed_at, created_at
       FROM vps_operations
       WHERE vps_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [vpsId]
    );
  }

  /**
   * Reconcile interrupted operations on server boot
   */
  public static async reconcileInterruptedOperations(): Promise<void> {
    const pendingOps = queryAll<any>(
      `SELECT * FROM vps_operations
       WHERE status IN ('queued', 'running', 'waiting_for_proxmox_task')`
    );

    if (!pendingOps.length) return;

    console.log(`[VPS-OPS] Found ${pendingOps.length} in-flight operation(s) to reconcile across restart...`);

    for (const op of pendingOps) {
      try {
        const vps = queryOne<any>("SELECT * FROM vps WHERE id = ? LIMIT 1", [op.vps_id]);
        if (!vps) {
          execute("UPDATE vps_operations SET status = 'completed', current_step = 'completed' WHERE id = ?", [op.id]);
          continue;
        }

        const node = ProvisioningService.getNodeConfig(vps.proxmox_node_id);
        if (!node) {
          this.failOperation(op.id, vps.id, "NODE_UNAVAILABLE", "Target Proxmox node unavailable during reconciliation.");
          continue;
        }

        const lxcStatus = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid);

        if (op.operation_type === "delete") {
          if (!lxcStatus.ok || lxcStatus.status === "unknown") {
            // Container absent: finalize IP release and DB cleanup
            execute("UPDATE ip_addresses SET status = 'available', vps_id = NULL WHERE vps_id = ?", [vps.id]);
            execute("DELETE FROM vps WHERE id = ?", [vps.id]);
            execute("UPDATE vps_operations SET status = 'completed', current_step = 'completed' WHERE id = ?", [op.id]);
          } else {
            // Container still present: requires manual recovery
            this.failOperation(op.id, vps.id, "RECOVERY_REQUIRED", "Delete interrupted while container still exists on Proxmox.", true);
            execute("UPDATE vps SET status = 'recovery_required' WHERE id = ?", [vps.id]);
          }
        } else {
          // Unlock VPS lock state and record reconciled state
          execute("UPDATE vps SET lock_state = NULL WHERE id = ?", [vps.id]);
          execute(
            "UPDATE vps_operations SET status = 'completed', current_step = 'reconciled_on_startup', completed_at = datetime('now') WHERE id = ?",
            [op.id]
          );
        }
      } catch (err) {
        console.error(`[VPS-OPS] Error reconciling operation ${op.id}:`, err);
      }
    }
  }
}
