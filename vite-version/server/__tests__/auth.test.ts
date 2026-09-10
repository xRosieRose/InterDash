/**
 * InterDash — Auth Regression Tests
 *
 * Critical tests to ensure protected routes are NEVER accessible
 * without a valid server-side session.
 *
 * Run with: npx tsx --test server/__tests__/auth.test.ts
 *
 * These tests use the Node.js built-in test runner (no extra dependencies).
 * When run without TEST_URL, they spin up an in-process test server on an ephemeral port.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createApp } from "../index.js";
import { closeDatabase } from "../db/index.js";

let server: Server | null = null;
let BASE_URL = process.env.TEST_URL || "";

/**
 * Helper to make requests without following redirects.
 */
async function fetchNoRedirect(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    redirect: "manual",
  });
}

describe("Authentication Security Tests", () => {
  before(async () => {
    if (!BASE_URL) {
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
    }
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    closeDatabase();
  });

  // ==========================================================================
  // TEST 1: Unauthenticated access to /dashboard → redirect
  // ==========================================================================
  it("should redirect unauthenticated /dashboard to /auth/sign-in", async () => {
    const res = await fetchNoRedirect("/dashboard");
    assert.equal(res.status, 302, "Expected 302 redirect");
    const location = res.headers.get("location");
    assert.ok(
      location?.includes("/auth/sign-in"),
      `Expected redirect to /auth/sign-in, got: ${location}`
    );
  });

  // ==========================================================================
  // TEST 2: Unauthenticated access to /dashboard-2 → redirect
  // ==========================================================================
  it("should redirect unauthenticated /dashboard-2 to /auth/sign-in", async () => {
    const res = await fetchNoRedirect("/dashboard-2");
    assert.equal(res.status, 302);
    const location = res.headers.get("location");
    assert.ok(location?.includes("/auth/sign-in"));
  });

  // ==========================================================================
  // TEST 3: Unauthenticated access to /settings/* → redirect
  // ==========================================================================
  it("should redirect unauthenticated /settings/account to /auth/sign-in", async () => {
    const res = await fetchNoRedirect("/settings/account");
    assert.equal(res.status, 302);
    const location = res.headers.get("location");
    assert.ok(location?.includes("/auth/sign-in"));
  });

  // ==========================================================================
  // TEST 4: Unauthenticated access to /users → redirect
  // ==========================================================================
  it("should redirect unauthenticated /users to /auth/sign-in", async () => {
    const res = await fetchNoRedirect("/users");
    assert.equal(res.status, 302);
    const location = res.headers.get("location");
    assert.ok(location?.includes("/auth/sign-in"));
  });

  // ==========================================================================
  // TEST 5: Unauthenticated /api/auth/me → 401
  // ==========================================================================
  it("should return 401 for unauthenticated /api/auth/me", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/me`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(body.error, "Expected error message in response");
  });

  // ==========================================================================
  // TEST 6: Unauthenticated /api/vps → 401
  // ==========================================================================
  it("should return 401 for unauthenticated /api/vps", async () => {
    const res = await fetch(`${BASE_URL}/api/vps`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(body.error);
  });

  // ==========================================================================
  // TEST 7: Unauthenticated /api/users → 401
  // ==========================================================================
  it("should return 401 for unauthenticated /api/users", async () => {
    const res = await fetch(`${BASE_URL}/api/users`);
    assert.equal(res.status, 401);
  });

  // ==========================================================================
  // TEST 8: Invalid session cookie → 401
  // ==========================================================================
  it("should return 401 for invalid session cookie", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: {
        Cookie: "interdash_session=fake_invalid_token_12345",
      },
    });
    assert.equal(res.status, 401);
  });

  // ==========================================================================
  // TEST 9: Health endpoint is public
  // ==========================================================================
  it("should allow unauthenticated access to /api/health", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
  });

  // ==========================================================================
  // TEST 10: Public pages are accessible
  // ==========================================================================
  it("should allow unauthenticated access to /", async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.equal(res.status, 200);
  });

  it("should allow unauthenticated access to /auth/sign-in", async () => {
    const res = await fetch(`${BASE_URL}/auth/sign-in`);
    assert.equal(res.status, 200);
  });

  // ==========================================================================
  // TEST 11: /api/auth/discord initiates OAuth flow
  // ==========================================================================
  it("should redirect /api/auth/discord to Discord OAuth", async () => {
    const res = await fetchNoRedirect("/api/auth/discord");
    assert.equal(res.status, 302);
    const location = res.headers.get("location");
    assert.ok(
      location?.includes("discord.com/oauth2/authorize"),
      `Expected redirect to Discord OAuth, got: ${location}`
    );
  });

  // ==========================================================================
  // TEST 12: Protected routes: /vps, /servers, /billing, /support, /mail, /tasks, /chat, /calendar, /admin
  // ==========================================================================
  const protectedPages = [
    "/vps",
    "/servers",
    "/billing",
    "/support",
    "/mail",
    "/tasks",
    "/chat",
    "/calendar",
    "/admin",
  ];

  for (const path of protectedPages) {
    it(`should redirect unauthenticated ${path} to /auth/sign-in`, async () => {
      const res = await fetchNoRedirect(path);
      assert.equal(res.status, 302);
      const location = res.headers.get("location");
      assert.ok(
        location?.includes("/auth/sign-in"),
        `Expected redirect to /auth/sign-in for ${path}, got: ${location}`
      );
    });
  }

  // ==========================================================================
  // TEST 13: No localStorage auth bypass
  // ==========================================================================
  it("should NOT accept authentication from custom headers alone", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: {
        Authorization: "Bearer fake_token",
        "X-Auth-Token": "fake_token",
      },
    });
    assert.equal(res.status, 401);
  });

  // ==========================================================================
  // TEST 14: Unknown API endpoint → 404
  // ==========================================================================
  it("should return 404 for unknown API endpoints", async () => {
    const res = await fetch(`${BASE_URL}/api/nonexistent`);
    assert.equal(res.status, 404);
  });
});
