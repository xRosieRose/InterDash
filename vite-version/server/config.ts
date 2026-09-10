/**
 * InterDash Server — Environment Configuration
 *
 * All secrets are read from process.env (server-only).
 * NONE of these values are exposed to the Vite client bundle.
 */

import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";

// Load .env file if available
try {
  process.loadEnvFile();
} catch {
  // If running from server/ directory or subfolder, try parent .env
  try {
    const parentEnv = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(parentEnv)) {
      process.loadEnvFile(parentEnv);
    }
  } catch {
    // .env not present or unreadable, continue with process.env
  }
}

function optional(name: string, fallback: string = ""): string {
  return process.env[name] || fallback;
}

export const config = {
  /** Node environment */
  nodeEnv: optional("NODE_ENV", "development"),
  get isDev() {
    return this.nodeEnv === "development";
  },
  get isProd() {
    return this.nodeEnv === "production";
  },
  get isTest() {
    return this.nodeEnv === "test";
  },

  /** Server port */
  port: parseInt(optional("PORT", "5173"), 10),

  /** Public URL of the application */
  appUrl: optional("APP_URL", "http://localhost:5173"),

  /** Session secret — used for signing CSRF tokens and misc HMAC */
  sessionSecret: optional(
    "SESSION_SECRET",
    crypto.randomBytes(32).toString("hex")
  ),

  /** SQLite database file path */
  databasePath: optional("DATABASE_PATH", "./data/interdash.db"),

  /** Discord OAuth2 */
  discord: {
    clientId: optional("DISCORD_CLIENT_ID", "123456789012345678"),
    clientSecret: optional("DISCORD_CLIENT_SECRET", "mock_discord_client_secret"),
    redirectUri: optional(
      "DISCORD_REDIRECT_URI",
      "http://localhost:5173/api/auth/discord/callback"
    ),
    scopes: optional("DISCORD_SCOPES", "identify email"),
    get isConfigured() {
      const id = process.env.DISCORD_CLIENT_ID;
      const secret = process.env.DISCORD_CLIENT_SECRET;
      return Boolean(
        id &&
        secret &&
        id !== "123456789012345678" &&
        id !== "mock_discord_client_id" &&
        /^\d{17,21}$/.test(id)
      );
    },
  },

  /** Discord admin user ID — determines owner role on first login */
  discordAdminUserId: optional("DISCORD_ADMIN_USER_ID", ""),

  /** Session configuration */
  session: {
    /** Cookie name */
    cookieName: "interdash_session",
    /** Max session age in milliseconds (7 days) */
    maxAge: 7 * 24 * 60 * 60 * 1000,
    /** Sliding expiration: extend on each request */
    sliding: true,
  },

  /** Rate limiting */
  rateLimit: {
    /** Login attempts per window */
    loginMaxAttempts: 5,
    /** Window duration in milliseconds (1 minute) */
    loginWindowMs: 60 * 1000,
  },
} as const;
