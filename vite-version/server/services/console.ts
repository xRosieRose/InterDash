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
 *       ↓ LXC runtime state check (running / stopped / locked)
 *       ↓ Proxmox API: POST /nodes/{node}/lxc/{vmid}/termproxy
 *       ↓ Upstream WebSocket (wss://.../vncwebsocket?port=...&vncticket=...)
 *       ↓ Protocol handshake: user:ticket\n
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
import { WebSocketServer, WebSocket } from "ws";
import { queryOne, execute } from "../db/index.js";
import { hashToken } from "../middleware/auth.js";
import {
  ProxmoxService,
  resolveProxmoxEndpoint,
  ProxmoxRequestError,
  type ProxmoxErrorClassification,
} from "./proxmox.js";
import { ProvisioningService } from "./provisioning.js";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export type ConsoleState =
  | "idle"
  | "connecting"
  | "checking_vps"
  | "requesting_termproxy"
  | "termproxy_ready"
  | "connecting_upstream"
  | "handshaking"
  | "connected"
  | "failed"
  | "disconnected"
  | "stopped"
  | "busy";

export interface ConsoleControlMessage {
  type: "status" | "error" | "data";
  state?: ConsoleState;
  message?: string;
  code?: string;
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
        `SELECT id, owner_user_id, proxmox_node_id, proxmox_vmid, status, hostname
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

      // 3. Resolve Proxmox node
      const node = ProvisioningService.getNodeConfig(vps.proxmox_node_id);
      if (!node) {
        socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        socket.destroy();
        return;
      }

      // 4. Upgrade client connection
      wss.handleUpgrade(req, socket, head, async (clientWs) => {
        let idleTimer: NodeJS.Timeout | null = null;
        let upstreamWs: WebSocket | null = null;
        let isConnected = false;

        const sendControl = (msg: ConsoleControlMessage) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify(msg));
          }
        };

        const resetIdleTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            console.log(`[CONSOLE] Session for VPS ${vpsId} closed due to 15m idle timeout.`);
            sendControl({
              type: "status",
              state: "disconnected",
              message: "Session closed due to inactivity.",
            });
            clientWs.close(1000, "Session closed due to inactivity.");
            upstreamWs?.close();
          }, IDLE_TIMEOUT_MS);
        };

        resetIdleTimer();

        // Audit log console opened
        execute(
          `INSERT INTO audit_logs (user_id, event_type, metadata)
           VALUES (?, 'vps_console_opened', ?)`,
          [user.id, JSON.stringify({ vps_id: vpsId, vmid: vps.proxmox_vmid })]
        );

        try {
          // STEP 1: Verify container state
          sendControl({
            type: "status",
            state: "checking_vps",
            message: "Checking container runtime status...",
          });

          let lxcStatus = "unknown";
          try {
            const statusRes = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid);
            lxcStatus = statusRes.status;
          } catch (statusErr: unknown) {
            console.warn(`[CONSOLE] Could not query container status for VPS ${vpsId}:`, statusErr);
          }

          if (lxcStatus === "stopped") {
            sendControl({
              type: "error",
              state: "stopped",
              code: "CONSOLE_LXC_STOPPED",
              message: "VPS is stopped. Start it to open the console.",
            });
            clientWs.close(1000, "VPS stopped");
            return;
          }

          // STEP 2: Request termproxy ticket from Proxmox
          sendControl({
            type: "status",
            state: "requesting_termproxy",
            message: "Requesting Proxmox terminal proxy ticket...",
          });

          const termproxy = await ProxmoxService.createLxcTermProxy(node, vps.proxmox_vmid);

          sendControl({
            type: "status",
            state: "termproxy_ready",
            message: "Termproxy ticket acquired.",
          });

          // STEP 3: Connect upstream WebSocket to Proxmox VE
          sendControl({
            type: "status",
            state: "connecting_upstream",
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
            node.nodeName
          )}/lxc/${vps.proxmox_vmid}/vncwebsocket?port=${termproxy.port}&vncticket=${encodeURIComponent(
            termproxy.ticket
          )}`;

          upstreamWs = new WebSocket(upstreamUrl, {
            rejectUnauthorized: !node.allowInsecureTls,
            headers: {
              Authorization: `PVEAPIToken=${node.authTokenId}=${node.authTokenSecret}`,
            },
          });

          upstreamWs.on("open", () => {
            sendControl({
              type: "status",
              state: "handshaking",
              message: "Performing console handshake with hypervisor...",
            });

            // Initial Proxmox termproxy handshake: user:ticket\n
            upstreamWs?.send(`${termproxy.user}:${termproxy.ticket}\n`);
          });

          upstreamWs.on("message", (data) => {
            resetIdleTimer();

            // First incoming data confirms handshake success and shell readiness
            if (!isConnected) {
              isConnected = true;
              sendControl({
                type: "status",
                state: "connected",
                message: "Terminal connected.",
              });
            }

            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(data);
            }
          });

          upstreamWs.on("error", (err) => {
            console.error(
              `[CONSOLE] Upstream Proxmox WS error for VPS ${vpsId} [endpoint=${endpoint.displayTarget}]:`,
              err.message
            );
            sendControl({
              type: "error",
              state: "failed",
              code: "WEBSOCKET_CONNECTION_FAILURE",
              message: `Hypervisor console stream error: ${err.message}`,
            });
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close(1011, "Upstream connection error");
            }
          });

          upstreamWs.on("close", (code, reason) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              sendControl({
                type: "status",
                state: "disconnected",
                message: `Terminal session disconnected (code ${code}).`,
              });
              clientWs.close(code, reason.toString());
            }
          });

          clientWs.on("message", (data) => {
            resetIdleTimer();
            if (!upstreamWs || upstreamWs.readyState !== WebSocket.OPEN) return;

            const str = data.toString();

            // Handle client resize messages (either Proxmox format 1:cols:rows: or JSON { type: "resize", cols, rows })
            if (str.startsWith("1:") && str.endsWith(":")) {
              upstreamWs.send(str);
              return;
            }

            if (str.startsWith("{")) {
              try {
                const parsed = JSON.parse(str);
                if (parsed.type === "resize" && typeof parsed.cols === "number" && typeof parsed.rows === "number") {
                  upstreamWs.send(`1:${parsed.cols}:${parsed.rows}:`);
                  return;
                }
              } catch {}
            }

            // Normal keyboard / terminal data
            upstreamWs.send(data);
          });

          const cleanup = () => {
            if (idleTimer) {
              clearTimeout(idleTimer);
              idleTimer = null;
            }
            if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
              upstreamWs.close();
            }

            // Audit log console closed
            execute(
              `INSERT INTO audit_logs (user_id, event_type, metadata)
               VALUES (?, 'vps_console_closed', ?)`,
              [user.id, JSON.stringify({ vps_id: vpsId, vmid: vps.proxmox_vmid })]
            );
          };

          clientWs.on("close", cleanup);
          clientWs.on("error", cleanup);
        } catch (err: unknown) {
          const endpoint = resolveProxmoxEndpoint(node.apiUrl, node.hostname, node.port);
          let code: ProxmoxErrorClassification = "UNKNOWN_CONSOLE_FAILURE";
          let details: Record<string, unknown> | undefined;

          if (err instanceof ProxmoxRequestError) {
            code = err.classification;
            details = {
              statusCode: err.statusCode,
              proxyDetected: err.proxyDetected,
              proxyType: err.proxyType,
              safeBodySnippet: err.safeBodySnippet,
              endpoint: endpoint.displayTarget,
            };
          }

          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[CONSOLE] vps=${vpsId} node=${node.nodeName} vmid=${vps.proxmox_vmid} endpoint=${endpoint.displayTarget} classification=${code}: ${msg}`
          );

          sendControl({
            type: "error",
            state: "failed",
            code,
            message: msg,
            details,
          });

          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(1011, msg);
          }
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
