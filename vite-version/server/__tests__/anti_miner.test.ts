/**
 * InterDash — Anti-Miner Protection Unit & Integration Tests
 *
 * Validates:
 * - AntiMinerService CRUD and validation
 * - Process signature parsing and detection against simulated process outputs
 * - Network mining port and Stratum protocol socket detection
 * - Policy enforcement (alert, kill_process, suspend_vps)
 * - Power operation guards (prohibiting start/reboot on mining_suspended VPS)
 * - Incident resolution and automated VPS unlocking
 * - Admin REST endpoints (/api/admin/settings/anti-miner, /api/admin/anti-miner/incidents, /scan)
 * - REST API v1 scoped endpoints (/api/v1/settings/anti-miner)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createApp } from "../index.js";
import { closeDatabase, queryOne, execute } from "../db/index.js";
import { AntiMinerService } from "../services/anti-miner.js";
import { VpsOperationsService } from "../services/vps-operations.js";
import { ApiKeyService } from "../services/api-key.js";
import { SCOPES } from "../services/api-scopes.js";
import { ProxmoxService, type ProxmoxNodeConfig } from "../services/proxmox.js";
import { hashToken } from "../middleware/auth.js";
import { encryptCredential } from "../services/crypto.js";

let server: Server | null = null;
let BASE_URL = "";
const CSRF_TOKEN = "test-csrf-token-antiminer";

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

describe("Anti-Miner VPS Protection Tests", { concurrency: 1 }, () => {
  let adminUserId = "admin-antiminer-test-user";
  let regularUserId = "regular-antiminer-test-user";
  let adminCookie = "";
  let regularCookie = "";
  let apiKeySettingsRead = "";
  let apiKeySettingsWrite = "";
  let testVpsId = "vps-antiminer-test-1";

  const mockNode: ProxmoxNodeConfig = {
    id: "mock-antiminer-node-1",
    name: "Mock Miner Hypervisor",
    hostname: "mock-miner-pve.local",
    apiUrl: "https://mock-miner-pve.local:8006",
    port: 8006,
    nodeName: "pve01",
    region: "US-Central",
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

    // Reset anti-miner settings & incidents for test isolation
    execute("DELETE FROM panel_settings WHERE key LIKE 'anti_miner_%'");
    execute("DELETE FROM anti_miner_incidents");

    // Create admin user
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, email, role, status, created_at, updated_at)
       VALUES (?, 'disc_admin_antiminer', 'MinerAdmin', 'admin_miner@test.local', 'admin', 'active', datetime('now'), datetime('now'))`,
      [adminUserId]
    );

    // Create regular user
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, email, role, status, created_at, updated_at)
       VALUES (?, 'disc_reg_antiminer', 'MinerUser', 'reg_miner@test.local', 'user', 'active', datetime('now'), datetime('now'))`,
      [regularUserId]
    );

    // Create sessions
    const adminRawToken = "admin-miner-raw-token-1234567890123456";
    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ('sess-admin-miner', ?, ?, datetime('now', '+1 day'))`,
      [adminUserId, hashToken(adminRawToken)]
    );
    adminCookie = `interdash_session=${adminRawToken}; interdash_csrf=${CSRF_TOKEN}`;

    const regRawToken = "reg-miner-raw-token-1234567890123456";
    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ('sess-reg-miner', ?, ?, datetime('now', '+1 day'))`,
      [regularUserId, hashToken(regRawToken)]
    );
    regularCookie = `interdash_session=${regRawToken}; interdash_csrf=${CSRF_TOKEN}`;

    // Create API Keys for scoped testing
    const readKey = ApiKeyService.createKey(
      {
        name: "Anti-Miner Settings Read Key",
        scopes: [SCOPES.SETTINGS_READ],
      },
      adminUserId
    );
    apiKeySettingsRead = readKey.rawToken;

    const writeKey = ApiKeyService.createKey(
      {
        name: "Anti-Miner Settings Write Key",
        scopes: [SCOPES.SETTINGS_WRITE, SCOPES.SETTINGS_READ],
      },
      adminUserId
    );
    apiKeySettingsWrite = writeKey.rawToken;

    // Create mock node and VPS in database
    execute(
      `INSERT OR REPLACE INTO proxmox_nodes (
        id, name, hostname, api_url, port, node_name, region,
        auth_token_id, auth_token_secret_encrypted, allow_insecure_tls,
        default_storage, default_bridge, enabled, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'local-lvm', 'vmbr0', 1, 'online', datetime('now'), datetime('now'))`,
      [
        mockNode.id,
        mockNode.name,
        mockNode.hostname,
        mockNode.apiUrl,
        mockNode.port,
        mockNode.nodeName,
        mockNode.region,
        mockNode.authTokenId,
        encryptCredential(mockNode.authTokenSecret || "secret"),
      ]
    );

    execute(
      `INSERT OR REPLACE INTO vps (
        id, owner_user_id, proxmox_node_id, proxmox_vmid, name, hostname,
        status, os_image_id, cpu_cores, memory_mb, swap_mb, disk_gb, created_at, updated_at
      ) VALUES (?, ?, ?, 105, 'Miner Test Instance', 'miner-test.local', 'running', 'ubuntu-22.04', 2, 2048, 512, 25, datetime('now'), datetime('now'))`,
      [testVpsId, regularUserId, mockNode.id]
    );
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    closeDatabase();
  });

  describe("AntiMinerService Core Logic", { concurrency: 1 }, () => {
    it("should retrieve default configuration", () => {
      const config = AntiMinerService.getConfig();
      assert.equal(typeof config.enabled, "boolean");
      assert.ok(["alert", "kill_process", "suspend_vps"].includes(config.policy));
      assert.ok(config.cpuThreshold >= 50 && config.cpuThreshold <= 100);
      assert.ok(config.sustainedChecks >= 1 && config.sustainedChecks <= 10);
      assert.ok(config.processSignatures.length > 5);
      assert.ok(config.networkPorts.includes(3333));
    });

    it("should update configuration safely and clamp values", () => {
      const updated = AntiMinerService.updateConfig(
        {
          enabled: true,
          policy: "kill_process",
          cpuThreshold: 150, // Should clamp to 100
          sustainedChecks: 0, // Should clamp to 1
          scanIntervalSec: 10, // Should clamp to 15
          processSignatures: ["xmrig", "customminer"],
          networkPorts: [3333, 4444, 99999], // 99999 should be excluded
        },
        adminUserId
      );

      assert.equal(updated.enabled, true);
      assert.equal(updated.policy, "kill_process");
      assert.equal(updated.cpuThreshold, 100);
      assert.equal(updated.sustainedChecks, 1);
      assert.equal(updated.scanIntervalSec, 15);
      assert.ok(updated.processSignatures.includes("customminer"));
      assert.ok(!updated.networkPorts.includes(99999));
    });

    it("should parse and detect known mining process signatures from ps output", () => {
      const simulatedPsOutput = `
  PID USER      %CPU %MEM COMMAND
    1 root       0.0  0.1 /sbin/init
  421 root       0.0  0.2 /usr/sbin/sshd -D
  890 www-data   0.5  1.2 /usr/sbin/nginx -g daemon on;
 1337 user      99.2  3.4 /tmp/.x/xmrig -o stratum+tcp://pool.supportxmr.com:3333 -u 48... -p worker1
 2048 miner     85.0  2.1 /usr/local/bin/minerd -a cryptonight -o stratum+tcp://xmr.pool:5555
 5555 node       1.2  4.5 /usr/bin/node /app/server.js
`;

      const findings = AntiMinerService.parseProcessInspectionOutput(simulatedPsOutput, [
        "xmrig",
        "minerd",
        "cpuminer",
      ]);

      assert.equal(findings.length, 2);
      assert.equal(findings[0].pid, 1337);
      assert.equal(findings[0].matchedSignature, "xmrig");
      assert.equal(findings[1].pid, 2048);
      assert.equal(findings[1].matchedSignature, "minerd");
    });

    it("should return empty findings when process list is clean", () => {
      const cleanPsOutput = `
  PID USER      %CPU %MEM COMMAND
    1 root       0.0  0.1 /sbin/init
  421 root       0.0  0.2 /usr/sbin/sshd -D
  890 www-data   0.5  1.2 /usr/sbin/nginx -g daemon on;
 1200 user       0.2  0.5 bash
`;

      const findings = AntiMinerService.parseProcessInspectionOutput(cleanPsOutput, [
        "xmrig",
        "minerd",
      ]);
      assert.equal(findings.length, 0);
    });

    it("should detect mining connections on Stratum ports from ss output", () => {
      const simulatedSsOutput = `
Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process
tcp   ESTAB  0      0      10.0.3.15:48292     198.51.100.20:3333 users:(("xmrig",pid=1337,fd=4))
tcp   ESTAB  0      0      10.0.3.15:22        192.168.1.10:52132 users:(("sshd",pid=421,fd=3))
tcp   ESTAB  0      0      10.0.3.15:59124     203.0.113.80:4444  users:(("miner",pid=2048,fd=5))
`;

      const findings = AntiMinerService.parseNetworkInspectionOutput(simulatedSsOutput, [
        3333, 4444, 5555,
      ]);

      assert.equal(findings.length, 2);
      assert.equal(findings[0].port, 3333);
      assert.equal(findings[1].port, 4444);
    });

    it("should execute suspend_vps policy and apply lock_state", async () => {
      // Stub Proxmox stopLxc
      const originalStopLxc = ProxmoxService.stopLxc;
      (ProxmoxService as any).stopLxc = async () => ({ upid: "UPID:stop-test" });

      try {
        const vps = queryOne<any>("SELECT * FROM vps WHERE id = ?", [testVpsId]);
        const result = await AntiMinerService.handleDetectionIncident({
          vps,
          node: mockNode,
          policy: "suspend_vps",
          triggerType: "process_signature",
          matchedTarget: "xmrig",
          pid: 9999,
          cmdline: "/usr/bin/xmrig --donate-level=1",
          details: { test: true },
        });

        assert.equal(result.recorded, true);
        assert.equal(result.actionTaken, "vps_suspended");

        // Verify VPS is now suspended and locked
        const updatedVps = queryOne<any>("SELECT status, lock_state FROM vps WHERE id = ?", [
          testVpsId,
        ]);
        assert.equal(updatedVps.status, "stopped");
        assert.equal(updatedVps.lock_state, "mining_suspended");
      } finally {
        ProxmoxService.stopLxc = originalStopLxc;
      }
    });

    it("should prevent start and reboot when VPS has mining_suspended lock", async () => {
      // Attempt to start locked VPS
      await assert.rejects(
        async () => {
          await VpsOperationsService.start(testVpsId, regularUserId);
        },
        (err: any) => {
          assert.equal(err.statusCode, 403);
          assert.ok(err.message.includes("cryptocurrency mining detection"));
          return true;
        }
      );

      // Attempt to reboot locked VPS
      await assert.rejects(
        async () => {
          await VpsOperationsService.reboot(testVpsId, regularUserId);
        },
        (err: any) => {
          assert.equal(err.statusCode, 403);
          assert.ok(err.message.includes("cryptocurrency mining detection"));
          return true;
        }
      );
    });

    it("should resolve incident and automatically unlock suspended VPS", () => {
      const incident = queryOne<any>(
        "SELECT id FROM anti_miner_incidents WHERE vps_id = ? ORDER BY detected_at DESC LIMIT 1",
        [testVpsId]
      );
      assert.ok(incident, "Incident should exist in database");

      const resolved = AntiMinerService.resolveIncident(incident.id, adminUserId);
      assert.equal(resolved.success, true);
      assert.equal(resolved.vpsUnlocked, true);

      // Verify DB state
      const dbIncident = queryOne<any>("SELECT status, resolved_by FROM anti_miner_incidents WHERE id = ?", [
        incident.id,
      ]);
      assert.equal(dbIncident.status, "resolved");
      assert.equal(dbIncident.resolved_by, adminUserId);

      const dbVps = queryOne<any>("SELECT lock_state FROM vps WHERE id = ?", [testVpsId]);
      assert.equal(dbVps.lock_state, null);
    });
  });

  describe("Admin Endpoints (/api/admin/settings/anti-miner & incidents)", () => {
    it("should reject unauthenticated requests with 401", async () => {
      const res = await fetchApi("/api/admin/settings/anti-miner");
      assert.equal(res.status, 401);
    });

    it("should reject non-admin users with 403", async () => {
      const res = await fetchApi("/api/admin/settings/anti-miner", {
        headers: { Cookie: regularCookie },
      });
      assert.equal(res.status, 403);
    });

    it("should allow admin to GET anti-miner settings", async () => {
      const res = await fetchApi("/api/admin/settings/anti-miner", {
        headers: { Cookie: adminCookie },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(typeof data.enabled, "boolean");
      assert.ok(Array.isArray(data.processSignatures));
    });

    it("should allow admin to PATCH anti-miner settings", async () => {
      const res = await fetchApi("/api/admin/settings/anti-miner", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          enabled: true,
          policy: "alert",
          cpuThreshold: 85,
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.settings.enabled, true);
      assert.equal(data.settings.policy, "alert");
      assert.equal(data.settings.cpuThreshold, 85);
    });

    it("should allow admin to query incident history", async () => {
      const res = await fetchApi("/api/admin/anti-miner/incidents", {
        headers: { Cookie: adminCookie },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.incidents));
      assert.ok(data.total >= 1);
    });

    it("should allow admin to trigger on-demand scan", async () => {
      const res = await fetchApi("/api/admin/anti-miner/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.bulk, true);
    });
  });

  describe("API v1 Endpoints (/api/v1/settings/anti-miner)", () => {
    it("should allow API key with settings:read to fetch anti-miner configuration", async () => {
      const res = await fetchApi("/api/v1/settings/anti-miner", {
        headers: {
          Authorization: `Bearer ${apiKeySettingsRead}`,
        },
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.data);
      assert.equal(typeof body.data.enabled, "boolean");
    });

    it("should reject API key with settings:read trying to PATCH anti-miner configuration", async () => {
      const res = await fetchApi("/api/v1/settings/anti-miner", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKeySettingsRead}`,
        },
        body: JSON.stringify({ enabled: false }),
      });

      assert.equal(res.status, 403);
    });

    it("should allow API key with settings:write to update anti-miner configuration", async () => {
      const res = await fetchApi("/api/v1/settings/anti-miner", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKeySettingsWrite}`,
        },
        body: JSON.stringify({
          enabled: false,
          policy: "kill_process",
        }),
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.data);
      assert.equal(body.data.enabled, false);
      assert.equal(body.data.policy, "kill_process");
    });
  });
});
