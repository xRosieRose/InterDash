/**
 * InterDash Server — API v1 Users Administration Control Plane
 *
 * Safe user administration. Under NO circumstances are password hashes,
 * session tokens, or private secrets exposed.
 */

import { Router, type Request, type Response } from "express";
import { requireApiKey, requireApiScope } from "../../middleware/api-auth.js";
import { apiRateLimit } from "../../middleware/api-rate-limit.js";
import { apiSuccess, apiCollection, apiError } from "../../middleware/api-envelope.js";
import { SCOPES } from "../../services/api-scopes.js";
import { queryAll, queryOne, execute } from "../../db/index.js";

const router = Router();
router.use(requireApiKey);

/**
 * Public User DTO Mapper. Guarantees zero credential leakage.
 */
function toUserDTO(row: any): Record<string, any> {
  return {
    id: row.id,
    discordId: row.discord_id || null,
    username: row.username,
    globalName: row.global_name || null,
    email: row.email || null,
    avatarHash: row.avatar_hash || null,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  };
}

// ============================================================================
// GET /api/v1/users — List Users
// ============================================================================
router.get(
  "/",
  requireApiScope(SCOPES.USERS_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "50", 10)));
    const offset = (page - 1) * pageSize;

    const role = (req.query.role as string) || "";
    const status = (req.query.status as string) || "";

    const whereConditions: string[] = ["1=1"];
    const params: any[] = [];

    if (role) {
      whereConditions.push("role = ?");
      params.push(role);
    }
    if (status) {
      whereConditions.push("status = ?");
      params.push(status);
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

    const totalRow = queryOne<any>(`SELECT COUNT(*) as count FROM users ${whereClause}`, params);
    const total = totalRow?.count || 0;

    const rows = queryAll<any>(
      `SELECT id, discord_id, username, global_name, email, avatar_hash, role, status, created_at, last_login_at
       FROM users
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const users = rows.map(toUserDTO);
    apiCollection(res, users, {
      page,
      pageSize,
      total,
      hasNext: offset + rows.length < total,
    });
  }
);

// ============================================================================
// GET /api/v1/users/:id — Get User Profile
// ============================================================================
router.get(
  "/:id",
  requireApiScope(SCOPES.USERS_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const { id } = req.params;
    const user = queryOne<any>(
      `SELECT id, discord_id, username, global_name, email, avatar_hash, role, status, created_at, last_login_at
       FROM users WHERE id = ? LIMIT 1`,
      [id]
    );

    if (!user) {
      apiError(res, 404, "USER_NOT_FOUND", `User '${id}' not found.`);
      return;
    }

    const instancesCount = queryOne<any>(
      "SELECT COUNT(*) as count FROM vps WHERE owner_user_id = ? AND status != 'deleted'",
      [id]
    )?.count || 0;

    apiSuccess(res, {
      ...toUserDTO(user),
      activeInstancesCount: instancesCount,
    });
  }
);

// ============================================================================
// PATCH /api/v1/users/:id/role — Modify User Role
// ============================================================================
router.patch(
  "/:id/role",
  requireApiScope(SCOPES.USERS_ROLE),
  apiRateLimit("heavy"),
  (req: Request, res: Response) => {
    const { id } = req.params;
    const { role } = req.body || {};

    const validRoles = ["user", "staff", "admin", "owner"];
    if (!role || !validRoles.includes(role)) {
      apiError(res, 400, "VALIDATION_ERROR", `Invalid role. Allowed: ${validRoles.join(", ")}`);
      return;
    }

    const user = queryOne<any>("SELECT id, role FROM users WHERE id = ?", [id]);
    if (!user) {
      apiError(res, 404, "USER_NOT_FOUND", `User '${id}' not found.`);
      return;
    }

    // Last admin lockout prevention
    if (user.role === "admin" && role !== "admin") {
      const adminCount = queryOne<any>("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")?.count || 0;
      if (adminCount <= 1) {
        apiError(res, 400, "LAST_ADMIN_LOCKOUT", "Cannot demote the last remaining administrator.");
        return;
      }
    }

    execute("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?", [role, id]);

    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata)
       VALUES (?, 'user_role_changed', ?)`,
      [req.apiPrincipal?.createdByUserId, JSON.stringify({ targetUserId: id, newRole: role })]
    );

    apiSuccess(res, { success: true, userId: id, role, message: `User role updated to '${role}'.` });
  }
);

// ============================================================================
// PATCH /api/v1/users/:id/status — Suspend, Ban, or Reactivate User
// ============================================================================
router.patch(
  "/:id/status",
  requireApiScope(SCOPES.USERS_WRITE),
  apiRateLimit("heavy"),
  (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body || {};

    const validStatuses = ["active", "suspended", "banned"];
    if (!status || !validStatuses.includes(status)) {
      apiError(res, 400, "VALIDATION_ERROR", `Invalid status. Allowed: ${validStatuses.join(", ")}`);
      return;
    }

    const user = queryOne<any>("SELECT id, role, status FROM users WHERE id = ?", [id]);
    if (!user) {
      apiError(res, 404, "USER_NOT_FOUND", `User '${id}' not found.`);
      return;
    }

    execute("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, id]);

    // Invalidate sessions if suspended or banned
    if (status !== "active") {
      execute("DELETE FROM sessions WHERE user_id = ?", [id]);
    }

    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata)
       VALUES (?, 'user_status_changed', ?)`,
      [req.apiPrincipal?.createdByUserId, JSON.stringify({ targetUserId: id, newStatus: status })]
    );

    apiSuccess(res, { success: true, userId: id, status, message: `User status updated to '${status}'.` });
  }
);

export default router;
