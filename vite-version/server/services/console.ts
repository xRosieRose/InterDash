/**
 * InterDash Server — Real LXC Interactive Terminal Console Service
 *
 * Implements a secure WebSocket proxy bridging the browser's ANSI terminal
 * directly to the Proxmox VE hypervisor termproxy without exposing hypervisor credentials.
 *
 * Architecture:
 *   Browser (xterm.js)
 *       ↓ WebSocket (authenticated session cookie)
 *   InterDash Backend (/api/vps/:id/console/ws)
 *       ↓ Server-side ownership / admin check
 *       ↓ Authoritative runtime node discovery
 *       ↓ LXC runtime state check (running / stopped / locked)
 *       ↓ Proxmox API: POST /nodes/{node}/lxc/{vmid}/termproxy
 *       ↓ Upstream WebSocket (wss://.../vncwebsocket?port=...&vncticket=...)
 *       ↓ Upstream HTTP 101 Switching Protocols validation
 *       ↓ Protocol handshake: <user>:<ticket>\n
 *       ↓ Handshake response validation: "OK"
 *       ↓ Application protocol framing: 0:<byteLength>:<data>, 1:<cols>:<rows>:, 2 (ping)
 *   Real Proxmox LXC Container Shell
 *
 * Security:
 *   - Proxmox API token and termproxy tickets never reach the browser.
 *   - Ownership or admin authorization is strictly verified on upgrade.
 *   - Idle timeout of 15 minutes prevents lingering sessions.
 *   - Terminal contents and credentials are NEVER logged or stored.
 *   - Audit logs capture session open and close events with timestamps.
 */

import type { IncomingMessage, Server } from "node:http";
import { URL } from "node:url";
import { randomUUID } from "node:crypto";
import https from "node:https";
import { WebSocketServer, WebSocket } from "ws";
import { queryOne, execute } from "../db/index.js";
import { hashToken } from "../middleware/auth.js";
import {
  ProxmoxService,
  resolveProxmoxEndpoint,
  ProxmoxRequestError,
  buildTermproxyInputFrame,
  buildTermproxyResizeFrame,
  buildTermproxyKeepaliveFrame,
  parseTermproxyResponse,
  classifyConsoleUpgradeError,
  type ProxmoxErrorClassification,
} from "./proxmox.js";
import { ProvisioningService } from "./provisioning.js";
import { VpsExpiryService } from "./vps-expiry.js";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const HANDSHAKE_TIMEOUT_MS = 10 * 1000; // 10 seconds
const KEEPALIVE_INTERVAL_MS = 30 * 1000; // 30 seconds

export type ConsoleState =
  | "idle"
  | "connecting"
  | "connecting_gateway"
  | "gateway_connected"
  | "checking_runtime"
  | "checking_vps"
  | "requesting_termproxy"
  | "termproxy_ready"
  | "connecting_upstream"
  | "upstream_connected"
  | "handshaking"
  | "connected"
  | "failed"
  | "disconnected"
  | "stopped"
  | "busy";

export type ConsoleFailureStage =
  | "gateway"
  | "authorization"
  | "runtime_resolution"
  | "termproxy"
  | "upstream_connect"
  | "upstream_upgrade"
  | "terminal_handshake"
  | "stream";

export interface ConsoleControlMessage {
  type: "status" | "error" | "data";
  state?: ConsoleState;
  stage?: ConsoleFailureStage;
  message?: string;
  code?: string;
  httpStatus?: number;
  websocketCode?: number;
  retryable?: boolean;
  sessionId?: string;
  diagnosticId?: string;
  details?: Record<string, unknown>;
}

