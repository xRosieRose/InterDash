/**
 * InterDash Server — VPS API Routes (Protected)
 *
 * All routes require authentication.
 * VPS access is strictly scoped to the owning user at the database query level.
 * Admin can access any VPS through admin endpoints or specific ID lookup.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { queryAll, queryOne } from "../db/index.js";

const router = Router();

// All VPS routes require authentication
router.use(requireAuth);

// ============================================================================
// GET /api/vps — List VPS instances for current authenticated user
// ============================================================================
router.get("/", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  // Database-enforced ownership: query only instances assigned to this user
  const instances = queryAll<any>(
    `SELECT v.id, v.owner_user_id, v.proxmox_node_id, v.proxmox_vmid,
            v.name, v.hostname, v.status, v.os_image_id, v.cpu_cores,
            v.memory_mb, v.swap_mb, v.disk_gb, v.ipv4_address, v.ipv6_address,
            v.created_at, v.updated_at,
            n.name as node_name, n.region as node_region, n.hostname as node_hostname, n.flag_url as node_flag_url
     FROM vps v
     LEFT JOIN proxmox_nodes n ON v.proxmox_node_id = n.id
     WHERE v.owner_user_id = ?
     ORDER BY v.created_at DESC`,
    [req.user.id]
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

  const { id } = req.params;

  const instance = queryOne<any>(
    `SELECT v.id, v.owner_user_id, v.proxmox_node_id, v.proxmox_vmid,
            v.name, v.hostname, v.status, v.os_image_id, v.cpu_cores,
            v.memory_mb, v.swap_mb, v.disk_gb, v.ipv4_address, v.ipv6_address,
            v.created_at, v.updated_at,
            n.name as node_name, n.region as node_region, n.hostname as node_hostname, n.flag_url as node_flag_url,
            u.username as owner_username, u.global_name as owner_global_name
     FROM vps v
     LEFT JOIN proxmox_nodes n ON v.proxmox_node_id = n.id
     LEFT JOIN users u ON v.owner_user_id = u.id
     WHERE v.id = ?
     LIMIT 1`,
    [id]
  );

  if (!instance) {
    res.status(404).json({ error: "VPS instance not found." });
    return;
  }

  // Enforce resource ownership
  if (instance.owner_user_id !== req.user.id && req.user.role !== "admin") {
    res.status(403).json({ error: "Access denied. You do not own this instance." });
    return;
  }

  res.json({ instance });
});

export default router;
