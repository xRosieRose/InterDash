/**
 * InterDash Server — VPS API Routes (Protected)
 *
 * All routes require authentication.
 * VPS access is strictly scoped to the owning user at the database query level,
 * with administrators granted elevated management access.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { queryAll, queryOne } from "../db/index.js";
import { VpsOperationsService } from "../services/vps-operations.js";
import { ProxmoxService } from "../services/proxmox.js";
import { ProvisioningService } from "../services/provisioning.js";
import { VpsExpiryService } from "../services/vps-expiry.js";

const router = Router();

// All VPS routes require authentication
router.use(requireAuth);

/**
 * Helper to verify VPS existence and user authorization
 */
function verifyVpsOwnership(vpsId: string, user: { id: string; role: string }): any {
  const vps = queryOne<any>(
    `SELECT v.*, n.name as node_name, n.region as node_region, n.hostname as node_hostname, n.flag_url as node_flag_url,
            u.username as owner_username, u.global_name as owner_global_name
     FROM vps v
     LEFT JOIN proxmox_nodes n ON v.proxmox_node_id = n.id
     LEFT JOIN users u ON v.owner_user_id = u.id
     WHERE v.id = ?
     LIMIT 1`,
    [vpsId]
  );

  if (!vps) {
    const err = new Error("VPS instance not found.");
    (err as any).statusCode = 404;
    throw err;
  }

  if (vps.owner_user_id !== user.id && user.role !== "admin") {
    const err = new Error("Access denied. You do not own this instance.");
    (err as any).statusCode = 403;
    throw err;
  }

  return vps;
}

// ============================================================================
// GET /api/vps — List VPS instances
// ============================================================================
router.get("/", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  // Administrators see all instances with owner info; users see only their assigned instances
  const isAdmin = req.user.role === "admin";
  const expiryFilter = (req.query.expiry as string || "all").toLowerCase();

  let expirySql = "";
  if (expiryFilter === "expired") {
    expirySql = "AND v.expires_at IS NOT NULL AND v.expires_at <= datetime('now')";
  } else if (expiryFilter === "expiring_soon") {
    expirySql = "AND v.expires_at IS NOT NULL AND v.expires_at > datetime('now') AND v.expires_at <= datetime('now', '+7 days')";
  } else if (expiryFilter === "active") {
    expirySql = "AND (v.expires_at IS NULL OR v.expires_at > datetime('now'))";
  }

  const whereClause = isAdmin
    ? (expirySql ? `WHERE 1=1 ${expirySql}` : "")
    : `WHERE v.owner_user_id = ? ${expirySql}`;

  const queryParams = isAdmin ? [] : [req.user.id];

  const instances = queryAll<any>(
    `SELECT v.id, v.owner_user_id, v.proxmox_node_id, v.proxmox_vmid,
            v.name, v.hostname, v.description, v.status, v.os_image_id, v.cpu_cores,
            v.memory_mb, v.swap_mb, v.disk_gb, v.ipv4_address, v.ipv6_address,
            v.lock_state, v.expires_at, v.last_proxmox_sync_at, v.created_at, v.updated_at,
            n.name as node_name, n.region as node_region, n.hostname as node_hostname, n.flag_url as node_flag_url,
            u.username as owner_username, u.global_name as owner_global_name
     FROM vps v
     LEFT JOIN proxmox_nodes n ON v.proxmox_node_id = n.id
     LEFT JOIN users u ON v.owner_user_id = u.id
     ${whereClause}
     ORDER BY v.created_at DESC`,
    queryParams
  );

  res.json({ instances });
});

// ============================================================================
// GET /api/vps/:id — Get a specific VPS instance (ownership check)
// ============================================================================
router.get("/:id", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    const instance = verifyVpsOwnership(req.params.id, req.user);
    res.json({ instance });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ============================================================================
// POST /api/vps/:id/power — Execute Power Operation (Start / Stop / Reboot)
// ============================================================================
router.post("/:id/power", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const { id } = req.params;
  const { action, force = false } = req.body;

  if (!["start", "stop", "reboot"].includes(action)) {
    res.status(400).json({
      error: "Invalid power action. Must be 'start', 'stop', or 'reboot'.",
    });
    return;
  }

  try {
    verifyVpsOwnership(id, req.user);

    let result;
    if (action === "start") {
      result = await VpsOperationsService.start(id, req.user.id);
    } else if (action === "stop") {
      result = await VpsOperationsService.stop(id, req.user.id, Boolean(force));
    } else {
      result = await VpsOperationsService.reboot(id, req.user.id);
    }

    res.json({
      success: true,
      action,
      operationId: result.operationId,
      status: result.status,
      message: `VPS ${action} operation completed successfully.`,
    });
  } catch (err: any) {
    const status = err.statusCode || (err.message.includes("locked") ? 409 : 500);
    res.status(status).json({ error: err.message });
  }
});