export function setupConsoleWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req: IncomingMessage, socket, head) => {
    try {
      const parsedUrl = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
      const pathname = parsedUrl.pathname;

      // Check path format: /api/vps/:id/console/ws
      const match = pathname.match(/^\/api\/vps\/([a-zA-Z0-9_-]+)\/console\/ws\/?$/);
      if (!match) {
        // Not a VPS console WebSocket route; ignore so other handlers can process if any
        return;
      }

      const vpsId = match[1];

      // 1. Authenticate session via HTTP-only cookie
      const rawCookie = req.headers.cookie || "";
      const sessionMatch = rawCookie.match(/(?:^|;\s*)interdash_session=([^;]+)/);
      if (!sessionMatch) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const sessionToken = decodeURIComponent(sessionMatch[1]);
      const tokenHash = hashToken(sessionToken);

      const user = queryOne<any>(
        `SELECT u.id, u.username, u.role, u.status
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.status = 'active'
         LIMIT 1`,
        [tokenHash]
      );

      if (!user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // 2. Authorize VPS ownership or admin role
      const vps = queryOne<any>(
        `SELECT id, owner_user_id, proxmox_node_id, proxmox_vmid, status, hostname, expires_at
         FROM vps
         WHERE id = ? LIMIT 1`,
        [vpsId]
      );

      if (!vps) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      if (vps.owner_user_id !== user.id && user.role !== "admin") {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      // Check VPS expiration: expired VPS cannot open interactive console
      if (VpsExpiryService.isExpired(vps.expires_at)) {
        socket.write("HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nVPS instance has expired.\r\n");
        socket.destroy();
        return;
      }

      // 3. Resolve Proxmox node configuration
      const node = ProvisioningService.getNodeConfig(vps.proxmox_node_id);
      if (!node) {
        socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        socket.destroy();
        return;
      }

      // 4. Upgrade client connection
      wss.handleUpgrade(req, socket, head, async (clientWs) => {
        const sessionId = `console_${randomUUID()}`;
        let idleTimer: NodeJS.Timeout | null = null;
        let keepaliveTimer: NodeJS.Timeout | null = null;
        let handshakeTimer: NodeJS.Timeout | null = null;
        let clientPingTimer: NodeJS.Timeout | null = null;
        let clientIsAlive = true;
        let upstreamWs: WebSocket | null = null;
        let isConnected = false;
        let isTermproxyHandshaking = false;
        let pendingResize: { cols: number; rows: number } | null = null;
        let isCleanedUp = false;

        const log = (stage: string, message: string, meta?: Record<string, unknown>) => {
          const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
          console.log(`[${sessionId}] [VPS ${vpsId}] [${stage}] ${message}${metaStr}`);
        };

        const sendControl = (msg: ConsoleControlMessage) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(
              JSON.stringify({
                sessionId,
                ...msg,
              })
            );
          }
        };

        // RFC 6455 compliant client close helper: NEVER sends reserved code 1006
        const safeCloseClient = (code = 1000, reason?: string) => {
          if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
            // RFC 6455 status code safety: 1006 must NEVER be sent as a close frame code
            let validCode = code;
            if (validCode === 1006 || validCode < 1000 || validCode > 4999) {
              validCode = 1011; // Internal error
            }

            // Reason string must not exceed 123 UTF-8 bytes
            let safeReason = reason;
            if (safeReason && Buffer.byteLength(safeReason, "utf8") > 120) {
              safeReason = safeReason.slice(0, 115) + "...";
            }

            try {
              clientWs.close(validCode, safeReason);
            } catch (closeErr) {
              try {
                clientWs.terminate();
              } catch {}
            }
          }
        };

        const resetIdleTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            log("idle", "Session closed due to 15m inactivity timeout.");
            sendControl({
              type: "status",
              state: "disconnected",
              message: "Session closed due to inactivity.",
            });
            safeCloseClient(1000, "Inactivity timeout");
            cleanup();
          }, IDLE_TIMEOUT_MS);
        };

        const cleanup = () => {
          if (isCleanedUp) return;
          isCleanedUp = true;

          if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
          }
          if (keepaliveTimer) {
            clearInterval(keepaliveTimer);
            keepaliveTimer = null;
          }
          if (handshakeTimer) {
            clearTimeout(handshakeTimer);
            handshakeTimer = null;
          }
          if (clientPingTimer) {
            clearInterval(clientPingTimer);
            clientPingTimer = null;
          }

          if (upstreamWs) {
            try {
              // Attach noop error handler so closing a CONNECTING socket does not emit uncaughtException
              upstreamWs.on("error", () => {});
              if (
                upstreamWs.readyState === WebSocket.OPEN ||
                upstreamWs.readyState === WebSocket.CONNECTING
              ) {
                upstreamWs.close(1000, "Client session terminated");
              }
            } catch {}
            upstreamWs = null;
          }

          // Audit log console closed
          execute(
            `INSERT INTO audit_logs (user_id, event_type, metadata)
             VALUES (?, 'vps_console_closed', ?)`,
            [user.id, JSON.stringify({ vps_id: vpsId, vmid: vps.proxmox_vmid, session_id: sessionId })]
          );
        };

        resetIdleTimer();

        // Heartbeat to keep browser WebSocket alive across tab switches and proxies
        clientWs.on("pong", () => {
          clientIsAlive = true;
        });

        clientPingTimer = setInterval(() => {
          if (clientWs.readyState === WebSocket.OPEN) {
            if (!clientIsAlive) {
              log("client", "Client ping heartbeat missed, terminating.");
              clientWs.terminate();
              return;
            }
            clientIsAlive = false;
            try {
              clientWs.ping();
            } catch {}
          }
        }, 15000);

        // Audit log console opened
        execute(
          `INSERT INTO audit_logs (user_id, event_type, metadata)
           VALUES (?, 'vps_console_opened', ?)`,
          [user.id, JSON.stringify({ vps_id: vpsId, vmid: vps.proxmox_vmid, session_id: sessionId })]
        );

        log("gateway", "InterDash console gateway connected.");

        try {
          // STEP 1: Authoritative Runtime Target Resolution & Live State Check
          sendControl({
            type: "status",
            state: "checking_runtime",
            stage: "runtime_resolution",
            message: "Checking VPS runtime state...",
          });

          const runtimeTarget = await ProxmoxService.resolveLxcRuntimeTarget(node, vps.proxmox_vmid);
          if (!runtimeTarget.ok) {
            let code = "UNKNOWN_CONSOLE_FAILURE";
            let msg = "Failed to locate VPS on hypervisor cluster.";
            if (runtimeTarget.reason === "not_found") {
              code = "CONSOLE_LXC_NOT_FOUND";
              msg = `LXC container ${vps.proxmox_vmid} not found on Proxmox cluster.`;
            } else if (
              runtimeTarget.reason === "node_unreachable" ||
              runtimeTarget.reason === "discovery_unavailable"
            ) {
              code = "CONSOLE_NODE_UNREACHABLE";
              msg = `Unable to contact hypervisor node '${node.nodeName}'.`;
            } else if (runtimeTarget.reason === "authorization_failed") {
              code = "TERM_PROXY_AUTH_FAILURE";
              msg =
                runtimeTarget.message ||
                "Proxmox API authorization failed. Check token permissions and ensure Privilege Separation is unchecked in Proxmox.";
            }

            log("runtime_resolution", `Resolution failed: ${code} - ${msg}`);
            sendControl({
              type: "error",
              state: "failed",
              stage: "runtime_resolution",
              code,
              message: msg,
              retryable: false,
            });
            safeCloseClient(1008, msg);
            cleanup();
            return;
          }

          const runtimeNode = runtimeTarget.nodeName;
          log("runtime_resolution", `VPS located on runtime node '${runtimeNode}'`);

          // Query live status on resolved runtime node
          const statusRes = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid, runtimeNode);
          if (!statusRes.ok) {
            log("runtime_check", `Status verification failed: ${statusRes.error}`);
            sendControl({
              type: "error",
              state: "failed",
              stage: "runtime_resolution",
              code: "CONSOLE_NODE_UNREACHABLE",
              message: statusRes.error || "Unable to verify container status on hypervisor.",
              retryable: true,
            });
            safeCloseClient(1011, "Hypervisor status check failed");
            cleanup();
            return;
          }

          if (statusRes.status === "stopped") {
            log("runtime_check", "VPS container is stopped.");
            sendControl({
              type: "error",
              state: "stopped",
              stage: "stream",
              code: "CONSOLE_LXC_STOPPED",
              message: "VPS is stopped. Start it to open the console.",
              retryable: false,
            });
            safeCloseClient(1000, "VPS stopped");
            cleanup();
            return;
          }

          // Check if container is locked by a Proxmox task
          const isLocked = await ProxmoxService.checkLxcLocked(node, vps.proxmox_vmid, runtimeNode);
          if (isLocked.locked) {
            log("runtime_check", `VPS locked by task: ${isLocked.lockName || "busy"}`);
            sendControl({
              type: "error",
              state: "busy",
              stage: "stream",
              code: "CONSOLE_LXC_LOCKED",
              message: `VPS is currently locked by a Proxmox background operation (${isLocked.lockName || "busy"}).`,
              retryable: true,
            });
            safeCloseClient(1000, "VPS locked");
            cleanup();
            return;
          }

          // STEP 2: Request termproxy ticket targeting authoritative runtimeNode
          sendControl({
            type: "status",
            state: "requesting_termproxy",
            stage: "termproxy",
            message: "Requesting Proxmox terminal proxy...",
          });

          const termproxy = await ProxmoxService.createLxcTermProxy(node, vps.proxmox_vmid, runtimeNode);
          log("termproxy", `Termproxy allocated port ${termproxy.port} for user '${termproxy.user}'`);

          sendControl({
            type: "status",
            state: "termproxy_ready",
            stage: "termproxy",
            message: "Termproxy ticket acquired.",
          });

          // STEP 3: Connect upstream WebSocket to Proxmox VE targeting runtimeNode
          sendControl({
            type: "status",
            state: "connecting_upstream",
            stage: "upstream_connect",
            message: "Connecting terminal stream to hypervisor...",
          });

          const endpoint = resolveProxmoxEndpoint(node.apiUrl, node.hostname, node.port);
          const wsProtocol = endpoint.isHttps ? "wss" : "ws";
          const wsPort =
            (endpoint.isHttps && endpoint.port === 443) || (!endpoint.isHttps && endpoint.port === 80)
              ? ""
              : `:${endpoint.port}`;
          const cleanBase = `${wsProtocol}://${endpoint.hostname}${wsPort}${endpoint.pathname}`;
          const upstreamUrl = `${cleanBase}/api2/json/nodes/${encodeURIComponent(
            runtimeNode
          )}/lxc/${vps.proxmox_vmid}/vncwebsocket?port=${termproxy.port}&vncticket=${encodeURIComponent(
            termproxy.ticket
          )}`;

          log("upstream_connect", `Connecting to upstream vncwebsocket [target=${endpoint.displayTarget}]`);

          const agent = endpoint.isHttps
            ? new https.Agent({
                rejectUnauthorized: !node.allowInsecureTls,
              })
            : undefined;

          // Proxmox vncwebsocket requires the 'binary' subprotocol
          upstreamWs = new WebSocket(upstreamUrl, ["binary"], {
            agent,
            rejectUnauthorized: !node.allowInsecureTls,
            headers: {
              Authorization: `PVEAPIToken=${node.authTokenId}=${node.authTokenSecret}`,
              "User-Agent": "InterDash-Console/1.0",
            },
            handshakeTimeout: 15000,
          });

          // Handle upstream HTTP response other than 101 Switching Protocols
          upstreamWs.on("unexpected-response", (_upstreamReq, upstreamRes) => {
            let bodySnippet = "";
            upstreamRes.on("data", (chunk) => {
              if (bodySnippet.length < 500) {
                bodySnippet += chunk.toString("utf8").slice(0, 500 - bodySnippet.length);
              }
            });

            upstreamRes.on("end", () => {
              const classified = classifyConsoleUpgradeError(
                upstreamRes.statusCode,
                upstreamRes.statusMessage,
                upstreamRes.headers as Record<string, string>,
                bodySnippet
              );

              log("upstream_upgrade", `Upgrade rejected with HTTP ${upstreamRes.statusCode} ${upstreamRes.statusMessage}`, {
                classification: classified.code,
              });

              sendControl({
                type: "error",
                state: "failed",
                stage: "upstream_upgrade",
                code: classified.code,
                httpStatus: upstreamRes.statusCode,
                message: classified.message,
                retryable: classified.retryable,
                details: {
                  endpoint: endpoint.displayTarget,
                  recommendedFix: classified.recommendedFix,
                },
              });

              safeCloseClient(
                upstreamRes.statusCode === 401 || upstreamRes.statusCode === 403 ? 1008 : 1011,
                classified.message
              );
              cleanup();
            });
          });

          // Upstream WebSocket reached HTTP 101 Switching Protocols
          upstreamWs.on("open", () => {
            isTermproxyHandshaking = true;
            log("upstream_upgrade", "Upstream WebSocket HTTP 101 Switching Protocols established.");

            sendControl({
              type: "status",
              state: "handshaking",
              stage: "terminal_handshake",
              message: "Performing console handshake with hypervisor...",
            });

            // Initial Proxmox termproxy authentication handshake: <user>:<ticket>\n
            log("terminal_handshake", `Sending termproxy authentication for identity '${termproxy.user}'`);
            upstreamWs?.send(`${termproxy.user}:${termproxy.ticket}\n`);

            // Start 10s handshake timeout
            handshakeTimer = setTimeout(() => {
              if (!isConnected) {
                log("terminal_handshake", "Timed out waiting for Proxmox termproxy handshake acknowledgment ('OK').");
                sendControl({
                  type: "error",
                  state: "failed",
                  stage: "terminal_handshake",
                  code: "TERMPROXY_HANDSHAKE_TIMEOUT",
                  message: "Timed out waiting for Proxmox terminal handshake response ('OK').",
                  retryable: true,
                });
                safeCloseClient(1011, "Handshake timeout");
                cleanup();
              }
            }, HANDSHAKE_TIMEOUT_MS);
          });

          upstreamWs.on("message", (msgData) => {
            resetIdleTimer();

            // Handshake stage: parse termproxy acknowledgment
            if (!isConnected) {
              const parsed = parseTermproxyResponse(msgData as Buffer | string);

              if (parsed.ready) {
                isConnected = true;
                isTermproxyHandshaking = false;

                if (handshakeTimer) {
                  clearTimeout(handshakeTimer);
                  handshakeTimer = null;
                }

                log("terminal_handshake", "Termproxy handshake accepted ('OK'). Interactive terminal ready.");

                sendControl({
                  type: "status",
                  state: "connected",
                  stage: "stream",
                  message: "Terminal connected.",
                });

                // Start keepalive timer: send "2" every 30 seconds according to Proxmox terminal protocol
                keepaliveTimer = setInterval(() => {
                  if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
                    upstreamWs.send(buildTermproxyKeepaliveFrame());
                  }
                }, KEEPALIVE_INTERVAL_MS);

                // Send initial window dimensions to Proxmox
                const initialCols = pendingResize?.cols || 80;
                const initialRows = pendingResize?.rows || 24;
                if (upstreamWs?.readyState === WebSocket.OPEN) {
                  upstreamWs.send(buildTermproxyResizeFrame(initialCols, initialRows));
                }
                pendingResize = null;

                // If initial terminal payload was attached after "OK", forward surviving bytes to browser
                if (
                  parsed.remaining &&
                  parsed.remaining.length > 0 &&
                  clientWs.readyState === WebSocket.OPEN
                ) {
                  clientWs.send(parsed.remaining);
                }

                // Send a wake-up carriage return to dtach/getty so the login prompt is immediately emitted
                setTimeout(() => {
                  if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
                    upstreamWs.send(buildTermproxyInputFrame("\r"));
                  }
                }, 100);
                return;
              } else {
                // Pre-OK payload was malformed or rejected
                log(
                  "terminal_handshake",
                  `Termproxy rejected authentication or sent invalid initial frame: '${parsed.rawText.slice(0, 100)}'`
                );

                sendControl({
                  type: "error",
                  state: "failed",
                  stage: "terminal_handshake",
                  code: "TERMPROXY_HANDSHAKE_REJECTED",
                  message:
                    "Proxmox termproxy rejected authentication handshake. Verify that API Token has VM.Console permissions and Privilege Separation is unchecked in Proxmox Datacenter settings.",
                  retryable: false,
                  details: {
                    endpoint: endpoint.displayTarget,
                    safeSnippet: parsed.rawText.slice(0, 100),
                  },
                });

                safeCloseClient(1008, "Termproxy handshake rejected");
                cleanup();
                return;
              }
            }

            // Normal connected terminal output: stream to browser
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(msgData);
            }
          });

          upstreamWs.on("error", (err) => {
            log("upstream_connect", `Upstream Proxmox WS error: ${err.message}`, {
              endpoint: endpoint.displayTarget,
            });

            if (!isConnected) {
              sendControl({
                type: "error",
                state: "failed",
                stage: isTermproxyHandshaking ? "terminal_handshake" : "upstream_connect",
                code: "WEBSOCKET_CONNECTION_FAILURE",
                message: `Hypervisor console stream error: ${err.message}`,
                retryable: true,
                details: {
                  endpoint: endpoint.displayTarget,
                },
              });
              safeCloseClient(1011, "Upstream connection error");
            }
            cleanup();
          });

          upstreamWs.on("close", (code, reason) => {
            const reasonStr = reason?.toString() || "";
            log("upstream", `Upstream Proxmox WS closed with code ${code} (${reasonStr})`);

            if (!isConnected) {
              let stage: ConsoleFailureStage = "upstream_connect";
              let codeName = "UPSTREAM_WEBSOCKET_CLOSED_EARLY";
              let msg = `Upstream console connection closed before session was established (code ${code}).`;

              if (isTermproxyHandshaking) {
                stage = "terminal_handshake";
                codeName = "TERMPROXY_HANDSHAKE_REJECTED";
                msg =
                  "Proxmox termproxy closed connection during authentication handshake. Verify that API Token has VM.Console permissions and Privilege Separation is unchecked in Proxmox.";
              }

              sendControl({
                type: "error",
                state: "failed",
                stage,
                code: codeName,
                websocketCode: code,
                message: msg,
                retryable: false,
                details: {
                  endpoint: endpoint.displayTarget,
                  runtimeNode,
                },
              });
              safeCloseClient(1011, msg);
            } else {
              sendControl({
                type: "status",
                state: "disconnected",
                stage: "stream",
                message: "Terminal session closed by hypervisor.",
              });
              safeCloseClient(1000, "Session closed");
            }
            cleanup();
          });

          // Browser -> InterDash gateway handling
          clientWs.on("message", (data) => {
            resetIdleTimer();

            const str = typeof data === "string" ? data : data.toString("utf8");

            // Handle client window resize messages:
            // 1. Proxmox native format: 1:<cols>:<rows>:
            // 2. InterDash JSON format: { type: "resize", cols: N, rows: N }
            if (str.startsWith("1:") && str.endsWith(":")) {
              if (isConnected && upstreamWs?.readyState === WebSocket.OPEN) {
                upstreamWs.send(str);
              }
              return;
            }

            if (str.startsWith("{")) {
              try {
                const parsed = JSON.parse(str);
                if (parsed.type === "ping") {
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
                  }
                  return;
                }
                if (
                  parsed.type === "resize" &&
                  typeof parsed.cols === "number" &&
                  typeof parsed.rows === "number"
                ) {
                  if (isConnected && upstreamWs?.readyState === WebSocket.OPEN) {
                    upstreamWs.send(buildTermproxyResizeFrame(parsed.cols, parsed.rows));
                  } else {
                    pendingResize = { cols: parsed.cols, rows: parsed.rows };
                  }
                  return;
                }
              } catch {}
            }

            // Normal interactive keystrokes / terminal data
            if (isConnected && upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
              // If already formatted with termproxy application protocol:
              if (/^0:\d+:/.test(str) || str === "2") {
                upstreamWs.send(data);
              } else {
                // Frame raw user input as 0:<byteLength>:<data> with exact UTF-8 byte length
                const framed = buildTermproxyInputFrame(data as Buffer | string);
                upstreamWs.send(framed);
              }
            }
          });

          clientWs.on("close", () => {
            log("client", "Browser terminal client disconnected.");
            cleanup();
          });

          clientWs.on("error", (err) => {
            log("client", `Browser terminal client socket error: ${err.message}`);
            cleanup();
          });
        } catch (err: unknown) {
          const endpoint = resolveProxmoxEndpoint(node.apiUrl, node.hostname, node.port);
          let code: ProxmoxErrorClassification = "UNKNOWN_CONSOLE_FAILURE";
          let stage: ConsoleFailureStage = "stream";
          let details: Record<string, unknown> | undefined;

          if (err instanceof ProxmoxRequestError) {
            code = err.classification;
            stage = "termproxy";
            details = {
              statusCode: err.statusCode,
              proxyDetected: err.proxyDetected,
              proxyType: err.proxyType,
              safeBodySnippet: err.safeBodySnippet,
              endpoint: endpoint.displayTarget,
            };
          }

          const msg = err instanceof Error ? err.message : String(err);
          log("failure", `Exception during console setup: ${code} - ${msg}`, details);

          sendControl({
            type: "error",
            state: "failed",
            stage,
            code,
            message: msg,
            details,
          });

          safeCloseClient(1011, msg);
          cleanup();
        }
      });
    } catch (err) {
      console.error("[CONSOLE] Unexpected error handling upgrade:", err);
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    }
  });

  return wss;
}
