/**
 * InterDash Server — API Authentication & Scope Authorization Middleware
 *
 * Enforces Bearer token authentication, request-time expiration, instant revocation,
 * two-tier scope authorization, and usage telemetry.
 */

import type { Request, Response, NextFunction } from "express";
import { ApiKeyService } from "../services/api-key.js";
import { hasRequiredScopes, SCOPES } from "../services/api-scopes.js";
import { apiError } from "./api-envelope.js";

export interface ApiPrincipal {
  type: "api_key";
  apiKeyId: string;
  keyName: string;
  prefix: string;
  createdByUserId: string;
  creatorUsername?: string;
  scopes: string[];
  rateLimitRpm: number;
  expiresAt: string | null;
  metadata: Record<string, any> | null;
}

declare global {
  namespace Express {
    interface Request {
      apiPrincipal?: ApiPrincipal;
    }
  }
}

/**
 * Middleware: Enforces valid Bearer API key authentication.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  // Reject API credentials sent via query parameters or body
  if (req.query?.api_key || req.query?.key || (req.body && (req.body.api_key || req.body.apiKey))) {
    apiError(
      res,
      400,
      "INVALID_CREDENTIAL_TRANSPORT",
      "API keys must be transmitted strictly via the 'Authorization: Bearer <key>' header. Query parameter and body credentials are not permitted."
    );
    return;
  }

  const authHeader = req.header("authorization");
  if (!authHeader) {
    apiError(
      res,
      401,
      "API_KEY_REQUIRED",
      "Authentication required. Please provide a valid API key in the 'Authorization: Bearer <key>' header."
    );
    return;
  }

  const parts = authHeader.trim().split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    apiError(
      res,
      401,
      "INVALID_AUTHORIZATION_HEADER",
      "Malformed Authorization header. Format must be 'Bearer <api-key>'."
    );
    return;
  }

  const token = parts[1];

  try {
    const key = ApiKeyService.verifyApiKey(token);

    req.apiPrincipal = {
      type: "api_key",
      apiKeyId: key.id,
      keyName: key.name,
      prefix: key.prefix,
      createdByUserId: key.created_by_user_id,
      creatorUsername: key.creator_username,
      scopes: key.scopes,
      rateLimitRpm: key.rate_limit_rpm,
      expiresAt: key.expires_at,
      metadata: key.metadata,
    };

    // Track usage throttled (non-blocking)
    const ip = req.ip || req.socket?.remoteAddress;
    const userAgent = req.header("user-agent");
    ApiKeyService.trackUsageAsync(key.id, ip, userAgent);

    // Record request telemetry on response completion
    res.on("finish", () => {
      const durationMs = req.startTime ? Date.now() - req.startTime : 0;
      ApiKeyService.recordMetric(
        key.id,
        req.baseUrl + req.path,
        req.method,
        res.statusCode,
        durationMs,
        ip
      );
    });

    next();
  } catch (err: any) {
    apiError(
      res,
      err.statusCode || 401,
      err.code || "API_KEY_INVALID",
      err.message || "Invalid or unverified API key."
    );
  }
}

/**
 * Middleware factory: Enforces specific required scopes.
 * Supports wildcard `api:full`.
 */
export function requireApiScope(...requiredScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.apiPrincipal) {
      apiError(res, 401, "API_KEY_REQUIRED", "Authentication required.");
      return;
    }

    const granted = req.apiPrincipal.scopes;
    const satisfied = hasRequiredScopes(granted, requiredScopes);

    if (!satisfied) {
      apiError(
        res,
        403,
        "API_SCOPE_REQUIRED",
        `Insufficient privileges. This operation requires the following scope(s): ${requiredScopes.join(", ")}`,
        {
          requiredScopes,
          grantedScopes: granted,
        }
      );
      return;
    }

    next();
  };
}
