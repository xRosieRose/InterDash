/**
 * InterDash — API Key System & Scoped Authentication Tests
 *
 * Tests:
 * 1. Cryptographic Key Generation & Hashing (CSPRNG, SHA-256 verifier, prefix)
 * 2. Key Lifecycle (request-time expiration, instant revocation, atomic rotation)
 * 3. Admin Key Management Routes (auth guard, secret displayed once, never in GET)
 * 4. API Authentication Middleware (Bearer extraction, transport validation)
 * 5. Two-Tier Scope Authorization (strict scope checks, api:full wildcard)
 * 6. Rate Limiting Headers & Request IDs
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Server } from "node:http";
import { createApp } from "../index.js";
import { closeDatabase, queryOne, execute } from "../db/index.js";
import { ApiKeyService } from "../services/api-key.js";
import { SCOPES } from "../services/api-scopes.js";

let server: Server | null = null;
let BASE_URL = "";

const CSRF_TOKEN = "test-csrf-token-api-keys";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function fetchSessionApi(path: string, options: RequestInit = {}): Promise<Response> {
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

async function fetchBearerApi(path: string, bearerToken?: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  if (bearerToken) {
    headers.set("Authorization", `Bearer ${bearerToken}`);
  }
  headers.set("Accept", "application/json");
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    redirect: "manual",
  });
}

describe("API Key System & Authentication Control Plane Tests", () => {
  let adminSessionCookie = "";
  let regularSessionCookie = "";
  let adminUserId = "admin-user-api-test";
  let regularUserId = "regular-user-api-test";

  before(async () => {
    const app = await createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server!.address();
        if (typeof addr === "object" && addr) {
          BASE_URL = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });

    // Create test admin user
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, email, role, status, created_at, updated_at)
       VALUES (?, ?, 'AdminUserApi', 'admin_api@test.local', 'admin', 'active', datetime('now'), datetime('now'))`,
      [adminUserId, "discord_admin_api_123"]
    );

    // Create test regular user
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, email, role, status, created_at, updated_at)
       VALUES (?, ?, 'RegularUserApi', 'user_api@test.local', 'user', 'active', datetime('now'), datetime('now'))`,
      [regularUserId, "discord_regular_api_456"]
    );

    // Setup admin session
    const adminToken = "admin-session-api-token";
    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES ('sess-admin-api', ?, ?, datetime('now', '+1 day'), datetime('now'), datetime('now'))`,
      [adminUserId, hashToken(adminToken)]
    );
    adminSessionCookie = `interdash_session=${adminToken}`;

    // Setup regular user session
    const regularToken = "regular-session-api-token";
    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES ('sess-regular-api', ?, ?, datetime('now', '+1 day'), datetime('now'), datetime('now'))`,
      [regularUserId, hashToken(regularToken)]
    );
    regularSessionCookie = `interdash_session=${regularToken}`;
  });

  after(() => {
    if (server) server.close();
    closeDatabase();
  });

  // ==========================================================================
  // 1. Cryptographic Key Service Tests
  // ==========================================================================
  describe("ApiKeyService Core Cryptography & Lifecycle", () => {
    let createdRawToken = "";
    let createdKeyId = "";

    it("should generate a key with 256-bit entropy, 'ih_live_' prefix and SHA-256 verifier", () => {
      const result = ApiKeyService.createKey(
        {
          name: "Test Automation Key",
          description: "Integration test key",
          scopes: [SCOPES.INSTANCES_READ, SCOPES.INSTANCES_POWER],
        },
        adminUserId
      );

      assert.ok(result.rawToken.startsWith("ih_live_"));
      assert.equal(result.rawToken.length, 8 + 64); // "ih_live_" (8) + 64 hex chars
      assert.ok(result.key.prefix.startsWith("ih_live_"));
      assert.equal(result.key.status, "active");
      assert.deepEqual(result.key.scopes, [SCOPES.INSTANCES_READ, SCOPES.INSTANCES_POWER]);

      // Check DB storage: raw token must NOT be in DB
      const dbRow = queryOne<any>("SELECT key_hash FROM api_keys WHERE id = ?", [result.key.id]);
      assert.ok(dbRow);
      assert.notEqual(dbRow.key_hash, result.rawToken);
      assert.equal(dbRow.key_hash, ApiKeyService.hashToken(result.rawToken));

      createdRawToken = result.rawToken;
      createdKeyId = result.key.id;
    });

    it("should successfully verify a valid raw token and return the key record", () => {
      const verified = ApiKeyService.verifyApiKey(createdRawToken);
      assert.equal(verified.id, createdKeyId);
      assert.equal(verified.status, "active");
    });

    it("should reject an invalid raw token with API_KEY_INVALID", () => {
      assert.throws(
        () => ApiKeyService.verifyApiKey("ih_live_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"),
        (err: any) => err.code === "API_KEY_INVALID" && err.statusCode === 401
      );
    });

    it("should atomically rotate an API key, revoking the old key immediately", () => {
      const rotated = ApiKeyService.rotateKey(createdKeyId, adminUserId);
      assert.ok(rotated.rawToken.startsWith("ih_live_"));
      assert.notEqual(rotated.rawToken, createdRawToken);
      assert.equal(rotated.key.rotation_parent_id, createdKeyId);

      // Old key must now throw API_KEY_REVOKED
      assert.throws(
        () => ApiKeyService.verifyApiKey(createdRawToken),
        (err: any) => err.code === "API_KEY_REVOKED" && err.statusCode === 401
      );

      // New key must verify cleanly
      const verifiedNew = ApiKeyService.verifyApiKey(rotated.rawToken);
      assert.equal(verifiedNew.id, rotated.key.id);
      assert.equal(verifiedNew.status, "active");
    });

    it("should reject expired keys at request-time", () => {
      // Insert an expired key directly into DB
      const rawToken = `ih_live_${crypto.randomBytes(32).toString("hex")}`;
      const keyHash = ApiKeyService.hashToken(rawToken);
      const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
      const expiredKeyId = `key_test_expired_${Date.now()}_${Math.random().toString(36).substring(2)}`;

      execute(
        `INSERT INTO api_keys (
          id, name, prefix, key_hash, created_by_user_id, scopes, status, expires_at, created_at, updated_at
        ) VALUES (?, 'Expired Key', 'ih_live_exp123', ?, ?, '["instances:read"]', 'active', ?, datetime('now'), datetime('now'))`,
        [expiredKeyId, keyHash, adminUserId, pastDate]
      );

      assert.throws(
        () => ApiKeyService.verifyApiKey(rawToken),
        (err: any) => err.code === "API_KEY_EXPIRED" && err.statusCode === 401
      );
    });
  });

  // ==========================================================================
  // 2. Admin API Key Management Endpoints
  // ==========================================================================
  describe("Admin API Key Management Routes (/api/admin/api-keys)", () => {
    let createdKeyId = "";

    it("should reject unauthenticated request with 401", async () => {
      const res = await fetchSessionApi("/api/admin/api-keys");
      assert.equal(res.status, 401);
    });

    it("should reject regular user with 403 Forbidden", async () => {
      const res = await fetchSessionApi("/api/admin/api-keys", {
        headers: { Cookie: regularSessionCookie },
      });
      assert.equal(res.status, 403);
    });

    it("should allow admin to list API keys and available scopes without exposing hashes", async () => {
      const res = await fetchSessionApi("/api/admin/api-keys", {
        headers: { Cookie: adminSessionCookie },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.keys));
      assert.ok(Array.isArray(data.availableScopes));

      // Verify no key_hash is returned
      for (const k of data.keys) {
        assert.equal((k as any).key_hash, undefined);
      }
    });

    it("should allow admin to create a key and return rawToken exactly once", async () => {
      const res = await fetchSessionApi("/api/admin/api-keys", {
        method: "POST",
        headers: {
          Cookie: adminSessionCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Webhook Integration Bot",
          description: "Test bot",
          scopes: [SCOPES.INSTANCES_READ, SCOPES.TICKETS_READ],
        }),
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.ok(data.rawToken);
      assert.ok(data.rawToken.startsWith("ih_live_"));
      assert.equal(data.key.name, "Webhook Integration Bot");
      createdKeyId = data.key.id;

      // Ensure subsequent GET /api-keys/:id does NOT return rawToken or key_hash
      const getRes = await fetchSessionApi(`/api/admin/api-keys/${createdKeyId}`, {
        headers: { Cookie: adminSessionCookie },
      });
      assert.equal(getRes.status, 200);
      const getData = await getRes.json();
      assert.equal(getData.rawToken, undefined);
      assert.equal((getData.key as any).key_hash, undefined);
    });

    it("should allow admin to revoke an API key immediately", async () => {
      const res = await fetchSessionApi(`/api/admin/api-keys/${createdKeyId}/revoke`, {
        method: "POST",
        headers: { Cookie: adminSessionCookie },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.key.status, "revoked");
      assert.ok(data.key.revoked_at);
    });
  });

  // ==========================================================================
  // 3. /api/v1/auth/me & Transport Security Tests
  // ==========================================================================
  describe("API v1 Authentication Middleware & Transport", () => {
    let testKeyToken = "";
    let testKeyId = "";

    before(() => {
      const created = ApiKeyService.createKey(
        {
          name: "Transport Verification Key",
          scopes: [SCOPES.INSTANCES_READ],
          rateLimitRpm: 150,
        },
        adminUserId
      );
      testKeyToken = created.rawToken;
      testKeyId = created.key.id;
    });

    it("should return 401 when Authorization header is missing", async () => {
      const res = await fetchBearerApi("/api/v1/auth/me");
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error.code, "API_KEY_REQUIRED");
      assert.ok(data.requestId);
    });

    it("should reject API keys passed via query parameter with 400", async () => {
      const res = await fetch(`${BASE_URL}/api/v1/auth/me?api_key=${testKeyToken}`);
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error.code, "INVALID_CREDENTIAL_TRANSPORT");
    });

    it("should reject malformed Authorization header with 401", async () => {
      const res = await fetch(`${BASE_URL}/api/v1/auth/me`, {
        headers: { Authorization: `Basic ${testKeyToken}` },
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error.code, "INVALID_AUTHORIZATION_HEADER");
    });

    it("should successfully authenticate with valid Bearer token and return API principal", async () => {
      const res = await fetchBearerApi("/api/v1/auth/me", testKeyToken);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.data.apiKeyId, testKeyId);
      assert.equal(data.data.keyName, "Transport Verification Key");
      assert.deepEqual(data.data.scopes, [SCOPES.INSTANCES_READ]);
      assert.equal(data.data.rateLimitRpm, 150);
      assert.ok(data.requestId);

      // Verify X-Request-ID response header
      assert.equal(res.headers.get("X-Request-ID"), data.requestId);
      // Verify rate limit headers
      assert.ok(res.headers.has("X-RateLimit-Limit"));
      assert.ok(res.headers.has("X-RateLimit-Remaining"));
    });

    it("should reject with 403 API_SCOPE_REQUIRED when key lacks necessary scope", async () => {
      // testKeyToken only has instances:read, try calling a write endpoint
      const res = await fetchBearerApi(`/api/v1/instances/some-vps`, testKeyToken, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error.code, "API_SCOPE_REQUIRED");
      assert.deepEqual(data.error.details.requiredScopes, [SCOPES.INSTANCES_WRITE]);
    });
  });
});
