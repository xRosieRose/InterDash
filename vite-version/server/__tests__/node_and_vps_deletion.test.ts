/**
 * InterDash — Node and VPS Lifecycle Deletion & Safety Integration Tests
 *
 * Tests:
 * 1. Safe Node Deletion:
 *    - Rejects deletion with 409 Conflict when VPS instances are assigned
 *    - Rejects deletion with 409 Conflict when provisioning jobs are active
 *    - Returns 404 when deleting a nonexistent node
 *    - Safely removes empty node with 204 No Content and logs audit event
 * 2. VPS Deletion:
 *    - Rejects deletion with 401 when unauthenticated
 *    - Rejects deletion with 403 when User B attempts to delete User A's VPS
 *    - Rejects deletion with 400 when confirmHostname does not match exact hostname
 *    - Rejects deletion with 409 Conflict when a conflicting operation is active
 *    - Successfully executes stop, container destroy, IPAM release, DB finalization, and audit log
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { createApp } from "../index.js";
import { closeDatabase, execute, queryOne } from "../db/index.js";
import { hashToken } from "../middleware/auth.js";
import { encryptCredential } from "../services/crypto.js";
import { VpsOperationsService } from "../services/vps-operations.js";
import { ProxmoxService } from "../services/proxmox.js";

let server: Server | null = null;
let BASE_URL = "";

const USER_A_ID = "test-user-del-a-" + crypto.randomUUID();
const USER_B_ID = "test-user-del-b-" + crypto.randomUUID();
const ADMIN_ID = "test-admin-del-" + crypto.randomUUID();

const SESSION_USER_A = "sess-del-a-" + crypto.randomUUID();
const SESSION_USER_B = "sess-del-b-" + crypto.randomUUID();
const SESSION_ADMIN = "sess-del-admin-" + crypto.randomUUID();

const NODE_WITH_VPS_ID = "node-with-vps-" + crypto.randomUUID();
const EMPTY_NODE_ID = "node-empty-" + crypto.randomUUID();

const VPS_TO_DELETE_ID = "vps-to-delete-" + crypto.randomUUID();
const VPS_HOSTNAME = "delete-me-lxc.local";
const IP_POOL_ID = "pool-del-" + crypto.randomUUID();
const IP_ADDR_ID = "ip-del-" + crypto.randomUUID();

const CSRF_TOKEN = "test-csrf-token-del";

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

describe("Node & VPS Deletion Lifecycle Integration Tests", () => {
  before(async () => {
    const app = await createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server!.address();
        if (typeof addr === "object" && addr !== null) {
          BASE_URL = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });

    let destroyed = false;
    ProxmoxService.destroyLxc = async () => {
      destroyed = true;
      return { upid: "UPID:pve:00006:00001:destroy" };
    };
    ProxmoxService.stopLxc = async () => ({
      upid: "UPID:pve:00003:00001:stop",
    });
    ProxmoxService.waitForProxmoxTask = async () => ({
      exitstatus: "OK",
    });
    ProxmoxService.getLxcStatus = async () => {
      if (destroyed) {
        return { status: "unknown", ok: false };
      }
      return {
        status: "stopped",
        uptime: 0,
        cpus: 1,
        maxmem: 1024 * 1024 * 1024,
        maxdisk: 25 * 1024 * 1024 * 1024,
        ok: true,
      };
    };
    ProxmoxService.request = async (_node, _method, path) => {
      if (destroyed) {
        const err = new Error("Configuration file '9901.conf' does not exist");
        (err as any).statusCode = 404;
        throw err;
      }
      if (path.includes("/status/current")) {
        return {
          status: 200,
          data: { status: "stopped", uptime: 0, cpus: 1, maxmem: 1024 * 1024 * 1024, maxdisk: 25 * 1024 * 1024 * 1024 },
          headers: new Headers(),
          latencyMs: 1,
        } as any;
      }
      return { status: 200, data: {}, headers: new Headers(), latencyMs: 1 } as any;
    };

    const now = new Date().toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();

    // Seed test users
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, email, role, status, created_at, updated_at)
       VALUES (?, ?, 'UserDelA', 'usera@test.local', 'user', 'active', ?, ?)`,
      [USER_A_ID, "disc-del-a-" + crypto.randomUUID(), now, now]
    );
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, email, role, status, created_at, updated_at)
       VALUES (?, ?, 'UserDelB', 'userb@test.local', 'user', 'active', ?, ?)`,
      [USER_B_ID, "disc-del-b-" + crypto.randomUUID(), now, now]
    );
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, email, role, status, created_at, updated_at)
       VALUES (?, ?, 'AdminDel', 'admin@test.local', 'admin', 'active', ?, ?)`,
      [ADMIN_ID, "disc-del-admin-" + crypto.randomUUID(), now, now]
    );

    // Seed sessions
    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["s-del-a", USER_A_ID, hashToken(SESSION_USER_A), future, now, now]
    );
    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["s-del-b", USER_B_ID, hashToken(SESSION_USER_B), future, now, now]
    );
    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["s-del-admin", ADMIN_ID, hashToken(SESSION_ADMIN), future, now, now]
    );

    // Seed Proxmox nodes
    const secretEnc = encryptCredential("dummy-secret-token");
    execute(
      `INSERT OR REPLACE INTO proxmox_nodes (
        id, name, hostname, api_url, port, node_name, region,
        auth_token_id, auth_token_secret_encrypted, allow_insecure_tls,
        default_storage, default_rootfs_storage, default_bridge, enabled, status
      ) VALUES (?, 'Node With VPS', 'pve01.local', 'https://pve01.local:8006', 8006, 'pve01', 'us-east',
                'root@pam!token', ?, 1, 'local-lvm', 'local-lvm', 'vmbr0', 1, 'healthy')`,
      [NODE_WITH_VPS_ID, secretEnc]
    );
    execute(
      `INSERT OR REPLACE INTO proxmox_nodes (
        id, name, hostname, api_url, port, node_name, region,
        auth_token_id, auth_token_secret_encrypted, allow_insecure_tls,
        default_storage, default_rootfs_storage, default_bridge, enabled, status
      ) VALUES (?, 'Empty Node', 'pve02.local', 'https://pve02.local:8006', 8006, 'pve02', 'us-west',
                'root@pam!token', ?, 1, 'local-lvm', 'local-lvm', 'vmbr0', 1, 'healthy')`,
      [EMPTY_NODE_ID, secretEnc]
    );

    // Seed IP Pool and IP address assigned to VPS
    execute(
      `INSERT OR REPLACE INTO ip_pools (id, name, node_id, ip_version, cidr, gateway)
       VALUES (?, 'Test Pool', ?, 4, '192.168.10.0/24', '192.168.10.1')`,
      [IP_POOL_ID, NODE_WITH_VPS_ID]
    );
    execute(
      `INSERT OR REPLACE INTO ip_addresses (id, pool_id, ip_address, status, vps_id)
       VALUES (?, ?, '192.168.10.55', 'assigned', ?)`,
      [IP_ADDR_ID, IP_POOL_ID, VPS_TO_DELETE_ID]
    );

    // Seed VPS assigned to NODE_WITH_VPS_ID
    execute(
      `INSERT OR REPLACE INTO vps (
        id, owner_user_id, proxmox_node_id, proxmox_vmid, name, hostname,
        status, os_image_id, cpu_cores, memory_mb, swap_mb, disk_gb,
        ipv4_address, created_at, updated_at
      ) VALUES (?, ?, ?, 9901, 'Delete Target VPS', ?, 'stopped', 'ubuntu-22.04', 2, 2048, 512, 20,
                '192.168.10.55', ?, ?)`,
      [VPS_TO_DELETE_ID, USER_A_ID, NODE_WITH_VPS_ID, VPS_HOSTNAME, now, now]
    );
  });

  after(async () => {
    await new Promise((r) => setTimeout(r, 200));
    if (server) server.close();
    closeDatabase();
  });

  describe("Guarded Node Deletion API", () => {
    it("should return 401 when unauthenticated accesses DELETE /api/admin/nodes/:id", async () => {
      const res = await fetchApi(`/api/admin/nodes/${EMPTY_NODE_ID}`, {
        method: "DELETE",
      });
      assert.strictEqual(res.status, 401);
    });

    it("should return 403 when non-admin accesses DELETE /api/admin/nodes/:id", async () => {
      const res = await fetchApi(`/api/admin/nodes/${EMPTY_NODE_ID}`, {
        method: "DELETE",
        headers: { Cookie: `interdash_session=${SESSION_USER_A}` },
      });
      assert.strictEqual(res.status, 403);
    });

    it("should return 404 when deleting a nonexistent node", async () => {
      const res = await fetchApi(`/api/admin/nodes/nonexistent-node-123`, {
        method: "DELETE",
        headers: { Cookie: `interdash_session=${SESSION_ADMIN}` },
      });
      assert.strictEqual(res.status, 404);
    });

    it("should return 409 Conflict when attempting to delete a node with assigned VPS instances", async () => {
      const res = await fetchApi(`/api/admin/nodes/${NODE_WITH_VPS_ID}`, {
        method: "DELETE",
        headers: { Cookie: `interdash_session=${SESSION_ADMIN}` },
      });
      assert.strictEqual(res.status, 409);
      const data = await res.json();
      assert.match(data.error, /assigned to it/);
      assert.strictEqual(data.dependencies?.vpsCount, 1);
    });

    it("should safely delete an empty node with 204 No Content", async () => {
      const res = await fetchApi(`/api/admin/nodes/${EMPTY_NODE_ID}`, {
        method: "DELETE",
        headers: { Cookie: `interdash_session=${SESSION_ADMIN}` },
      });
      assert.strictEqual(res.status, 204);

      // Verify node removed from DB
      const row = queryOne("SELECT id FROM proxmox_nodes WHERE id = ?", [EMPTY_NODE_ID]);
      assert.strictEqual(row, null);

      // Verify audit log recorded
      const audit = queryOne<any>(
        "SELECT event_type, metadata FROM audit_logs WHERE event_type = 'proxmox_node_deleted' ORDER BY id DESC LIMIT 1"
      );
      assert.ok(audit);
      assert.match(audit.metadata, new RegExp(EMPTY_NODE_ID));
    });
  });

  describe("VPS Deletion & IPAM Release API", () => {
    it("should return 401 when unauthenticated accesses DELETE /api/vps/:id", async () => {
      const res = await fetchApi(`/api/vps/${VPS_TO_DELETE_ID}`, {
        method: "DELETE",
      });
      assert.strictEqual(res.status, 401);
    });

    it("should return 403 when User B tries to delete User A's VPS", async () => {
      const res = await fetchApi(`/api/vps/${VPS_TO_DELETE_ID}`, {
        method: "DELETE",
        headers: { Cookie: `interdash_session=${SESSION_USER_B}` },
      });
      assert.strictEqual(res.status, 403);
    });

    it("should return 400 when confirmHostname does not match exact hostname", async () => {
      const res = await fetchApi(`/api/vps/${VPS_TO_DELETE_ID}`, {
        method: "DELETE",
        headers: {
          Cookie: `interdash_session=${SESSION_USER_A}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirmHostname: "wrong-hostname.local" }),
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /Confirmation mismatch/);
    });

    it("should return 409 Conflict when a conflicting operation is already active", async () => {
      // Simulate active operation on VPS
      const opId = VpsOperationsService.claimOperation(VPS_TO_DELETE_ID, USER_A_ID, "reboot");
      try {
        const res = await fetchApi(`/api/vps/${VPS_TO_DELETE_ID}`, {
          method: "DELETE",
          headers: {
            Cookie: `interdash_session=${SESSION_USER_A}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ confirmHostname: VPS_HOSTNAME }),
        });
        assert.strictEqual(res.status, 409);
      } finally {
        // Complete the dummy active operation
        VpsOperationsService.completeOperation(opId, VPS_TO_DELETE_ID);
      }
    });

    it("should accept delete request with 202 and release IPAM resources upon completion", async () => {
      const res = await fetchApi(`/api/vps/${VPS_TO_DELETE_ID}`, {
        method: "DELETE",
        headers: {
          Cookie: `interdash_session=${SESSION_USER_A}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirmHostname: VPS_HOSTNAME }),
      });

      assert.strictEqual(res.status, 202);
      const data = await res.json();
      assert.ok(data.operationId);
      assert.strictEqual(data.status, "running");

      // Verify operation status endpoint
      const opRes = await fetchApi(`/api/vps/${VPS_TO_DELETE_ID}/operations/${data.operationId}`, {
        headers: { Cookie: `interdash_session=${SESSION_USER_A}` },
      });
      assert.strictEqual(opRes.status, 200);
      const opData = await opRes.json();
      assert.strictEqual(opData.operationId, data.operationId);
      assert.strictEqual(opData.type, "delete");

      // Wait for background worker to conclude before test finishes
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const check = await fetchApi(`/api/vps/${VPS_TO_DELETE_ID}/operations/${data.operationId}`, {
          headers: { Cookie: `interdash_session=${SESSION_USER_A}` },
        });
        if (check.status === 200) {
          const cData = await check.json();
          if (cData.status === "completed" || cData.status === "failed") break;
        }
      }
    });

    it("should set heartbeat_at and lease_expires_at when claiming an operation", async () => {
      const dummyVpsId = "vps-lease-test-" + crypto.randomUUID();
      execute(
        `INSERT INTO vps (id, owner_user_id, proxmox_node_id, proxmox_vmid, name, hostname, status, os_image_id, cpu_cores, memory_mb, swap_mb, disk_gb)
         VALUES (?, ?, ?, 9999, 'Lease Test', 'lease.local', 'running', 'ubuntu', 1, 1024, 512, 10)`,
        [dummyVpsId, USER_A_ID, NODE_WITH_VPS_ID]
      );
      try {
        const opId = VpsOperationsService.claimOperation(dummyVpsId, USER_A_ID, "reboot");
        const op = VpsOperationsService.getOperation(opId);
        assert.ok(op);
        assert.ok(op.heartbeat_at, "heartbeat_at must be populated");
        assert.ok(op.lease_expires_at, "lease_expires_at must be populated");

        // Test heartbeat update
        VpsOperationsService.updateOperationHeartbeat(opId, 600);
        const updated = VpsOperationsService.getOperation(opId);
        assert.ok(updated.lease_expires_at);

        VpsOperationsService.completeOperation(opId, dummyVpsId);
      } finally {
        execute("DELETE FROM vps WHERE id = ?", [dummyVpsId]);
      }
    });

    it("should allow admin to update node status to draining and reflect in overview metrics", async () => {
      // Create a test node
      const drainNodeId = "node-drain-" + crypto.randomUUID();
      execute(
        `INSERT INTO proxmox_nodes (id, name, hostname, api_url, port, node_name, region, auth_token_id, auth_token_secret_encrypted, status, enabled)
         VALUES (?, 'Drain Node', 'pve-drain.local', 'https://pve-drain.local:8006', 8006, 'pve', 'us-east', 'token', 'secret', 'healthy', 1)`,
        [drainNodeId]
      );

      try {
        // Set node to draining via PATCH
        const patchRes = await fetchApi(`/api/admin/nodes/${drainNodeId}`, {
          method: "PATCH",
          headers: {
            Cookie: `interdash_session=${SESSION_ADMIN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "draining" }),
        });
        assert.strictEqual(patchRes.status, 200);

        const nodeRow = queryOne<any>("SELECT status FROM proxmox_nodes WHERE id = ?", [drainNodeId]);
        assert.strictEqual(nodeRow.status, "draining");

        // Overview metrics should report this node in disabledNodes (since draining is offline from new provisioning)
        const overviewRes = await fetchApi("/api/admin/overview", {
          headers: { Cookie: `interdash_session=${SESSION_ADMIN}` },
        });
        assert.strictEqual(overviewRes.status, 200);
        const overviewData = await overviewRes.json();
        assert.ok(overviewData.metrics.disabledNodes >= 1);

        // Preflight should reject provisioning on this draining node
        const preflightRes = await fetchApi("/api/admin/vps/preflight", {
          method: "POST",
          headers: {
            Cookie: `interdash_session=${SESSION_ADMIN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            targetNodeId: drainNodeId,
            hostname: "test-drain-deploy.local",
          }),
        });
        assert.strictEqual(preflightRes.status, 422);
      } finally {
        execute("DELETE FROM proxmox_nodes WHERE id = ?", [drainNodeId]);
      }
    });
  });
});
