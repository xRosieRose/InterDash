/**
 * InterDash Server — API v1 Platform Settings Control Plane
 *
 * Exposes safe public branding settings and administrative authentication configs.
 * NEVER returns raw OAuth client secrets, encryption keys, or internal tokens.
 */

import { Router, type Request, type Response } from "express";
import { requireApiKey, requireApiScope } from "../../middleware/api-auth.js";
import { apiRateLimit } from "../../middleware/api-rate-limit.js";
import { apiSuccess, apiError } from "../../middleware/api-envelope.js";
import { SCOPES } from "../../services/api-scopes.js";
import { queryAll, execute } from "../../db/index.js";
import { AuthConfigService } from "../../services/auth-config.js";
import { StartupScriptService } from "../../services/startup-script.js";

const router = Router();
router.use(requireApiKey);

const ALLOWED_BRANDING_KEYS = [
  "brand_name",
  "panel_title",
  "logo_url",
  "favicon_url",
  "support_url",
  "website_url",
  "discord_url",
  "contact_email",
];

// ============================================================================
// GET /api/v1/settings — Safe Platform Branding Settings
// ============================================================================
router.get(
  "/",
  requireApiScope(SCOPES.SETTINGS_READ),
  apiRateLimit("standard"),
  (_req: Request, res: Response) => {
    const rows = queryAll<{ key: string; value: string }>(
      "SELECT key, value FROM panel_settings"
    );

    const settings: Record<string, string> = {};
    for (const row of rows) {
      if (ALLOWED_BRANDING_KEYS.includes(row.key)) {
        settings[row.key] = row.value;
      }
    }

    apiSuccess(res, settings);
  }
);

// ============================================================================
// PATCH /api/v1/settings — Update Platform Branding
// ============================================================================
router.patch(
  "/",
  requireApiScope(SCOPES.SETTINGS_WRITE),
  apiRateLimit("heavy"),
  (req: Request, res: Response) => {
    const settings = req.body;
    if (!settings || typeof settings !== "object") {
      apiError(res, 400, "VALIDATION_ERROR", "Invalid settings payload.");
      return;
    }

    const updatedKeys: string[] = [];

    for (const [key, value] of Object.entries(settings)) {
      if (ALLOWED_BRANDING_KEYS.includes(key) && typeof value === "string") {
        const cleanVal = value.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "").trim();
        execute(
          `INSERT INTO panel_settings (key, value, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          [key, cleanVal]
        );
        updatedKeys.push(key);
      }
    }

    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata)
       VALUES (?, 'platform_settings_updated', ?)`,
      [req.apiPrincipal?.createdByUserId, JSON.stringify({ keysUpdated: updatedKeys })]
    );

    apiSuccess(res, { success: true, updatedKeys, message: "Platform settings updated successfully." });
  }
);

// ============================================================================
// GET /api/v1/settings/authentication — Masked Auth Provider Settings
// ============================================================================
router.get(
  "/authentication",
  requireApiScope(SCOPES.SETTINGS_READ),
  apiRateLimit("standard"),
  (_req: Request, res: Response) => {
    try {
      const authSettings = AuthConfigService.getAdminSettings();
      apiSuccess(res, authSettings);
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "SETTINGS_FAILED", err.message);
    }
  }
);

// ============================================================================
// PATCH /api/v1/settings/authentication — Update Auth Providers
// ============================================================================
router.patch(
  "/authentication",
  requireApiScope(SCOPES.SETTINGS_WRITE),
  apiRateLimit("heavy"),
  (req: Request, res: Response) => {
    try {
      const result = AuthConfigService.updateAdminSettings(
        req.body,
        req.apiPrincipal?.createdByUserId || "api"
      );
      apiSuccess(res, result);
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "AUTH_UPDATE_FAILED", err.message);
    }
  }
);

// ============================================================================
// GET /api/v1/settings/startup-script — Get First-Install Startup Script
// ============================================================================
router.get(
  "/startup-script",
  requireApiScope(SCOPES.SETTINGS_READ),
  apiRateLimit("standard"),
  (_req: Request, res: Response) => {
    try {
      const config = StartupScriptService.getConfig();
      apiSuccess(res, config);
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "SETTINGS_FAILED", err.message);
    }
  }
);

// ============================================================================
// PATCH /api/v1/settings/startup-script — Update First-Install Startup Script
// ============================================================================
router.patch(
  "/startup-script",
  requireApiScope(SCOPES.SETTINGS_WRITE),
  apiRateLimit("heavy"),
  (req: Request, res: Response) => {
    try {
      const updated = StartupScriptService.updateConfig(
        req.body,
        req.apiPrincipal?.createdByUserId || "api"
      );
      apiSuccess(res, updated);
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "SETTINGS_UPDATE_FAILED", err.message);
    }
  }
);

export default router;
