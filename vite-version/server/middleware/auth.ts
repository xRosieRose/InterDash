/**
 * InterDash Server — Auth Middleware
 *
 * Session validation, role-based access, and resource ownership checks.
 * The server is authoritative — the browser is NOT.
 */

import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { getDb, saveToDisk } from "../db/index.js";
import { config } from "../config.js";

/** User object attached to req.user by auth middleware */
export interface AuthUser {
  id: string;
  discord_id: string;
  username: string;
  global_name: string | null;
  email: string | null;
  avatar_hash: string | null;
  role: "user" | "staff" | "admin" | "owner";
  status: "active" | "suspended" | "banned";
}

/** Extend Express Request */
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
    }
  }
}

/**
 * Hash a session token for storage.
 * We never store plaintext session tokens in the database.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a cryptographically random session token.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Validate session from cookie and attach user to request.
 * This is the core security boundary.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const isApi =
    (req.originalUrl || req.url || "").startsWith("/api/") ||
    (req.baseUrl || "").startsWith("/api");
  const token = req.cookies[config.session.cookieName];

  if (!token) {
    // For API requests, return 401
    if (isApi) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    // For page requests, redirect to login
    res.redirect(302, "/auth/sign-in");
    return;
  }

  const tokenHash = hashToken(token);
  const db = getDb();

  // Look up session with user join
  const row = db.exec(
    `SELECT s.id as session_id, s.expires_at, s.last_seen_at,
            u.id, u.discord_id, u.username, u.global_name, u.email,
            u.avatar_hash, u.role, u.status
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = ?
     LIMIT 1`,
    [tokenHash]
  );

  if (!row.length || !row[0].values.length) {
    // Invalid session — clear cookie
    res.clearCookie(config.session.cookieName, { path: "/" });
    if (isApi) {
      res.status(401).json({ error: "Invalid or expired session." });
      return;
    }
    res.redirect(302, "/auth/sign-in");
    return;
  }

  const sessionData = row[0].values[0];
  const expiresAt = new Date(sessionData[1] as string);

  // Check expiration
  if (expiresAt < new Date()) {
    // Session expired — clean up
    db.run("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]);
    saveToDisk();
    res.clearCookie(config.session.cookieName, { path: "/" });
    if (isApi) {
      res.status(401).json({ error: "Session expired." });
      return;
    }
    res.redirect(302, "/auth/sign-in");
    return;
  }

  // Check user status
  const userStatus = sessionData[10] as string;
  if (userStatus !== "active") {
    db.run("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]);
    saveToDisk();
    res.clearCookie(config.session.cookieName, { path: "/" });
    if (isApi) {
      res.status(403).json({ error: "Account suspended." });
      return;
    }
    res.redirect(302, "/auth/sign-in");
    return;
  }

  // Attach user to request
  req.user = {
    id: sessionData[3] as string,
    discord_id: sessionData[4] as string,
    username: sessionData[5] as string,
    global_name: sessionData[6] as string | null,
    email: sessionData[7] as string | null,
    avatar_hash: sessionData[8] as string | null,
    role: sessionData[9] as AuthUser["role"],
    status: sessionData[10] as AuthUser["status"],
  };
  req.sessionId = sessionData[0] as string;

  // Sliding expiration: update last_seen and extend session
  if (config.session.sliding) {
    const newExpiry = new Date(
      Date.now() + config.session.maxAge
    ).toISOString();
    db.run(
      `UPDATE sessions SET last_seen_at = datetime('now'), expires_at = ? WHERE id = ?`,
      [newExpiry, req.sessionId]
    );
    // Don't save to disk on every request — the periodic save handles it
  }

  next();
}

/**
 * Optional auth — doesn't reject if unauthenticated, just attaches user if available.
 */
export function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = req.cookies[config.session.cookieName];

  if (!token) {
    return next();
  }

  const tokenHash = hashToken(token);
  const db = getDb();

  const row = db.exec(
    `SELECT u.id, u.discord_id, u.username, u.global_name, u.email,
            u.avatar_hash, u.role, u.status, s.id as session_id, s.expires_at
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.status = 'active'
     LIMIT 1`,
    [tokenHash]
  );

  if (row.length && row[0].values.length) {
    const d = row[0].values[0];
    req.user = {
      id: d[0] as string,
      discord_id: d[1] as string,
      username: d[2] as string,
      global_name: d[3] as string | null,
      email: d[4] as string | null,
      avatar_hash: d[5] as string | null,
      role: d[6] as AuthUser["role"],
      status: d[7] as AuthUser["status"],
    };
    req.sessionId = d[8] as string;
  }

  next();
}

/**
 * Role-based access control middleware.
 * Must be used after requireAuth.
 */
export function requireRole(...allowedRoles: AuthUser["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions." });
      return;
    }

    next();
  };
}
