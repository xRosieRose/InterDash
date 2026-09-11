/**
 * InterDash — Real VPS Management & Lifecycle Integration Tests
 *
 * Verifies:
 * 1. Authentication & Ownership Isolation (User A vs User B vs Admin)
 * 2. Real Power Operations (start, stop, reboot, status sync)
 * 3. Settings Operations (display name, description, root password)
 * 4. Destructive Reinstall Guardrails (exact hostname confirmation required)
 * 5. Server-Side Operation Concurrency Locking (409 Conflict)
 * 6. Provisioning Idempotency & Request Hash Verification
 * 7. Credential Privacy (passwords never returned, logged, or stored in params_json)
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { createApp } from "../index.js";
import { closeDatabase, execute, queryOne } from "../db/index.js";
import { hashToken } from "../middleware/auth.js";
import { ProxmoxService } from "../services/proxmox.js";
import { encryptCredential } from "../services/crypto.js";
import { VpsOperationsService } from "../services/vps-operations.js";
import { ProvisioningService } from "../services/provisioning.js";

let server: Server | null = null;
let BASE_URL = "";

// Test IDs
const USER_A_ID = "test-mgr-usera-" + crypto.randomUUID();
const USER_B_ID = "test-mgr-userb-" + crypto.randomUUID();
const ADMIN_ID = "test-mgr-admin-" + crypto.randomUUID();

const SESSION_USER_A = "sess-mgra-" + crypto.randomUUID();
const SESSION_USER_B = "sess-mgrb-" + crypto.randomUUID();
const SESSION_ADMIN = "sess-mgradmin-" + crypto.randomUUID();

const NODE_ID = "test-pve-node-1";
let VPS_A_ID = "vps-mgra-" + crypto.randomUUID();
let VPS_B_ID = "vps-mgrb-" + crypto.randomUUID();

const CSRF_TOKEN = "test-csrf-token-mgr";

async function fetchApi(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
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

describe("VPS Real Management & Lifecycle Integration Tests", () => {
  before(async () => {
    // Mock ProxmoxService methods for unit/integration testing
    ProxmoxService.healthCheck = async () => ({
      online: true,
      version: "8.2.4",
      release: "8.2",
    });

    let mockVmidCounter = 5000;
    ProxmoxService.getNextVmid = async () => ++mockVmidCounter;

    ProxmoxService.createLxc = async (_node, params) => ({
      upid: "UPID:pve:00001:00001:create",
      vmid: params.vmid,
    });

    ProxmoxService.waitForProxmoxTask = async () => ({
      exitstatus: "OK",
    });

    ProxmoxService.getLxcStatus = async () => ({
      status: "running",
      uptime: 4200,
      cpus: 2,
      maxmem: 2048 * 1024 * 1024,
      maxdisk: 50 * 1024 * 1024 * 1024,
    });

    ProxmoxService.startLxc = async () => ({
      upid: "UPID:pve:00002:00001:start",
    });

    ProxmoxService.stopLxc = async () => ({
      upid: "UPID:pve:00003:00001:stop",
    });

    ProxmoxService.shutdownLxc = async () => ({
      upid: "UPID:pve:00004:00001:shutdown",
    });

    ProxmoxService.rebootLxc = async () => ({
      upid: "UPID:pve:00005:00001:reboot",
    });

    ProxmoxService.destroyLxc = async () => ({
      upid: "UPID:pve:00006:00001:destroy",
    });

    ProxmoxService.setLxcPassword = async () => {};
    ProxmoxService.updateLxcConfig = async () => {};
    ProxmoxService.checkLxcLocked = async () => ({ locked: false });

    ProxmoxService.getTemplates = async () => [
      {
        volid: "local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst",
        storage: "local",
        filename: "ubuntu-24.04-standard_24.04-2_amd64.tar.zst",
        format: "tar.zst",
        sizeBytes: 130 * 1024 * 1024,
      },
    ];

    ProxmoxService.getStorageList = async () => [
      {
        storage: "local-lvm",
        type: "lvmthin",
        active: true,
        content: ["rootdir", "images"],
        supportsTemplates: false,
        supportsRootfs: true,
      },
      {
        storage: "local",
        type: "dir",
        active: true,
        content: ["iso", "vztmpl", "backup"],
        supportsTemplates: true,
        supportsRootfs: false,
      },
    ];

    ProxmoxService.getNetworkBridges = async () => [
      {
        iface: "vmbr0",
        type: "bridge",
        active: true,
      },
    ];

    ProxmoxService.verifyNode = async (node) => ({
      status: "healthy",
      readiness: "PROVISION_READY",
      reachable: true,
      authenticated: true,
      identityVerified: true,
      expectedNodeName: node.nodeName,
      actualNodeName: node.nodeName,
      checks: [],
      storages: [],
      templateStorages: ["local"],
      rootfsStorages: ["local-lvm"],
      templates: [
        {
          volid: "local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst",
          storage: "local",
          filename: "ubuntu-24.04-standard_24.04-2_amd64.tar.zst",
          format: "tar.zst",
          sizeBytes: 130 * 1024 * 1024,
        },
      ],
      bridges: [{ iface: "vmbr0", type: "bridge", active: true }],
      verifiedAt: new Date().toISOString(),
    });

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

    // 1. Seed users
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, global_name, email, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [USER_A_ID, "disc-a-" + Date.now(), "usera_mgr", "User A", "usera_mgr@test.com", "user", "active", now, now]
    );

    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, global_name, email, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [USER_B_ID, "disc-b-" + Date.now(), "userb_mgr", "User B", "userb_mgr@test.com", "user", "active", now, now]
    );

    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, global_name, email, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ADMIN_ID, "disc-admin-" + Date.now(), "admin_mgr", "Admin Mgr", "admin_mgr@test.com", "admin", "active", now, now]
    );

    // 2. Seed sessions
    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["sess-id-mgr-a", USER_A_ID, hashToken(SESSION_USER_A), future, now, now]
    );

    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["sess-id-mgr-b", USER_B_ID, hashToken(SESSION_USER_B), future, now, now]
    );

    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["sess-id-mgr-admin", ADMIN_ID, hashToken(SESSION_ADMIN), future, now, now]
    );

    // 3. Seed node
    execute(
      `INSERT OR REPLACE INTO proxmox_nodes (
        id, name, hostname, api_url, port, node_name, region,
        auth_token_id, auth_token_secret_encrypted, allow_insecure_tls,
        default_storage, default_bridge, enabled, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'online', ?, ?)`,
      [
        NODE_ID,
        "Ashburn Core PVE",
        "pve-01.test.internal",
        "https://127.0.0.1:8006",
        8006,
        "pve",
        "us-east",
        "root@pam!test",
        encryptCredential("mock-secret-token"),
        1,
        "local-lvm",
        "vmbr0",
        now,
        now,
      ]
    );

    // 4. Seed VPS A (owned by User A) and VPS B (owned by User B)
    execute(
      `INSERT OR REPLACE INTO vps (
        id, owner_user_id, proxmox_node_id, proxmox_vmid, name, hostname,
        description, status, os_image_id, cpu_cores, memory_mb, swap_mb, disk_gb,
        ipv4_address, ipv6_address, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        VPS_A_ID,
        USER_A_ID,
        NODE_ID,
        2001,
        "User A Production Web",
        "web-a.test.com",
        "Primary web service",
        "running",
        "local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst",
        2,
        2048,
        512,
        50,
        "192.168.1.101",
        null,
        now,
        now,
      ]
    );

    execute(
      `INSERT OR REPLACE INTO vps (
        id, owner_user_id, proxmox_node_id, proxmox_vmid, name, hostname,
        description, status, os_image_id, cpu_cores, memory_mb, swap_mb, disk_gb,
        ipv4_address, ipv6_address, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        VPS_B_ID,
        USER_B_ID,
        NODE_ID,
        2002,
        "User B Database Node",
        "db-b.test.com",
        "PostgreSQL cluster",
        "stopped",
        "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst",
        4,
        4096,
        1024,
        100,
        "192.168.1.102",
        null,
        now,
        now,
      ]
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
  // 1. Authentication & Ownership Isolation Tests
  // ==========================================================================
  it("should return 401 when unauthenticated request accesses GET /api/vps/:id", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}`);
    assert.equal(res.status, 401);
  });

  it("should return 401 when unauthenticated request accesses POST /api/vps/:id/power", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/power`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reboot" }),
    });
    assert.equal(res.status, 401);
  });

  it("should return 401 when unauthenticated request accesses POST /api/vps/:id/reinstall", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/reinstall`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmHostname: "web-a.test.com", template: "test" }),
    });
    assert.equal(res.status, 401);
  });

  it("should allow User A to view their own VPS details", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}`, {
      headers: { Cookie: `interdash_session=${SESSION_USER_A}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.instance.id, VPS_A_ID);
    assert.equal(data.instance.hostname, "web-a.test.com");
  });

  it("should return 403 when User B tries to view User A's VPS", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}`, {
      headers: { Cookie: `interdash_session=${SESSION_USER_B}` },
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.match(data.error, /Access denied/i);
  });

  it("should return 403 when User B tries to power cycle User A's VPS", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/power`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_USER_B}`,
      },
      body: JSON.stringify({ action: "reboot" }),
    });
    assert.equal(res.status, 403);
  });

  it("should return 403 when User B tries to reinstall User A's VPS", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/reinstall`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_USER_B}`,
      },
      body: JSON.stringify({ confirmHostname: "web-a.test.com", template: "debian" }),
    });
    assert.equal(res.status, 403);
  });

  it("should allow Admin to manage any VPS (User A or User B)", async () => {
    const resA = await fetchApi(`/api/vps/${VPS_A_ID}`, {
      headers: { Cookie: `interdash_session=${SESSION_ADMIN}` },
    });
    assert.equal(resA.status, 200);

    const resB = await fetchApi(`/api/vps/${VPS_B_ID}`, {
      headers: { Cookie: `interdash_session=${SESSION_ADMIN}` },
    });
    assert.equal(resB.status, 200);
  });

  // ==========================================================================
  // 2. Real Power Operations Tests
  // ==========================================================================
  it("should allow User A to reboot their VPS and log audit event", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/power`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_USER_A}`,
      },
      body: JSON.stringify({ action: "reboot" }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.action, "reboot");

    // Verify audit log
    const audit = queryOne<any>(
      "SELECT * FROM audit_logs WHERE event_type = 'vps_rebooted' AND user_id = ? ORDER BY created_at DESC LIMIT 1",
      [USER_A_ID]
    );
    assert.ok(audit);
  });

  it("should allow User A to stop their VPS gracefully", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/power`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_USER_A}`,
      },
      body: JSON.stringify({ action: "stop", force: false }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.action, "stop");
  });

  it("should allow User A to start their VPS", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/power`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_USER_A}`,
      },
      body: JSON.stringify({ action: "start" }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.action, "start");
  });

  it("should reject invalid power action with 400 Bad Request", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/power`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_USER_A}`,
      },
      body: JSON.stringify({ action: "explode" }),
    });
    assert.equal(res.status, 400);
  });

  // ==========================================================================
  // 3. Metadata & Settings Tests
  // ==========================================================================
  it("should allow User A to update name and description", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_USER_A}`,
      },
      body: JSON.stringify({
        name: "Renamed Web Frontend",
        description: "Updated production description notes",
      }),
    });
    assert.equal(res.status, 200);

    // Verify DB update
    const updated = queryOne<any>("SELECT name, description FROM vps WHERE id = ?", [VPS_A_ID]);
    assert.equal(updated.name, "Renamed Web Frontend");
    assert.equal(updated.description, "Updated production description notes");
  });

  // ==========================================================================
  // 4. Root Password Change Tests
  // ==========================================================================
  it("should reject password change when password is shorter than 8 characters", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_USER_A}`,
      },
      body: JSON.stringify({ password: "short" }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /8 characters/i);
  });

  it("should allow User A to change their root password without password leakage", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_USER_A}`,
      },
      body: JSON.stringify({ password: "SuperSecretPassword123!" }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.password, undefined); // Password never returned in response

    // Verify password is NOT in database operations params_json
    const op = queryOne<any>(
      "SELECT * FROM vps_operations WHERE id = ?",
      [data.operationId]
    );
    assert.ok(op);
    assert.equal(op.params_json, null); // Password excluded from params_json
  });

  // ==========================================================================
  // 5. Destructive Reinstall Guardrail Tests
  // ==========================================================================
  it("should reject reinstall when hostname confirmation does not match exact hostname", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/reinstall`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_USER_A}`,
      },
      body: JSON.stringify({
        template: "local:vztmpl/debian-12.tar.zst",
        confirmHostname: "wrong-hostname",
      }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /Confirmation mismatch/i);
  });

  it("should successfully reinstall when exact hostname is confirmed", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/reinstall`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_USER_A}`,
      },
      body: JSON.stringify({
        template: "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst",
        confirmHostname: "web-a.test.com",
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);

    // Verify DB update
    const vps = queryOne<any>("SELECT os_image_id, lock_state FROM vps WHERE id = ?", [VPS_A_ID]);
    assert.equal(vps.os_image_id, "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst");
    assert.equal(vps.lock_state, null);
  });

  // ==========================================================================
  // 6. Concurrency Locking Tests
  // ==========================================================================
  it("should return 409 Conflict when an operation is already active on the VPS", async () => {
    // Manually simulate an active operation in database
    const fakeOpId = "active-op-" + crypto.randomUUID();
    execute(
      `INSERT INTO vps_operations (id, vps_id, requested_by_user_id, operation_type, status, current_step)
       VALUES (?, ?, ?, 'reinstall', 'running', 'destroying_old_rootfs')`,
      [fakeOpId, VPS_A_ID, USER_A_ID]
    );

    const res = await fetchApi(`/api/vps/${VPS_A_ID}/power`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_USER_A}`,
      },
      body: JSON.stringify({ action: "reboot" }),
    });

    assert.equal(res.status, 409);
    const data = await res.json();
    assert.match(data.error, /Conflict/i);

    // Clean up simulated active operation
    execute("DELETE FROM vps_operations WHERE id = ?", [fakeOpId]);
  });

  // ==========================================================================
  // 7. Provisioning Idempotency Tests
  // ==========================================================================
  it("should return existing job when same idempotency key is submitted with identical parameters", async () => {
    const key = "idem-key-" + crypto.randomUUID();

    const payload = {
      ownerUserId: USER_A_ID,
      targetNodeId: NODE_ID,
      hostname: "test-idem-01",
      osTemplate: "local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst",
      cpuCores: 1,
      memoryMb: 1024,
      diskGb: 20,
      idempotencyKey: key,
    };

    // First submission
    const res1 = await fetchApi("/api/admin/vps", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_ADMIN}`,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(res1.status, 202);
    const data1 = await res1.json();
    assert.ok(data1.jobId);

    // Duplicate submission with same key
    const res2 = await fetchApi("/api/admin/vps", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_ADMIN}`,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(res2.status, 202);
    const data2 = await res2.json();
    assert.equal(data2.jobId, data1.jobId);
    assert.equal(data2.isDuplicate, true);
  });

  it("should return 409 Conflict when same idempotency key is submitted with conflicting parameters", async () => {
    const key = "idem-conflict-" + crypto.randomUUID();

    const payload1 = {
      ownerUserId: USER_A_ID,
      targetNodeId: NODE_ID,
      hostname: "test-conflict-01",
      osTemplate: "local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst",
      cpuCores: 1,
      memoryMb: 1024,
      diskGb: 20,
      idempotencyKey: key,
    };

    const res1 = await fetchApi("/api/admin/vps", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_ADMIN}`,
      },
      body: JSON.stringify(payload1),
    });
    assert.equal(res1.status, 202);

    // Same key with different hostname/template
    const payload2 = {
      ...payload1,
      hostname: "test-conflict-DIFFERENT",
      cpuCores: 4,
    };

    const res2 = await fetchApi("/api/admin/vps", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `interdash_session=${SESSION_ADMIN}`,
      },
      body: JSON.stringify(payload2),
    });
    assert.equal(res2.status, 409);
    const data2 = await res2.json();
    assert.match(data2.error, /conflicting parameters/i);
  });
});
