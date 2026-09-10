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
  const instances = queryAll<any>(
    `SELECT v.id, v.owner_user_id, v.proxmox_node_id, v.proxmox_vmid,
            v.name, v.hostname, v.description, v.status, v.os_image_id, v.cpu_cores,
            v.memory_mb, v.swap_mb, v.disk_gb, v.ipv4_address, v.ipv6_address,
            v.lock_state, v.last_proxmox_sync_at, v.created_at, v.updated_at,
            n.name as node_name, n.region as node_region, n.hostname as node_hostname, n.flag_url as node_flag_url,
            u.username as owner_username, u.global_name as owner_global_name
     FROM vps v
     LEFT JOIN proxmox_nodes n ON v.proxmox_node_id = n.id
     LEFT JOIN users u ON v.owner_user_id = u.id
     ${isAdmin ? "" : "WHERE v.owner_user_id = ?"}
     ORDER BY v.created_at DESC`,
    isAdmin ? [] : [req.user.id]
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

export default router;
