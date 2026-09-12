/**
 * InterDash Server — Master API v1 Router
 *
 * Mounts the versioned control plane with request ID tracking, CORS policy,
 * discovery, interactive OpenAPI documentation, and sub-routers.
 */

import { Router, type Request, type Response } from "express";
import { apiRequestId, apiSuccess, apiError } from "../../middleware/api-envelope.js";
import { getOpenApiSpec, getApiDocsHtml } from "../../services/openapi.js";
import { SCOPE_REGISTRY } from "../../services/api-scopes.js";
import { getDb } from "../../db/index.js";

// Sub-routers
import authRouter from "./auth.js";
import instancesRouter from "./instances.js";
import provisioningRouter from "./provisioning.js";
import nodesRouter from "./nodes.js";
import ticketsRouter from "./tickets.js";
import usersRouter from "./users.js";
import settingsRouter from "./settings.js";
import analyticsRouter from "./analytics.js";
import operationsRouter from "./operations.js";
import auditRouter from "./audit.js";

const router = Router();

// ============================================================================
// Global API Middleware
// ============================================================================

// 1. Request ID Middleware
router.use(apiRequestId);

// 2. Controlled CORS Middleware for External API Consumers
router.use((req: Request, res: Response, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept, Idempotency-Key, X-Request-ID"
  );

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// ============================================================================
// Discovery & Documentation Endpoints (Public)
// ============================================================================

/**
 * GET /api/v1 — Root API Discovery & Capability Catalog
 */
router.get("/", (_req: Request, res: Response) => {
  apiSuccess(res, {
    name: "InterDash Cloud VPS Control Plane API",
    version: "v1",
    status: "operational",
    authentication: {
      type: "Bearer Token",
      format: "Authorization: Bearer ih_live_<api-key>",
      management: "Admin-created credentials only (/admin/settings?tab=api-keys)",
    },
    documentation: "/api/v1/docs",
    openapi: "/api/v1/openapi.json",
    endpoints: {
      auth: "/api/v1/auth/me",
      instances: "/api/v1/instances",
      provisioning: "/api/v1/provisioning/jobs",
      nodes: "/api/v1/nodes",
      tickets: "/api/v1/tickets",
      users: "/api/v1/users",
      settings: "/api/v1/settings",
      analytics: "/api/v1/analytics",
      operations: "/api/v1/operations",
      audit: "/api/v1/audit",
    },
    scopesCatalog: SCOPE_REGISTRY.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      description: s.description,
      isDangerous: Boolean(s.isDangerous),
      requiresAdminRole: Boolean(s.requiresAdminRole),
    })),
  });
});

/**
 * GET /api/v1/health — API Service Health Check
 */
router.get("/health", (_req: Request, res: Response) => {
  let dbStatus = "healthy";
  try {
    const db = getDb();
    db.exec("SELECT 1;");
  } catch {
    dbStatus = "degraded";
  }

  apiSuccess(res, {
    status: dbStatus === "healthy" ? "ok" : "degraded",
    apiVersion: "1.0.0",
    uptimeSeconds: Math.floor(process.uptime()),
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/v1/openapi.json — OpenAPI 3.1 Specification JSON
 */
router.get("/openapi.json", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");
  res.json(getOpenApiSpec());
});

/**
 * GET /api/v1/docs — Interactive Documentation Explorer
 */
router.get("/docs", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(getApiDocsHtml());
});

// ============================================================================
// Versioned Domain Sub-Routers
// ============================================================================
router.use("/auth", authRouter);
router.use("/instances", instancesRouter);
router.use("/provisioning", provisioningRouter);
router.use("/nodes", nodesRouter);
router.use("/tickets", ticketsRouter);
router.use("/users", usersRouter);
router.use("/settings", settingsRouter);
router.use("/analytics", analyticsRouter);
router.use("/operations", operationsRouter);
router.use("/audit", auditRouter);

// ============================================================================
// API v1 Catch-All 404
// ============================================================================
router.all("{*splat}", (req: Request, res: Response) => {
  apiError(res, 404, "ENDPOINT_NOT_FOUND", `The requested API endpoint '${req.method} /api/v1${req.path}' does not exist.`);
});

export default router;
