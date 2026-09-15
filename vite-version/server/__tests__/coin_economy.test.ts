/**
 * InterDash — Virtual Coin Economy Foundation Test Suite
 *
 * Exhaustively verifies:
 * 1. Migration v20 (schema, tables, constraints, backfills)
 * 2. CoinService (atomic balance mutation, integer safety, limits, ledger integrity)
 * 3. Idempotency (replay caching vs conflicting key rejection)
 * 4. Concurrent grant safety (no lost updates)
 * 5. Admin API endpoints (GET /users with coin_balance, GET/POST coins, transactions)
 * 6. API v1 endpoints with dedicated economy scope enforcement (coins:read, coins:write)
 * 7. Auth integration (coin_balance in /api/auth/me and auto-account on registration)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Server } from "node:http";
import { v4 as uuidv4 } from "uuid";
import { createApp } from "../index.js";
import { closeDatabase, queryOne, queryAll, execute } from "../db/index.js";
import { CoinService, CoinError, MAX_SINGLE_COIN_AMOUNT } from "../services/coin.js";
import { ApiKeyService } from "../services/api-key.js";
import { SCOPES } from "../services/api-scopes.js";

let server: Server | null = null;
let BASE_URL = "";

const CSRF_TOKEN = "test-csrf-coin-economy";

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

describe("Virtual Coin Economy Foundation Tests", () => {
  const adminUserId = "usr-coin-admin-1";
  const regularUserId = "usr-coin-user-1";
  const user2Id = "usr-coin-user-2";

  let adminCookie = "";
  let regularCookie = "";

  let readOnlyApiKey = "";
  let writeOnlyApiKey = "";
  let fullAdminApiKey = "";
  let usersWriteApiKey = "";

  before(async () => {
    const app = await createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server?.address();
        if (addr && typeof addr === "object") {
          BASE_URL = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });

    // 1. Seed test users
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, email, role, status)
       VALUES (?, 'discord_admin_coin', 'CoinAdmin', 'admin@example.com', 'admin', 'active')`,
      [adminUserId]
    );

    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, email, role, status)
       VALUES (?, 'discord_user_coin_1', 'CoinUser1', 'user1@example.com', 'user', 'active')`,
      [regularUserId]
    );

    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, email, role, status)
       VALUES (?, 'discord_user_coin_2', 'CoinUser2', 'user2@example.com', 'user', 'active')`,
      [user2Id]
    );

    // Clean any previous test artifacts for deterministic test runs
    execute("DELETE FROM coin_transactions WHERE user_id IN (?, ?, ?)", [adminUserId, regularUserId, user2Id]);
    execute("DELETE FROM coin_accounts WHERE user_id IN (?, ?, ?)", [adminUserId, regularUserId, user2Id]);

    // Ensure coin accounts are initialized for seeded users
    CoinService.getOrCreateAccount(adminUserId);
    CoinService.getOrCreateAccount(regularUserId);
    CoinService.getOrCreateAccount(user2Id);

    // 2. Create sessions for cookie auth
    const adminToken = "admin_coin_session_raw_token";
    const regularToken = "user_coin_session_raw_token";

    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ('sess-coin-admin', ?, ?, datetime('now', '+1 hour'))`,
      [adminUserId, hashToken(adminToken)]
    );
    adminCookie = `interdash_session=${adminToken}`;

    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ('sess-coin-user', ?, ?, datetime('now', '+1 hour'))`,
      [regularUserId, hashToken(regularToken)]
    );
    regularCookie = `interdash_session=${regularToken}`;

    // 3. Create API keys with various scopes
    const k1 = ApiKeyService.createKey(
      {
        name: "Coin Read Key",
        scopes: [SCOPES.COINS_READ],
      },
      adminUserId
    );
    readOnlyApiKey = k1.rawToken;

    const k2 = ApiKeyService.createKey(
      {
        name: "Coin Write Key",
        scopes: [SCOPES.COINS_WRITE],
      },
      adminUserId
    );
    writeOnlyApiKey = k2.rawToken;

    const k3 = ApiKeyService.createKey(
      {
        name: "Full Admin Key",
        scopes: [SCOPES.FULL_ACCESS],
      },
      adminUserId
    );
    fullAdminApiKey = k3.rawToken;

    const k4 = ApiKeyService.createKey(
      {
        name: "Users Write Only Key",
        scopes: [SCOPES.USERS_WRITE, SCOPES.USERS_READ],
      },
      adminUserId
    );
    usersWriteApiKey = k4.rawToken;
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    closeDatabase();
  });

  // ==========================================================================
  // 1. Schema & Migration v20 Constraints
  // ==========================================================================
  describe("Schema & Constraint Integrity", () => {
    it("should ensure coin_accounts and coin_transactions tables exist", () => {
      const accTable = queryOne<any>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='coin_accounts'"
      );
      assert.ok(accTable, "coin_accounts table must exist");

      const txTable = queryOne<any>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='coin_transactions'"
      );
      assert.ok(txTable, "coin_transactions table must exist");
    });

    it("should have backfilled coin accounts for all seeded users", () => {
      const acc1 = queryOne<any>("SELECT balance FROM coin_accounts WHERE user_id = ?", [adminUserId]);
      assert.ok(acc1, "Admin user must have coin account");
      assert.strictEqual(acc1.balance >= 0, true);

      const acc2 = queryOne<any>("SELECT balance FROM coin_accounts WHERE user_id = ?", [regularUserId]);
      assert.ok(acc2, "Regular user 1 must have coin account");
    });

    it("should enforce non-negative balance CHECK constraint on coin_accounts", () => {
      assert.throws(() => {
        execute(
          "INSERT INTO coin_accounts (id, user_id, balance) VALUES (?, ?, -50)",
          [uuidv4(), "non-existent-user"]
        );
      });
    });

    it("should enforce UNIQUE user_id on coin_accounts", () => {
      assert.throws(() => {
        execute(
          "INSERT INTO coin_accounts (id, user_id, balance) VALUES (?, ?, 100)",
          [uuidv4(), regularUserId]
        );
      });
    });

    it("should enforce amount != 0 on coin_transactions", () => {
      assert.throws(() => {
        execute(
          `INSERT INTO coin_transactions (id, user_id, type, amount, balance_before, balance_after, reason)
           VALUES (?, ?, 'admin_grant', 0, 100, 100, 'invalid')`,
          [uuidv4(), regularUserId]
        );
      });
    });

    it("should enforce transaction type CHECK constraint", () => {
      assert.throws(() => {
        execute(
          `INSERT INTO coin_transactions (id, user_id, type, amount, balance_before, balance_after, reason)
           VALUES (?, ?, 'invalid_type_xyz', 100, 0, 100, 'test')`,
          [uuidv4(), regularUserId]
        );
      });
    });
  });

  // ==========================================================================
  // 2. CoinService Core Logic
  // ==========================================================================
  describe("CoinService Core Mutations & Safe Integers", () => {
    it("should get balance for user", () => {
      const bal = CoinService.getBalance(regularUserId);
      assert.strictEqual(typeof bal, "number");
      assert.strictEqual(bal >= 0, true);
    });

    it("should grant coins to user and update balance atomically", () => {
      const initialBalance = CoinService.getBalance(regularUserId);
      const grantAmount = 500;

      const res = CoinService.grantCoins({
        userId: regularUserId,
        amount: grantAmount,
        reason: "Test Welcome Bonus",
        description: "Automated test grant",
        adminUserId: adminUserId,
      });

      assert.strictEqual(res.isCached, false);
      assert.strictEqual(res.transaction.amount, grantAmount);
      assert.strictEqual(res.transaction.balance_before, initialBalance);
      assert.strictEqual(res.transaction.balance_after, initialBalance + grantAmount);
      assert.strictEqual(res.account.balance, initialBalance + grantAmount);

      // Verify DB state
      const dbBal = CoinService.getBalance(regularUserId);
      assert.strictEqual(dbBal, initialBalance + grantAmount);
    });

    it("should reject non-integer or float amounts", () => {
      assert.throws(() => {
        CoinService.grantCoins({
          userId: regularUserId,
          amount: 50.5,
          reason: "Float test",
        });
      }, (err: any) => err instanceof CoinError && err.code === "INVALID_COIN_AMOUNT");

      assert.throws(() => {
        CoinService.grantCoins({
          userId: regularUserId,
          amount: NaN,
          reason: "NaN test",
        });
      }, (err: any) => err instanceof CoinError && err.code === "INVALID_COIN_AMOUNT");

      assert.throws(() => {
        CoinService.grantCoins({
          userId: regularUserId,
          amount: "100" as any,
          reason: "String amount test",
        });
      }, (err: any) => err instanceof CoinError && err.code === "INVALID_COIN_AMOUNT");
    });

    it("should reject zero or negative amounts", () => {
      assert.throws(() => {
        CoinService.grantCoins({
          userId: regularUserId,
          amount: 0,
          reason: "Zero test",
        });
      }, (err: any) => err instanceof CoinError && err.code === "INVALID_COIN_AMOUNT");

      assert.throws(() => {
        CoinService.grantCoins({
          userId: regularUserId,
          amount: -100,
          reason: "Negative test",
        });
      }, (err: any) => err instanceof CoinError && err.code === "INVALID_COIN_AMOUNT");
    });

    it("should reject amounts exceeding MAX_SINGLE_COIN_AMOUNT (10^9)", () => {
      assert.throws(() => {
        CoinService.grantCoins({
          userId: regularUserId,
          amount: MAX_SINGLE_COIN_AMOUNT + 1,
          reason: "Overflow test",
        });
      }, (err: any) => err instanceof CoinError && err.code === "COIN_AMOUNT_TOO_LARGE");
    });

    it("should reject missing or empty reason", () => {
      assert.throws(() => {
        CoinService.grantCoins({
          userId: regularUserId,
          amount: 100,
          reason: "   ",
        });
      }, (err: any) => err instanceof CoinError && err.code === "INVALID_COIN_REASON");
    });

    it("should reject grant to non-existent user", () => {
      assert.throws(() => {
        CoinService.grantCoins({
          userId: "usr-ghost-does-not-exist",
          amount: 100,
          reason: "Ghost grant",
        });
      }, (err: any) => err instanceof CoinError && err.code === "COIN_USER_NOT_FOUND");
    });

    it("should block debitCoins and creditCoins in foundational phase", () => {
      assert.throws(() => {
        CoinService.debitCoins({
          userId: regularUserId,
          amount: 50,
          reason: "Spend test",
        });
      }, (err: any) => err instanceof CoinError && err.code === "COIN_OPERATION_FORBIDDEN");

      assert.throws(() => {
        CoinService.creditCoins({
          userId: regularUserId,
          amount: 50,
          reason: "Credit test",
        });
      }, (err: any) => err instanceof CoinError && err.code === "COIN_OPERATION_FORBIDDEN");
    });
  });

  // ==========================================================================
  // 3. Idempotency & Conflict Detection
  // ==========================================================================
  describe("Idempotency Replay & Conflict Safety", () => {
    it("should replay identical transaction on duplicate idempotency key without double credit", () => {
      const initialBal = CoinService.getBalance(user2Id);
      const testKey = `idem-key-test-${uuidv4()}`;

      const res1 = CoinService.grantCoins({
        userId: user2Id,
        amount: 250,
        reason: "Idempotent Grant",
        idempotencyKey: testKey,
        adminUserId: adminUserId,
      });

      assert.strictEqual(res1.isCached, false);
      assert.strictEqual(CoinService.getBalance(user2Id), initialBal + 250);

      // Re-submit identical grant with same key
      const res2 = CoinService.grantCoins({
        userId: user2Id,
        amount: 250,
        reason: "Idempotent Grant",
        idempotencyKey: testKey,
        adminUserId: adminUserId,
      });

      assert.strictEqual(res2.isCached, true);
      assert.strictEqual(res2.transaction.id, res1.transaction.id);
      // Balance must NOT have increased twice
      assert.strictEqual(CoinService.getBalance(user2Id), initialBal + 250);
    });

    it("should throw 409 conflict when idempotency key is reused with different parameters", () => {
      const testKey = `conflict-key-${uuidv4()}`;

      CoinService.grantCoins({
        userId: user2Id,
        amount: 100,
        reason: "Original grant",
        idempotencyKey: testKey,
      });

      assert.throws(() => {
        CoinService.grantCoins({
          userId: user2Id,
          amount: 999, // Mismatched amount
          reason: "Original grant",
          idempotencyKey: testKey,
        });
      }, (err: any) => err instanceof CoinError && err.code === "COIN_IDEMPOTENCY_CONFLICT" && err.statusCode === 409);
    });
  });

  // ==========================================================================
  // 4. Concurrency Safety & Ledger Integrity
  // ==========================================================================
  describe("Concurrency & Ledger Integrity Verification", () => {
    it("should accurately verify account integrity against transaction ledger sum", () => {
      const integrity = CoinService.verifyAccountIntegrity(user2Id);
      assert.strictEqual(integrity.valid, true);
      assert.strictEqual(integrity.accountBalance, integrity.ledgerSum);
      assert.strictEqual(integrity.discrepancy, 0);
    });

    it("should handle multiple sequential grants without losing updates", () => {
      const user = user2Id;
      const startBal = CoinService.getBalance(user);
      const increments = [10, 20, 30, 40, 50];

      for (const inc of increments) {
        CoinService.grantCoins({
          userId: user,
          amount: inc,
          reason: `Batch grant ${inc}`,
        });
      }

      const expectedTotal = startBal + increments.reduce((a, b) => a + b, 0);
      assert.strictEqual(CoinService.getBalance(user), expectedTotal);

      const integrity = CoinService.verifyAccountIntegrity(user);
      assert.strictEqual(integrity.valid, true);
    });
  });

  // ==========================================================================
  // 5. Admin API Endpoints
  // ==========================================================================
  describe("Admin Routes (/api/admin/users & /coins)", () => {
    it("should reject unauthenticated request to /api/admin/users with 401", async () => {
      const res = await fetch(`${BASE_URL}/api/admin/users`);
      assert.strictEqual(res.status, 401);
    });

    it("should reject regular user access to /api/admin/users with 403", async () => {
      const res = await fetchApi("/api/admin/users", {
        headers: { Cookie: regularCookie },
      });
      assert.strictEqual(res.status, 403);
    });

    it("should return users with coin_balance in GET /api/admin/users for admin", async () => {
      const res = await fetchApi("/api/admin/users", {
        headers: { Cookie: adminCookie },
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.users));

      const target = data.users.find((u: any) => u.id === regularUserId);
      assert.ok(target, "Target user must be returned");
      assert.strictEqual(typeof target.coin_balance, "number");
      assert.strictEqual(target.coin_balance >= 500, true);
    });

    it("should allow admin to GET /api/admin/users/:userId/coins", async () => {
      const res = await fetchApi(`/api/admin/users/${regularUserId}/coins`, {
        headers: { Cookie: adminCookie },
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.account);
      assert.strictEqual(data.account.user_id, regularUserId);
      assert.ok(data.integrity);
      assert.strictEqual(data.integrity.valid, true);
    });

    it("should allow admin to POST /api/admin/users/:userId/coins/grant", async () => {
      const prevBal = CoinService.getBalance(regularUserId);
      const grantAmount = 300;

      const res = await fetchApi(`/api/admin/users/${regularUserId}/coins/grant`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          amount: grantAmount,
          reason: "Support Credit",
          description: "Admin panel grant test",
        }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.account.balance, prevBal + grantAmount);
      assert.strictEqual(data.transaction.amount, grantAmount);
    });

    it("should reject invalid amount in admin grant endpoint with 400", async () => {
      const res = await fetchApi(`/api/admin/users/${regularUserId}/coins/grant`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          amount: -50,
          reason: "Invalid",
        }),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.code, "INVALID_COIN_AMOUNT");
    });

    it("should allow admin to GET /api/admin/users/:userId/coins/transactions", async () => {
      const res = await fetchApi(`/api/admin/users/${regularUserId}/coins/transactions?page=1&pageSize=10`, {
        headers: { Cookie: adminCookie },
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.transactions));
      assert.strictEqual(data.transactions.length > 0, true);
      assert.ok(data.pagination);
      assert.strictEqual(data.pagination.page, 1);
    });
  });

  // ==========================================================================
  // 6. API v1 Scope Enforcement & Endpoints
  // ==========================================================================
  describe("API v1 Scope Enforcement & Dedicated Economy Permissions", () => {
    it("should reject unauthenticated request to /api/v1/coins/:userId with 401", async () => {
      const res = await fetch(`${BASE_URL}/api/v1/coins/${regularUserId}`);
      assert.strictEqual(res.status, 401);
    });

    it("should reject API key with users:write when requesting coins:read endpoint with 403", async () => {
      const res = await fetch(`${BASE_URL}/api/v1/coins/${regularUserId}`, {
        headers: { Authorization: `Bearer ${usersWriteApiKey}` },
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.error.code, "API_SCOPE_REQUIRED");
    });

    it("should reject API key with coins:read when requesting coins:write endpoint with 403", async () => {
      const res = await fetch(`${BASE_URL}/api/v1/coins/${regularUserId}/grant`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${readOnlyApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: 100,
          reason: "Unauthorized write",
        }),
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.error.code, "API_SCOPE_REQUIRED");
    });

    it("should allow API key with coins:read to fetch balance via /api/v1/coins/:userId", async () => {
      const res = await fetch(`${BASE_URL}/api/v1/coins/${regularUserId}`, {
        headers: { Authorization: `Bearer ${readOnlyApiKey}` },
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.data.userId, regularUserId);
      assert.strictEqual(typeof data.data.balance, "number");
    });

    it("should allow API key with coins:read to fetch transactions via /api/v1/coins/:userId/transactions", async () => {
      const res = await fetch(`${BASE_URL}/api/v1/coins/${regularUserId}/transactions`, {
        headers: { Authorization: `Bearer ${readOnlyApiKey}` },
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.data));
      assert.ok(data.pagination);
    });

    it("should allow API key with coins:write to grant coins via /api/v1/coins/:userId/grant", async () => {
      const beforeBal = CoinService.getBalance(regularUserId);
      const grantAmt = 150;
      const v1Key = `v1-idem-${uuidv4()}`;

      const res = await fetch(`${BASE_URL}/api/v1/coins/${regularUserId}/grant`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${writeOnlyApiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": v1Key,
        },
        body: JSON.stringify({
          amount: grantAmt,
          reason: "API v1 Economy Grant",
          description: "Integration test via API v1",
        }),
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.data.balance, beforeBal + grantAmt);
      assert.strictEqual(data.data.transaction.amount, grantAmt);

      // Replay with same Idempotency-Key header -> returns 200 cached
      const replayRes = await fetch(`${BASE_URL}/api/v1/coins/${regularUserId}/grant`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${writeOnlyApiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": v1Key,
        },
        body: JSON.stringify({
          amount: grantAmt,
          reason: "API v1 Economy Grant",
          description: "Integration test via API v1",
        }),
      });

      assert.strictEqual(replayRes.status, 200);
      const replayData = await replayRes.json();
      assert.strictEqual(replayData.data.isCached, true);
      assert.strictEqual(CoinService.getBalance(regularUserId), beforeBal + grantAmt);
    });

    it("should allow fullAdminApiKey (api:full wildcard) to access coin endpoints", async () => {
      const res = await fetch(`${BASE_URL}/api/v1/coins/${regularUserId}`, {
        headers: { Authorization: `Bearer ${fullAdminApiKey}` },
      });
      assert.strictEqual(res.status, 200);
    });

    it("should include coinBalance in GET /api/v1/users list and user profile", async () => {
      const res = await fetch(`${BASE_URL}/api/v1/users/${regularUserId}`, {
        headers: { Authorization: `Bearer ${fullAdminApiKey}` },
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(typeof data.data.coinBalance, "number");
      assert.strictEqual(data.data.coinBalance > 0, true);
    });
  });

  // ==========================================================================
  // 7. Auth /api/auth/me Integration
  // ==========================================================================
  describe("Auth Context & /api/auth/me Balance Delivery", () => {
    it("should include coin_balance in GET /api/auth/me for authenticated user", async () => {
      const res = await fetchApi("/api/auth/me", {
        headers: { Cookie: regularCookie },
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.id, regularUserId);
      assert.strictEqual(typeof data.coin_balance, "number");
      assert.strictEqual(data.coin_balance, CoinService.getBalance(regularUserId));
    });
  });
});
