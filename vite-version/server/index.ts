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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { initDatabase, closeDatabase, cleanExpiredSessions, queryAll } from "./db/index.js";
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
import { setupConsoleWebSocket } from "./services/console.js";
import { ProvisioningService } from "./services/provisioning.js";

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

  // Parse JSON body (10mb to support base64 custom logo/favicon uploads)
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));

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

  // Favicon handler: intercept before express.static so no old template icons are served
  app.get(["/favicon.ico", "/favicon.png", "/favicon-dark.png"], (_req, res) => {
    try {
      const rows = queryAll<{ key: string; value: string }>(
        "SELECT key, value FROM panel_settings WHERE key = 'favicon_url'"
      );
      if (rows[0]?.value) {
        return res.redirect(302, rows[0].value);
      }
    } catch {}
    res.setHeader("Content-Type", "image/svg+xml");
    const svgPath = path.resolve(__dirname, "..", "public", "favicon.svg");
    if (fs.existsSync(svgPath)) {
      return res.sendFile(svgPath);
    }
    res.status(204).end();
  });

  // ==========================================================================
  // Static File Serving
  // ==========================================================================
  const distPath = path.resolve(__dirname, "..", "dist");
  app.use(express.static(distPath, { index: false }));

  // Helper to escape HTML characters in dynamic insertions
  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

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

  // Dynamic HTML server with injected branding and zero hydration flash
  const serveIndexHtml = (targetRes: express.Response) => {
    const indexPath = path.join(distPath, "index.html");
    if (!fs.existsSync(indexPath)) {
      return targetRes.status(404).send("Application bundle not built. Please run npm run build.");
    }

    try {
      let html = fs.readFileSync(indexPath, "utf8");

      // Load dynamic panel settings from database
      const rows = queryAll<{ key: string; value: string }>(
        "SELECT key, value FROM panel_settings"
      );
      const settings: Record<string, string> = {};
      for (const row of rows) {
        settings[row.key] = row.value;
      }

      const title = settings.panel_title || settings.brand_name || "Cloud VPS Control Panel";
      const brand = settings.brand_name || "InterDash";
      const favicon = settings.favicon_url;

      // Replace Title & Meta tags
      html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
      html = html.replace(/<meta\s+name="title"\s+content="[^"]*"\s*\/?>/i, `<meta name="title" content="${escapeHtml(title)}" />`);
      html = html.replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:title" content="${escapeHtml(title)}" />`);
      html = html.replace(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:title" content="${escapeHtml(title)}" />`);
      html = html.replace(/<meta\s+property="og:site_name"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:site_name" content="${escapeHtml(brand)}" />`);

      // Replace Favicons
      html = html.replace(/<link\s+rel="icon"[^>]*>/gi, "");
      const finalFavicon = favicon || "/favicon.svg";
      const isSvg = finalFavicon.endsWith(".svg") || finalFavicon.startsWith("data:image/svg+xml");
      const iconTag = `<link rel="icon" href="${escapeHtml(finalFavicon)}" ${isSvg ? 'type="image/svg+xml"' : ''}>\n`;
      html = html.replace("</head>", `${iconTag}</head>`);

      // Inject initial settings script to eliminate client-side hydration flash
      const initScript = `<script>window.__INITIAL_SETTINGS__=${JSON.stringify(settings)};</script>\n`;
      html = html.replace("</head>", `${initScript}</head>`);

      targetRes.setHeader("Content-Type", "text/html; charset=utf-8");
      targetRes.send(html);
    } catch (err) {
      console.error("[SERVER] Error in serveIndexHtml:", err);
      targetRes.sendFile(indexPath);
    }
  };

  // ==========================================================================
  // Admin Page Routes (Require Authenticated Session AND role === 'admin')
  // ==========================================================================
  app.get(["/admin", "/admin/{*splat}"], requireAuth, requireAdminPage, (_req, res) => {
    serveIndexHtml(res);
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
      serveIndexHtml(res);
    });
  }

  // ==========================================================================
  // Public Page Routes (no auth required)
  // ==========================================================================
  const publicPaths = [
    "/",
    "/index.html",
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
      serveIndexHtml(res);
    });
  }

  // ==========================================================================
  // SPA Fallback
  // For any route not matched above, check auth status then serve SPA
  // This ensures unknown routes go through the React 404 handler
  // ==========================================================================
  app.get("{*splat}", optionalAuth, (_req, res) => {
    serveIndexHtml(res);
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

  // Reconcile any interrupted provisioning jobs across server restarts
  await ProvisioningService.reconcileInterruptedJobs().catch((err) => {
    console.error("[PROVISIONING] Startup reconciliation error:", err);
  });

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

  // Attach interactive terminal WebSocket proxy to HTTP server
  setupConsoleWebSocket(server);

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
