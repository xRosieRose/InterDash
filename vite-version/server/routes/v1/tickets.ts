/**
 * InterDash Server — API v1 Support Tickets Control Plane
 *
 * Full support ticket management respecting user ownership and administrative privileges.
 */

import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { requireApiKey, requireApiScope } from "../../middleware/api-auth.js";
import { apiRateLimit } from "../../middleware/api-rate-limit.js";
import { apiSuccess, apiCollection, apiError } from "../../middleware/api-envelope.js";
import { SCOPES } from "../../services/api-scopes.js";
import { queryAll, queryOne, execute } from "../../db/index.js";

const router = Router();
router.use(requireApiKey);

// ============================================================================
// GET /api/v1/tickets — List Tickets
// ============================================================================
router.get(
  "/",
  requireApiScope(SCOPES.TICKETS_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "50", 10)));
    const offset = (page - 1) * pageSize;

    const status = (req.query.status as string) || "";
    const priority = (req.query.priority as string) || "";
    const restrictedUserId = req.apiPrincipal?.metadata?.restricted_user_id;

    const whereConditions: string[] = ["1=1"];
    const params: any[] = [];

    if (restrictedUserId) {
      whereConditions.push("t.user_id = ?");
      params.push(restrictedUserId);
    }

    if (status) {
      whereConditions.push("t.status = ?");
      params.push(status);
    }

    if (priority) {
      whereConditions.push("t.priority = ?");
      params.push(priority);
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

    const totalRow = queryOne<any>(`SELECT COUNT(*) as count FROM tickets t ${whereClause}`, params);
    const total = totalRow?.count || 0;

    const rows = queryAll<any>(
      `SELECT t.id, t.user_id, t.subject, t.category, t.status, t.priority,
              t.created_at, t.updated_at,
              u.username, u.global_name,
              (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) as message_count
       FROM tickets t
       LEFT JOIN users u ON t.user_id = u.id
       ${whereClause}
       ORDER BY t.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const tickets = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username || "Unknown",
      globalName: r.global_name || null,
      subject: r.subject,
      category: r.category,
      status: r.status,
      priority: r.priority,
      messageCount: r.message_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    apiCollection(res, tickets, {
      page,
      pageSize,
      total,
      hasNext: offset + rows.length < total,
    });
  }
);

// ============================================================================
// POST /api/v1/tickets — Create New Ticket
// ============================================================================
router.post(
  "/",
  requireApiScope(SCOPES.TICKETS_WRITE),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const { subject, category = "general", priority = "medium", message, userId } = req.body || {};

    if (!subject || typeof subject !== "string" || !subject.trim()) {
      apiError(res, 400, "VALIDATION_ERROR", "Ticket subject is required.");
      return;
    }

    if (!message || typeof message !== "string" || !message.trim()) {
      apiError(res, 400, "VALIDATION_ERROR", "Initial ticket message is required.");
      return;
    }

    // Determine target user
    const targetUserId =
      req.apiPrincipal?.metadata?.restricted_user_id || userId || req.apiPrincipal?.createdByUserId;

    const validCategories = ["technical", "billing", "network", "abuse", "general"];
    const validPriorities = ["low", "medium", "high", "urgent"];
    const safeCategory = validCategories.includes(category) ? category : "general";
    const safePriority = validPriorities.includes(priority) ? priority : "medium";

    const ticketId = uuidv4();
    const messageId = uuidv4();

    execute(
      `INSERT INTO tickets (id, user_id, subject, category, status, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, datetime('now'), datetime('now'))`,
      [ticketId, targetUserId, subject.trim(), safeCategory, safePriority]
    );

    execute(
      `INSERT INTO ticket_messages (id, ticket_id, user_id, message, is_admin_reply, created_at)
       VALUES (?, ?, ?, ?, 0, datetime('now'))`,
      [messageId, ticketId, targetUserId, message.trim()]
    );

    apiSuccess(
      res,
      {
        ticketId,
        subject: subject.trim(),
        status: "open",
        priority: safePriority,
        message: "Support ticket created successfully.",
      },
      undefined,
      201
    );
  }
);

// ============================================================================
// GET /api/v1/tickets/:id — Get Ticket with Message Thread
// ============================================================================
router.get(
  "/:id",
  requireApiScope(SCOPES.TICKETS_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const { id } = req.params;

    const ticket = queryOne<any>(
      `SELECT t.*, u.username, u.global_name
       FROM tickets t
       LEFT JOIN users u ON t.user_id = u.id
       WHERE t.id = ?
       LIMIT 1`,
      [id]
    );

    if (!ticket) {
      apiError(res, 404, "TICKET_NOT_FOUND", `Ticket '${id}' not found.`);
      return;
    }

    const restrictedUserId = req.apiPrincipal?.metadata?.restricted_user_id;
    if (restrictedUserId && ticket.user_id !== restrictedUserId) {
      apiError(res, 403, "RESOURCE_FORBIDDEN", "Access denied to this ticket.");
      return;
    }

    const messages = queryAll<any>(
      `SELECT tm.id, tm.ticket_id, tm.user_id, tm.message, tm.is_admin_reply, tm.created_at,
              u.username, u.global_name, u.role
       FROM ticket_messages tm
       LEFT JOIN users u ON tm.user_id = u.id
       WHERE tm.ticket_id = ?
       ORDER BY tm.created_at ASC`,
      [id]
    );

    apiSuccess(res, {
      id: ticket.id,
      userId: ticket.user_id,
      username: ticket.username || "Unknown",
      globalName: ticket.global_name || null,
      subject: ticket.subject,
      category: ticket.category,
      status: ticket.status,
      priority: ticket.priority,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      messages: messages.map((m) => ({
        id: m.id,
        userId: m.user_id,
        username: m.username || "Staff",
        message: m.message,
        isAdminReply: Boolean(m.is_admin_reply),
        createdAt: m.created_at,
      })),
    });
  }
);

// ============================================================================
// POST /api/v1/tickets/:id/messages — Reply to Ticket
// ============================================================================
router.post(
  "/:id/messages",
  requireApiScope(SCOPES.TICKETS_WRITE),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const { id } = req.params;
    const { message } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      apiError(res, 400, "VALIDATION_ERROR", "Message content cannot be empty.");
      return;
    }

    const ticket = queryOne<any>("SELECT * FROM tickets WHERE id = ?", [id]);
    if (!ticket) {
      apiError(res, 404, "TICKET_NOT_FOUND", `Ticket '${id}' not found.`);
      return;
    }

    const restrictedUserId = req.apiPrincipal?.metadata?.restricted_user_id;
    if (restrictedUserId && ticket.user_id !== restrictedUserId) {
      apiError(res, 403, "RESOURCE_FORBIDDEN", "Access denied to this ticket.");
      return;
    }

    const replyUserId = restrictedUserId || req.apiPrincipal?.createdByUserId;
    const messageId = uuidv4();
    const isAdminReply = !restrictedUserId ? 1 : 0;

    execute(
      `INSERT INTO ticket_messages (id, ticket_id, user_id, message, is_admin_reply, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [messageId, id, replyUserId, message.trim(), isAdminReply]
    );

    // Auto-update ticket status: if staff replies, set to 'waiting'; if user replies, set to 'open'
    const nextStatus = isAdminReply ? "waiting" : "open";
    execute("UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?", [nextStatus, id]);

    apiSuccess(res, { success: true, messageId, status: nextStatus }, undefined, 201);
  }
);

