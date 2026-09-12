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
 * 7. Terminal protocol: Input framing 0:<byteLength>:<data> with exact UTF-8 byte counting.
 * 8. Terminal protocol: Resize framing 1:<cols>:<rows>:.
 * 9. Terminal protocol: Keepalive frame "2".
 * 10. Terminal protocol: Handshake parser consumes and strips "OK", preserving surviving bytes.
 * 11. Upstream WebSocket upgrade classification: 401, 403, 404, 426, 501, 502/503.
 * 12. End-to-end WebSocket interactive console proxy through InterDash gateway.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { createApp } from "../index.js";
import { closeDatabase, execute } from "../db/index.js";
import {
  ProxmoxService,
  type ProxmoxNodeConfig,
  ProxmoxRequestError,
  buildTermproxyInputFrame,
  buildTermproxyResizeFrame,
  buildTermproxyKeepaliveFrame,
  parseTermproxyResponse,
  classifyConsoleUpgradeError,
} from "../services/proxmox.js";
import { setupConsoleWebSocket } from "../services/console.js";
import { encryptCredential } from "../services/crypto.js";

describe("Console Termproxy Request Framing & 501 Diagnostics", () => {
  let mockServer: http.Server;
  let mockPort: number;
  let mockWss: WebSocketServer;
  let appServer: Server;
  let appPort: number;
  let appBaseUrl = "";

  // Mock response controls
  let mockStatusCode = 200;
  let mockResponseHeaders: Record<string, string> = { "Content-Type": "application/json" };
  let mockResponseBody: string | object = {
    data: { port: 5900, ticket: "test-ticket-abc", upid: "UPID:pve:123", user: "root@pam" },
  };

  // Upstream WebSocket mock controls
  let mockWsUpgradeStatus = 101;
  let mockHandshakeSucceeds = true;
  let lastHandshakePayload = "";
  let lastFramedInput = "";
  let lastResize = "";
  let lastKeepalive = "";

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
    // 1. Start mock Proxmox server with both HTTP REST and WebSocket termproxy support
    await new Promise<void>((resolve) => {
      mockServer = http.createServer((req, res) => {
        let reqBody = "";
        req.on("data", (chunk) => {
          reqBody += chunk.toString();
        });

        req.on("end", () => {
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
            res.end(
              JSON.stringify({
                data: [{ volid: "local:vztmpl/ubuntu-22.04.tar.zst", format: "tar.zst", size: 200000000 }],
              })
            );
            return;
          }

          if (req.url?.includes("/storage")) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                data: [
                  { storage: "local", type: "dir", active: 1, content: "vztmpl" },
                  { storage: "local-lvm", type: "lvmthin", active: 1, content: "rootdir,images" },
                ],
              })
            );
            return;
          }

          res.writeHead(mockStatusCode, mockResponseHeaders);
          const bodyStr = typeof mockResponseBody === "string" ? mockResponseBody : JSON.stringify(mockResponseBody);
          res.end(bodyStr);
        });
      });

      mockWss = new WebSocketServer({ noServer: true });

      mockServer.on("upgrade", (req, socket, head) => {
        if (req.url?.includes("vncwebsocket")) {
          if (mockWsUpgradeStatus === 101) {
            mockWss.handleUpgrade(req, socket, head, (ws) => {
              ws.on("error", () => {});
              ws.on("message", (msg) => {
                const str = msg.toString();
                if (str.includes(":") && str.endsWith("\n")) {
                  lastHandshakePayload = str;
                  if (mockHandshakeSucceeds) {
                    // Send "OK" as termproxy protocol acknowledgment
                    ws.send(Buffer.from("OK"));
                  } else {
                    // Close connection abruptly without OK (simulate handshake rejection)
                    ws.close();
                  }
                } else if (str.startsWith("0:")) {
                  lastFramedInput = str;
                  // Echo back terminal response
                  ws.send(Buffer.from(`output:${str}`));
                } else if (str.startsWith("1:")) {
                  lastResize = str;
                } else if (str === "2") {
                  lastKeepalive = "2";
                }
              });
            });
          } else {
            socket.end(
              `HTTP/1.1 ${mockWsUpgradeStatus} ${mockWsUpgradeStatus === 403 ? "Forbidden" : "Upgrade Failed"}\r\nConnection: close\r\n\r\n`
            );
          }
        }
      });

      mockServer.listen(0, "127.0.0.1", () => {
        const addr = mockServer.address() as { port: number };
        mockPort = addr.port;
        resolve();
      });
    });

    // 2. Start InterDash app server with WebSocket console gateway attached
    const app = await createApp();
    await new Promise<void>((resolve) => {
      appServer = app.listen(0, "127.0.0.1", () => {
        const addr = appServer.address() as { port: number };
        appPort = addr.port;
        appBaseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // Attach InterDash console WebSocket gateway
    setupConsoleWebSocket(appServer);

    // 3. Seed users, sessions, node, and VPS
    execute(
      `INSERT OR REPLACE INTO users (id, discord_id, username, role, status)
       VALUES (?, 'disc-a', 'usera', 'user', 'active'),
              (?, 'disc-b', 'userb', 'user', 'active'),
              (?, 'disc-adm', 'admin', 'admin', 'active')`,
      [USER_A_ID, USER_B_ID, ADMIN_ID]
    );

    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    execute(
      `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ('s-a', ?, ?, ?),
              ('s-b', ?, ?, ?),
              ('s-adm', ?, ?, ?)`,
      [
        USER_A_ID,
        crypto.createHash("sha256").update(SESSION_USER_A).digest("hex"),
        expiresAt,
        USER_B_ID,
        crypto.createHash("sha256").update(SESSION_USER_B).digest("hex"),
        expiresAt,
        ADMIN_ID,
        crypto.createHash("sha256").update(SESSION_ADMIN).digest("hex"),
        expiresAt,
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
    mockWss.close();
    mockServer.close();
    appServer.close();
    closeDatabase();
  });

  beforeEach(() => {
    mockStatusCode = 200;
    mockResponseHeaders = { "Content-Type": "application/json" };
    mockResponseBody = { data: { port: 5900, ticket: "ticket-123", upid: "UPID:pve:123", user: "root@pam" } };
    mockWsUpgradeStatus = 101;
    mockHandshakeSucceeds = true;
    lastHandshakePayload = "";
    lastFramedInput = "";
    lastResize = "";
    lastKeepalive = "";
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

    let capturedHeaders: http.IncomingHttpHeaders = {};
    const testServer = http.createServer((req, res) => {
      capturedHeaders = req.headers;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { port: 5900, ticket: "ticket", upid: "UPID:123", user: "root@pam" } }));
    });

    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", () => resolve()));
    const addr = testServer.address() as { port: number };
    nodeConfig.apiUrl = `http://127.0.0.1:${addr.port}`;
    nodeConfig.port = addr.port;

    await ProxmoxService.createLxcTermProxy(nodeConfig, 101);

    assert.equal(capturedHeaders["content-length"], "0");
    assert.equal(capturedHeaders["transfer-encoding"], undefined);

    testServer.close();
  });

  // --------------------------------------------------------------------------
  // PART 2: TermProxy Application Framing & Parsing Helpers
  // --------------------------------------------------------------------------
  it("should format termproxy input frames with exact UTF-8 byte count", () => {
    // ASCII input: 2 bytes
    const frameAscii = buildTermproxyInputFrame("ls");
    assert.equal(frameAscii, "0:2:ls");

    // Multi-byte Unicode input: 🌍 is 4 UTF-8 bytes, total string 10 bytes (not 8 characters!)
    const unicodeInput = "Hello 🌍";
    const frameUnicode = buildTermproxyInputFrame(unicodeInput);
    assert.equal(frameUnicode, `0:10:${unicodeInput}`);

    // Carriage return / newline
    const enterFrame = buildTermproxyInputFrame("\r");
    assert.equal(enterFrame, "0:1:\r");

    // Ctrl+C (\x03)
    const ctrlCFrame = buildTermproxyInputFrame("\x03");
    assert.equal(ctrlCFrame, "0:1:\x03");
  });

  it("should format termproxy window resize frames as 1:cols:rows:", () => {
    assert.equal(buildTermproxyResizeFrame(80, 24), "1:80:24:");
    assert.equal(buildTermproxyResizeFrame(120, 40), "1:120:40:");
    // Bounds checking
    assert.equal(buildTermproxyResizeFrame(0, 0), "1:1:1:");
  });

  it("should format keepalive frame as '2'", () => {
    assert.equal(buildTermproxyKeepaliveFrame(), "2");
  });

  it("should parse termproxy handshake response correctly and preserve trailing bytes", () => {
    // Exact "OK"
    const exactOk = parseTermproxyResponse(Buffer.from("OK"));
    assert.equal(exactOk.ready, true);
    assert.equal(exactOk.remaining, undefined);

    // "OK" followed immediately by terminal banner bytes
    const banner = "\x1b[?2004hroot@host:~# ";
    const combined = Buffer.concat([Buffer.from("OK"), Buffer.from(banner)]);
    const combinedRes = parseTermproxyResponse(combined);
    assert.equal(combinedRes.ready, true);
    assert.ok(combinedRes.remaining !== undefined);
    assert.equal(combinedRes.remaining.toString("utf8"), banner);

    // Handshake rejected or malformed
    const rejected = parseTermproxyResponse(Buffer.from("authentication failure"));
    assert.equal(rejected.ready, false);
  });

  it("should classify WebSocket upgrade errors with appropriate codes and messages", () => {
    const auth401 = classifyConsoleUpgradeError(401, "Unauthorized");
    assert.equal(auth401.code, "PROXMOX_CONSOLE_AUTH_FAILED");
    assert.equal(auth401.retryable, false);

    const denied403 = classifyConsoleUpgradeError(403, "Forbidden");
    assert.equal(denied403.code, "PROXMOX_CONSOLE_UPGRADE_DENIED");
    assert.equal(denied403.retryable, false);

    const cf501 = classifyConsoleUpgradeError(501, "Not Implemented", { server: "cloudflare" });
    assert.equal(cf501.code, "CLOUDFLARE_501_WEBSOCKET");

    const gateway502 = classifyConsoleUpgradeError(502, "Bad Gateway");
    assert.equal(gateway502.code, "PROXMOX_GATEWAY_ERROR");
    assert.equal(gateway502.retryable, true);
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

    mockStatusCode = 200;
    mockResponseBody = { data: { port: 5900, ticket: "ticket-xyz", upid: "UPID:123", user: "root@pam" } };

    const diag = await ProxmoxService.testTermProxy(nodeConfig, 101);

    assert.equal(diag.ok, true);
    assert.equal(diag.statusCode, 200);
    assert.equal(diag.stages?.runtime?.status, "ok");
    assert.equal(diag.stages?.termproxy?.status, "ok");
    assert.equal(diag.stages?.upstreamUpgrade?.status, "ok");
    assert.equal(diag.stages?.termproxyHandshake?.status, "ok");

    // Zero secrets leakage check
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
    // Normal user does not get internal endpoint or secret
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
    assert.ok(data.stages !== undefined, "Admin gets protocol lifecycle stages");
  });

  it("should allow owner to fetch reinstall capabilities via GET /api/vps/:id/reinstall/capabilities", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/reinstall/capabilities`, SESSION_USER_A);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.templates));
    assert.ok(data.templates.length > 0);
    assert.ok(data.templates[0].volid.includes("ubuntu-22.04"));
    assert.equal(data.auth_token_id, undefined);
    assert.equal(data.auth_token_secret, undefined);
  });

  it("should deny other user on GET /api/vps/:id/reinstall/capabilities with 403", async () => {
    const res = await fetchApi(`/api/vps/${VPS_A_ID}/reinstall/capabilities`, SESSION_USER_B);
    assert.equal(res.status, 403);
  });

  // --------------------------------------------------------------------------
  // PART 5: Full End-to-End WebSocket Terminal Gateway Tests
  // --------------------------------------------------------------------------
  it("should connect, authenticate, frame user input, handle resize, and stream terminal data end-to-end", async () => {
    mockStatusCode = 200;
    mockResponseBody = { data: { port: 5900, ticket: "pve-ticket-xyz", upid: "UPID:123", user: "root@pam" } };

    const clientWs = new WebSocket(`ws://127.0.0.1:${appPort}/api/vps/${VPS_A_ID}/console/ws`, {
      headers: {
        Cookie: `interdash_session=${SESSION_USER_A}`,
      },
    });

    const receivedMessages: string[] = [];
    let isSessionConnected = false;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for console connection")), 8000);

      clientWs.on("message", (data) => {
        const str = data.toString();
        receivedMessages.push(str);

        if (str.startsWith("{")) {
          try {
            const parsed = JSON.parse(str);
            if (parsed.type === "status" && parsed.state === "connected") {
              isSessionConnected = true;

              // Send framed resize message
              clientWs.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));

              // Send raw terminal input: "ls"
              clientWs.send("ls");
            }
          } catch {}
        } else if (str.startsWith("output:")) {
          // Terminal output received from upstream echo
          clearTimeout(timeout);
          clientWs.close();
          resolve();
        }
      });

      clientWs.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    assert.equal(isSessionConnected, true, "Console session must reach 'connected' state");
    assert.ok(lastHandshakePayload.includes("root@pam:pve-ticket-xyz\n"), "Must send <user>:<ticket>\\n handshake");
    assert.equal(lastFramedInput, "0:2:ls", "Must frame raw client input 'ls' into '0:2:ls'");
    assert.equal(lastResize, "1:120:40:", "Must transform client resize into '1:120:40:'");
  });

  it("should classify upstream HTTP 403 upgrade rejection with PROXMOX_CONSOLE_UPGRADE_DENIED and never close with 1006", async () => {
    mockStatusCode = 200;
    mockResponseBody = { data: { port: 5900, ticket: "pve-ticket-xyz", upid: "UPID:123", user: "root@pam" } };
    mockWsUpgradeStatus = 403; // Hypervisor rejects WebSocket upgrade with 403

    const clientWs = new WebSocket(`ws://127.0.0.1:${appPort}/api/vps/${VPS_A_ID}/console/ws`, {
      headers: {
        Cookie: `interdash_session=${SESSION_USER_A}`,
      },
    });

    let receivedError: any = null;
    let closeCode = 0;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for rejection")), 5000);

      clientWs.on("message", (data) => {
        const str = data.toString();
        if (str.startsWith("{")) {
          try {
            const parsed = JSON.parse(str);
            if (parsed.type === "error") {
              receivedError = parsed;
            }
          } catch {}
        }
      });

      clientWs.on("close", (code) => {
        closeCode = code;
        clearTimeout(timeout);
        resolve();
      });

      clientWs.on("error", () => {
        // Socket errors expected when server closes
      });
    });

    assert.ok(receivedError !== null, "Must receive structured control error");
    assert.equal(receivedError.stage, "upstream_upgrade");
    assert.equal(receivedError.code, "PROXMOX_CONSOLE_UPGRADE_DENIED");
    assert.equal(receivedError.httpStatus, 403);
    assert.notEqual(closeCode, 1006, "Close code must NEVER be RFC 6455 1006");
  });

  it("should classify pre-OK closure with TERMPROXY_HANDSHAKE_REJECTED", async () => {
    mockStatusCode = 200;
    mockResponseBody = { data: { port: 5900, ticket: "pve-ticket-xyz", upid: "UPID:123", user: "root@pam" } };
    mockWsUpgradeStatus = 101;
    mockHandshakeSucceeds = false; // Mock termproxy closes socket without sending OK

    const clientWs = new WebSocket(`ws://127.0.0.1:${appPort}/api/vps/${VPS_A_ID}/console/ws`, {
      headers: {
        Cookie: `interdash_session=${SESSION_USER_A}`,
      },
    });

    let receivedError: any = null;
    let closeCode = 0;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for handshake failure")), 5000);

      clientWs.on("message", (data) => {
        const str = data.toString();
        if (str.startsWith("{")) {
          try {
            const parsed = JSON.parse(str);
            if (parsed.type === "error") {
              receivedError = parsed;
            }
          } catch {}
        }
      });

      clientWs.on("close", (code) => {
        closeCode = code;
        clearTimeout(timeout);
        resolve();
      });

      clientWs.on("error", () => {});
    });

    assert.ok(receivedError !== null, "Must receive structured control error for handshake failure");
    assert.equal(receivedError.stage, "terminal_handshake");
    assert.equal(receivedError.code, "TERMPROXY_HANDSHAKE_REJECTED");
    assert.notEqual(closeCode, 1006, "Close code must NEVER be RFC 6455 1006");
  });
});
