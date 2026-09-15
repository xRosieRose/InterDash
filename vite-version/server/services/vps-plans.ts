/**
 * InterDash Server — VPS Plans Management Service
 *
 * Provides authoritative management and validation for VPS deployment plans.
 * Admins define the product: RAM, CPU, Disk, Coin Price, Bridge.
 * Users select from enabled plans without ability to modify resource parameters.
 */

import { v4 as uuidv4 } from "uuid";
import { queryOne, queryAll, execute } from "../db/index.js";
import { MAX_SINGLE_COIN_AMOUNT } from "./coin.js";
import { ProxmoxService } from "./proxmox.js";
import { ProvisioningService } from "./provisioning.js";

export interface VpsPlan {
  id: string;
  name: string;
  description: string | null;
  cpu_cores: number;
  memory_mb: number;
  disk_gb: number;
  swap_mb: number;
  coin_price: number;
  network_bridge: string;
  enabled: number;
  display_order: number;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  deployments_count?: number;
}

export interface PublicVpsPlanDTO {
  id: string;
  name: string;
  description: string | null;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
  swapMb: number;
  coinPrice: number;
  networkBridge: string;
  displayOrder: number;
}

export interface CreatePlanParams {
  name: string;
  description?: string | null;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
  swapMb?: number;
  coinPrice: number;
  networkBridge?: string;
  displayOrder?: number;
  enabled?: boolean;
}

export interface UpdatePlanParams {
  name?: string;
  description?: string | null;
  cpuCores?: number;
  memoryMb?: number;
  diskGb?: number;
  swapMb?: number;
  coinPrice?: number;
  networkBridge?: string;
  displayOrder?: number;
  enabled?: boolean;
}

