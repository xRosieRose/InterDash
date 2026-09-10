/**
 * InterDash Server — Provisioning Jobs API Routes
 *
 * Provides status polling for asynchronous VPS provisioning jobs.
 * Enforces ownership: only the requesting user, owner, or an admin may view status.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { queryOne } from "../db/index.js";

const router = Router();
router.use(requireAuth);

router.get("/jobs/:id", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

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
    res.status(404).json({ error: "Provisioning job not found." });
    return;
  }

  // Authorization check
  const isAuthorized =
    req.user.role === "admin" ||
    job.owner_user_id === req.user.id ||
    job.requested_by_user_id === req.user.id;

  if (!isAuthorized) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  res.json({ job });
});

export default router;
