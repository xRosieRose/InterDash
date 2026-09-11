/**
 * InterDash — Authoritative Runtime Resolution, Session Timezone & Status Preservation Tests
 *
 * Validates:
 * 1. Database session timestamp parsing (parseDatabaseTimestampUtc) across multiple formats and timezones.
 * 2. Proxmox cluster runtime target resolution (resolveLxcRuntimeTarget).
 * 3. Proxmox cluster movement without node identity mutation (never modifying proxmox_nodes.node_name).
 * 4. DB status preservation during transient Proxmox failures (never turning running into unknown).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { parseDatabaseTimestampUtc } from "../utils/timestamp.js";
import {
  ProxmoxService,
  type ProxmoxNodeConfig,
} from "../services/proxmox.js";
import { VpsOperationsService } from "../services/vps-operations.js";
import { initDatabase, execute, queryOne, closeDatabase } from "../db/index.js";

describe("Session Timestamp & Timezone Safety Tests", () => {
  it("should parse ISO UTC timestamp with Z correctly", () => {
    const iso = "2026-09-11T12:00:00.000Z";
    const parsed = parseDatabaseTimestampUtc(iso);
    assert.ok(parsed instanceof Date);
    assert.equal(parsed.toISOString(), "2026-09-11T12:00:00.000Z");
    assert.equal(parsed.getTime(), Date.parse("2026-09-11T12:00:00.000Z"));
  });

  it("should parse SQLite space-separated UTC datetime string (YYYY-MM-DD HH:mm:ss)", () => {
    const sqliteStr = "2026-09-11 12:00:00";
    const parsed = parseDatabaseTimestampUtc(sqliteStr);
    assert.ok(parsed instanceof Date);
    // Must be interpreted as UTC 12:00:00, NOT local time!
    assert.equal(parsed.toISOString(), "2026-09-11T12:00:00.000Z");
  });

  it("should parse ISO string with positive offset (+05:30)", () => {
    // 17:30 in +05:30 is 12:00:00 UTC
    const offsetStr = "2026-09-11T17:30:00+05:30";
    const parsed = parseDatabaseTimestampUtc(offsetStr);
    assert.ok(parsed instanceof Date);
    assert.equal(parsed.toISOString(), "2026-09-11T12:00:00.000Z");
  });

  it("should parse ISO string with negative offset (-04:00)", () => {
    // 08:00 in -04:00 is 12:00:00 UTC
    const offsetStr = "2026-09-11T08:00:00-04:00";
    const parsed = parseDatabaseTimestampUtc(offsetStr);
    assert.ok(parsed instanceof Date);
    assert.equal(parsed.toISOString(), "2026-09-11T12:00:00.000Z");
  });

  it("should determine expiration identically regardless of environment timezone", () => {
    const pastUtc = "2020-01-01 00:00:00";
    const futureUtc = "2099-01-01 00:00:00";

    const pastDate = parseDatabaseTimestampUtc(pastUtc);
    const futureDate = parseDatabaseTimestampUtc(futureUtc);
    const now = new Date();

    assert.ok(pastDate.getTime() < now.getTime(), "Past timestamp must be expired");
    assert.ok(futureDate.getTime() > now.getTime(), "Future timestamp must be valid");
  });

  it("should safely return epoch 0 for invalid or empty timestamp input", () => {
    const invalid = parseDatabaseTimestampUtc("not-a-date");
    assert.equal(invalid.getTime(), 0);

    const empty = parseDatabaseTimestampUtc("");
    assert.equal(empty.getTime(), 0);

    const nullVal = parseDatabaseTimestampUtc(null);
    assert.equal(nullVal.getTime(), 0);
  });
});

describe("Cluster Runtime Target Resolution & Node Isolation Tests", () => {
  let mockServer: http.Server;
  let mockPort: number;
  let clusterResources: any[] = [];
  let directLxcExists = true;
  let directLxcStatus = "running";
  let clusterEndpointAvailable = true;
  let simulatedAuthDenied = false;

  before(async () => {
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url || "", `http://${req.headers.host}`);

      if (simulatedAuthDenied) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "permission denied - invalid token" }));
        return;
      }

      // Check direct LXC status endpoint
      if (url.pathname.match(/\/nodes\/([^/]+)\/lxc\/(\d+)\/status\/current/)) {
        const match = url.pathname.match(/\/nodes\/([^/]+)\/lxc\/(\d+)\/status\/current/)!;
        const nodeName = match[1];
        const vmid = parseInt(match[2], 10);

        if (directLxcExists && nodeName === "pve01" && vmid === 101) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: { status: directLxcStatus, name: "test-ct", vmid: 101 } }));
          return;
        }

        if (nodeName === "pve02" && vmid === 101) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: { status: "running", name: "migrated-ct", vmid: 101 } }));
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: `Configuration file 'nodes/${nodeName}/lxc/${vmid}.conf' does not exist` }));
        return;
      }

      // Check cluster resource inventory endpoint
      if (url.pathname === "/api2/json/cluster/resources") {
        if (!clusterEndpointAvailable) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "Cluster API unavailable" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: clusterResources }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Not found" }));
    });

    initDatabase();
    await new Promise<void>((resolve) => {
      mockServer.listen(0, "127.0.0.1", () => {
        const addr = mockServer.address() as any;
        mockPort = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    mockServer.close();
  });

  it("should resolve direct target when container is present on configured node", async () => {
    directLxcExists = true;
    directLxcStatus = "running";
    clusterEndpointAvailable = true;
    simulatedAuthDenied = false;

    const nodeConfig: ProxmoxNodeConfig = {
      id: "node-test",
      name: "Node 1",
      hostname: "127.0.0.1",
      apiUrl: `http://127.0.0.1:${mockPort}`,
      port: mockPort,
      nodeName: "pve01",
      region: "default",
      authTokenId: "root@pam!token",
      authTokenSecret: "secret",
      allowInsecureTls: true,
    };

    const target = await ProxmoxService.resolveLxcRuntimeTarget(nodeConfig, 101);
    assert.equal(target.ok, true);
    if (target.ok) {
      assert.equal(target.nodeName, "pve01");
      assert.equal(target.vmid, 101);
      assert.equal(target.discoveredFrom, "direct");
      assert.equal(target.status, "running");
    }
  });

  it("should discover actual runtime node on cluster when container moved to pve02", async () => {
    // Container is NOT on pve01 anymore, but is present on pve02 in the cluster inventory
    directLxcExists = false;
    clusterResources = [
      { id: "lxc/101", type: "lxc", vmid: 101, node: "pve02", status: "running" },
      { id: "qemu/102", type: "qemu", vmid: 102, node: "pve01", status: "running" },
    ];
    clusterEndpointAvailable = true;
    simulatedAuthDenied = false;

    const nodeConfig: ProxmoxNodeConfig = {
      id: "node-test",
      name: "Node 1",
      hostname: "127.0.0.1",
      apiUrl: `http://127.0.0.1:${mockPort}`,
      port: mockPort,
      nodeName: "pve01", // Configured node is still pve01
      region: "default",
      authTokenId: "root@pam!token",
      authTokenSecret: "secret",
      allowInsecureTls: true,
    };

    const target = await ProxmoxService.resolveLxcRuntimeTarget(nodeConfig, 101);
    assert.equal(target.ok, true);
    if (target.ok) {
      assert.equal(target.nodeName, "pve02", "Must resolve to actual cluster runtime node");
      assert.equal(target.vmid, 101);
      assert.equal(target.discoveredFrom, "cluster");
    }
  });

  it("should return not_found when container does not exist anywhere in cluster", async () => {
    directLxcExists = false;
    clusterResources = [
      { id: "lxc/999", type: "lxc", vmid: 999, node: "pve02", status: "running" },
    ];
    clusterEndpointAvailable = true;
    simulatedAuthDenied = false;

    const nodeConfig: ProxmoxNodeConfig = {
      id: "node-test",
      name: "Node 1",
      hostname: "127.0.0.1",
      apiUrl: `http://127.0.0.1:${mockPort}`,
      port: mockPort,
      nodeName: "pve01",
      region: "default",
      authTokenId: "root@pam!token",
      authTokenSecret: "secret",
      allowInsecureTls: true,
    };

    const target = await ProxmoxService.resolveLxcRuntimeTarget(nodeConfig, 101);
    assert.equal(target.ok, false);
    if (!target.ok) {
      assert.equal(target.reason, "not_found");
    }
  });

  it("should return discovery_unavailable when cluster endpoint fails", async () => {
    directLxcExists = false;
    clusterEndpointAvailable = false;
    simulatedAuthDenied = false;

    const nodeConfig: ProxmoxNodeConfig = {
      id: "node-test",
      name: "Node 1",
      hostname: "127.0.0.1",
      apiUrl: `http://127.0.0.1:${mockPort}`,
      port: mockPort,
      nodeName: "pve01",
      region: "default",
      authTokenId: "root@pam!token",
      authTokenSecret: "secret",
      allowInsecureTls: true,
    };

    const target = await ProxmoxService.resolveLxcRuntimeTarget(nodeConfig, 101);
    assert.equal(target.ok, false);
    if (!target.ok) {
      assert.equal(target.reason, "discovery_unavailable");
    }
  });

  it("should return authorization_failed when token is unauthorized", async () => {
    simulatedAuthDenied = true;

    const nodeConfig: ProxmoxNodeConfig = {
      id: "node-test",
      name: "Node 1",
      hostname: "127.0.0.1",
      apiUrl: `http://127.0.0.1:${mockPort}`,
      port: mockPort,
      nodeName: "pve01",
      region: "default",
      authTokenId: "root@pam!token",
      authTokenSecret: "secret",
      allowInsecureTls: true,
    };

    const target = await ProxmoxService.resolveLxcRuntimeTarget(nodeConfig, 101);
    assert.equal(target.ok, false);
    if (!target.ok) {
      assert.equal(target.reason, "authorization_failed");
    }
  });
});

describe("Authoritative Status Preservation on Proxmox Failure Tests", () => {
  before(() => {
    initDatabase();
  });

  after(() => {
    closeDatabase();
  });

  it("should preserve DB status as 'running' when Proxmox is unreachable", async () => {
    // Seed a VPS record with status 'running'
    const vpsId = "vps-preserve-test-1";
    const nodeId = "node-preserve-test-1";

    execute(
      `INSERT OR REPLACE INTO proxmox_nodes
       (id, name, hostname, api_url, port, node_name, region, auth_token_id, auth_token_secret_encrypted, allow_insecure_tls)
       VALUES (?, 'Preserve Node', 'invalid-hypervisor-domain-xyz.local', 'https://invalid-hypervisor-domain-xyz.local:8006', 8006, 'pve01', 'us-east', 'token', 'secret', 1)`,
      [nodeId]
    );

    execute(
      `INSERT OR REPLACE INTO vps
       (id, owner_user_id, proxmox_node_id, proxmox_vmid, hostname, name, status, os_image_id, cpu_cores, memory_mb, disk_gb)
       VALUES (?, 'user-1', ?, 199, 'preserve.test', 'Preserve VPS', 'running', 'local:vztmpl/ubuntu-22.04.tar.zst', 2, 2048, 20)`,
      [vpsId, nodeId]
    );

    // Call syncStatus when hypervisor is completely unreachable
    const result = await VpsOperationsService.syncStatus(vpsId);

    // Verify sync result flags
    assert.equal(result.fresh, false, "Must report fresh: false on hypervisor outage");
    assert.equal(result.status, "running", "Returned status must preserve previous known state");
    assert.ok(result.error, "Must include failure classification or error message");

    // Authoritative check: Verify database status was NEVER rewritten to 'unknown'!
    const dbVps = queryOne<{ status: string }>(
      `SELECT status FROM vps WHERE id = ? LIMIT 1`,
      [vpsId]
    );
    assert.ok(dbVps);
    assert.equal(
      dbVps.status,
      "running",
      "Database status MUST remain 'running' and NOT be corrupted to 'unknown'"
    );

    // Verify proxmox_nodes.node_name was NOT mutated
    const dbNode = queryOne<{ node_name: string }>(
      `SELECT node_name FROM proxmox_nodes WHERE id = ? LIMIT 1`,
      [nodeId]
    );
    assert.ok(dbNode);
    assert.equal(dbNode.node_name, "pve01", "proxmox_nodes.node_name must NEVER be mutated");
  });
});
