/**
 * InterDash Server — API v1 Identity Route
 *
 * Exposes current API principal metadata, creator info, scopes, and rate limits.
 */

import { Router, type Request, type Response } from "express";
import { requireApiKey } from "../../middleware/api-auth.js";
import { apiRateLimit } from "../../middleware/api-rate-limit.js";
import { apiSuccess } from "../../middleware/api-envelope.js";

const router = Router();
router.use(requireApiKey);

// ============================================================================
// GET /api/v1/auth/me — Current API Principal & Scopes
// ============================================================================
router.get("/me", apiRateLimit("standard"), (req: Request, res: Response) => {
  const principal = req.apiPrincipal!;
  apiSuccess(res, {
    type: principal.type,
    apiKeyId: principal.apiKeyId,
    keyName: principal.keyName,
    prefix: principal.prefix,
    createdByUserId: principal.createdByUserId,
    creatorUsername: principal.creatorUsername || null,
    scopes: principal.scopes,
    rateLimitRpm: principal.rateLimitRpm,
    expiresAt: principal.expiresAt,
    metadata: principal.metadata,
  });
});

export default router;
