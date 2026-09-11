/**
 * InterDash — Proxmox TermProxy Request Framing, 501 Classification & Console Tests
 *
 * Verifies:
 * 1. Request framing: empty POST has Content-Length 0, no chunked transfer encoding.
 * 2. Request framing: JSON body has exact Content-Length, no chunked transfer encoding.
 * 3. Error classification: 501 JSON vs 501 HTML vs Cloudflare 501 vs Reverse Proxy 501.
 * 4. Diagnostics: ProxmoxService.testTermProxy produces safe diagnostics without secrets.
 * 5. Authorization: GET /api/vps/:id/console/diagnostic (owner & admin allowed, other denied).
 * 6. Authorization: GET /api/vps/:id/reinstall/capabilities (owner & admin allowed, safe subset).
 * 7. Terminal resize protocol: Proxmox 1:<cols>:<rows>: framing.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import type { Server } from "node:http";
import { createApp } from "../index.js";
import { closeDatabase, execute, queryOne } from "../db/index.js";
import { hashToken } from "../middleware/auth.js";
import {
  ProxmoxService,
  type ProxmoxNodeConfig,
  ProxmoxRequestError,
} from "../services/proxmox.js";
import { encryptCredential } from "../services/crypto.js";

describe("Console Termproxy Request Framing & 501 Diagnostics", () => {
  let mockServer: http.Server;
  let mockPort: number;
  let appServer: Server;
  let appBaseUrl = "";

  // Captured request inspection
  let lastRequestHeaders: http.IncomingHttpHeaders = {};
  let lastRequestMethod = "";
  let lastRequestPath = "";
  let lastRequestBody = "";

  // Mock response controls
  let mockStatusCode = 200;
  let mockResponseHeaders: Record<string, string> = { "Content-Type": "application/json" };
  let mockResponseBody: string | object = { data: { port: 5900, ticket: "test-ticket-abc", upid: "UPID:pve:123", user: "root@pam" } };

  // Database IDs
  const USER_A_ID = "diag-user-a-" + crypto.randomUUID();
  const USER_B_ID = "diag-user-b-" + crypto.randomUUID();
  const ADMIN_ID = "diag-admin-" + crypto.randomUUID();

  const SESSION_USER_A = "sess-diag-a-" + crypto.randomUUID();
  const SESSION_USER_B = "sess-diag-b-" + crypto.randomUUID();
  const SESSION_ADMIN = "sess-diag-admin-" + crypto.randomUUID();

  const NODE_ID = "diag-node-" + crypto.randomUUID();
  const VPS_A_ID = "diag-vps-a-" + crypto.randomUUID();
  const CSRF_TOKEN = "diag-csrf-token";

  before(async () => {
    // 1. Start mock Proxmox server
    await new Promise<void>((resolve) => {
      mockServer = http.createServer((req, res) => {
        lastRequestHeaders = req.headers;
        lastRequestMethod = req.method || "";
        lastRequestPath = req.url || "";
        lastRequestBody = "";

        req.on("data", (chunk) => {
          lastRequestBody += chunk.toString();
        });

        req.on("end", () => {
          // Default mock route handling
          if (req.url === "/api2/json/version") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ data: { release: "9.0", repo_id: "pve", version: "9.0-1" } }));
            return;
          }

          if (req.url === "/api2/json/nodes") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ data: [{ node: "pve", status: "online" }] }));
            return;
          }

          if (req.url?.includes("/nodes/pve/status")) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ data: { uptime: 50000, cpu: 0.1, memory: { used: 100, total: 1000 } } }));
            return;
          }

          if (req.url?.includes("/status/current")) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ data: { status: "running", vmid: 101 } }));
            return;
          }

          if (req.url?.includes("/storage") && req.url?.includes("/content")) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              data: [
                { volid: "local:vztmpl/ubuntu-22.04.tar.zst", format: "tar.zst", size: 200000000 }
              ]
            }));
            return;
          }

          if (req.url?.includes("/storage")) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              data: [
                { storage: "local", type: "dir", active: 1, content: "vztmpl" },
                { storage: "local-lvm", type: "lvmthin", active: 1, content: "rootdir,images" }
              ]
            }));
            return;
          }

          res.writeHead(mockStatusCode, mockResponseHeaders);
          const bodyStr = typeof mockResponseBody === "string" ? mockResponseBody : JSON.stringify(mockResponseBody);
          res.end(bodyStr);
        });
      });

      mockServer.listen(0, "127.0.0.1", () => {
        const addr = mockServer.address() as { port: number };
        mockPort = addr.port;
        resolve();
      });
    });

    // 2. Start InterDash app server
    const app = await createApp();
    await new Promise<void>((resolve) => {
      appServer = app.listen(0, "127.0.0.1", () => {
        const addr = appServer.address() as { port: number };
        appBaseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // 3. Seed users, sessions, node, and VPS
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, role, status)
       VALUES (?, 'disc-a', 'usera', 'user', 'active'),
              (?, 'disc-b', 'userb', 'user', 'active'),
              (?, 'disc-adm', 'admin', 'admin', 'active')`,
      [USER_A_ID, USER_B_ID, ADMIN_ID]
    );

    const now = new Date().toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();

    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?)`,
      [
        "sess-id-a", USER_A_ID, hashToken(SESSION_USER_A), future, now, now,
        "sess-id-b", USER_B_ID, hashToken(SESSION_USER_B), future, now, now,
        "sess-id-adm", ADMIN_ID, hashToken(SESSION_ADMIN), future, now, now,
      ]
    );

    execute(
      `INSERT OR REPLACE INTO proxmox_nodes (
         id, name, hostname, api_url, port, node_name, region,
         auth_token_id, auth_token_secret_encrypted, allow_insecure_tls,
         default_storage, default_template_storage, default_rootfs_storage, default_bridge, enabled, status
       ) VALUES (?, 'Diag Mock Node', '127.0.0.1', ?, ?, 'pve', 'default',
         'root@pam!token', ?, 1, 'local-lvm', 'local', 'local-lvm', 'vmbr0', 1, 'online')`,
      [
        NODE_ID,
        `http://127.0.0.1:${mockPort}`,
        mockPort,
        encryptCredential("super-secret-token-key"),
      ]
    );

    execute(
      `INSERT OR REPLACE INTO vps (
         id, owner_user_id, proxmox_node_id, proxmox_vmid, name, hostname,
         status, os_image_id, cpu_cores, memory_mb, swap_mb, disk_gb
       ) VALUES (?, ?, ?, 101, 'diag-box', 'diag-box.internal',
         'running', 'local:vztmpl/ubuntu-22.04.tar.zst', 2, 2048, 512, 20)`,
      [VPS_A_ID, USER_A_ID, NODE_ID]
    );
  });

  after(async () => {
    mockServer.close();
    appServer.close();
    closeDatabase();
  });

  beforeEach(() => {
    mockStatusCode = 200;
    mockResponseHeaders = { "Content-Type": "application/json" };
    mockResponseBody = { data: { port: 5900, ticket: "ticket-123", upid: "UPID:pve:123", user: "root@pam" } };
  });

  async function fetchApi(path: string, sessionCookie: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers || {});
    headers.set("Cookie", `interdash_session=${sessionCookie}; interdash_csrf=${CSRF_TOKEN}`);
    headers.set("x-csrf-token", CSRF_TOKEN);
    return fetch(`${appBaseUrl}${path}`, { ...options, headers });
  }

  // --------------------------------------------------------------------------
  // PART 1: Request Framing Tests
  // --------------------------------------------------------------------------
  it("should send Content-Length: 0 on empty POST request without chunked transfer encoding", async () => {
    const nodeConfig: ProxmoxNodeConfig = {
      id: NODE_ID,
      name: "Mock Node",
      hostname: "127.0.0.1",
      apiUrl: `http://127.0.0.1:${mockPort}`,
      port: mockPort,
      nodeName: "pve",
      region: "default",
      authTokenId: "root@pam!token",
      authTokenSecret: "secret",
      allowInsecureTls: true,
    };

    await ProxmoxService.createLxcTermProxy(nodeConfig, 101);

    assert.equal(lastRequestMethod, "POST");
    assert.equal(lastRequestHeaders["content-length"], "0");
    assert.equal(lastRequestHeaders["transfer-encoding"], undefined, "Transfer-Encoding must NOT be chunked");
    assert.equal(lastRequestBody, "");
  });

  it("should send exact UTF-8 Content-Length on JSON POST and never chunked transfer encoding", async () => {
    const nodeConfig: ProxmoxNodeConfig = {
      id: NODE_ID,
      name: "Mock Node",
      hostname: "127.0.0.1",
      apiUrl: `http://127.0.0.1:${mockPort}`,
      port: mockPort,
      nodeName: "pve",
      region: "default",
      authTokenId: "root@pam!token",
      authTokenSecret: "secret",
      allowInsecureTls: true,
    };

    const payload = { testKey: "value-with-unicode-⚡" };
    await ProxmoxService.request(nodeConfig, "POST", "/api2/json/test-json", payload);

    assert.equal(lastRequestMethod, "POST");
    const expectedLength = Buffer.byteLength(JSON.stringify(payload), "utf8").toString();
    assert.equal(lastRequestHeaders["content-length"], expectedLength);
    assert.equal(lastRequestHeaders["transfer-encoding"], undefined, "Transfer-Encoding must NOT be chunked");
    assert.equal(lastRequestHeaders["content-type"], "application/json");
  });

  // --------------------------------------------------------------------------
  // PART 2: TermProxy Success & Error Classifications
  // --------------------------------------------------------------------------
  it("should parse termproxy success response correctly", async () => {
    const nodeConfig: ProxmoxNodeConfig = {
      id: NODE_ID,
      name: "Mock Node",
      hostname: "127.0.0.1",
      apiUrl: `http://127.0.0.1:${mockPort}`,
      port: mockPort,
      nodeName: "pve",
      region: "default",
      authTokenId: "root@pam!token",
      authTokenSecret: "secret",
      allowInsecureTls: true,
    };

    mockStatusCode = 200;
    mockResponseBody = {
      data: {
        port: 5901,
        ticket: "PVE:ticket:xyz",
        upid: "UPID:pve:termproxy:123",
        user: "root@pam",
      },
    };

    const res = await ProxmoxService.createLxcTermProxy(nodeConfig, 101);
    assert.equal(res.port, 5901);
    assert.equal(res.ticket, "PVE:ticket:xyz");
    assert.equal(res.user, "root@pam");
  });

  it("should classify 401 Unauthorized as AUTHENTICATION_FAILURE", async () => {
    const nodeConfig: ProxmoxNodeConfig = {
      id: NODE_ID,
      name: "Mock Node",
      hostname: "127.0.0.1",
      apiUrl: `http://127.0.0.1:${mockPort}`,
      port: mockPort,
      nodeName: "pve",
      region: "default",
      authTokenId: "root@pam!token",
      authTokenSecret: "secret",
      allowInsecureTls: true,
    };

    mockStatusCode = 401;
    mockResponseBody = { message: "Permission denied - invalid token" };

    await assert.rejects(
      async () => ProxmoxService.createLxcTermProxy(nodeConfig, 101),
      (err: any) => {
        assert.ok(err instanceof ProxmoxRequestError);
        assert.equal(err.classification, "AUTHENTICATION_FAILURE");
        assert.equal(err.statusCode, 401);
        return true;
      }
    );
  });

  it("should classify 403 Forbidden as AUTHORIZATION_FAILURE", async () => {
    const nodeConfig: ProxmoxNodeConfig = {
      id: NODE_ID,
      name: "Mock Node",
      hostname: "127.0.0.1",
      apiUrl: `http://127.0.0.1:${mockPort}`,
      port: mockPort,
      nodeName: "pve",
      region: "default",
      authTokenId: "root@pam!token",
      authTokenSecret: "secret",
      allowInsecureTls: true,
    };

    mockStatusCode = 403;
    mockResponseBody = { message: "Permission denied" };

    await assert.rejects(
      async () => ProxmoxService.createLxcTermProxy(nodeConfig, 101),
      (err: any) => {
        assert.ok(err instanceof ProxmoxRequestError);
        assert.equal(err.classification, "AUTHORIZATION_FAILURE");
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  it("should classify 501 JSON without proxy headers as PROXMOX_501_TERM_PROXY", async () => {
    const nodeConfig: ProxmoxNodeConfig = {
      id: NODE_ID,
      name: "Mock Node",
      hostname: "127.0.0.1",
      apiUrl: `http://127.0.0.1:${mockPort}`,
      port: mockPort,
      nodeName: "pve",
      region: "default",
      authTokenId: "root@pam!token",
      authTokenSecret: "secret",
      allowInsecureTls: true,
    };

    mockStatusCode = 501;
    mockResponseBody = { message: "Not Implemented" };

    await assert.rejects(
      async () => ProxmoxService.createLxcTermProxy(nodeConfig, 101),
      (err: any) => {
        assert.ok(err instanceof ProxmoxRequestError);
        assert.equal(err.classification, "PROXMOX_501_TERM_PROXY");
        assert.equal(err.proxyDetected, false);
        return true;
      }
    );
  });

  it("should classify 501 HTML with cf-ray as CLOUDFLARE_501 and proxyDetected = true", async () => {
    const nodeConfig: ProxmoxNodeConfig = {
      id: NODE_ID,
      name: "Mock Node",
      hostname: "127.0.0.1",
      apiUrl: `http://127.0.0.1:${mockPort}`,
      port: mockPort,
      nodeName: "pve",
      region: "default",
      authTokenId: "root@pam!token",
      authTokenSecret: "secret",
      allowInsecureTls: true,
    };

    mockStatusCode = 501;
    mockResponseHeaders = {
      "Content-Type": "text/html",
      "server": "cloudflare",
      "cf-ray": "8bf992019ab3-ORD",
    };
    mockResponseBody = "<html><body><h1>501 Not Implemented</h1><p>Cloudflare Tunnel</p></body></html>";

    await assert.rejects(
      async () => ProxmoxService.createLxcTermProxy(nodeConfig, 101),
      (err: any) => {
        assert.ok(err instanceof ProxmoxRequestError);
        assert.equal(err.classification, "CLOUDFLARE_501");
        assert.equal(err.proxyDetected, true);
        assert.equal(err.proxyType, "cloudflare");
        assert.ok(err.safeBodySnippet?.includes("501 Not Implemented"));
        return true;
      }
    );
  });

  it("should classify 501 HTML with reverse proxy headers as REVERSE_PROXY_501", async () => {
    const nodeConfig: ProxmoxNodeConfig = {
      id: NODE_ID,
      name: "Mock Node",
      hostname: "127.0.0.1",
      apiUrl: `http://127.0.0.1:${mockPort}`,
      port: mockPort,
      nodeName: "pve",
      region: "default",
      authTokenId: "root@pam!token",
      authTokenSecret: "secret",
      allowInsecureTls: true,
    };

    mockStatusCode = 501;
    mockResponseHeaders = {
      "Content-Type": "text/html",
      "server": "nginx/1.24.0",
      "via": "1.1 reverse-proxy.internal",
    };
    mockResponseBody = "<html><head><title>501 Not Implemented</title></head></html>";

    await assert.rejects(
      async () => ProxmoxService.createLxcTermProxy(nodeConfig, 101),
      (err: any) => {
        assert.ok(err instanceof ProxmoxRequestError);
        assert.equal(err.classification, "REVERSE_PROXY_501");
        assert.equal(err.proxyDetected, true);
        assert.equal(err.proxyType, "reverse_proxy");
        return true;
      }
    );
  });

  it("should reject termproxy response with missing port or empty ticket as TERM_PROXY_INVALID_RESPONSE", async () => {
    const nodeConfig: ProxmoxNodeConfig = {
      id: NODE_ID,
      name: "Mock Node",
      hostname: "127.0.0.1",
      apiUrl: `http://127.0.0.1:${mockPort}`,
      port: mockPort,
      nodeName: "pve",
      region: "default",
      authTokenId: "root@pam!token",
      authTokenSecret: "secret",
      allowInsecureTls: true,
    };

    mockStatusCode = 200;
    mockResponseBody = { data: { port: 0, ticket: "" } };

    await assert.rejects(
      async () => ProxmoxService.createLxcTermProxy(nodeConfig, 101),
      (err: any) => {
        assert.ok(err instanceof ProxmoxRequestError);
        assert.equal(err.classification, "TERM_PROXY_INVALID_RESPONSE");
        return true;
      }
    );
  });

  // --------------------------------------------------------------------------
  // PART 3: Server-side Direct Diagnostic: testTermProxy
  // --------------------------------------------------------------------------
  it("should return safe diagnostic results from testTermProxy without credential leakage", async () => {
    const nodeConfig: ProxmoxNodeConfig = {
      id: NODE_ID,
      name: "Mock Node",
      hostname: "127.0.0.1",
      apiUrl: `http://127.0.0.1:${mockPort}`,
      port: mockPort,
      nodeName: "pve",
      region: "default",
      authTokenId: "root@pam!token",
      authTokenSecret: "super-secret-token",
      allowInsecureTls: true,
    };

    mockStatusCode = 501;
    mockResponseHeaders = {
      "Content-Type": "text/html",
      "server": "cloudflare",
      "cf-ray": "cf-ray-12345",
    };
    mockResponseBody = "<html><body>501 Not Implemented</body></html>";

    const diag = await ProxmoxService.testTermProxy(nodeConfig, 101);

    assert.equal(diag.ok, false);
    assert.equal(diag.statusCode, 501);
    assert.equal(diag.classification, "CLOUDFLARE_501");
    assert.equal(diag.proxied, true);
    assert.equal(diag.proxyType, "cloudflare");
    assert.ok(diag.recommendedFix?.includes("disableChunkedEncoding: true"));

    // Crucial: Zero secrets leakage check
    const serialized = JSON.stringify(diag);
    assert.ok(!serialized.includes("super-secret-token"), "Must never leak token secret");
    assert.ok(!serialized.includes("PVEAPIToken"), "Must never leak authorization header");
  });

  // --------------------------------------------------------------------------
  // PART 4: API Endpoints & Authorization
  // --------------------------------------------------------------------------
  it("should allow owner to access GET /api/vps/:id/console/diagnostic with safe summary", async () => {
    mockStatusCode = 200;
    mockResponseBody = { data: { port: 5900, ticket: "valid-ticket", upid: "UPID:123", user: "root@pam" } };

    const res = await fetchApi(`/api/vps/${VPS_A_ID}/console/diagnostic`, SESSION_USER_A);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.message, "Console service is operational.");
    // Normal user does not get internal endpoint or token
    assert.equal(data.endpoint, undefined);
  });

  it("should deny non-owner with 403 on GET /api/vps/:id/console/diagnostic", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/console/diagnostic`, SESSION_USER_B);
    assert.equal(res.status, 403);
  });

  it("should allow admin to access GET /api/vps/:id/console/diagnostic with full technical details", async () => {
    mockStatusCode = 200;
    mockResponseBody = { data: { port: 5900, ticket: "valid-ticket", upid: "UPID:123", user: "root@pam" } };

    const res = await fetchApi(`/api/vps/${VPS_A_ID}/console/diagnostic`, SESSION_ADMIN);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(data.endpoint !== undefined, "Admin gets endpoint info");
    assert.ok(data.latencyMs !== undefined, "Admin gets latencyMs");
    assert.ok(data.proxyType !== undefined, "Admin gets proxyType");
  });

  it("should allow owner to fetch reinstall capabilities via GET /api/vps/:id/reinstall/capabilities", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/reinstall/capabilities`, SESSION_USER_A);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.templates));
    assert.ok(data.templates.length > 0);
    assert.ok(data.templates[0].volid.includes("ubuntu-22.04"));
    // Node configuration secrets must NOT be in the response
    assert.equal(data.auth_token_id, undefined);
    assert.equal(data.auth_token_secret, undefined);
  });

  it("should deny other user on GET /api/vps/:id/reinstall/capabilities with 403", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/reinstall/capabilities`, SESSION_USER_B);
    assert.equal(res.status, 403);
  });
});
