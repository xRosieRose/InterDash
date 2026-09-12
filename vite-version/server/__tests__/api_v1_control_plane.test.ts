/**
 * InterDash — API v1 Full Control Plane Integration Tests
 *
 * End-to-end tests for all /api/v1 endpoints:
 * - Discovery, Health, OpenAPI 3.1, and Interactive Docs
 * - Instances CRUD, Lifecycle, and Idempotency Replay & Conflict
 * - Nodes Management and Dependency Guard
 * - Tickets Control Plane
 * - Settings and Masked Auth Providers
 * - Real Infrastructure Analytics
 * - Response DTO Secret Audit
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Server } from "node:http";
import { createApp } from "../index.js";
import { closeDatabase, queryOne, execute } from "../db/index.js";
import { ApiKeyService } from "../services/api-key.js";
import { SCOPES } from "../services/api-scopes.js";
import { encryptCredential } from "../services/crypto.js";
import { ProxmoxService } from "../services/proxmox.js";

let server: Server | null = null;
let BASE_URL = "";

async function fetchApi(path: string, bearerToken?: string, options: RequestInit = {}): Promise<Response> {
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

describe("API v1 REST Control Plane Integration Tests", () => {
  let fullAdminKey = "";
  let scopedUserKey = "";
  let adminUserId = "admin-v1-ctrl-user";
  let targetUserId = "target-v1-ctrl-user";
  let testNodeId = "pve-v1-test-node";
  let testVpsId = "vps-v1-test-inst-1";

  before(async () => {
    // Proxmox Mocking for integration environment
    ProxmoxService.getTemplates = async () => [
      { volid: "local:vztmpl/ubuntu-22.04.tar.zst", storage: "local", filename: "ubuntu-22.04.tar.zst" } as any,
    ];
    ProxmoxService.getStorageList = async () => [
      { storage: "local", active: true, content: ["rootdir", "images", "vztmpl"], supportsRootfs: true, supportsTemplates: true } as any,
    ];
    ProxmoxService.checkLxcLocked = async () => ({ locked: false });
    ProxmoxService.rebootLxc = async () => ({ upid: "UPID:test:reboot" });
    ProxmoxService.waitForProxmoxTask = async () => {};
    ProxmoxService.getLxcStatus = async () => ({ ok: true, status: "running" });

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

    // Create users
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, email, role, status, created_at, updated_at)
       VALUES (?, ?, 'AdminCtrl', 'admin_ctrl@test.local', 'admin', 'active', datetime('now'), datetime('now'))`,
      [adminUserId, "discord_admin_ctrl"]
    );
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, email, role, status, created_at, updated_at)
       VALUES (?, ?, 'TargetUserCtrl', 'target_ctrl@test.local', 'user', 'active', datetime('now'), datetime('now'))`,
      [targetUserId, "discord_target_ctrl"]
    );

    // Create hypervisor node
    execute(
      `INSERT OR REPLACE INTO proxmox_nodes (
        id, name, hostname, api_url, port, node_name, region, auth_token_id, auth_token_secret_encrypted,
        status, enabled, created_at, updated_at
      ) VALUES (?, 'Test Hypervisor 01', 'pve01.test.local', 'https://pve01.test.local:8006', 8006, 'pve', 'US-East',
        'root@pam!token1', ?, 'online', 1, datetime('now'), datetime('now'))`,
      [testNodeId, encryptCredential("mock_pve_token_secret")]
    );

    // Create VPS instance
    execute(
      `INSERT OR REPLACE INTO vps (
        id, owner_user_id, proxmox_node_id, proxmox_vmid, name, hostname, status,
        os_image_id, cpu_cores, memory_mb, swap_mb, disk_gb, ipv4_address, created_at, updated_at
      ) VALUES (?, ?, ?, 199, 'Production Web 01', 'web01.test.local', 'running',
        'ubuntu-22.04', 2, 2048, 512, 30, '10.0.0.99', datetime('now'), datetime('now'))`,
      [testVpsId, targetUserId, testNodeId]
    );

    // Generate full access key (api:full)
    const fullKeyRes = ApiKeyService.createKey(
      {
        name: "Full Admin API Key",
        scopes: [SCOPES.FULL_ACCESS],
      },
      adminUserId
    );
    fullAdminKey = fullKeyRes.rawToken;

    // Generate scoped key for read-only monitoring
    const scopedKeyRes = ApiKeyService.createKey(
      {
        name: "Read Only Monitor Key",
        scopes: [SCOPES.INSTANCES_READ, SCOPES.ANALYTICS_READ, SCOPES.SETTINGS_READ],
      },
      adminUserId
    );
    scopedUserKey = scopedKeyRes.rawToken;
  });

  after(() => {
    if (server) server.close();
    closeDatabase();
  });

  // ==========================================================================
  // 1. Discovery, Health & OpenAPI Tests
  // ==========================================================================
  describe("Discovery, Health & OpenAPI Specification", () => {
    it("should return root API discovery without authentication", async () => {
      const res = await fetchApi("/api/v1");
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.version, "v1");
      assert.ok(Array.isArray(body.data.scopesCatalog));
      assert.ok(body.data.endpoints.instances);
    });

    it("should return healthy status from /api/v1/health", async () => {
      const res = await fetchApi("/api/v1/health");
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.status, "ok");
      assert.equal(body.data.database, "healthy");
    });

    it("should serve valid OpenAPI 3.1 schema at /api/v1/openapi.json", async () => {
      const res = await fetchApi("/api/v1/openapi.json");
      assert.equal(res.status, 200);
      const spec = await res.json();
      assert.equal(spec.openapi, "3.1.0");
      assert.ok(spec.paths["/instances"]);
      assert.ok(spec.paths["/nodes"]);
      assert.ok(spec.components.securitySchemes.ApiKeyAuth);
    });

    it("should serve interactive documentation HTML at /api/v1/docs", async () => {
      const res = await fetch(`${BASE_URL}/api/v1/docs`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes("SwaggerUIBundle"));
      assert.ok(html.includes("InterDash"));
    });

    it("should redirect /docs/api to /api/v1/docs", async () => {
      const res = await fetch(`${BASE_URL}/docs/api`, { redirect: "manual" });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), "/api/v1/docs");
    });
  });

  // ==========================================================================
  // 2. Instances Control Plane & Idempotency Tests
  // ==========================================================================
  describe("Instances & Idempotency", () => {
    it("should return paginated instances with DTO mapping", async () => {
      const res = await fetchApi("/api/v1/instances", fullAdminKey);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.data));
      assert.ok(body.pagination);
      assert.ok(body.pagination.total >= 1);

      const inst = body.data.find((i: any) => i.id === testVpsId);
      assert.ok(inst);
      assert.equal(inst.name, "Production Web 01");
      assert.equal(inst.ipv4Address, "10.0.0.99");
      assert.equal(inst.node.name, "Test Hypervisor 01");
      assert.equal(inst.owner.username, "TargetUserCtrl");

      // Verify no sensitive internal columns leaked
      assert.equal((inst as any).proxmox_token, undefined);
      assert.equal((inst as any).password, undefined);
    });

    it("should support Idempotency-Key on provisioning and safely replay identical request", async () => {
      const idempotencyKey = `idemp-prov-${crypto.randomUUID()}`;
      const payload = {
        ownerUserId: targetUserId,
        targetNodeId: testNodeId,
        hostname: `idemp-${crypto.randomBytes(4).toString("hex")}.local`,
        name: "Idempotency Test Box",
        osTemplate: "local:vztmpl/ubuntu-22.04.tar.zst",
        cpuCores: 1,
        memoryMb: 1024,
        diskGb: 20,
      };

      // First Request -> 202 Accepted
      const res1 = await fetchApi("/api/v1/instances", fullAdminKey, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
      });

      assert.equal(res1.status, 202);
      const body1 = await res1.json();
      assert.ok(body1.data.jobId);
      assert.equal(body1.data.status, "queued");

      // Second Request with SAME key and SAME payload -> Replays cached 202
      const res2 = await fetchApi("/api/v1/instances", fullAdminKey, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
      });

      assert.equal(res2.status, 202);
      assert.equal(res2.headers.get("x-cache"), "IDEMPOTENT-REPLAY");
      const body2 = await res2.json();
      assert.equal(body2.data.jobId, body1.data.jobId);

      // Third Request with SAME key but DIFFERENT payload -> 409 Conflict
      const res3 = await fetchApi("/api/v1/instances", fullAdminKey, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ ...payload, hostname: "different-hostname.local" }),
      });

      assert.equal(res3.status, 409);
      const body3 = await res3.json();
      assert.equal(body3.error.code, "IDEMPOTENCY_CONFLICT");
    });

    it("should allow updating instance metadata via PATCH /instances/:id", async () => {
      const res = await fetchApi(`/api/v1/instances/${testVpsId}`, fullAdminKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Web Cluster 01",
          description: "Production cluster entry node",
        }),
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.name, "Updated Web Cluster 01");
      assert.equal(body.data.description, "Production cluster entry node");
    });

    it("should initiate power operation (start/stop/reboot) returning 202 Accepted", async () => {
      const res = await fetchApi(`/api/v1/instances/${testVpsId}/reboot`, fullAdminKey, {
        method: "POST",
      });
      assert.equal(res.status, 202);
      const body = await res.json();
      assert.ok(body.data.operationId);
      assert.equal(body.data.status, "queued");
    });

    it("should reject reinstall if hostname confirmation mismatch", async () => {
      const res = await fetchApi(`/api/v1/instances/${testVpsId}/reinstall`, fullAdminKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          osTemplate: "local:vztmpl/debian-12.tar.zst",
          confirmHostname: "wrong.hostname.local",
        }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error.code, "HOSTNAME_MISMATCH");
    });

    it("should generate console ticket via POST /instances/:id/console", async () => {
      const res = await fetchApi(`/api/v1/instances/${testVpsId}/console`, fullAdminKey, {
        method: "POST",
      });
      // Either 200 (if Proxmox termproxy operational or mocked) or 503/502 with structured error
      assert.ok([200, 502, 503].includes(res.status));
      const body = await res.json();
      assert.ok(body.requestId);
    });
  });

  // ==========================================================================
  // 3. Hypervisor Nodes & Dependency Safeguards
  // ==========================================================================
  describe("Hypervisor Nodes Management", () => {
    it("should list hypervisor nodes with credentials masked", async () => {
      const res = await fetchApi("/api/v1/nodes", fullAdminKey);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.data));
      const node = body.data.find((n: any) => n.id === testNodeId);
      assert.ok(node);
      assert.equal(node.hasTokenSecret, true);
      assert.equal((node as any).api_token_secret_encrypted, undefined);
      assert.equal((node as any).password, undefined);
    });

    it("should prevent deleting a node with active VPS instances (409)", async () => {
      const res = await fetchApi(`/api/v1/nodes/${testNodeId}`, fullAdminKey, {
        method: "DELETE",
      });
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.error.code, "NODE_HAS_INSTANCES");
    });
  });

  // ==========================================================================
  // 4. Support Tickets Control Plane
  // ==========================================================================
  describe("Support Tickets Control Plane", () => {
    let createdTicketId = "";

    it("should create a support ticket and return 201 Created", async () => {
      const res = await fetchApi("/api/v1/tickets", fullAdminKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: "Network routing inquiry",
          category: "network",
          priority: "high",
          message: "Please verify IPv6 upstream gateway.",
        }),
      });

      assert.equal(res.status, 201);
      const body = await res.json();
      assert.ok(body.data.ticketId);
      assert.equal(body.data.subject, "Network routing inquiry");
      createdTicketId = body.data.ticketId;
    });

    it("should reply to support ticket and retrieve thread messages", async () => {
      // Add reply
      const replyRes = await fetchApi(`/api/v1/tickets/${createdTicketId}/messages`, fullAdminKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Gateway is verified on node pve01." }),
      });
      assert.equal(replyRes.status, 201);

      // Get ticket thread
      const getRes = await fetchApi(`/api/v1/tickets/${createdTicketId}`, fullAdminKey);
      assert.equal(getRes.status, 200);
      const body = await getRes.json();
      assert.equal(body.data.id, createdTicketId);
      assert.equal(body.data.messages.length, 2);
    });
  });

  // ==========================================================================
  // 5. Settings, Analytics & DTO Audit
  // ==========================================================================
  describe("Settings & Real Analytics", () => {
    it("should return safe public settings from /api/v1/settings", async () => {
      const res = await fetchApi("/api/v1/settings", scopedUserKey);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.data.brand_name);
      assert.equal((body.data as any).auth_discord_client_secret_encrypted, undefined);
    });

    it("should return masked auth settings from /api/v1/settings/authentication", async () => {
      const res = await fetchApi("/api/v1/settings/authentication", fullAdminKey);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.data.discord);
      assert.ok(body.data.email);
      // Ensure raw client secret is NOT exposed
      assert.equal((body.data.discord as any).clientSecret, undefined);
    });

    it("should return real fleet infrastructure analytics", async () => {
      const res = await fetchApi("/api/v1/analytics", scopedUserKey);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.scope, "fleet");
      assert.ok(body.data.metrics.totalInstances >= 1);
      assert.ok(body.data.metrics.totalNodes >= 1);
    });
  });
});
