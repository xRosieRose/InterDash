/**
 * InterDash Server — Main Express Application
 *
 * This replaces the PM2 static `serve` with a real server that:
 * 1. Enforces authentication server-side for protected routes
 * 2. Serves the Vite SPA for public routes
 * 3. Provides authenticated API endpoints
 * 4. Manages sessions with HTTP-only cookies
 *
 * The server is authoritative. The browser is NOT.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { initDatabase, closeDatabase, cleanExpiredSessions } from "./db/index.js";
import {
  securityHeaders,
  csrfCookieSetter,
  csrfProtection,
} from "./middleware/security.js";
import { requireAuth, optionalAuth, requireAdminPage } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import vpsRoutes from "./routes/vps.js";
import analyticsRoutes from "./routes/analytics.js";
import ticketsRoutes from "./routes/tickets.js";
import provisioningRoutes from "./routes/provisioning.js";
import adminRoutes from "./routes/admin.js";
import settingsRoutes from "./routes/settings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createApp(): Promise<express.Express> {
  // Initialize database
  await initDatabase();

  const app = express();

  // ==========================================================================
  // Global Middleware
  // ==========================================================================

  // Trust proxy (for Cloudflare tunnel / reverse proxy)
  app.set("trust proxy", 1);

  // Parse cookies
  app.use(cookieParser());

  // Parse JSON body
  app.use(express.json({ limit: "1mb" }));

  // Security headers
  app.use(securityHeaders);

  // CSRF cookie setter (on every response)
  app.use(csrfCookieSetter);

  // ==========================================================================
  // Health Check & Public Settings (Public)
  // ==========================================================================
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/api/settings", settingsRoutes);

  // ==========================================================================
  // Auth API Routes (mixed public/protected)
  // CSRF is NOT required for OAuth redirect flow (GET-based)
  // CSRF IS required for logout (POST)
  // ==========================================================================
  app.use("/api/auth", authRoutes);

  // ==========================================================================
  // Protected API Routes (require CSRF for mutations)
  // ==========================================================================
  app.use("/api/vps", csrfProtection, vpsRoutes);
  app.use("/api/analytics", csrfProtection, analyticsRoutes);
  app.use("/api/tickets", csrfProtection, ticketsRoutes);
  app.use("/api/provisioning", csrfProtection, provisioningRoutes);
  app.use("/api/admin", csrfProtection, adminRoutes);
  app.use("/api/users", csrfProtection, adminRoutes);

  // Catch-all for unknown API routes (Express 5 wildcard syntax: /api/{*splat})
  app.all("/api/{*splat}", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found." });
  });

  // ==========================================================================
  // Static File Serving
  // ==========================================================================
  const distPath = path.resolve(__dirname, "..", "dist");
  app.use(express.static(distPath, { index: false }));

  // ==========================================================================
  // Role-Aware Page Redirects (server-side)
  // ==========================================================================
  app.get(["/dashboard", "/dashboard/{*splat}"], requireAuth, (req, res) => {
    if (req.user?.role === "admin") {
      res.redirect(302, "/admin/overview");
    } else {
      res.redirect(302, "/instances");
    }
  });

  app.get(["/dashboard-2", "/dashboard-2/{*splat}"], requireAuth, (_req, res) => {
    res.redirect(302, "/analytics");
  });

  app.get(["/mail", "/mail/{*splat}"], requireAuth, (_req, res) => {
    res.redirect(302, "/tickets");
  });

  app.get(["/users", "/users/{*splat}"], requireAuth, (req, res) => {
    if (req.user?.role === "admin") {
      res.redirect(302, "/admin/users");
    } else {
      res.redirect(302, "/instances");
    }
  });

  // Legacy/alias redirects
  app.get(["/vps", "/vps/{*splat}", "/servers", "/servers/{*splat}"], requireAuth, (_req, res) => {
    res.redirect(302, "/instances");
  });

  // ==========================================================================
  // Admin Page Routes (Require Authenticated Session AND role === 'admin')
  // ==========================================================================
  app.get(["/admin", "/admin/{*splat}"], requireAuth, requireAdminPage, (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  // ==========================================================================
  // Protected Product & Legacy Page Routes (Require Authenticated Session)
  // ==========================================================================
  const protectedPaths = [
    "/instances",
    "/instances/{*splat}",
    "/analytics",
    "/analytics/{*splat}",
    "/tickets",
    "/tickets/{*splat}",
    "/settings",
    "/settings/{*splat}",
    "/billing",
    "/billing/{*splat}",
    "/support",
    "/support/{*splat}",
    "/tasks",
    "/tasks/{*splat}",
    "/chat",
    "/chat/{*splat}",
    "/calendar",
    "/calendar/{*splat}",
  ];

  for (const routePath of protectedPaths) {
    app.get(routePath, requireAuth, (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // ==========================================================================
  // Public Page Routes (no auth required)
  // ==========================================================================
  const publicPaths = [
    "/",
    "/landing",
    "/landing/{*splat}",
    "/auth/{*splat}",
    "/faqs",
    "/faqs/{*splat}",
    "/pricing",
    "/pricing/{*splat}",
    "/demo",
    "/demo/{*splat}",
    "/errors/{*splat}",
  ];

  for (const routePath of publicPaths) {
    app.get(routePath, (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // ==========================================================================
  // SPA Fallback
  // For any route not matched above, check auth status then serve SPA
  // This ensures unknown routes go through the React 404 handler
  // ==========================================================================
  app.get("{*splat}", optionalAuth, (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  // ==========================================================================
  // Error Handler
  // ==========================================================================
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error("[SERVER] Unhandled error:", err.message);
      if (config.isDev) {
        console.error(err.stack);
      }
      res.status(500).json({
        error: config.isDev
          ? err.message
          : "An internal error occurred.",
      });
    }
  );

  return app;
}

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export async function main() {
  const app = await createApp();

  // Session Cleanup (every 15 minutes)
  cleanupInterval = setInterval(() => {
    cleanExpiredSessions();
  }, 15 * 60 * 1000);
  cleanupInterval.unref();

  // Graceful Shutdown
  const shutdown = () => {
    console.log("\n[SERVER] Shutting down...");
    if (cleanupInterval) clearInterval(cleanupInterval);
    closeDatabase();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Start Server
  const server = app.listen(config.port, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║           InterDash Server Running               ║
║══════════════════════════════════════════════════║
║  URL:  http://localhost:${config.port.toString().padEnd(25)}║
║  Mode: ${config.nodeEnv.padEnd(41)}║
║  DB:   ${config.databasePath.substring(0, 41).padEnd(41)}║
╚══════════════════════════════════════════════════╝
    `);
  });

  return server;
}

// Auto-run if executed directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("server/index.ts") ||
    process.argv[1].endsWith("server\\index.ts") ||
    process.argv[1].endsWith("server/index.js") ||
    process.argv[1].endsWith("server\\index.js"));

if (isDirectRun) {
  main().catch((err) => {
    console.error("[SERVER] Fatal error:", err);
    process.exit(1);
  });
}
