/**
 * InterDash Server — VPS API Routes (Protected)
 *
 * All routes require authentication.
 * VPS access is scoped to the owning user.
 * Admin/owner can access all VPS instances.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// All VPS routes require authentication
router.use(requireAuth);

// ============================================================================
// GET /api/vps — List VPS instances for current user
// ============================================================================
router.get("/", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  // TODO: When VPS instances are stored in the database, query by user_id
  // For now, return an empty array since VPS data is currently in React state
  // This endpoint exists to establish the security boundary
  res.json({
    instances: [],
    message:
      "VPS data is not yet persisted. This endpoint validates authentication and will serve real data when the VPS backend is implemented.",
  });
});

// ============================================================================
// GET /api/vps/:id — Get a specific VPS instance (ownership check)
// ============================================================================
router.get("/:id", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  // TODO: Ownership verification when VPS instances are in the database
  // const vps = db.getVps(req.params.id);
  // if (!vps) return res.status(404).json({ error: "VPS not found." });
  // if (vps.user_id !== req.user.id && !['admin','owner'].includes(req.user.role))
  //   return res.status(403).json({ error: "Access denied." });

  res.status(501).json({
    error: "VPS persistence not yet implemented.",
  });
});

// ============================================================================
// POST /api/vps/:id/power — Power action (ownership check)
// ============================================================================
router.post("/:id/power", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  // TODO: Ownership verification + Proxmox integration
  res.status(501).json({
    error: "VPS power management not yet implemented.",
  });
});

// ============================================================================
// DELETE /api/vps/:id — Delete VPS (ownership check)
// ============================================================================
router.delete("/:id", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  // TODO: Ownership verification + Proxmox integration
  res.status(501).json({
    error: "VPS deletion not yet implemented.",
  });
});

// ============================================================================
// Admin-only: GET /api/vps/admin/all — List ALL VPS instances
// ============================================================================
router.get(
  "/admin/all",
  requireRole("admin", "owner"),
  (_req: Request, res: Response) => {
    res.status(501).json({
      error: "Admin VPS listing not yet implemented.",
    });
  }
);

export default router;
