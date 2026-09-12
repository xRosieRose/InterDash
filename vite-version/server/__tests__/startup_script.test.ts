/**
 * InterDash — First-Install Startup Script Unit & Integration Tests
 *
 * Validates:
 * - StartupScriptService CRUD and audit logging
 * - Payload preparation with runtime context variable injection
 * - Proxmox execution dispatch and non-blocking failure tolerance
 * - Administrative endpoints (GET/PATCH /api/admin/settings/startup-script)
 * - API v1 scoped endpoints (GET/PATCH /api/v1/settings/startup-script)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createApp } from "../index.js";
import { closeDatabase, queryOne, execute } from "../db/index.js";
import { StartupScriptService } from "../services/startup-script.js";
import { ApiKeyService } from "../services/api-key.js";
import { SCOPES } from "../services/api-scopes.js";
import { ProxmoxService, type ProxmoxNodeConfig } from "../services/proxmox.js";
import { hashToken } from "../middleware/auth.js";

let server: Server | null = null;
let BASE_URL = "";
const CSRF_TOKEN = "test-csrf-token-startup";

async function fetchApi(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
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
  }
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    redirect: "manual",
  });
}

describe("First-Install Startup Script Tests", () => {
  let adminUserId = "admin-startup-test-user";
  let regularUserId = "regular-startup-test-user";
  let adminCookie = "";
  let regularCookie = "";
  let apiKeySettingsRead = "";
  let apiKeySettingsWrite = "";

  const mockNode: ProxmoxNodeConfig = {
    id: "mock-node-1",
    name: "Mock Hypervisor",
    hostname: "mock-pve.local",
    apiUrl: "https://mock-pve.local:8006",
    port: 8006,
    nodeName: "pve01",
    region: "US-East",
    authTokenId: "root@pam!token",
    authTokenSecret: "secret",
    allowInsecureTls: true,
    enabled: true,
    status: "online",
  };

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

    // Create admin user
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, email, role, status, created_at, updated_at)
       VALUES (?, 'disc_admin_startup', 'StartupAdmin', 'admin_script@test.local', 'admin', 'active', datetime('now'), datetime('now'))`,
      [adminUserId]
    );

    // Create regular user
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, email, role, status, created_at, updated_at)
       VALUES (?, 'disc_reg_startup', 'StartupUser', 'reg_script@test.local', 'user', 'active', datetime('now'), datetime('now'))`,
      [regularUserId]
    );

    // Create sessions with proper token hashing
    const adminRawToken = "admin-session-raw-token-123";
    const adminTokenHash = hashToken(adminRawToken);
    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, datetime('now', '+1 day'), datetime('now'), datetime('now'))`,
      ["sess-startup-admin-123", adminUserId, adminTokenHash]
    );
    adminCookie = `interdash_session=${adminRawToken}; interdash_csrf=${CSRF_TOKEN}`;

    const regRawToken = "reg-session-raw-token-123";
    const regTokenHash = hashToken(regRawToken);
    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, datetime('now', '+1 day'), datetime('now'), datetime('now'))`,
      ["sess-startup-reg-123", regularUserId, regTokenHash]
    );
    regularCookie = `interdash_session=${regRawToken}; interdash_csrf=${CSRF_TOKEN}`;

    // Create API keys
    const resKeyRead = ApiKeyService.createKey(
      {
        name: "Settings Read Key",
        scopes: [SCOPES.SETTINGS_READ],
      },
      adminUserId
    );
    apiKeySettingsRead = resKeyRead.rawToken;

    const resKeyWrite = ApiKeyService.createKey(
      {
        name: "Settings Write Key",
        scopes: [SCOPES.SETTINGS_WRITE, SCOPES.SETTINGS_READ],
      },
      adminUserId
    );
    apiKeySettingsWrite = resKeyWrite.rawToken;
  });

  after(() => {
    if (server) {
      server.close();
    }
    closeDatabase();
  });

  // 1. Service Level Tests
  describe("StartupScriptService Core Logic", () => {
    it("should retrieve configuration with default fallback", () => {
      const config = StartupScriptService.getConfig();
      assert.equal(typeof config.enabled, "boolean");
      assert.equal(typeof config.content, "string");
    });

    it("should update configuration and log audit event", () => {
      const testContent = "#!/usr/bin/env bash\necho 'Test Startup Exec'\nexit 0\n";
      const updated = StartupScriptService.updateConfig(
        {
          enabled: true,
          content: testContent,
        },
        adminUserId
      );

      assert.equal(updated.enabled, true);
      assert.equal(updated.content, testContent);
      assert.equal(updated.updatedBy, adminUserId);

      // Verify audit log
      const audit = queryOne<any>(
        "SELECT * FROM audit_logs WHERE user_id = ? AND event_type = 'startup_script_updated' ORDER BY id DESC LIMIT 1",
        [adminUserId]
      );
      assert.ok(audit);
      const meta = JSON.parse(audit.metadata);
      assert.equal(meta.enabled, true);
    });

    it("should reject scripts exceeding maximum allowed size", () => {
      const hugeScript = "A".repeat(StartupScriptService.MAX_SCRIPT_SIZE_BYTES + 1024);
      assert.throws(
        () => {
          StartupScriptService.updateConfig({ content: hugeScript }, adminUserId);
        },
        (err: any) => err.statusCode === 400
      );
    });

    it("should properly prepare script with injected runtime environment variables", () => {
      const rawScript = `#!/usr/bin/env bash\necho "Hostname is $INTERDASH_HOSTNAME"`;
      const prepared = StartupScriptService.prepareScriptPayload(rawScript, {
        vpsId: "vps_01j7b8q",
        hostname: "web01.internal",
        ipv4: "192.168.10.25",
      });

      assert.ok(prepared.includes('export INTERDASH_VPS_ID="vps_01j7b8q"'));
      assert.ok(prepared.includes('export INTERDASH_HOSTNAME="web01.internal"'));
      assert.ok(prepared.includes('export INTERDASH_IPV4="192.168.10.25"'));
      assert.ok(prepared.includes('export INTERDASH_EXEC_TIME='));
      assert.ok(prepared.includes('echo "Hostname is $INTERDASH_HOSTNAME"'));
    });

    it("should skip execution gracefully when script is disabled", async () => {
      StartupScriptService.updateConfig({ enabled: false }, adminUserId);

      const res = await StartupScriptService.executeForVps({
        node: mockNode,
        vmid: 101,
        vpsId: "vps-test-skip",
        hostname: "skip.local",
      });

      assert.equal(res.executed, false);
      assert.equal(res.reason, "startup_script_disabled");
    });

    it("should dispatch execution to ProxmoxService when enabled", async () => {
      StartupScriptService.updateConfig(
        {
          enabled: true,
          content: "#!/usr/bin/env bash\necho 'Running inside container'",
        },
        adminUserId
      );

      let capturedVmid = 0;
      let capturedScript = "";
      ProxmoxService.execLxcScript = async (_node, vmid, script) => {
        capturedVmid = vmid;
        capturedScript = script;
        return { ok: true, upid: "UPID:test:exec:1" };
      };

      const res = await StartupScriptService.executeForVps({
        node: mockNode,
        vmid: 102,
        vpsId: "vps-test-exec",
        hostname: "exec.local",
        ipv4: "10.0.0.5",
      });

      assert.equal(res.executed, true);
      assert.equal(res.success, true);
      assert.equal(capturedVmid, 102);
      assert.ok(capturedScript.includes("Running inside container"));
      assert.ok(capturedScript.includes("INTERDASH_HOSTNAME"));
    });

    it("should handle Proxmox execution failures non-destructively", async () => {
      StartupScriptService.updateConfig({ enabled: true, content: "#!/bin/bash\nexit 1" }, adminUserId);

      ProxmoxService.execLxcScript = async () => {
        return { ok: false, error: "Container exec failed: command timeout" };
      };

      const res = await StartupScriptService.executeForVps({
        node: mockNode,
        vmid: 103,
        vpsId: "vps-test-fail",
        hostname: "fail.local",
      });

      assert.equal(res.executed, true);
      assert.equal(res.success, false);
      assert.ok(res.error?.includes("command timeout"));
    });
  });

  // 2. Admin HTTP Endpoints
  describe("Admin Endpoints (/api/admin/settings/startup-script)", () => {
    it("should reject unauthenticated requests with 401", async () => {
      const res = await fetchApi("/api/admin/settings/startup-script");
      assert.equal(res.status, 401);
    });

    it("should reject non-admin users with 403", async () => {
      const res = await fetchApi("/api/admin/settings/startup-script", {
        headers: { Cookie: regularCookie },
      });
      assert.equal(res.status, 403);
    });

    it("should allow admin to GET current startup script", async () => {
      const res = await fetchApi("/api/admin/settings/startup-script", {
        headers: { Cookie: adminCookie },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(typeof data.enabled, "boolean");
      assert.equal(typeof data.content, "string");
    });

    it("should allow admin to PATCH startup script", async () => {
      const newScript = "#!/usr/bin/env bash\necho 'Admin Patched Setup'\n";
      const res = await fetchApi("/api/admin/settings/startup-script", {
        method: "PATCH",
        headers: {
          Cookie: adminCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: true,
          content: newScript,
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.settings.enabled, true);
      assert.equal(data.settings.content, newScript);
    });
  });

  // 3. API v1 REST Endpoints
  describe("API v1 Endpoints (/api/v1/settings/startup-script)", () => {
    it("should allow API key with settings:read to fetch startup script", async () => {
      const res = await fetchApi("/api/v1/settings/startup-script", {
        headers: { Authorization: `Bearer ${apiKeySettingsRead}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.data);
      assert.equal(typeof body.data.enabled, "boolean");
    });

    it("should reject API key with settings:read trying to PATCH startup script", async () => {
      const res = await fetchApi("/api/v1/settings/startup-script", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${apiKeySettingsRead}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled: false }),
      });
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.error.code, "API_SCOPE_REQUIRED");
    });

    it("should allow API key with settings:write to update startup script", async () => {
      const v1Script = "#!/usr/bin/env bash\necho 'V1 API Update'\n";
      const res = await fetchApi("/api/v1/settings/startup-script", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${apiKeySettingsWrite}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: true,
          content: v1Script,
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.data);
      assert.equal(body.data.enabled, true);
      assert.equal(body.data.content, v1Script);
    });
  });
});
