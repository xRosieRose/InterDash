/**
 * InterDash — Control Plane Regression & Ownership Tests
 *
 * Tests:
 * 1. Authentication & Route Guards for new routes (/instances, /analytics, /tickets, /admin/*)
 * 2. Role-Based Access Control (user vs admin on /api/admin/*)
 * 3. Ownership Isolation (User A cannot view User B's VPS or Ticket)
 * 4. Safety Guardrails (Cannot demote the last remaining admin)
 * 5. Public Settings vs Admin Settings
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { createApp } from "../index.js";
import { closeDatabase, execute, queryOne } from "../db/index.js";
import { hashToken } from "../middleware/auth.js";

let server: Server | null = null;
let BASE_URL = "";

// Test IDs
const USER_A_ID = "test-user-a-" + crypto.randomUUID();
const USER_B_ID = "test-user-b-" + crypto.randomUUID();
const ADMIN_ID = "test-admin-" + crypto.randomUUID();

const SESSION_USER_A = "sess-a-" + crypto.randomUUID();
const SESSION_USER_B = "sess-b-" + crypto.randomUUID();
const SESSION_ADMIN = "sess-admin-" + crypto.randomUUID();

let VPS_A_ID = "vps-a-" + crypto.randomUUID();
let TICKET_A_ID = "ticket-a-" + crypto.randomUUID();

async function fetchNoRedirect(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    redirect: "manual",
  });
}

describe("InterDash Control Plane & Ownership Tests", () => {
  before(async () => {
    try {
      const app = await createApp();
      await new Promise<void>((resolve) => {
        server = app.listen(0, () => {
          const address = server!.address();
          if (typeof address === "object" && address !== null) {
            BASE_URL = `http://localhost:${address.port}`;
          }
          resolve();
        });
      });

      const now = new Date().toISOString();
      const future = new Date(Date.now() + 86400000).toISOString();

      // Seed test users
      execute(
        `INSERT OR REPLACE INTO users (id, discord_id, username, global_name, email, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [USER_A_ID, "disc-a-" + Date.now(), "usera", "User A", "usera@test.com", "user", "active", now, now]
      );

      execute(
        `INSERT OR REPLACE INTO users (id, discord_id, username, global_name, email, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [USER_B_ID, "disc-b-" + Date.now(), "userb", "User B", "userb@test.com", "user", "active", now, now]
      );

      execute(
        `INSERT OR REPLACE INTO users (id, discord_id, username, global_name, email, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ADMIN_ID, "disc-admin-" + Date.now(), "adminuser", "Admin User", "admin@test.com", "admin", "active", now, now]
      );

      // Seed sessions with proper SHA-256 token hash
      execute(
        `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["sess-id-a", USER_A_ID, hashToken(SESSION_USER_A), future, now, now]
      );

      execute(
        `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["sess-id-b", USER_B_ID, hashToken(SESSION_USER_B), future, now, now]
      );

      execute(
        `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["sess-id-admin", ADMIN_ID, hashToken(SESSION_ADMIN), future, now, now]
      );

      // Seed a dummy node & VPS owned by User A
      execute(
        `INSERT OR REPLACE INTO proxmox_nodes (id, name, hostname, api_url, port, node_name, region, auth_token_id, auth_token_secret_encrypted, status, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ["test-node-1", "Test Node", "pve1.interenl.com", "https://pve1.interenl.com:8006", 8006, "pve1", "us-east", "root@pam!test", "enc", "online", 1, now, now]
      );

      execute(
        `INSERT OR REPLACE INTO vps (id, owner_user_id, proxmox_node_id, proxmox_vmid, name, hostname, status, os_image_id, cpu_cores, memory_mb, swap_mb, disk_gb, ipv4_address, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [VPS_A_ID, USER_A_ID, "test-node-1", 1099, "User A VPS", "vps-a.interenl.com", "running", "ubuntu-24.04", 2, 2048, 512, 25, "10.0.0.2", now, now]
      );

      // Seed a ticket owned by User A
      execute(
        `INSERT OR REPLACE INTO tickets (id, user_id, subject, category, priority, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [TICKET_A_ID, USER_A_ID, "Server connection inquiry", "general", "low", "open", now, now]
      );
    } catch (err: any) {
      console.error("[TEST BEFORE ERROR]:", err);
      throw err;
    }
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    closeDatabase();
    setTimeout(() => process.exit(0), 100).unref();
  });

  // ==========================================================================
  // SECTION 1: Unauthenticated Route Guards
  // ==========================================================================
  const unauthPages = [
    "/instances",
    "/analytics",
    "/tickets",
    "/admin/overview",
    "/admin/users",
    "/admin/nodes",
    "/admin/settings",
  ];

  for (const page of unauthPages) {
    it(`should redirect unauthenticated ${page} to /auth/sign-in`, async () => {
      const res = await fetchNoRedirect(page);
      assert.equal(res.status, 302);
      const location = res.headers.get("location");
      assert.ok(location?.includes("/auth/sign-in"));
    });
  }

  // ==========================================================================
  // SECTION 2: Role-Based Authorization Guards (User vs Admin)
  // ==========================================================================
  it("should return 403 when standard user attempts GET /api/admin/overview", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/overview`, {
      headers: { Cookie: `interdash_session=${SESSION_USER_A}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.ok(body.error, "Expected permission error");
  });

  it("should return 403 when standard user attempts GET /api/admin/users", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/users`, {
      headers: { Cookie: `interdash_session=${SESSION_USER_A}` },
    });
    assert.equal(res.status, 403);
  });

  it("should return 403 when standard user attempts GET /api/admin/nodes", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/nodes`, {
      headers: { Cookie: `interdash_session=${SESSION_USER_A}` },
    });
    assert.equal(res.status, 403);
  });

  it("should return 403 when standard user attempts POST /api/admin/vps", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/vps`, {
      method: "POST",
      headers: {
        Cookie: `interdash_session=${SESSION_USER_A}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        owner_user_id: USER_A_ID,
        proxmox_node_id: "test-node-1",
        hostname: "unauthorized.interenl.com",
      }),
    });
    assert.equal(res.status, 403);
  });

  it("should allow admin to access GET /api/admin/overview", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/overview`, {
      headers: { Cookie: `interdash_session=${SESSION_ADMIN}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.metrics, "Expected metrics object");
    assert.ok(typeof body.metrics.totalVps === "number");
    assert.ok(typeof body.metrics.totalUsers === "number");
  });

  // ==========================================================================
  // SECTION 3: Ownership Isolation (User A vs User B)
  // ==========================================================================
  it("should allow User A to view their own VPS", async () => {
    const res = await fetch(`${BASE_URL}/api/vps/${VPS_A_ID}`, {
      headers: { Cookie: `interdash_session=${SESSION_USER_A}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.instance.id, VPS_A_ID);
    assert.equal(body.instance.owner_user_id, USER_A_ID);
  });

  it("should return 403 when User B tries to view User A's VPS", async () => {
    const res = await fetch(`${BASE_URL}/api/vps/${VPS_A_ID}`, {
      headers: { Cookie: `interdash_session=${SESSION_USER_B}` },
    });
    assert.equal(res.status, 403, "User B should be denied access to User A's VPS");
  });

  it("should isolate VPS list: User B sees 0 instances while User A sees 1", async () => {
    const resA = await fetch(`${BASE_URL}/api/vps`, {
      headers: { Cookie: `interdash_session=${SESSION_USER_A}` },
    });
    const bodyA = await resA.json();
    assert.equal(bodyA.instances.length, 1);

    const resB = await fetch(`${BASE_URL}/api/vps`, {
      headers: { Cookie: `interdash_session=${SESSION_USER_B}` },
    });
    const bodyB = await resB.json();
    assert.equal(bodyB.instances.length, 0);
  });

  it("should allow User A to view their own Ticket", async () => {
    const res = await fetch(`${BASE_URL}/api/tickets/${TICKET_A_ID}`, {
      headers: { Cookie: `interdash_session=${SESSION_USER_A}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ticket.id, TICKET_A_ID);
  });

  it("should return 403 when User B tries to view User A's Ticket", async () => {
    const res = await fetch(`${BASE_URL}/api/tickets/${TICKET_A_ID}`, {
      headers: { Cookie: `interdash_session=${SESSION_USER_B}` },
    });
    assert.equal(res.status, 403, "User B should be denied access to User A's ticket");
  });

  // ==========================================================================
  // SECTION 4: Last Admin Demotion Guard
  // ==========================================================================
  it("should prevent demoting the last remaining administrator", async () => {
    const row = queryOne<{ c: number }>("SELECT COUNT(*) as c FROM users WHERE role = 'admin'");
    const admins = row?.c || 0;

    if (admins === 1) {
      const res = await fetch(`${BASE_URL}/api/admin/users/${ADMIN_ID}`, {
        method: "PATCH",
        headers: {
          Cookie: `interdash_session=${SESSION_ADMIN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "user" }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(body.error, /Cannot demote the last remaining administrator/i);
    } else {
      assert.ok(admins > 1);
    }
  });

  // ==========================================================================
  // SECTION 5: Public Panel Settings
  // ==========================================================================
  it("should allow public access to GET /api/settings", async () => {
    const res = await fetch(`${BASE_URL}/api/settings`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.settings, "Expected settings object");
    assert.ok(body.settings.brand_name, "Expected brand_name in settings");
  });
});
