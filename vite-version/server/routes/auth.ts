/**
 * InterDash Server — Authentication Routes
 *
 * Discord OAuth2 Authorization Code flow (server-side token exchange).
 * Session management with HTTP-only cookies.
 * NO client-side token handling. NO localStorage auth.
 */

import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { getDb, saveToDisk } from "../db/index.js";
import {
  generateSessionToken,
  hashToken,
  requireAuth,
} from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";

const router = Router();

// ============================================================================
// GET /api/auth/discord — Initiate Discord OAuth2 Authorization Code flow
// ============================================================================
router.get("/discord", (req: Request, res: Response) => {
  // Generate a random state parameter to prevent CSRF
  const state = crypto.randomBytes(16).toString("hex");

  // Store state in a short-lived, HttpOnly cookie
  res.cookie("interdash_oauth_state", state, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 5 * 60 * 1000, // 5 minutes
  });

  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: config.discord.redirectUri,
    response_type: "code", // Authorization Code flow, NOT implicit
    scope: config.discord.scopes,
    state,
    prompt: "consent",
  });

  const authUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;
  res.redirect(302, authUrl);
});

// ============================================================================
// GET /api/auth/discord/callback — Handle Discord OAuth2 callback
// ============================================================================
router.get(
  "/discord/callback",
  rateLimitMiddleware(config.rateLimit.loginMaxAttempts, config.rateLimit.loginWindowMs),
  async (req: Request, res: Response) => {
    try {
      const { code, state, error: oauthError } = req.query;
      const storedState = req.cookies["interdash_oauth_state"];

      // Clear the state cookie immediately
      res.clearCookie("interdash_oauth_state", { path: "/" });

      // Check for OAuth errors
      if (oauthError) {
        console.warn(`[AUTH] Discord OAuth error: ${oauthError}`);
        return res.redirect("/auth/sign-in?error=discord_denied");
      }

      // Validate state parameter
      if (!state || !storedState || state !== storedState) {
        console.warn("[AUTH] CSRF state mismatch in OAuth callback");
        return res.redirect("/auth/sign-in?error=invalid_state");
      }

      if (!code || typeof code !== "string") {
        return res.redirect("/auth/sign-in?error=missing_code");
      }

      // Exchange authorization code for access token (SERVER-SIDE)
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.discord.clientId,
          client_secret: config.discord.clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: config.discord.redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        console.error(
          `[AUTH] Discord token exchange failed: ${tokenRes.status} ${errBody}`
        );
        return res.redirect("/auth/sign-in?error=token_exchange_failed");
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      if (!accessToken) {
        return res.redirect("/auth/sign-in?error=no_access_token");
      }

      // Fetch Discord user profile using the access token
      const userRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!userRes.ok) {
        console.error(
          `[AUTH] Discord user fetch failed: ${userRes.status}`
        );
        return res.redirect("/auth/sign-in?error=user_fetch_failed");
      }

      const discordUser = await userRes.json();

      // Access token is used ONLY on the server. Never sent to the client.
      // We can revoke it now if desired — we only need the user's identity.

      // Determine role
      let role: "user" | "staff" | "admin" | "owner" = "user";
      if (
        config.discordAdminUserId &&
        discordUser.id === config.discordAdminUserId
      ) {
        role = "owner";
      }

      const db = getDb();
      const userId = uuidv4();

      // Upsert user
      const existingUser = db.exec(
        "SELECT id, role FROM users WHERE discord_id = ? LIMIT 1",
        [discordUser.id]
      );

      let finalUserId: string;
      let finalRole: string;

      if (existingUser.length && existingUser[0].values.length) {
        // Existing user — update profile, preserve role (unless they're the admin)
        finalUserId = existingUser[0].values[0][0] as string;
        const existingRole = existingUser[0].values[0][1] as string;

        // Only upgrade role if they match the admin ID, never downgrade
        finalRole =
          role === "owner"
            ? "owner"
            : existingRole;

        db.run(
          `UPDATE users SET
            username = ?, global_name = ?, email = ?, avatar_hash = ?,
            role = ?, updated_at = datetime('now'), last_login_at = datetime('now')
           WHERE id = ?`,
          [
            discordUser.username,
            discordUser.global_name || discordUser.username,
            discordUser.email || null,
            discordUser.avatar || null,
            finalRole,
            finalUserId,
          ]
        );
      } else {
        // New user
        finalUserId = userId;
        finalRole = role;

        db.run(
          `INSERT INTO users (id, discord_id, username, global_name, email, avatar_hash, role, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          [
            finalUserId,
            discordUser.id,
            discordUser.username,
            discordUser.global_name || discordUser.username,
            discordUser.email || null,
            discordUser.avatar || null,
            finalRole,
          ]
        );
      }

      // Create session
      const sessionToken = generateSessionToken();
      const sessionTokenHash = hashToken(sessionToken);
      const sessionId = uuidv4();
      const expiresAt = new Date(
        Date.now() + config.session.maxAge
      ).toISOString();

      db.run(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          finalUserId,
          sessionTokenHash,
          expiresAt,
          req.ip || req.socket.remoteAddress || null,
          (req.headers["user-agent"] || "").substring(0, 512),
        ]
      );

      // Audit log
      db.run(
        `INSERT INTO audit_logs (user_id, event_type, ip_address, user_agent, metadata)
         VALUES (?, 'login_success', ?, ?, ?)`,
        [
          finalUserId,
          req.ip || req.socket.remoteAddress || null,
          (req.headers["user-agent"] || "").substring(0, 512),
          JSON.stringify({
            discord_id: discordUser.id,
            username: discordUser.username,
          }),
        ]
      );

      saveToDisk();

      // Set HTTP-only session cookie — the ONLY auth credential the browser receives
      res.cookie(config.session.cookieName, sessionToken, {
        httpOnly: true,
        secure: config.isProd,
        sameSite: "lax",
        path: "/",
        maxAge: config.session.maxAge,
      });

      // Redirect to dashboard
      res.redirect(302, "/dashboard");
    } catch (err) {
      console.error("[AUTH] OAuth callback error:", err);
      res.redirect("/auth/sign-in?error=server_error");
    }
  }
);

// ============================================================================
// GET /api/auth/me — Get current authenticated user
// ============================================================================
router.get("/me", requireAuth, (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  // Compute avatar URL server-side
  let avatarUrl = "";
  if (req.user.avatar_hash) {
    avatarUrl = `https://cdn.discordapp.com/avatars/${req.user.discord_id}/${req.user.avatar_hash}.png?size=128`;
  } else {
    // Default Discord avatar
    try {
      const index = Number(BigInt(req.user.discord_id) % 5n);
      avatarUrl = `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    } catch {
      avatarUrl = "https://cdn.discordapp.com/embed/avatars/0.png";
    }
  }

  // Return ONLY safe user fields — never password, token, or session info
  res.json({
    id: req.user.id,
    discord_id: req.user.discord_id,
    username: req.user.username,
    global_name: req.user.global_name,
    email: req.user.email,
    avatar_url: avatarUrl,
    role: req.user.role,
    status: req.user.status,
    is_admin:
      req.user.role === "admin" ||
      req.user.role === "owner",
  });
});

// ============================================================================
// POST /api/auth/logout — Invalidate session server-side
// ============================================================================
router.post("/logout", requireAuth, (req: Request, res: Response) => {
  if (req.sessionId) {
    const db = getDb();

    // Delete the session from the database
    db.run("DELETE FROM sessions WHERE id = ?", [req.sessionId]);

    // Audit log
    db.run(
      `INSERT INTO audit_logs (user_id, event_type, ip_address, user_agent)
       VALUES (?, 'logout', ?, ?)`,
      [
        req.user?.id || null,
        req.ip || req.socket.remoteAddress || null,
        (req.headers["user-agent"] || "").substring(0, 512),
      ]
    );

    saveToDisk();
  }

  // Clear the session cookie
  res.clearCookie(config.session.cookieName, { path: "/" });

  res.json({ success: true });
});

// ============================================================================
// GET /api/auth/csrf — Get CSRF token for client
// ============================================================================
router.get("/csrf", (req: Request, res: Response) => {
  const csrfToken = req.cookies["interdash_csrf"];
  if (csrfToken) {
    res.json({ token: csrfToken });
  } else {
    // Generate one
    const token = crypto.randomBytes(32).toString("hex");
    res.cookie("interdash_csrf", token, {
      httpOnly: false,
      secure: config.isProd,
      sameSite: "lax",
      path: "/",
      maxAge: config.session.maxAge,
    });
    res.json({ token });
  }
});

export default router;
