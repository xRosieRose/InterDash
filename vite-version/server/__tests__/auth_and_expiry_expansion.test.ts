/**
 * InterDash — Auth Configuration & Durable VPS Expiry Tests
 *
 * Tests for:
 * 1. PasswordService (scrypt hash + timing-safe verification)
 * 2. AuthConfigService (provider settings, admin views, secret encryption)
 * 3. VpsExpiryService (expiry checking, action blocking, date extensions)
 * 4. Auth API: GET /api/auth/providers, POST /api/auth/email/register, POST /api/auth/email/login
 * 5. Admin API: GET/PATCH /api/admin/settings/authentication, PATCH /api/admin/vps/:id/expiry
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Server } from "node:http";
import { createApp } from "../index.js";
import { closeDatabase, queryOne, execute } from "../db/index.js";
import { PasswordService } from "../services/password.js";
import { AuthConfigService } from "../services/auth-config.js";
import { VpsExpiryService } from "../services/vps-expiry.js";

let server: Server | null = null;
let BASE_URL = "";

const CSRF_TOKEN = "test-csrf-token-auth-expiry";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function fetchApi(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  if (!headers.has("x-csrf-token")) {
    headers.set("x-csrf-token", CSRF_TOKEN);
  }
  const existingCookie = headers.get("Cookie") || "";
  if (!existingCookie.includes("interdash_csrf")) {
    headers.set(
      "Cookie",
      existingCookie
        ? `${existingCookie}; interdash_csrf=${CSRF_TOKEN}`
        : `interdash_csrf=${CSRF_TOKEN}`
    );
  }
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    redirect: "manual",
  });
}

describe("Auth Configuration & VPS Expiry Expansion Tests", () => {
  let adminCookie = "";
  let regularCookie = "";
  const testVpsId = "vps-expiry-test-vm-1";

  before(async () => {
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
    const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Seed test users
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, global_name, email, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      ["user-admin-exp-1", "discord-admin-1", "admin_tester", "Admin Tester", "admin@example.com", "admin", now, now]
    );
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, global_name, email, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      ["user-regular-exp-1", "discord-regular-1", "regular_tester", "Regular Tester", "regular@example.com", "user", now, now]
    );

    // Seed test sessions
    const adminSessionToken = "test_admin_session_token_12345";
    const regularSessionToken = "test_regular_session_token_12345";

    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["sess-admin-1", "user-admin-exp-1", hashToken(adminSessionToken), futureExpiry, now, now]
    );
    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["sess-regular-1", "user-regular-exp-1", hashToken(regularSessionToken), futureExpiry, now, now]
    );

    adminCookie = `interdash_session=${adminSessionToken}`;
    regularCookie = `interdash_session=${regularSessionToken}`;

    // Reset default panel_settings for auth
    execute(
      `INSERT OR REPLACE INTO panel_settings (key, value, updated_at) VALUES
       ('auth_discord_enabled', 'true', datetime('now')),
       ('auth_email_enabled', 'false', datetime('now')),
       ('auth_email_allow_registration', 'false', datetime('now'))`
    );
    AuthConfigService.invalidateCache();

    // Seed test node & test VPS
    execute(
      `INSERT OR REPLACE INTO proxmox_nodes (id, name, hostname, api_url, port, auth_token_id, auth_token_secret_encrypted, node_name, region, status, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["node-pve-test-1", "Test Node 1", "127.0.0.1", "https://127.0.0.1:8006", 8006, "root@pam!token", "secret", "pve01", "test-region", "online", 1]
    );

    execute(
      `INSERT OR REPLACE INTO vps (id, owner_user_id, proxmox_node_id, proxmox_vmid, name, hostname, status, os_image_id, cpu_cores, memory_mb, swap_mb, disk_gb, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'stopped', ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [testVpsId, "user-regular-exp-1", "node-pve-test-1", 9910, "Expiry Test VPS", "test-expiry.local", "local:vztmpl/ubuntu.tar.zst", 2, 2048, 512, 20, now, now]
    );
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    closeDatabase();
  });

  // ==========================================================================
  // PasswordService Unit Tests
  // ==========================================================================
  describe("PasswordService (Scrypt Hashing)", () => {
    it("should hash a password with random salt and verify correctly", async () => {
      const password = "SuperSecretPassword123!";
      const hash = await PasswordService.hash(password);

      assert.ok(hash.startsWith("scrypt:"));
      const isValid = await PasswordService.verify(password, hash);
      assert.strictEqual(isValid, true);

      const isInvalid = await PasswordService.verify("WrongPassword456!", hash);
      assert.strictEqual(isInvalid, false);
    });

    it("should reject invalid hash formats gracefully", async () => {
      const isValid = await PasswordService.verify("password", "invalid-hash-string");
      assert.strictEqual(isValid, false);
    });
  });

  // ==========================================================================
  // AuthConfigService Tests
  // ==========================================================================
  describe("AuthConfigService", () => {
    it("should report Discord enabled by default", () => {
      const isDiscord = AuthConfigService.isDiscordEnabled();
      assert.strictEqual(isDiscord, true);
    });

    it("should return public provider status without exposing secrets", () => {
      const status = AuthConfigService.getPublicStatus();
      assert.ok("discord" in status);
      assert.ok("email" in status);
      assert.strictEqual(typeof status.discord.enabled, "boolean");
      assert.strictEqual(typeof status.email.enabled, "boolean");
      // Must not expose client secret
      assert.strictEqual((status.discord as Record<string, unknown>).clientSecret, undefined);
    });

    it("should return admin settings with masked secrets", () => {
      const adminSettings = AuthConfigService.getAdminSettings();
      assert.ok("discord" in adminSettings);
      assert.ok("email" in adminSettings);
      assert.strictEqual(typeof adminSettings.discord.hasClientSecret, "boolean");
      assert.strictEqual(typeof adminSettings.discord.enabled, "boolean");
      assert.strictEqual(typeof adminSettings.email.enabled, "boolean");
    });
  });

  // ==========================================================================
  // Public Providers API Test
  // ==========================================================================
  describe("GET /api/auth/providers", () => {
    it("should return provider configuration publicly without authentication", async () => {
      const res = await fetchApi("/api/auth/providers");
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.discord);
      assert.ok(data.email);
      assert.strictEqual(typeof data.discord.enabled, "boolean");
      assert.strictEqual(typeof data.email.enabled, "boolean");
    });
  });

  // ==========================================================================
  // Admin Authentication Settings API Tests
  // ==========================================================================
  describe("Admin Settings Authentication Endpoints", () => {
    it("should reject non-admin access to GET /api/admin/settings/authentication", async () => {
      const res = await fetchApi("/api/admin/settings/authentication", {
        headers: { Cookie: regularCookie },
      });
      assert.strictEqual(res.status, 403);
    });

    it("should allow admin access to GET /api/admin/settings/authentication", async () => {
      const res = await fetchApi("/api/admin/settings/authentication", {
        headers: { Cookie: adminCookie },
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.discord);
      assert.ok(data.email);
    });

    it("should enable email authentication and update settings", async () => {
      const patchRes = await fetchApi("/api/admin/settings/authentication", {
        method: "PATCH",
        headers: {
          Cookie: adminCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          discord: { enabled: true },
          email: {
            enabled: true,
            allowRegistration: true,
            minPasswordLength: 8,
          },
        }),
      });

      assert.strictEqual(patchRes.status, 200);
      const updated = AuthConfigService.getAdminSettings();
      assert.strictEqual(updated.email.enabled, true);
      assert.strictEqual(updated.email.allowRegistration, true);
    });

    it("should reject disabling all providers (safety rule)", async () => {
      const patchRes = await fetchApi("/api/admin/settings/authentication", {
        method: "PATCH",
        headers: {
          Cookie: adminCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          discord: { enabled: false },
          email: { enabled: false },
        }),
      });

      assert.strictEqual(patchRes.status, 400);
      const data = await patchRes.json();
      assert.match(data.error, /Cannot disable all authentication providers/i);
    });
  });

  // ==========================================================================
  // Email Registration & Login API Tests
  // ==========================================================================
  describe("Email Registration & Login", () => {
    const testEmail = `newuser_${Date.now()}@example.com`;
    const testPassword = "MySecurePassword2026!";

    it("should register a new user via email", async () => {
      const regRes = await fetchApi("/api/auth/email/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
          username: "emailtester",
        }),
      });

      assert.strictEqual(regRes.status, 201);
      const data = await regRes.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.redirect, "/dashboard");

      // Verify cookie was set
      const setCookie = regRes.headers.get("set-cookie");
      assert.ok(setCookie?.includes("interdash_session="));
    });

    it("should reject duplicate email registration", async () => {
      const regRes = await fetchApi("/api/auth/email/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
        }),
      });

      assert.strictEqual(regRes.status, 409);
    });

    it("should authenticate existing email user", async () => {
      const loginRes = await fetchApi("/api/auth/email/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
        }),
      });

      assert.strictEqual(loginRes.status, 200);
      const data = await loginRes.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.redirect, "/dashboard");
    });

    it("should reject wrong password", async () => {
      const loginRes = await fetchApi("/api/auth/email/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: testEmail,
          password: "WrongPassword999!",
        }),
      });

      assert.strictEqual(loginRes.status, 401);
    });
  });

  // ==========================================================================
  // VpsExpiryService & Lifecycle Enforcement Tests
  // ==========================================================================
  describe("VPS Expiry Service & Action Blocking", () => {
    it("should correctly identify non-expired VPS", () => {
      assert.strictEqual(VpsExpiryService.isExpired(null), false);
      assert.strictEqual(VpsExpiryService.isExpired(undefined), false);

      const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
      assert.strictEqual(VpsExpiryService.isExpired(futureDate), false);
    });

    it("should correctly identify expired VPS", () => {
      const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
      assert.strictEqual(VpsExpiryService.isExpired(pastDate), true);
    });

    it("should block start, reboot, reinstall, and console on expired VPS", () => {
      const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
      const expiredVps = { id: testVpsId, expires_at: pastDate };

      assert.throws(
        () => VpsExpiryService.assertVpsActionAllowed(expiredVps, "start"),
        (err: any) => err.statusCode === 403 && /expired/i.test(err.message)
      );

      assert.throws(
        () => VpsExpiryService.assertVpsActionAllowed(expiredVps, "reboot"),
        (err: any) => err.statusCode === 403 && /expired/i.test(err.message)
      );

      assert.throws(
        () => VpsExpiryService.assertVpsActionAllowed(expiredVps, "reinstall"),
        (err: any) => err.statusCode === 403 && /expired/i.test(err.message)
      );

      assert.throws(
        () => VpsExpiryService.assertVpsActionAllowed(expiredVps, "console"),
        (err: any) => err.statusCode === 403 && /expired/i.test(err.message)
      );

      // Stop action must be permitted
      assert.doesNotThrow(() => VpsExpiryService.assertVpsActionAllowed(expiredVps, "stop"));

      // extend_expiry permitted for admin, blocked for user
      assert.doesNotThrow(() => VpsExpiryService.assertVpsActionAllowed(expiredVps, "extend_expiry", "admin"));
      assert.throws(
        () => VpsExpiryService.assertVpsActionAllowed(expiredVps, "extend_expiry", "user"),
        (err: any) => err.statusCode === 403
      );
    });

    it("should update VPS expiry via VpsExpiryService.updateVpsExpiry", () => {
      const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      const res = VpsExpiryService.updateVpsExpiry(testVpsId, future, "user-admin-exp-1");
      assert.ok(res.newExpiry);

      const row = queryOne<{ expires_at: string }>(
        `SELECT expires_at FROM vps WHERE id = ?`,
        [testVpsId]
      );
      assert.strictEqual(row?.expires_at, res.newExpiry);
    });

    it("should enforce expiry via API: block start when VPS is expired", async () => {
      // Set expiry to past directly in database
      const pastDate = new Date(Date.now() - 60 * 1000).toISOString();
      execute("UPDATE vps SET expires_at = ? WHERE id = ?", [pastDate, testVpsId]);

      const powerRes = await fetchApi(`/api/vps/${testVpsId}/power`, {
        method: "POST",
        headers: {
          Cookie: regularCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "start" }),
      });

      assert.strictEqual(powerRes.status, 403);
      const data = await powerRes.json();
      assert.match(data.error, /expired/i);
    });

    it("should allow admin to update expiry via PATCH /api/admin/vps/:id/expiry", async () => {
      const newExpiry = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

      const res = await fetchApi(`/api/admin/vps/${testVpsId}/expiry`, {
        method: "PATCH",
        headers: {
          Cookie: adminCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expires_at: newExpiry }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.expires_at, newExpiry);
    });

    it("should reject non-admin modifying expiry via PATCH /api/admin/vps/:id/expiry", async () => {
      const res = await fetchApi(`/api/admin/vps/${testVpsId}/expiry`, {
        method: "PATCH",
        headers: {
          Cookie: regularCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expires_at: null }),
      });

      assert.strictEqual(res.status, 403);
    });

    it("should allow clearing expiry (indefinite lifetime)", async () => {
      const res = await fetchApi(`/api/admin/vps/${testVpsId}/expiry`, {
        method: "PATCH",
        headers: {
          Cookie: adminCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expires_at: null }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.expires_at, null);
    });
  });
});
