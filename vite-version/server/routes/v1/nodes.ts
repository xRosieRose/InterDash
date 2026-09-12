/**
 * InterDash Server — API v1 Hypervisor Nodes Control Plane
 *
 * Privileged Proxmox VE hypervisor node administration:
 * - Credentials (API tokens, passwords) are NEVER leaked in GET responses.
 * - Mutative operations require administrative scopes.
 * - Node deletion enforces dependency guards (cannot delete nodes with active VPS instances).
 */

import { Router, type Request, type Response } from "express";
import { requireApiKey, requireApiScope } from "../../middleware/api-auth.js";
import { apiRateLimit } from "../../middleware/api-rate-limit.js";
import { apiSuccess, apiCollection, apiError } from "../../middleware/api-envelope.js";
import { SCOPES } from "../../services/api-scopes.js";
import { queryAll, queryOne, execute } from "../../db/index.js";
import { ProxmoxService } from "../../services/proxmox.js";
import { encryptCredential } from "../../services/crypto.js";
import { ProvisioningService } from "../../services/provisioning.js";

const router = Router();
router.use(requireApiKey);

/**
 * Public Node DTO Mapper. Redacts all sensitive token secrets and keys.
 */
function toNodeDTO(row: any): Record<string, any> {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    port: row.port,
    region: row.region,
    countryCode: row.country_code || null,
    flagUrl: row.flag_url || null,
    status: row.status,
    enabled: Boolean(row.enabled),
    totalCores: row.total_cores,
    totalMemoryMb: row.total_memory_mb,
    totalDiskGb: row.total_disk_gb,
    authType: row.auth_type || (row.auth_token_id ? "api_token" : "password"),
    tokenId: row.auth_token_id || row.api_token_id || null,
    hasTokenSecret: Boolean(row.auth_token_secret_encrypted || row.api_token_secret_encrypted),
    hasPassword: Boolean(row.password_encrypted),
    sshPort: row.ssh_port || 22,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// GET /api/v1/nodes — List Hypervisor Nodes
// ============================================================================
router.get(
  "/",
  requireApiScope(SCOPES.NODES_READ),
  apiRateLimit("standard"),
  (_req: Request, res: Response) => {
    const rows = queryAll<any>(
      `SELECT n.*,
              COUNT(v.id) as instance_count,
              COALESCE(SUM(v.cpu_cores), 0) as allocated_cores,
              COALESCE(SUM(v.memory_mb), 0) as allocated_memory_mb
       FROM proxmox_nodes n
       LEFT JOIN vps v ON n.id = v.proxmox_node_id
       GROUP BY n.id
       ORDER BY n.created_at DESC`
    );

    const nodes = rows.map((r) => ({
      ...toNodeDTO(r),
      allocated: {
        instanceCount: r.instance_count,
        cores: r.allocated_cores,
        memoryMb: r.allocated_memory_mb,
      },
    }));

    apiSuccess(res, nodes);
  }
);

// ============================================================================
// GET /api/v1/nodes/:id — Get Specific Node
// ============================================================================
router.get(
  "/:id",
  requireApiScope(SCOPES.NODES_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const node = queryOne<any>("SELECT * FROM proxmox_nodes WHERE id = ?", [req.params.id]);
    if (!node) {
      apiError(res, 404, "NODE_NOT_FOUND", `Node '${req.params.id}' not found.`);
      return;
    }
    apiSuccess(res, toNodeDTO(node));
  }
);

// ============================================================================
// POST /api/v1/nodes — Register New Hypervisor Node
// ============================================================================
router.post(
  "/",
  requireApiScope(SCOPES.NODES_WRITE),
  apiRateLimit("heavy"),
  async (req: Request, res: Response) => {
    const {
      id,
      name,
      hostname,
      port = 8006,
      region = "Default",
      countryCode,
      flagUrl,
      authType = "api_token",
      apiTokenId,
      apiTokenSecret,
      username,
      password,
      totalCores = 8,
      totalMemoryMb = 32768,
      totalDiskGb = 500,
      sshPort = 22,
    } = req.body || {};

    if (!id || !name || !hostname) {
      apiError(res, 400, "VALIDATION_ERROR", "Node id, name, and hostname are required.");
      return;
    }

    const existing = queryOne<any>("SELECT id FROM proxmox_nodes WHERE id = ?", [id]);
    if (existing) {
      apiError(res, 409, "NODE_ALREADY_EXISTS", `A node with ID '${id}' already exists.`);
      return;
    }

    let tokenSecretEnc = null;
    let passwordEnc = null;

    if (authType === "api_token" && apiTokenSecret) {
      tokenSecretEnc = encryptCredential(apiTokenSecret);
    } else if (authType === "password" && password) {
      passwordEnc = encryptCredential(password);
    }

    execute(
      `INSERT INTO proxmox_nodes (
        id, name, hostname, port, region, country_code, flag_url,
        status, enabled, auth_type, api_token_id, api_token_secret_encrypted,
        username, password_encrypted, ssh_port, total_cores, total_memory_mb,
        total_disk_gb, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        id.trim(),
        name.trim(),
        hostname.trim(),
        Number(port),
        region.trim(),
        countryCode || null,
        flagUrl || null,
        authType,
        apiTokenId?.trim() || null,
        tokenSecretEnc,
        username?.trim() || null,
        passwordEnc,
        Number(sshPort),
        Number(totalCores),
        Number(totalMemoryMb),
        Number(totalDiskGb),
      ]
    );

    const created = queryOne<any>("SELECT * FROM proxmox_nodes WHERE id = ?", [id]);
    apiSuccess(res, toNodeDTO(created), undefined, 201);
  }
);

// ============================================================================
// PATCH /api/v1/nodes/:id — Update Node Configuration
// ============================================================================
router.patch(
  "/:id",
  requireApiScope(SCOPES.NODES_WRITE),
  apiRateLimit("standard"),
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = queryOne<any>("SELECT * FROM proxmox_nodes WHERE id = ?", [id]);
    if (!existing) {
      apiError(res, 404, "NODE_NOT_FOUND", `Node '${id}' not found.`);
      return;
    }

    const {
      name,
      hostname,
      port,
      region,
      enabled,
      apiTokenId,
      apiTokenSecret,
      totalCores,
      totalMemoryMb,
      totalDiskGb,
    } = req.body || {};

    const updates: string[] = ["updated_at = datetime('now')"];
    const params: any[] = [];

    if (name !== undefined) {
      updates.push("name = ?");
      params.push(name.trim());
    }
    if (hostname !== undefined) {
      updates.push("hostname = ?");
      params.push(hostname.trim());
    }
    if (port !== undefined) {
      updates.push("port = ?");
      params.push(Number(port));
    }
    if (region !== undefined) {
      updates.push("region = ?");
      params.push(region.trim());
    }
    if (enabled !== undefined) {
      updates.push("enabled = ?");
      params.push(enabled ? 1 : 0);
    }
    if (apiTokenId !== undefined) {
      updates.push("api_token_id = ?");
      params.push(apiTokenId.trim());
    }
    if (apiTokenSecret) {
      updates.push("api_token_secret_encrypted = ?");
      params.push(encryptCredential(apiTokenSecret));
    }
    if (totalCores !== undefined) {
      updates.push("total_cores = ?");
      params.push(Number(totalCores));
    }
    if (totalMemoryMb !== undefined) {
      updates.push("total_memory_mb = ?");
      params.push(Number(totalMemoryMb));
    }
    if (totalDiskGb !== undefined) {
      updates.push("total_disk_gb = ?");
      params.push(Number(totalDiskGb));
    }

    params.push(id);
    execute(`UPDATE proxmox_nodes SET ${updates.join(", ")} WHERE id = ?`, params);

    const updated = queryOne<any>("SELECT * FROM proxmox_nodes WHERE id = ?", [id]);
    apiSuccess(res, toNodeDTO(updated));
  }
);

// ============================================================================
// POST /api/v1/nodes/:id/verify — Trigger Live Proxmox Verification
// ============================================================================
router.post(
  "/:id/verify",
  requireApiScope(SCOPES.NODES_VERIFY),
  apiRateLimit("heavy"),
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const node = ProvisioningService.getNodeConfig(id);
    if (!node) {
      apiError(res, 404, "NODE_NOT_FOUND", `Node '${id}' not found.`);
      return;
    }

    try {
      const result = await ProxmoxService.verifyNode(node, true);
      // Update DB status to online/degraded
      const newStatus = result.provisionReady ? "online" : result.readReady ? "degraded" : "offline";
      execute("UPDATE proxmox_nodes SET status = ?, updated_at = datetime('now') WHERE id = ?", [newStatus, id]);

      apiSuccess(res, {
        nodeId: id,
        status: newStatus,
        reachable: result.reachable,
        authenticated: result.authenticated,
        provisionReady: result.provisionReady,
        storagesCount: result.storages?.length || 0,
        templatesCount: result.templates?.length || 0,
        bridgesCount: result.bridges?.length || 0,
      });
    } catch (err: any) {
      apiError(res, 502, "VERIFICATION_FAILED", err.message);
    }
  }
);

// ============================================================================
// GET /api/v1/nodes/:id/capabilities — Get Storage, Templates & Bridges
// ============================================================================
router.get(
  "/:id/capabilities",
  requireApiScope(SCOPES.NODES_READ),
  apiRateLimit("standard"),
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const node = ProvisioningService.getNodeConfig(id);
    if (!node) {
      apiError(res, 404, "NODE_NOT_FOUND", `Node '${id}' not found.`);
      return;
    }

    try {
      const verification = await ProxmoxService.verifyNode(node, false);
      apiSuccess(res, {
        nodeId: id,
        provisionReady: verification.provisionReady,
        templates: verification.templates || [],
        storages: verification.storages || [],
        bridges: verification.bridges || [],
      });
    } catch (err: any) {
      apiError(res, 502, "CAPABILITIES_FAILED", err.message);
    }
  }
);

// ============================================================================
// DELETE /api/v1/nodes/:id — Delete Node (Dependency guarded)
// ============================================================================
router.delete(
  "/:id",
  requireApiScope(SCOPES.NODES_DELETE),
  apiRateLimit("heavy"),
  (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = queryOne<any>("SELECT id FROM proxmox_nodes WHERE id = ?", [id]);
    if (!existing) {
      apiError(res, 404, "NODE_NOT_FOUND", `Node '${id}' not found.`);
      return;
    }

    // Dependency check: Cannot delete node if active VPS instances are bound to it
    const activeVps = queryOne<any>(
      "SELECT COUNT(*) as count FROM vps WHERE proxmox_node_id = ? AND status != 'deleted'",
      [id]
    );

    if (activeVps && activeVps.count > 0) {
      apiError(
        res,
        409,
        "NODE_HAS_INSTANCES",
        `Cannot delete hypervisor node '${id}': ${activeVps.count} VPS instance(s) are currently provisioned on this node.`
      );
      return;
    }

    execute("DELETE FROM proxmox_nodes WHERE id = ?", [id]);

    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata)
       VALUES (?, 'node_deleted', ?)`,
      [req.apiPrincipal?.createdByUserId, JSON.stringify({ nodeId: id })]
    );

    apiSuccess(res, { success: true, message: `Node '${id}' deleted successfully.` });
  }
);

export default router;