// ============================================================================
// GET /api/vps/:id/status — Query Live Proxmox Status & Telemetry
// ============================================================================
router.get("/:id/status", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const { id } = req.params;

  try {
    verifyVpsOwnership(id, req.user);
    const liveStatus = await VpsOperationsService.syncStatus(id);
    res.json(liveStatus);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ============================================================================
// PATCH /api/vps/:id — Update Display Name or Description
// ============================================================================
router.patch("/:id", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const { id } = req.params;
  const { name, description } = req.body;

  if (name === undefined && description === undefined) {
    res.status(400).json({ error: "No fields provided to update." });
    return;
  }

  try {
    verifyVpsOwnership(id, req.user);
    await VpsOperationsService.updateMetadata(id, req.user.id, { name, description });
    res.json({ success: true, message: "VPS metadata updated successfully." });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ============================================================================
// POST /api/vps/:id/password — Change Root Password (Proxmox mutation)
// ============================================================================
router.post("/:id/password", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const { id } = req.params;
  const { password } = req.body;

  if (!password || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters long." });
    return;
  }

  try {
    verifyVpsOwnership(id, req.user);
    const result = await VpsOperationsService.changeRootPassword(id, req.user.id, password);
    res.json({
      success: true,
      operationId: result.operationId,
      message: "Root password changed successfully.",
    });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ============================================================================
// POST /api/vps/:id/reinstall — Destructive Reinstall (Exact Hostname Required)
// ============================================================================
router.post("/:id/reinstall", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const { id } = req.params;
  const { template, rootPassword, sshKey, confirmHostname } = req.body;

  if (!template || typeof template !== "string") {
    res.status(400).json({ error: "OS template is required." });
    return;
  }

  if (!confirmHostname || typeof confirmHostname !== "string") {
    res.status(400).json({
      error: "Confirmation failed: You must provide the exact hostname to reinstall.",
    });
    return;
  }

  try {
    verifyVpsOwnership(id, req.user);
    const result = await VpsOperationsService.reinstall(id, req.user.id, {
      template,
      rootPassword,
      sshKey,
      confirmHostname,
    });
    res.json({
      success: true,
      operationId: result.operationId,
      message: "VPS reinstalled successfully.",
    });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ============================================================================
// DELETE /api/vps/:id — Real VPS Deletion (Hypervisor Destroy & IPAM Release)
// ============================================================================
router.delete("/:id", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const { id } = req.params;
  const { confirmHostname } = req.body || {};

  try {
    const vps = verifyVpsOwnership(id, req.user);

    // Hostname confirmation check
    if (confirmHostname && confirmHostname.trim() !== vps.hostname.trim()) {
      res.status(400).json({
        error: `Confirmation mismatch: You must enter the exact VPS hostname '${vps.hostname}' to delete.`,
      });
      return;
    }

    // Initiate async deletion with 202 Accepted
    const result = VpsOperationsService.startDelete(id, req.user.id, confirmHostname);
    res.status(202).json({
      operationId: result.operationId,
      status: result.status,
      message: "VPS deletion initiated.",
    });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ============================================================================
// GET /api/vps/:id/operations — Operation History
// ============================================================================
router.get("/:id/operations", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const { id } = req.params;

  try {
    verifyVpsOwnership(id, req.user);
    const operations = VpsOperationsService.getOperations(id);
    res.json({ operations });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ============================================================================
// GET /api/vps/:id/operations/:operationId — Query Specific Operation State
// ============================================================================
router.get("/:id/operations/:operationId", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const { id, operationId } = req.params;

  try {
    // Check operation directly in case VPS row was finalized/deleted
    const operation = VpsOperationsService.getOperation(operationId);
    if (!operation) {
      res.status(404).json({ error: "Operation not found." });
      return;
    }

    // Verify actor is admin or owner
    if (operation.requested_by_user_id !== req.user.id && req.user.role !== "admin") {
      res.status(403).json({ error: "Access denied." });
      return;
    }

    res.json({
      operationId: operation.id,
      vpsId: operation.vps_id || id,
      type: operation.operation_type,
      status: operation.status,
      currentStep: operation.current_step,
      errorCode: operation.error_code,
      error: operation.error_message,
      createdAt: operation.created_at,
      startedAt: operation.started_at,
      completedAt: operation.completed_at,
      result: operation.result_json ? JSON.parse(operation.result_json) : null,
    });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ============================================================================
// GET /api/vps/:id/reinstall/capabilities — User-Authorized Template Discovery
// ============================================================================
router.get("/:id/reinstall/capabilities", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const { id } = req.params;

  try {
    const vps = verifyVpsOwnership(id, req.user);
    const node = ProvisioningService.getNodeConfig(vps.proxmox_node_id);
    if (!node) {
      res.status(502).json({ error: `Associated hypervisor node '${vps.proxmox_node_id}' is unavailable.` });
      return;
    }

    const verification = await ProxmoxService.verifyNode(node, false);
    // Return only safe template metadata for reinstall
    const safeTemplates = (verification.templates || []).map((t) => ({
      volid: t.volid,
      filename: t.filename,
      osFamily: t.osFamily,
      version: t.version,
      architecture: t.architecture,
      sizeBytes: t.sizeBytes,
    }));

    res.json({ templates: safeTemplates });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ============================================================================
// GET /api/vps/:id/console/diagnostic — Direct Server-Side Termproxy Diagnostic
// ============================================================================
router.get("/:id/console/diagnostic", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const { id } = req.params;

  try {
    const vps = verifyVpsOwnership(id, req.user);
    const node = ProvisioningService.getNodeConfig(vps.proxmox_node_id);
    if (!node) {
      res.status(502).json({ error: `Associated hypervisor node '${vps.proxmox_node_id}' is unavailable.` });
      return;
    }

    const diag = await ProxmoxService.testTermProxy(node, vps.proxmox_vmid);

    // Full diagnostic details for administrators; safe high-level status for users
    if (req.user.role === "admin") {
      res.json({
        ...diag,
        diagnostic: diag,
      });
    } else {
      res.json({
        ok: diag.ok,
        lxcStatus: diag.lxcStatus,
        runtimeNode: diag.runtimeNode,
        runtimeNodeSource: diag.runtimeNodeSource,
        classification: diag.classification,
        recommendedFix: diag.recommendedFix,
        stages: diag.stages,
        diagnostic: diag,
        message: diag.ok
          ? "Console service is operational."
          : `Console unavailable: ${diag.recommendedFix || "Please contact your administrator."}`,
      });
    }
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

export default router;
