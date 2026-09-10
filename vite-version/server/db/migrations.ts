/**
 * InterDash Server — Versioned Database Migrations
 *
 * Implements a production-grade versioned migration runner.
 * Every migration runs in a transaction, records its version in `schema_migrations`,
 * and is strictly idempotent.
 */

import type { Database } from "sql.js";

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "normalize_users_role_constraint",
    up: (db: Database) => {
      // Create migration tracking table if not exists
      db.run(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version     INTEGER PRIMARY KEY,
          name        TEXT NOT NULL,
          applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // Check if users table already exists
      const tableCheck = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
      );

      if (tableCheck.length && tableCheck[0].values.length) {
        // Table exists - check if we need to rebuild it for role constraint
        db.run(`
          CREATE TABLE IF NOT EXISTS users_v2 (
            id              TEXT PRIMARY KEY,
            discord_id      TEXT NOT NULL UNIQUE,
            username        TEXT NOT NULL,
            global_name     TEXT,
            email           TEXT,
            avatar_hash     TEXT,
            role            TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
            status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','banned')),
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
            last_login_at   TEXT
          );
        `);

        // Migrate existing users: 'owner' -> 'admin', 'staff' -> 'user'
        db.run(`
          INSERT OR IGNORE INTO users_v2 (
            id, discord_id, username, global_name, email, avatar_hash, role, status, created_at, updated_at, last_login_at
          )
          SELECT 
            id, discord_id, username, global_name, email, avatar_hash,
            CASE 
              WHEN role IN ('admin', 'owner') THEN 'admin' 
              ELSE 'user' 
            END,
            status, created_at, updated_at, last_login_at
          FROM users;
        `);

        db.run("DROP TABLE users;");
        db.run("ALTER TABLE users_v2 RENAME TO users;");
      } else {
        // Fresh creation
        db.run(`
          CREATE TABLE users (
            id              TEXT PRIMARY KEY,
            discord_id      TEXT NOT NULL UNIQUE,
            username        TEXT NOT NULL,
            global_name     TEXT,
            email           TEXT,
            avatar_hash     TEXT,
            role            TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
            status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','banned')),
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
            last_login_at   TEXT
          );
        `);
      }

      db.run("CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);");
      db.run("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);");
    },
  },

  {
    version: 2,
    name: "create_proxmox_nodes_table",
    up: (db: Database) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS proxmox_clusters (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          description TEXT,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS proxmox_nodes (
          id                          TEXT PRIMARY KEY,
          cluster_id                  TEXT REFERENCES proxmox_clusters(id) ON DELETE SET NULL,
          name                        TEXT NOT NULL,
          hostname                    TEXT NOT NULL,
          api_url                     TEXT NOT NULL,
          port                        INTEGER NOT NULL DEFAULT 8006,
          node_name                   TEXT NOT NULL DEFAULT 'pve',
          region                      TEXT NOT NULL DEFAULT 'default',
          flag_url                    TEXT,
          auth_token_id               TEXT NOT NULL,
          auth_token_secret_encrypted TEXT NOT NULL,
          allow_insecure_tls          INTEGER NOT NULL DEFAULT 0,
          default_storage             TEXT NOT NULL DEFAULT 'local-lvm',
          default_bridge              TEXT NOT NULL DEFAULT 'vmbr0',
          enabled                     INTEGER NOT NULL DEFAULT 1,
          status                      TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('online','offline','degraded','unknown')),
          last_health_check           TEXT,
          health_info                 TEXT,
          created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_proxmox_nodes_status ON proxmox_nodes(status);
        CREATE INDEX IF NOT EXISTS idx_proxmox_nodes_enabled ON proxmox_nodes(enabled);
      `);
    },
  },

  {
    version: 3,
    name: "create_ipam_tables",
    up: (db: Database) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS ip_pools (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          node_id     TEXT REFERENCES proxmox_nodes(id) ON DELETE CASCADE,
          ip_version  INTEGER NOT NULL DEFAULT 4 CHECK(ip_version IN (4, 6)),
          cidr        TEXT NOT NULL,
          gateway     TEXT NOT NULL,
          dns         TEXT NOT NULL DEFAULT '1.1.1.1,8.8.8.8',
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS ip_addresses (
          id          TEXT PRIMARY KEY,
          pool_id     TEXT NOT NULL REFERENCES ip_pools(id) ON DELETE CASCADE,
          ip_address  TEXT NOT NULL UNIQUE,
          status      TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','reserved','assigned','released')),
          vps_id      TEXT,
          reserved_at TEXT,
          assigned_at TEXT,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_ip_addresses_pool_id ON ip_addresses(pool_id);
        CREATE INDEX IF NOT EXISTS idx_ip_addresses_status ON ip_addresses(status);
        CREATE INDEX IF NOT EXISTS idx_ip_addresses_vps_id ON ip_addresses(vps_id);
      `);
    },
  },

  {
    version: 4,
    name: "create_vps_table",
    up: (db: Database) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS vps (
          id              TEXT PRIMARY KEY,
          owner_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          proxmox_node_id TEXT NOT NULL REFERENCES proxmox_nodes(id) ON DELETE RESTRICT,
          proxmox_vmid    INTEGER NOT NULL,
          name            TEXT NOT NULL,
          hostname        TEXT NOT NULL,
          status          TEXT NOT NULL DEFAULT 'provisioning' CHECK(status IN ('provisioning','running','stopped','unknown','error','deleting')),
          os_image_id     TEXT NOT NULL,
          cpu_cores       INTEGER NOT NULL DEFAULT 1,
          memory_mb       INTEGER NOT NULL DEFAULT 1024,
          swap_mb         INTEGER NOT NULL DEFAULT 512,
          disk_gb         INTEGER NOT NULL DEFAULT 25,
          ipv4_address    TEXT,
          ipv6_address    TEXT,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_vps_owner_user_id ON vps(owner_user_id);
        CREATE INDEX IF NOT EXISTS idx_vps_proxmox_node_id ON vps(proxmox_node_id);
        CREATE INDEX IF NOT EXISTS idx_vps_proxmox_vmid ON vps(proxmox_vmid);
        CREATE INDEX IF NOT EXISTS idx_vps_status ON vps(status);
      `);
    },
  },

  {
    version: 5,
    name: "create_provisioning_jobs_table",
    up: (db: Database) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS provisioning_jobs (
          id                    TEXT PRIMARY KEY,
          idempotency_key       TEXT UNIQUE,
          vps_id                TEXT REFERENCES vps(id) ON DELETE SET NULL,
          owner_user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          target_node_id        TEXT NOT NULL REFERENCES proxmox_nodes(id),
          requested_by_user_id  TEXT NOT NULL REFERENCES users(id),
          hostname              TEXT NOT NULL,
          specs_json            TEXT NOT NULL,
          status                TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','allocating','creating','configuring','starting','verifying','completed','failed')),
          current_step          TEXT NOT NULL DEFAULT 'queued',
          error_code            TEXT,
          error_message         TEXT,
          started_at            TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at          TEXT,
          created_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_owner ON provisioning_jobs(owner_user_id);
        CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_status ON provisioning_jobs(status);
        CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_key ON provisioning_jobs(idempotency_key);
      `);
    },
  },

  {
    version: 6,
    name: "create_support_tickets_tables",
    up: (db: Database) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS tickets (
          id          TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          subject     TEXT NOT NULL,
          category    TEXT NOT NULL DEFAULT 'general' CHECK(category IN ('technical','billing','network','abuse','general')),
          status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','waiting','resolved','closed')),
          priority    TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS ticket_messages (
          id              TEXT PRIMARY KEY,
          ticket_id       TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
          user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          message         TEXT NOT NULL,
          is_admin_reply  INTEGER NOT NULL DEFAULT 0,
          created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
        CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
        CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);
      `);
    },
  },

  {
    version: 7,
    name: "create_panel_settings_table",
    up: (db: Database) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS panel_settings (
          key         TEXT PRIMARY KEY,
          value       TEXT NOT NULL,
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // Seed default panel settings if not present
      const defaultSettings: [string, string][] = [
        ["brand_name", "InterENL"],
        ["panel_title", "InterDash — Cloud VPS Control Panel"],
        ["logo_url", ""],
        ["favicon_url", ""],
        ["support_url", "https://discord.gg/interenl"],
        ["website_url", "https://interenl.com"],
        ["discord_url", "https://discord.gg/interenl"],
        ["contact_email", "support@interenl.com"],
      ];

      for (const [key, value] of defaultSettings) {
        db.run(
          "INSERT OR IGNORE INTO panel_settings (key, value) VALUES (?, ?);",
          [key, value]
        );
      }
    },
  },

  {
    version: 8,
    name: "add_flag_url_to_proxmox_nodes",
    up: (db: Database) => {
      try {
        db.run("ALTER TABLE proxmox_nodes ADD COLUMN flag_url TEXT;");
      } catch {
        // column may already exist
      }
    },
  },
];

/**
 * Execute all pending migrations sequentially.
 */
export function runMigrations(db: Database): void {
  // Ensure schema_migrations table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Query applied versions
  const appliedResult = db.exec("SELECT version FROM schema_migrations ORDER BY version ASC;");
  const appliedVersions = new Set<number>();
  if (appliedResult.length && appliedResult[0].values.length) {
    for (const row of appliedResult[0].values) {
      appliedVersions.add(row[0] as number);
    }
  }

  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      console.log(`[DB] Applying migration ${migration.version}: ${migration.name}...`);
      db.run("BEGIN TRANSACTION;");
      try {
        migration.up(db);
        db.run(
          "INSERT INTO schema_migrations (version, name) VALUES (?, ?);",
          [migration.version, migration.name]
        );
        db.run("COMMIT;");
        console.log(`[DB] Migration ${migration.version} applied successfully.`);
      } catch (err) {
        db.run("ROLLBACK;");
        console.error(`[DB] Migration ${migration.version} failed:`, err);
        throw err;
      }
    }
  }
}
