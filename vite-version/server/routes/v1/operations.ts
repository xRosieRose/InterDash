/**
 * InterDash Server — API v1 Operations Control Plane
 *
 * Durable tracking of asynchronous lifecycle operations (power, reinstall, password reset, delete).
 */

import { Router, type Request, type Response } from "express";
import { requireApiKey, requireApiScope } from "../../middleware/api-auth.js";
import { apiRateLimit } from "../../middleware/api-rate-limit.js";
import { apiSuccess, apiCollection, apiError } from "../../middleware/api-envelope.js";
import { SCOPES } from "../../services/api-scopes.js";
import { queryAll, queryOne } from "../../db/index.js";
import { VpsOperationsService } from "../../services/vps-operations.js";

const router = Router();
router.use(requireApiKey);

// ============================================================================
// GET /api/v1/operations — List Lifecycle Operations
// ============================================================================
router.get(
  "/",
  requireApiScope(SCOPES.OPERATIONS_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "50", 10)));
    const offset = (page - 1) * pageSize;

    const vpsId = (req.query.vpsId as string) || "";
    const status = (req.query.status as string) || "";
    const type = (req.query.type as string) || "";
    const restrictedUserId = req.apiPrincipal?.metadata?.restricted_user_id;

    const whereConditions: string[] = ["1=1"];
    const params: any[] = [];

    if (restrictedUserId) {
      whereConditions.push("requested_by_user_id = ?");
      params.push(restrictedUserId);
    }

    if (vpsId) {
      whereConditions.push("vps_id = ?");
      params.push(vpsId);
    }

    if (status) {
      whereConditions.push("status = ?");
      params.push(status);
    }

    if (type) {
      whereConditions.push("operation_type = ?");
      params.push(type);
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

    const totalRow = queryOne<any>(`SELECT COUNT(*) as count FROM vps_operations ${whereClause}`, params);
    const total = totalRow?.count || 0;

    const rows = queryAll<any>(
      `SELECT id, vps_id, operation_type, status, current_step,
              error_code, error_message, requested_by_user_id,
              created_at, started_at, completed_at
       FROM vps_operations
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const operations = rows.map((op) => ({
      id: op.id,
      vpsId: op.vps_id,
      operationType: op.operation_type,
      status: op.status,
      currentStep: op.current_step,
      errorCode: op.error_code || null,
      errorMessage: op.error_message || null,
      requestedByUserId: op.requested_by_user_id,
      createdAt: op.created_at,
      startedAt: op.started_at,
      completedAt: op.completed_at,
    }));

    apiCollection(res, operations, {
      page,
      pageSize,
      total,
      hasNext: offset + rows.length < total,
    });
  }
);

// ============================================================================
// GET /api/v1/operations/:id — Get Operation Status
// ============================================================================
router.get(
  "/:id",
  requireApiScope(SCOPES.OPERATIONS_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const { id } = req.params;

    const operation = VpsOperationsService.getOperation(id);
    if (!operation) {
      apiError(res, 404, "OPERATION_NOT_FOUND", `Operation '${id}' not found.`);
      return;
    }

    const restrictedUserId = req.apiPrincipal?.metadata?.restricted_user_id;
    if (restrictedUserId && operation.requested_by_user_id !== restrictedUserId) {
      apiError(res, 403, "RESOURCE_FORBIDDEN", "Access denied to this operation.");
      return;
    }

    let parsedResult = null;
    if (operation.result_json) {
      try {
        parsedResult = JSON.parse(operation.result_json);
      } catch {}
    }

    apiSuccess(res, {
      id: operation.id,
      vpsId: operation.vps_id,
      operationType: operation.operation_type,
      status: operation.status,
      currentStep: operation.current_step,
      errorCode: operation.error_code || null,
      errorMessage: operation.error_message || null,
      result: parsedResult,
      createdAt: operation.created_at,
      startedAt: operation.started_at,
      completedAt: operation.completed_at,
    });
  }
);

export default router;