// ============================================================================
// PATCH /api/v1/tickets/:id — Update Ticket Status / Priority
// ============================================================================
router.patch(
  "/:id",
  requireApiScope(SCOPES.TICKETS_WRITE),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, priority } = req.body || {};

    const ticket = queryOne<any>("SELECT * FROM tickets WHERE id = ?", [id]);
    if (!ticket) {
      apiError(res, 404, "TICKET_NOT_FOUND", `Ticket '${id}' not found.`);
      return;
    }

    const restrictedUserId = req.apiPrincipal?.metadata?.restricted_user_id;
    if (restrictedUserId && ticket.user_id !== restrictedUserId) {
      apiError(res, 403, "RESOURCE_FORBIDDEN", "Access denied to this ticket.");
      return;
    }

    // Normal restricted users can only close tickets
    if (restrictedUserId && status !== "closed") {
      apiError(res, 403, "RESOURCE_FORBIDDEN", "Regular user credentials can only close tickets.");
      return;
    }

    const updates: string[] = ["updated_at = datetime('now')"];
    const params: any[] = [];

    const validStatuses = ["open", "waiting", "resolved", "closed"];
    const validPriorities = ["low", "medium", "high", "urgent"];

    if (status && validStatuses.includes(status)) {
      updates.push("status = ?");
      params.push(status);
    }
    if (priority && validPriorities.includes(priority) && !restrictedUserId) {
      updates.push("priority = ?");
      params.push(priority);
    }

    params.push(id);
    execute(`UPDATE tickets SET ${updates.join(", ")} WHERE id = ?`, params);

    apiSuccess(res, { success: true, message: "Ticket updated successfully." });
  }
);

export default router;
