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

  {
    version: 9,
    name: "vps_operations_and_durability",
    up: (db: Database) => {
      // 1. Extend vps table
      const safeAddColumn = (table: string, columnDef: string) => {
        try {
          db.run(`ALTER TABLE ${table} ADD COLUMN ${columnDef};`);
        } catch {
          // column already exists
        }
      };

      safeAddColumn("vps", "description TEXT");
      safeAddColumn("vps", "last_proxmox_sync_at TEXT");
      safeAddColumn("vps", "lock_state TEXT DEFAULT NULL");

      // Deduplicate any pre-existing duplicate rows before applying unique constraint
      try {
        db.run(`
          DELETE FROM vps WHERE rowid NOT IN (
            SELECT MIN(rowid) FROM vps GROUP BY proxmox_node_id, proxmox_vmid
          );
        `);
      } catch {
        // ignore if rowid or group by fails
      }

      // Unique index on (proxmox_node_id, proxmox_vmid)
      db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_vps_node_vmid ON vps(proxmox_node_id, proxmox_vmid);");

      // 2. Extend provisioning_jobs table
      safeAddColumn("provisioning_jobs", "current_state TEXT");
      safeAddColumn("provisioning_jobs", "vmid INTEGER");
      safeAddColumn("provisioning_jobs", "cleanup_status TEXT");
      safeAddColumn("provisioning_jobs", "error_details TEXT");
      safeAddColumn("provisioning_jobs", "request_hash TEXT");

      // 3. Create vps_operations table
      db.run(`
        CREATE TABLE IF NOT EXISTS vps_operations (
          id                    TEXT PRIMARY KEY,
          vps_id                TEXT NOT NULL REFERENCES vps(id) ON DELETE CASCADE,
          requested_by_user_id  TEXT NOT NULL REFERENCES users(id),
          operation_type        TEXT NOT NULL CHECK(operation_type IN ('start','stop','reboot','reinstall','password_reset','rename','update_description','sync_status','console')),
          status                TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','waiting_for_proxmox_task','completed','failed','cancelled','recovery_required')),
          current_step          TEXT NOT NULL DEFAULT 'queued',
          params_json           TEXT,
          result_json           TEXT,
          error_code            TEXT,
          error_message         TEXT,
          started_at            TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at          TEXT,
          created_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_vps_operations_vps_id ON vps_operations(vps_id);
        CREATE INDEX IF NOT EXISTS idx_vps_operations_status ON vps_operations(status);
        CREATE INDEX IF NOT EXISTS idx_vps_operations_created_at ON vps_operations(created_at);
      `);
    },
  },
  {
    version: 10,
    name: "proxmox_nodes_verification_and_storage_separation",
    up: (db: Database) => {
      // 1. Temporarily disable foreign keys for table recreation
      db.run("PRAGMA foreign_keys = OFF;");

      try {
        // Check if proxmox_nodes exists
        const tableCheck = db.exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='proxmox_nodes'"
        );

        if (tableCheck.length && tableCheck[0].values.length) {
          // Create v2 table with decoupled storages and expanded status CHECK constraint
          db.run(`
            CREATE TABLE IF NOT EXISTS proxmox_nodes_v2 (
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
              default_storage             TEXT,
              default_template_storage    TEXT,
              default_rootfs_storage      TEXT,
              default_bridge              TEXT,
              enabled                     INTEGER NOT NULL DEFAULT 1,
              status                      TEXT NOT NULL DEFAULT 'unverified' CHECK(status IN ('healthy','online','offline','degraded','misconfigured','unverified','unknown')),
              last_health_check           TEXT,
              last_verified_at            TEXT,
              health_info                 TEXT,
              verification_info           TEXT,
              created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
            );
          `);

          // Migrate data safely:
          // - default_template_storage is NULL (never hardcode 'local')
          // - default_rootfs_storage derived from existing default_storage
          // - status mapped to healthy/degraded/offline/misconfigured/unverified/unknown
          db.run(`
            INSERT INTO proxmox_nodes_v2 (
              id, cluster_id, name, hostname, api_url, port, node_name, region, flag_url,
              auth_token_id, auth_token_secret_encrypted, allow_insecure_tls,
              default_storage, default_template_storage, default_rootfs_storage, default_bridge,
              enabled, status, last_health_check, last_verified_at, health_info, verification_info,
              created_at, updated_at
            )
            SELECT 
              id, cluster_id, name, hostname, api_url, port, node_name, region, flag_url,
              auth_token_id, auth_token_secret_encrypted, allow_insecure_tls,
              default_storage,
              NULL,
              default_storage,
              default_bridge,
              enabled,
              CASE
                WHEN status = 'online' THEN 'healthy'
                WHEN status IN ('healthy','offline','degraded','misconfigured','unverified','unknown') THEN status
                ELSE 'unverified'
              END,
              last_health_check,
              last_health_check,
              health_info,
              health_info,
              created_at,
              updated_at
            FROM proxmox_nodes;
          `);

          db.run("DROP TABLE proxmox_nodes;");
          db.run("ALTER TABLE proxmox_nodes_v2 RENAME TO proxmox_nodes;");
        } else {
          // Fresh creation
          db.run(`
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
              default_storage             TEXT,
              default_template_storage    TEXT,
              default_rootfs_storage      TEXT,
              default_bridge              TEXT,
              enabled                     INTEGER NOT NULL DEFAULT 1,
              status                      TEXT NOT NULL DEFAULT 'unverified' CHECK(status IN ('healthy','online','offline','degraded','misconfigured','unverified','unknown')),
              last_health_check           TEXT,
              last_verified_at            TEXT,
              health_info                 TEXT,
              verification_info           TEXT,
              created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
            );
          `);
        }

        // Recreate indexes
        db.run("CREATE INDEX IF NOT EXISTS idx_proxmox_nodes_status ON proxmox_nodes(status);");
        db.run("CREATE INDEX IF NOT EXISTS idx_proxmox_nodes_enabled ON proxmox_nodes(enabled);");
      } finally {
        db.run("PRAGMA foreign_keys = ON;");
      }
    },
  },
  {
    version: 11,
    name: "sync_node_ports_from_api_urls",
    up: (db: Database) => {
      // Find all nodes in proxmox_nodes and adjust ports if the api_url is a domain or standard URL without explicit :8006
      const nodesResult = db.exec("SELECT id, api_url, port, hostname FROM proxmox_nodes;");
      if (nodesResult.length && nodesResult[0].values.length) {
        for (const row of nodesResult[0].values) {
          const id = row[0] as string;
          const apiUrl = (row[1] as string) || "";
          const currentPort = row[2] as number;
          const currentHost = (row[3] as string) || "";

          try {
            const rawUrl = /^https?:\/\//i.test(apiUrl) ? apiUrl : `https://${apiUrl}`;
            const parsed = new URL(rawUrl);
            const isHttps = parsed.protocol === "https:";
            let correctedPort: number;

            if (parsed.port) {
              correctedPort = parseInt(parsed.port, 10);
            } else if (currentPort === 8006) {
              // Legacy schema default was 8006, but the URL didn't specify :8006 (e.g. https://pve-pe.kinetichost.pro)
              correctedPort = isHttps ? 443 : 80;
            } else {
              correctedPort = currentPort;
            }

            const cleanHost = parsed.hostname || currentHost;
            db.run(
              "UPDATE proxmox_nodes SET port = ?, hostname = ? WHERE id = ?;",
              [correctedPort, cleanHost, id]
            );
          } catch {
            // Ignore unparseable
          }
        }
      }
    },
  },
  {
    version: 12,
    name: "vps_runtime_freshness_and_delete_operations",
    up: (db: Database) => {
      // 1. Helper to safely add column if not exists
      const safeAddColumn = (table: string, columnDef: string) => {
        try {
          db.run(`ALTER TABLE ${table} ADD COLUMN ${columnDef};`);
        } catch {
          // column already exists
        }
      };

      // Extend vps with runtime freshness and error tracking fields
      safeAddColumn("vps", "runtime_sync_error_code TEXT DEFAULT NULL");
      safeAddColumn("vps", "runtime_sync_error TEXT DEFAULT NULL");
      safeAddColumn("vps", "runtime_state_fresh INTEGER NOT NULL DEFAULT 1");
      safeAddColumn("vps", "runtime_node_name TEXT DEFAULT NULL");
      safeAddColumn("vps", "runtime_node_last_seen_at TEXT DEFAULT NULL");

      // 2. Rebuild vps_operations to expand operation_type CHECK constraint to include 'delete' and 'force_stop'
      db.run("PRAGMA foreign_keys = OFF;");
      try {
        const tableCheck = db.exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='vps_operations'"
        );

        if (tableCheck.length && tableCheck[0].values.length) {
          db.run(`
            CREATE TABLE IF NOT EXISTS vps_operations_v2 (
              id                    TEXT PRIMARY KEY,
              vps_id                TEXT,
              requested_by_user_id  TEXT NOT NULL REFERENCES users(id),
              operation_type        TEXT NOT NULL CHECK(operation_type IN ('start','stop','force_stop','reboot','reinstall','password_reset','rename','update_description','sync_status','console','delete','hostname_update')),
              status                TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','waiting_for_proxmox_task','completed','failed','cancelled','recovery_required')),
              current_step          TEXT NOT NULL DEFAULT 'queued',
              params_json           TEXT,
              result_json           TEXT,
              error_code            TEXT,
              error_message         TEXT,
              started_at            TEXT NOT NULL DEFAULT (datetime('now')),
              completed_at          TEXT,
              created_at            TEXT NOT NULL DEFAULT (datetime('now'))
            );
          `);

          db.run(`
            INSERT OR IGNORE INTO vps_operations_v2 (
              id, vps_id, requested_by_user_id, operation_type, status, current_step,
              params_json, result_json, error_code, error_message, started_at, completed_at, created_at
            )
            SELECT
              id, vps_id, requested_by_user_id, operation_type, status, current_step,
              params_json, result_json, error_code, error_message, started_at, completed_at, created_at
            FROM vps_operations;
          `);

          db.run("DROP TABLE vps_operations;");
          db.run("ALTER TABLE vps_operations_v2 RENAME TO vps_operations;");

          db.run("CREATE INDEX IF NOT EXISTS idx_vps_operations_vps_id ON vps_operations(vps_id);");
          db.run("CREATE INDEX IF NOT EXISTS idx_vps_operations_status ON vps_operations(status);");
          db.run("CREATE INDEX IF NOT EXISTS idx_vps_operations_created_at ON vps_operations(created_at);");
        }
      } finally {
        db.run("PRAGMA foreign_keys = ON;");
      }
    },
  },
  {
    version: 13,
    name: "node_lifecycle_and_operation_leasing",
    up: (db: Database) => {
      // 1. Add heartbeat_at and lease_expires_at to vps_operations
      const safeAddColumn = (table: string, columnDef: string) => {
        try {
          db.run(`ALTER TABLE ${table} ADD COLUMN ${columnDef};`);
        } catch {
          // column already exists
        }
      };

      safeAddColumn("vps_operations", "heartbeat_at TEXT DEFAULT NULL");
      safeAddColumn("vps_operations", "lease_expires_at TEXT DEFAULT NULL");
      db.run("CREATE INDEX IF NOT EXISTS idx_vps_operations_lease ON vps_operations(status, lease_expires_at);");

      // 2. Rebuild proxmox_nodes to expand status CHECK constraint to include disabled, draining, deleting
      db.run("PRAGMA foreign_keys = OFF;");
      try {
        const tableCheck = db.exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='proxmox_nodes'"
        );

        if (tableCheck.length && tableCheck[0].values.length) {
          db.run(`
            CREATE TABLE IF NOT EXISTS proxmox_nodes_v3 (
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
              default_storage             TEXT,
              default_template_storage    TEXT,
              default_rootfs_storage      TEXT,
              default_bridge              TEXT,
              enabled                     INTEGER NOT NULL DEFAULT 1,
              status                      TEXT NOT NULL DEFAULT 'unverified' CHECK(status IN ('healthy','online','offline','degraded','misconfigured','unverified','unknown','disabled','draining','deleting')),
              last_health_check           TEXT,
              last_verified_at            TEXT,
              health_info                 TEXT,
              verification_info           TEXT,
              created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
            );
          `);

          db.run(`
            INSERT INTO proxmox_nodes_v3 (
              id, cluster_id, name, hostname, api_url, port, node_name, region, flag_url,
              auth_token_id, auth_token_secret_encrypted, allow_insecure_tls,
              default_storage, default_template_storage, default_rootfs_storage, default_bridge,
              enabled, status, last_health_check, last_verified_at, health_info, verification_info,
              created_at, updated_at
            )
            SELECT 
              id, cluster_id, name, hostname, api_url, port, node_name, region, flag_url,
              auth_token_id, auth_token_secret_encrypted, allow_insecure_tls,
              default_storage, default_template_storage, default_rootfs_storage, default_bridge,
              enabled, status, last_health_check, last_verified_at, health_info, verification_info,
              created_at, updated_at
            FROM proxmox_nodes;
          `);

          db.run("DROP TABLE proxmox_nodes;");
          db.run("ALTER TABLE proxmox_nodes_v3 RENAME TO proxmox_nodes;");

          db.run("CREATE INDEX IF NOT EXISTS idx_proxmox_nodes_status ON proxmox_nodes(status);");
          db.run("CREATE INDEX IF NOT EXISTS idx_proxmox_nodes_enabled ON proxmox_nodes(enabled);");
        }
      } finally {
        db.run("PRAGMA foreign_keys = ON;");
      }
    },
  },
  {
    version: 14,
    name: "user_auth_identity_expansion",
    up: (db: Database) => {
      db.run("PRAGMA foreign_keys = OFF;");
      try {
        const tableCheck = db.exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
        );

        if (tableCheck.length && tableCheck[0].values.length) {
          // Rebuild users table allowing nullable discord_id and adding password_hash
          db.run(`
            CREATE TABLE IF NOT EXISTS users_v3 (
              id              TEXT PRIMARY KEY,
              discord_id      TEXT UNIQUE,
              username        TEXT NOT NULL,
              global_name     TEXT,
              email           TEXT,
              password_hash   TEXT DEFAULT NULL,
              avatar_hash     TEXT,
              role            TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
              status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','banned')),
              created_at      TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
              last_login_at   TEXT
            );
          `);

          db.run(`
            INSERT OR IGNORE INTO users_v3 (
              id, discord_id, username, global_name, email, avatar_hash, role, status, created_at, updated_at, last_login_at
            )
            SELECT 
              id, discord_id, username, global_name, email, avatar_hash, role, status, created_at, updated_at, last_login_at
            FROM users;
          `);

          db.run("DROP TABLE users;");
          db.run("ALTER TABLE users_v3 RENAME TO users;");

          db.run("CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);");
          db.run("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);");
        }
      } finally {
        db.run("PRAGMA foreign_keys = ON;");
      }
    },
  },
  {
    version: 15,
    name: "auth_provider_settings",
    up: (db: Database) => {
      const defaultAuthSettings: [string, string][] = [
        ["auth_discord_enabled", "true"],
        ["auth_discord_client_id", ""],
        ["auth_discord_client_secret_encrypted", ""],
        ["auth_discord_redirect_uri", ""],
        ["auth_email_enabled", "false"],
        ["auth_email_allow_registration", "false"],
        ["auth_email_min_password_length", "8"],
      ];

      for (const [key, value] of defaultAuthSettings) {
        db.run(
          "INSERT OR IGNORE INTO panel_settings (key, value, updated_at) VALUES (?, ?, datetime('now'));",
          [key, value]
        );
      }
    },
  },
  {
    version: 16,
    name: "vps_expiration_schema",
    up: (db: Database) => {
      try {
        db.run("ALTER TABLE vps ADD COLUMN expires_at TEXT DEFAULT NULL;");
      } catch {
        // column may already exist
      }
      db.run("CREATE INDEX IF NOT EXISTS idx_vps_expires_at ON vps(expires_at);");
    },
  },
  {
    version: 17,
    name: "api_platform_core_schema",
    up: (db: Database) => {
      // API keys table
      db.run(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id                  TEXT PRIMARY KEY,
          name                TEXT NOT NULL,
          description         TEXT,
          prefix              TEXT NOT NULL,
          key_hash            TEXT NOT NULL UNIQUE,
          created_by_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          scopes              TEXT NOT NULL,
          metadata            TEXT,
          status              TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
          rate_limit_rpm      INTEGER NOT NULL DEFAULT 120,
          expires_at          TEXT DEFAULT NULL,
          revoked_at          TEXT DEFAULT NULL,
          revoked_by_user_id  TEXT DEFAULT NULL REFERENCES users(id),
          last_used_at        TEXT DEFAULT NULL,
          last_used_ip        TEXT DEFAULT NULL,
          last_used_user_agent TEXT DEFAULT NULL,
          rotation_parent_id  TEXT DEFAULT NULL REFERENCES api_keys(id),
          rotated_at          TEXT DEFAULT NULL,
          created_at          TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      db.run("CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);");
      db.run("CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);");
      db.run("CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys(created_by_user_id);");
      db.run("CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at ON api_keys(expires_at);");
      db.run("CREATE INDEX IF NOT EXISTS idx_api_keys_revoked_at ON api_keys(revoked_at);");
      db.run("CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);");

      // Idempotency table
      db.run(`
        CREATE TABLE IF NOT EXISTS api_idempotency_keys (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          idempotency_key   TEXT NOT NULL,
          api_key_id        TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
          method            TEXT NOT NULL,
          path              TEXT NOT NULL,
          request_hash      TEXT NOT NULL,
          status_code       INTEGER NOT NULL,
          response_headers  TEXT,
          response_body     TEXT NOT NULL,
          resource_id       TEXT,
          created_at        TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at        TEXT NOT NULL DEFAULT (datetime('now', '+24 hours'))
        );
      `);
      db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_api_idempotency ON api_idempotency_keys(api_key_id, idempotency_key);");
      db.run("CREATE INDEX IF NOT EXISTS idx_api_idempotency_expires ON api_idempotency_keys(expires_at);");

      // Usage telemetry table
      db.run(`
        CREATE TABLE IF NOT EXISTS api_usage_metrics (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          api_key_id        TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
          endpoint          TEXT NOT NULL,
          method            TEXT NOT NULL,
          status_code       INTEGER NOT NULL,
          response_time_ms  INTEGER,
          ip_address        TEXT,
          created_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      db.run("CREATE INDEX IF NOT EXISTS idx_api_usage_key ON api_usage_metrics(api_key_id);");
      db.run("CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage_metrics(created_at);");
    },
  },

  {
    version: 18,
    name: "startup_script_settings",
    up: (db: Database) => {
      const defaultStartupSettings: [string, string][] = [
        ["startup_script_enabled", "false"],
        [
          "startup_script_content",
          `#!/usr/bin/env bash
# ==============================================================================
# InterDash — VPS First-Install Startup Script
# ==============================================================================
# This script executes automatically once upon initial provisioning or reinstallation.
# Runtime Environment Variables:
#   $INTERDASH_VPS_ID   - Assigned VPS Identifier
#   $INTERDASH_HOSTNAME - Assigned Hostname
#   $INTERDASH_IPV4     - Primary Assigned IPv4 Address
# ==============================================================================

set -euo pipefail

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Initializing InterDash instance ($INTERDASH_HOSTNAME)..."

# Update package metadata
export DEBIAN_FRONTEND=noninteractive
apt-get update -q -y || true

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] InterDash first-install startup completed."
exit 0
`,
        ],
      ];

      for (const [key, value] of defaultStartupSettings) {
        db.run(
          "INSERT OR IGNORE INTO panel_settings (key, value, updated_at) VALUES (?, ?, datetime('now'));",
          [key, value]
        );
      }
    },
  },
  {
    version: 19,
    name: "anti_miner_protection",
    up: (db: Database) => {
      // 1. Create anti_miner_incidents table
      db.run(`
        CREATE TABLE IF NOT EXISTS anti_miner_incidents (
          id              TEXT PRIMARY KEY,
          vps_id          TEXT NOT NULL REFERENCES vps(id) ON DELETE CASCADE,
          owner_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          hostname        TEXT NOT NULL,
          trigger_type    TEXT NOT NULL,
          matched_target  TEXT NOT NULL,
          pid             INTEGER,
          cmdline         TEXT,
          action_taken    TEXT NOT NULL,
          status          TEXT NOT NULL DEFAULT 'detected',
          details_json    TEXT,
          detected_at     TEXT NOT NULL DEFAULT (datetime('now')),
          resolved_at     TEXT,
          resolved_by     TEXT REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_anti_miner_incidents_vps_id ON anti_miner_incidents(vps_id);
        CREATE INDEX IF NOT EXISTS idx_anti_miner_incidents_status ON anti_miner_incidents(status);
        CREATE INDEX IF NOT EXISTS idx_anti_miner_incidents_detected_at ON anti_miner_incidents(detected_at);
      `);

      // 2. Default Anti-Miner Panel Settings
      const defaultAntiMinerSettings: [string, string][] = [
        ["anti_miner_enabled", "false"],
        ["anti_miner_policy", "alert"],
        ["anti_miner_cpu_threshold", "90"],
        ["anti_miner_sustained_checks", "3"],
        ["anti_miner_scan_interval_sec", "60"],
        [
          "anti_miner_process_signatures",
          JSON.stringify([
            "xmrig",
            "minerd",
            "cpuminer",
            "xmr-stak",
            "cryptonight",
            "stratum",
            "ethminer",
            "nbminer",
            "ccminer",
            "nicehash",
            "kinsing",
            "kdevtmpfsi",
            "nanominer",
            "teamredminer",
            "t-rex",
            "gminer",
            "srbminer",
            "randomx",
            "rx/0",
            "donate-level",
            "moneroocean",
            "supportxmr",
            "hashvault",
          ]),
        ],
        [
          "anti_miner_network_ports",
          JSON.stringify([3333, 4444, 5555, 7777, 8888, 9999, 14444, 14433, 45560, 45700, 18080, 18081]),
        ],
        ["anti_miner_whitelist_vps_ids", JSON.stringify([])],
      ];

      for (const [key, value] of defaultAntiMinerSettings) {
        db.run(
          "INSERT OR IGNORE INTO panel_settings (key, value, updated_at) VALUES (?, ?, datetime('now'));",
          [key, value]
        );
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
      db.run("PRAGMA foreign_keys = OFF;");
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
      } finally {
        db.run("PRAGMA foreign_keys = ON;");
      }
    }
  }
}
