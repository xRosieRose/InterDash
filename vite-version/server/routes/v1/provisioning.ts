/**
 * InterDash Server — API v1 Provisioning Jobs Route
 *
 * Status polling and progress tracking for asynchronous VPS provisioning jobs.
 */

import { Router, type Request, type Response } from "express";
import { requireApiKey, requireApiScope } from "../../middleware/api-auth.js";
import { apiRateLimit } from "../../middleware/api-rate-limit.js";
import { apiSuccess, apiCollection, apiError } from "../../middleware/api-envelope.js";
import { SCOPES } from "../../services/api-scopes.js";
import { queryAll, queryOne } from "../../db/index.js";

const router = Router();
router.use(requireApiKey);

// ============================================================================
// GET /api/v1/provisioning/jobs — List Provisioning Jobs
// ============================================================================
router.get(
  "/jobs",
  requireApiScope(SCOPES.PROVISIONING_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "50", 10)));
    const offset = (page - 1) * pageSize;
    const statusFilter = (req.query.status as string) || "";
    const restrictedUserId = req.apiPrincipal?.metadata?.restricted_user_id;

    const whereConditions: string[] = ["1=1"];
    const params: any[] = [];

    if (restrictedUserId) {
      whereConditions.push("(owner_user_id = ? OR requested_by_user_id = ?)");
      params.push(restrictedUserId, restrictedUserId);
    }

    if (statusFilter) {
      whereConditions.push("status = ?");
      params.push(statusFilter);
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

    const totalRow = queryOne<any>(`SELECT COUNT(*) as count FROM provisioning_jobs ${whereClause}`, params);
    const total = totalRow?.count || 0;

    const jobs = queryAll<any>(
      `SELECT id, vps_id, owner_user_id, target_node_id, requested_by_user_id,
              hostname, status, current_step, error_code, error_message,
              started_at, completed_at, created_at
       FROM provisioning_jobs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    apiCollection(res, jobs, {
      page,
      pageSize,
      total,
      hasNext: offset + jobs.length < total,
    });
  }
);

// ============================================================================
// GET /api/v1/provisioning/jobs/:id — Get Job Progress
// ============================================================================
router.get(
  "/jobs/:id",
  requireApiScope(SCOPES.PROVISIONING_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const { id } = req.params;

    const job = queryOne<any>(
      `SELECT id, vps_id, owner_user_id, target_node_id, requested_by_user_id,
              hostname, status, current_step, error_code, error_message,
              started_at, completed_at, created_at
       FROM provisioning_jobs
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    if (!job) {
      apiError(res, 404, "JOB_NOT_FOUND", `Provisioning job '${id}' not found.`);
      return;
    }

    const restrictedUserId = req.apiPrincipal?.metadata?.restricted_user_id;
    if (restrictedUserId && job.owner_user_id !== restrictedUserId && job.requested_by_user_id !== restrictedUserId) {
      apiError(res, 403, "RESOURCE_FORBIDDEN", "Access denied to this provisioning job.");
      return;
    }

    apiSuccess(res, job);
  }
);

export default router;
