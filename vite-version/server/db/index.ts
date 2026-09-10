/**
 * InterDash Server — Database Layer (SQLite via sql.js)
 *
 * Uses sql.js (pure JS/WASM SQLite) for zero-dependency builds.
 * Data is persisted to disk at config.databasePath.
 */

import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database } from "sql.js";
import { config } from "../config.js";

let db: Database | null = null;
let saveInterval: ReturnType<typeof setInterval> | null = null;

const SCHEMA_SQL = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  discord_id      TEXT NOT NULL UNIQUE,
  username        TEXT NOT NULL,
  global_name     TEXT,
  email           TEXT,
  avatar_hash     TEXT,
  role            TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','staff','admin','owner')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','banned')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address      TEXT,
  user_agent      TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT,
  event_type      TEXT NOT NULL,
  ip_address      TEXT,
  user_agent      TEXT,
  metadata        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs(user_id);
`;

/**
 * Initialize the database connection and run migrations.
 */
export async function initDatabase(): Promise<Database> {
  if (db) return db;

  // Ensure data directory exists
  const dbDir = path.dirname(path.resolve(config.databasePath));
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const SQL = await initSqlJs();
  const dbPath = path.resolve(config.databasePath);

  // Load existing DB file or create new
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Enable WAL mode for better concurrent performance
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");

  // Run schema migrations
  db.run(SCHEMA_SQL);

  // Save to disk
  saveToDisk();

  // Auto-save every 30 seconds
  saveInterval = setInterval(() => {
    saveToDisk();
  }, 30_000);
  saveInterval.unref();

  console.log(`[DB] SQLite database initialized at ${dbPath}`);
  return db;
}

/**
 * Get the current database instance.
 */
export function getDb(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

/**
 * Persist the in-memory database to disk.
 */
export function saveToDisk(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  const dbPath = path.resolve(config.databasePath);
  fs.writeFileSync(dbPath, buffer);
}

/**
 * Clean up expired sessions.
 */
export function cleanExpiredSessions(): void {
  const database = getDb();
  const result = database.run(
    "DELETE FROM sessions WHERE expires_at < datetime('now')"
  );
  saveToDisk();
}

/**
 * Graceful shutdown.
 */
export function closeDatabase(): void {
  if (saveInterval) {
    clearInterval(saveInterval);
    saveInterval = null;
  }
  if (db) {
    saveToDisk();
    db.close();
    db = null;
    console.log("[DB] Database closed.");
  }
}
