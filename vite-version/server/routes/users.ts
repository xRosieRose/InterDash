/**
 * InterDash Server — User Management Routes (Admin)
 *
 * Admin/owner-only user management endpoints.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getDb, saveToDisk } from "../db/index.js";

const router = Router();

// All user management routes require auth + admin/owner role
router.use(requireAuth);

// ============================================================================
// GET /api/users — List all users (admin/owner only)
// ============================================================================
router.get(
  "/",
  requireRole("admin", "owner"),
  (_req: Request, res: Response) => {
    const db = getDb();
    const result = db.exec(
      `SELECT id, discord_id, username, global_name, email, avatar_hash, role, status, created_at, last_login_at
       FROM users ORDER BY created_at DESC`
    );

    if (!result.length) {
      res.json({ users: [] });
      return;
    }

    const columns = result[0].columns;
    const users = result[0].values.map((row) => {
      const user: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        user[col] = row[i];
      });
      return user;
    });

    res.json({ users });
  }
);

// ============================================================================
// PATCH /api/users/:id/role — Change user role (owner only)
// ============================================================================
router.patch(
  "/:id/role",
  requireRole("owner"),
  (req: Request, res: Response) => {
    const { id } = req.params;
    const { role } = req.body;

    const validRoles = ["user", "staff", "admin", "owner"];
    if (!role || !validRoles.includes(role)) {
      res.status(400).json({ error: "Invalid role." });
      return;
    }

    const db = getDb();

    // Prevent changing your own role
    if (id === req.user?.id) {
      res.status(400).json({ error: "Cannot change your own role." });
      return;
    }

    // Check user exists
    const existing = db.exec("SELECT id FROM users WHERE id = ?", [id]);
    if (!existing.length || !existing[0].values.length) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    db.run(
      `UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?`,
      [role, id]
    );

    // Audit log
    db.run(
      `INSERT INTO audit_logs (user_id, event_type, ip_address, metadata)
       VALUES (?, 'role_changed', ?, ?)`,
      [
        req.user?.id || null,
        req.ip || null,
        JSON.stringify({ target_user_id: id, new_role: role }),
      ]
    );

    saveToDisk();

    res.json({ success: true, message: `User role updated to ${role}.` });
  }
);

// ============================================================================
// PATCH /api/users/:id/status — Suspend/ban user (admin/owner)
// ============================================================================
router.patch(
  "/:id/status",
  requireRole("admin", "owner"),
  (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["active", "suspended", "banned"];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({ error: "Invalid status." });
      return;
    }

    const db = getDb();

    // Prevent changing your own status
    if (id === req.user?.id) {
      res.status(400).json({ error: "Cannot change your own status." });
      return;
    }

    db.run(
      `UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      [status, id]
    );

    // If suspended/banned, invalidate all their sessions
    if (status !== "active") {
      db.run("DELETE FROM sessions WHERE user_id = ?", [id]);
    }

    saveToDisk();

    res.json({ success: true });
  }
);

export default router;
