/**
 * InterDash Server — Support Ticket API Routes
 *
 * Full support ticket management for InterENL VPS Hosting.
 * Enforces server-side ownership:
 *   - Normal users can only view, reply to, and close their own tickets.
 *   - Admins can view all tickets, reply as staff, update status and priority.
 */

import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { requireAuth } from "../middleware/auth.js";
import { queryAll, queryOne, execute } from "../db/index.js";

const router = Router();
router.use(requireAuth);

// ============================================================================
// GET /api/tickets — List support tickets
// ============================================================================
router.get("/", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const isAdmin = req.user.role === "admin";

  let sql: string;
  let params: any[];

  if (isAdmin) {
    sql = `
      SELECT t.id, t.user_id, t.subject, t.category, t.status, t.priority,
             t.created_at, t.updated_at,
             u.username, u.global_name, u.avatar_hash, u.discord_id,
             (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) as message_count
      FROM tickets t
      LEFT JOIN users u ON t.user_id = u.id
      ORDER BY t.updated_at DESC
    `;
    params = [];
  } else {
    sql = `
      SELECT t.id, t.user_id, t.subject, t.category, t.status, t.priority,
             t.created_at, t.updated_at,
             (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) as message_count
      FROM tickets t
      WHERE t.user_id = ?
      ORDER BY t.updated_at DESC
    `;
    params = [req.user.id];
  }

  const tickets = queryAll<any>(sql, params);
  res.json({ tickets });
});

// ============================================================================
// POST /api/tickets — Create a new support ticket
// ============================================================================
router.post("/", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const { subject, category = "general", priority = "medium", message } = req.body;

  if (!subject || typeof subject !== "string" || !subject.trim()) {
    res.status(400).json({ error: "Subject is required." });
    return;
  }

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Initial ticket message is required." });
    return;
  }

  const validCategories = ["technical", "billing", "network", "abuse", "general"];
  const validPriorities = ["low", "medium", "high", "urgent"];

  const safeCategory = validCategories.includes(category) ? category : "general";
  const safePriority = validPriorities.includes(priority) ? priority : "medium";

  const ticketId = uuidv4();
  const messageId = uuidv4();

  execute(
    `INSERT INTO tickets (id, user_id, subject, category, status, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'open', ?, datetime('now'), datetime('now'))`,
    [ticketId, req.user.id, subject.trim(), safeCategory, safePriority]
  );

  execute(
    `INSERT INTO ticket_messages (id, ticket_id, user_id, message, is_admin_reply, created_at)
     VALUES (?, ?, ?, ?, 0, datetime('now'))`,
    [messageId, ticketId, req.user.id, message.trim()]
  );

  res.status(201).json({
    success: true,
    ticketId,
    message: "Support ticket created successfully.",
  });
});

// ============================================================================
// GET /api/tickets/:id — View a specific ticket and its messages
// ============================================================================
router.get("/:id", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const { id } = req.params;

  const ticket = queryOne<any>(
    `SELECT t.id, t.user_id, t.subject, t.category, t.status, t.priority,
            t.created_at, t.updated_at,
            u.username, u.global_name, u.avatar_hash, u.discord_id
     FROM tickets t
     LEFT JOIN users u ON t.user_id = u.id
     WHERE t.id = ?
     LIMIT 1`,
    [id]
  );

  if (!ticket) {
    res.status(404).json({ error: "Ticket not found." });
    return;
  }

  // Ownership verification
  if (ticket.user_id !== req.user.id && req.user.role !== "admin") {
    res.status(403).json({ error: "Access denied. You do not own this ticket." });
    return;
  }

  // Fetch all messages in the thread
  const messages = queryAll<any>(
    `SELECT tm.id, tm.ticket_id, tm.user_id, tm.message, tm.is_admin_reply, tm.created_at,
            u.username, u.global_name, u.avatar_hash, u.role
     FROM ticket_messages tm
     LEFT JOIN users u ON tm.user_id = u.id
     WHERE tm.ticket_id = ?
     ORDER BY tm.created_at ASC`,
    [id]
  );

  res.json({ ticket, messages });
});

// ============================================================================
// POST /api/tickets/:id/messages — Reply to a ticket
// ============================================================================
router.post("/:id/messages", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const { id } = req.params;
  const { message } = req.body;

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Message content cannot be empty." });
    return;
  }

  const ticket = queryOne<any>("SELECT id, user_id, status FROM tickets WHERE id = ?", [id]);
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found." });
    return;
  }

  const isAdmin = req.user.role === "admin";
  if (ticket.user_id !== req.user.id && !isAdmin) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const messageId = uuidv4();
  const isAdminReply = isAdmin ? 1 : 0;

  execute(
    `INSERT INTO ticket_messages (id, ticket_id, user_id, message, is_admin_reply, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [messageId, id, req.user.id, message.trim(), isAdminReply]
  );

  // Update ticket updated_at and optionally status
  let newStatus = ticket.status;
  if (isAdmin && ticket.status === "open") {
    newStatus = "waiting";
  } else if (!isAdmin && ticket.status === "waiting") {
    newStatus = "open";
  }

  execute(
    "UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?",
    [newStatus, id]
  );

  res.status(201).json({ success: true, messageId });
});

// ============================================================================
// PATCH /api/tickets/:id — Update ticket status/priority
// ============================================================================
router.patch("/:id", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const { id } = req.params;
  const { status, priority } = req.body;

  const ticket = queryOne<any>("SELECT id, user_id, status, priority FROM tickets WHERE id = ?", [id]);
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found." });
    return;
  }

  const isAdmin = req.user.role === "admin";

  // Normal users may only close their own ticket
  if (!isAdmin) {
    if (ticket.user_id !== req.user.id) {
      res.status(403).json({ error: "Access denied." });
      return;
    }

    if (status === "closed") {
      execute("UPDATE tickets SET status = 'closed', updated_at = datetime('now') WHERE id = ?", [id]);
      res.json({ success: true, message: "Ticket closed." });
      return;
    }

    res.status(403).json({ error: "Regular users can only close tickets." });
    return;
  }

  // Admin can update status and priority
  const updates: string[] = ["updated_at = datetime('now')"];
  const params: any[] = [];

  const validStatuses = ["open", "waiting", "resolved", "closed"];
  const validPriorities = ["low", "medium", "high", "urgent"];

  if (status && validStatuses.includes(status)) {
    updates.push("status = ?");
    params.push(status);
  }

  if (priority && validPriorities.includes(priority)) {
    updates.push("priority = ?");
    params.push(priority);
  }

  params.push(id);
  execute(`UPDATE tickets SET ${updates.join(", ")} WHERE id = ?`, params);

  res.json({ success: true, message: "Ticket updated successfully." });
});

export default router;
