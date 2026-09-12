/**
 * InterDash Server — API v1 Audit Trail Control Plane
 *
 * Query administrative and security events. Strictly sanitizes historical records
 * to guarantee no secrets, passwords, or tokens are ever exposed.
 */

import { Router, type Request, type Response } from "express";
import { requireApiKey, requireApiScope } from "../../middleware/api-auth.js";
import { apiRateLimit } from "../../middleware/api-rate-limit.js";
import { apiSuccess, apiCollection } from "../../middleware/api-envelope.js";
import { SCOPES } from "../../services/api-scopes.js";
import { queryAll, queryOne } from "../../db/index.js";

const router = Router();
router.use(requireApiKey);

// Sensitive keys to scrub from historical metadata
const REDACT_KEYS = ["password", "token", "secret", "clientSecret", "keyHash", "rawToken"];

function sanitizeMetadata(rawMetadata: string | null): Record<string, any> | null {
  if (!rawMetadata) return null;
  try {
    const obj = JSON.parse(rawMetadata);
    if (typeof obj !== "object") return obj;

    function scrub(target: any) {
      if (!target || typeof target !== "object") return;
      for (const k of Object.keys(target)) {
        if (REDACT_KEYS.some((rk) => k.toLowerCase().includes(rk.toLowerCase()))) {
          target[k] = "••••••••";
        } else if (typeof target[k] === "object") {
          scrub(target[k]);
        }
      }
    }

    scrub(obj);
    return obj;
  } catch {
    return { raw: rawMetadata };
  }
}

// ============================================================================
// GET /api/v1/audit — Query Audit Trail
// ============================================================================
router.get(
  "/",
  requireApiScope(SCOPES.AUDIT_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "50", 10)));
    const offset = (page - 1) * pageSize;

    const eventType = (req.query.eventType as string) || "";
    const userId = (req.query.userId as string) || "";

    const whereConditions: string[] = ["1=1"];
    const params: any[] = [];

    if (eventType) {
      whereConditions.push("event_type = ?");
      params.push(eventType);
    }
    if (userId) {
      whereConditions.push("user_id = ?");
      params.push(userId);
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

    const totalRow = queryOne<any>(`SELECT COUNT(*) as count FROM audit_logs ${whereClause}`, params);
    const total = totalRow?.count || 0;

    const rows = queryAll<any>(
      `SELECT id, user_id, event_type, ip_address, metadata, created_at
       FROM audit_logs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const logs = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      eventType: r.event_type,
      ipAddress: r.ip_address,
      metadata: sanitizeMetadata(r.metadata),
      createdAt: r.created_at,
    }));

    apiCollection(res, logs, {
      page,
      pageSize,
      total,
      hasNext: offset + rows.length < total,
    });
  }
);

export default router;
