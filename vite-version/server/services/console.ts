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
 *       ↓ Proxmox API: POST /nodes/{node}/lxc/{vmid}/termproxy
 *       ↓ Upstream WebSocket (wss://.../vncwebsocket?port=...&vncticket=...)
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
import { ProxmoxService } from "./proxmox.js";
import { ProvisioningService } from "./provisioning.js";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

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

        const resetIdleTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            console.log(`[CONSOLE] Session for VPS ${vpsId} closed due to 15m idle timeout.`);
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
          // 5. Request termproxy ticket from Proxmox
          const termproxy = await ProxmoxService.createLxcTermProxy(node, vps.proxmox_vmid);

          // 6. Connect upstream WebSocket to Proxmox VE
          const cleanBase = node.apiUrl.replace(/^http/i, "ws").replace(/\/+$/, "");
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
            // Initial Proxmox termproxy handshake
            upstreamWs?.send(`${termproxy.user}:${termproxy.ticket}\n`);
          });

          upstreamWs.on("message", (data) => {
            resetIdleTimer();
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(data);
            }
          });

          upstreamWs.on("error", (err) => {
            console.error(`[CONSOLE] Upstream Proxmox WS error for VPS ${vpsId}:`, err.message);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(`\r\n\x1b[31m[Console Error: Connection to hypervisor failed (${err.message})]\x1b[0m\r\n`);
              clientWs.close(1011, "Upstream error");
            }
          });

          upstreamWs.on("close", (code, reason) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close(code, reason.toString());
            }
          });

          clientWs.on("message", (data) => {
            resetIdleTimer();
            if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
              upstreamWs.send(data);
            }
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
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[CONSOLE] Failed to initiate termproxy for VPS ${vpsId}:`, msg);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(`\r\n\x1b[31m[Console Error: ${msg}]\x1b[0m\r\n`);
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