export class PlanError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, code: string = "PLAN_ERROR", statusCode: number = 400) {
    super(message);
    this.name = "PlanError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class PlanService {
  /**
   * Get all active and enabled plans visible to normal users.
   */
  static getEnabledPlans(): PublicVpsPlanDTO[] {
    const rows = queryAll<VpsPlan>(
      `SELECT id, name, description, cpu_cores, memory_mb, disk_gb, swap_mb,
              coin_price, network_bridge, display_order, created_at, updated_at
       FROM vps_plans
       WHERE enabled = 1
       ORDER BY display_order ASC, coin_price ASC, created_at DESC`
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      cpuCores: r.cpu_cores,
      memoryMb: r.memory_mb,
      diskGb: r.disk_gb,
      swapMb: r.swap_mb,
      coinPrice: r.coin_price,
      networkBridge: r.network_bridge,
      displayOrder: r.display_order,
    }));
  }

  /**
   * Get all plans (both enabled and disabled) with deployment counts for administrators.
   */
  static getAllPlans(): VpsPlan[] {
    return queryAll<VpsPlan>(
      `SELECT p.*,
              (SELECT COUNT(*) FROM deployment_orders d WHERE d.plan_id = p.id) as deployments_count
       FROM vps_plans p
       ORDER BY p.display_order ASC, p.coin_price ASC, p.created_at DESC`
    );
  }

  /**
   * Get a single plan by ID.
   */
  static getPlanById(id: string): VpsPlan | null {
    if (!id) return null;
    return queryOne<VpsPlan>(
      `SELECT p.*,
              (SELECT COUNT(*) FROM deployment_orders d WHERE d.plan_id = p.id) as deployments_count
       FROM vps_plans p
       WHERE p.id = ? LIMIT 1`,
      [id]
    );
  }

  /**
   * Create a new authoritative VPS deployment plan.
   */
  static createPlan(params: CreatePlanParams, adminUserId?: string | null): VpsPlan {
    const name = (params.name || "").trim();
    if (!name || name.length < 2 || name.length > 64) {
      throw new PlanError("Plan name must be between 2 and 64 characters.", "INVALID_PLAN_NAME", 400);
    }

    const description = params.description ? params.description.trim().substring(0, 500) : null;

    const cpuCores = Math.floor(Number(params.cpuCores));
    if (isNaN(cpuCores) || cpuCores < 1 || cpuCores > 64) {
      throw new PlanError("CPU cores must be an integer between 1 and 64.", "INVALID_PLAN_CPU", 400);
    }

    const memoryMb = Math.floor(Number(params.memoryMb));
    if (isNaN(memoryMb) || memoryMb < 256 || memoryMb > 131072) {
      throw new PlanError("RAM must be between 256 MB and 131,072 MB (128 GB).", "INVALID_PLAN_RAM", 400);
    }

    const diskGb = Math.floor(Number(params.diskGb));
    if (isNaN(diskGb) || diskGb < 5 || diskGb > 2048) {
      throw new PlanError("Disk must be between 5 GB and 2,048 GB (2 TB).", "INVALID_PLAN_DISK", 400);
    }

    const swapMb = params.swapMb !== undefined ? Math.floor(Number(params.swapMb)) : 512;
    if (isNaN(swapMb) || swapMb < 0 || swapMb > 65536) {
      throw new PlanError("Swap must be between 0 MB and 65,536 MB.", "INVALID_PLAN_SWAP", 400);
    }

    const coinPrice = Math.floor(Number(params.coinPrice));
    if (isNaN(coinPrice) || coinPrice <= 0 || !Number.isSafeInteger(coinPrice)) {
      throw new PlanError("Coin price must be a positive whole number of coins.", "INVALID_PLAN_PRICE", 400);
    }
    if (coinPrice > MAX_SINGLE_COIN_AMOUNT) {
      throw new PlanError(`Coin price cannot exceed ${MAX_SINGLE_COIN_AMOUNT.toLocaleString()} coins.`, "INVALID_PLAN_PRICE", 400);
    }

    const networkBridge = (params.networkBridge || "vmbr0").trim();
    if (!/^[a-zA-Z0-9_\-\.]{2,32}$/.test(networkBridge)) {
      throw new PlanError("Network bridge must be a valid interface name (e.g. vmbr0).", "INVALID_PLAN_BRIDGE", 400);
    }

    const displayOrder = params.displayOrder !== undefined ? Math.floor(Number(params.displayOrder)) : 0;
    const enabled = params.enabled !== false ? 1 : 0;

    const planId = uuidv4();
    execute(
      `INSERT INTO vps_plans (
        id, name, description, cpu_cores, memory_mb, disk_gb, swap_mb,
        coin_price, network_bridge, enabled, display_order, created_by_user_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        planId,
        name,
        description,
        cpuCores,
        memoryMb,
        diskGb,
        swapMb,
        coinPrice,
        networkBridge,
        enabled,
        displayOrder,
        adminUserId || null,
      ]
    );

    const created = this.getPlanById(planId);
    if (!created) {
      throw new PlanError("Failed to persist plan.", "PLAN_PERSIST_FAILED", 500);
    }

    // Audit log
    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata, created_at)
       VALUES (?, 'vps_plan_created', ?, datetime('now'))`,
      [
        adminUserId || null,
        JSON.stringify({
          plan_id: planId,
          name,
          cpu_cores: cpuCores,
          memory_mb: memoryMb,
          disk_gb: diskGb,
          coin_price: coinPrice,
          network_bridge: networkBridge,
          enabled,
        }),
      ]
    );

    return created;
  }

  /**
   * Update an existing plan.
   * Safety invariant: Modifying a plan applies ONLY to future deployments.
   * Existing VPSs preserve their historical snapshot and are not mutated.
   */
  static updatePlan(id: string, params: UpdatePlanParams, adminUserId?: string | null): VpsPlan {
    const existing = this.getPlanById(id);
    if (!existing) {
      throw new PlanError(`Plan '${id}' not found.`, "PLAN_NOT_FOUND", 404);
    }

    const updates: string[] = [];
    const values: any[] = [];
    const changes: Record<string, { from: any; to: any }> = {};

    if (params.name !== undefined) {
      const name = params.name.trim();
      if (!name || name.length < 2 || name.length > 64) {
        throw new PlanError("Plan name must be between 2 and 64 characters.", "INVALID_PLAN_NAME", 400);
      }
      updates.push("name = ?");
      values.push(name);
      changes.name = { from: existing.name, to: name };
    }

    if (params.description !== undefined) {
      const description = params.description ? params.description.trim().substring(0, 500) : null;
      updates.push("description = ?");
      values.push(description);
      changes.description = { from: existing.description, to: description };
    }

    if (params.cpuCores !== undefined) {
      const cpuCores = Math.floor(Number(params.cpuCores));
      if (isNaN(cpuCores) || cpuCores < 1 || cpuCores > 64) {
        throw new PlanError("CPU cores must be between 1 and 64.", "INVALID_PLAN_CPU", 400);
      }
      updates.push("cpu_cores = ?");
      values.push(cpuCores);
      changes.cpu_cores = { from: existing.cpu_cores, to: cpuCores };
    }

    if (params.memoryMb !== undefined) {
      const memoryMb = Math.floor(Number(params.memoryMb));
      if (isNaN(memoryMb) || memoryMb < 256 || memoryMb > 131072) {
        throw new PlanError("RAM must be between 256 MB and 131,072 MB.", "INVALID_PLAN_RAM", 400);
      }
      updates.push("memory_mb = ?");
      values.push(memoryMb);
      changes.memory_mb = { from: existing.memory_mb, to: memoryMb };
    }

    if (params.diskGb !== undefined) {
      const diskGb = Math.floor(Number(params.diskGb));
      if (isNaN(diskGb) || diskGb < 5 || diskGb > 2048) {
        throw new PlanError("Disk must be between 5 GB and 2,048 GB.", "INVALID_PLAN_DISK", 400);
      }
      updates.push("disk_gb = ?");
      values.push(diskGb);
      changes.disk_gb = { from: existing.disk_gb, to: diskGb };
    }

    if (params.swapMb !== undefined) {
      const swapMb = Math.floor(Number(params.swapMb));
      if (isNaN(swapMb) || swapMb < 0 || swapMb > 65536) {
        throw new PlanError("Swap must be between 0 MB and 65,536 MB.", "INVALID_PLAN_SWAP", 400);
      }
      updates.push("swap_mb = ?");
      values.push(swapMb);
      changes.swap_mb = { from: existing.swap_mb, to: swapMb };
    }

    if (params.coinPrice !== undefined) {
      const coinPrice = Math.floor(Number(params.coinPrice));
      if (isNaN(coinPrice) || coinPrice <= 0 || !Number.isSafeInteger(coinPrice)) {
        throw new PlanError("Coin price must be a positive whole number of coins.", "INVALID_PLAN_PRICE", 400);
      }
      if (coinPrice > MAX_SINGLE_COIN_AMOUNT) {
        throw new PlanError(`Coin price cannot exceed ${MAX_SINGLE_COIN_AMOUNT.toLocaleString()} coins.`, "INVALID_PLAN_PRICE", 400);
      }
      updates.push("coin_price = ?");
      values.push(coinPrice);
      changes.coin_price = { from: existing.coin_price, to: coinPrice };
    }

    if (params.networkBridge !== undefined) {
      const networkBridge = params.networkBridge.trim();
      if (!/^[a-zA-Z0-9_\-\.]{2,32}$/.test(networkBridge)) {
        throw new PlanError("Network bridge must be a valid interface name (e.g. vmbr0).", "INVALID_PLAN_BRIDGE", 400);
      }
      updates.push("network_bridge = ?");
      values.push(networkBridge);
      changes.network_bridge = { from: existing.network_bridge, to: networkBridge };
    }

    if (params.displayOrder !== undefined) {
      const displayOrder = Math.floor(Number(params.displayOrder)) || 0;
      updates.push("display_order = ?");
      values.push(displayOrder);
      changes.display_order = { from: existing.display_order, to: displayOrder };
    }

    if (params.enabled !== undefined) {
      const enabled = params.enabled ? 1 : 0;
      updates.push("enabled = ?");
      values.push(enabled);
      changes.enabled = { from: existing.enabled, to: enabled };
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    execute(
      `UPDATE vps_plans SET ${updates.join(", ")} WHERE id = ?`,
      values
    );

    // Audit log
    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata, created_at)
       VALUES (?, 'vps_plan_updated', ?, datetime('now'))`,
      [
        adminUserId || null,
        JSON.stringify({
          plan_id: id,
          changes,
        }),
      ]
    );

    const updated = this.getPlanById(id);
    if (!updated) {
      throw new PlanError("Failed to retrieve updated plan.", "PLAN_UPDATE_FAILED", 500);
    }
    return updated;
  }

  /**
   * Toggle enabled/disabled status of a plan.
   */
  static togglePlanStatus(id: string, enabled: boolean, adminUserId?: string | null): VpsPlan {
    return this.updatePlan(id, { enabled }, adminUserId);
  }

  /**
   * Delete a plan.
   * Enforces historical preservation: if the plan has historical deployment orders or VPSs,
   * hard deletion is rejected and disabling/archiving is required instead.
   */
  static deletePlan(id: string, adminUserId?: string | null): { deleted: boolean; disabledInstead?: boolean } {
    const plan = this.getPlanById(id);
    if (!plan) {
      throw new PlanError(`Plan '${id}' not found.`, "PLAN_NOT_FOUND", 404);
    }

    // Check if referenced by deployment orders or VPSs
    const ordersCount = queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM deployment_orders WHERE plan_id = ?",
      [id]
    )?.count || 0;

    const vpsCount = queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM vps WHERE plan_id = ?",
      [id]
    )?.count || 0;

    if (ordersCount > 0 || vpsCount > 0) {
      // Historical references exist: disable instead of deleting
      this.updatePlan(id, { enabled: false }, adminUserId);
      return { deleted: false, disabledInstead: true };
    }

    execute("DELETE FROM vps_plans WHERE id = ?", [id]);

    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata, created_at)
       VALUES (?, 'vps_plan_deleted', ?, datetime('now'))`,
      [
        adminUserId || null,
        JSON.stringify({
          plan_id: id,
          name: plan.name,
        }),
      ]
    );

    return { deleted: true };
  }
}
