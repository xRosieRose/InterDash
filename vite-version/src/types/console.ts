/**
 * InterDash — Console & Terminal Protocol Types
 *
 * Types for the real Proxmox LXC terminal integration,
 * WebSocket control protocol, connection state machine,
 * and diagnostic inspection.
 */

export type ConsoleState =
  | "idle"
  | "connecting"
  | "checking_runtime"
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

export interface ConsoleError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  diagnosticId?: string;
}

export interface TermProxySession {
  port: number;
  ticket: string;
  upid: string;
  user: string;
}

export interface ProxyDiagnostic {
  proxied: boolean;
  proxyType?: "cloudflare" | "generic_reverse_proxy" | "none";
  cfRay?: string;
  server?: string;
  via?: string;
  recommendedFix?: string;
}

export interface ConsoleDiagnostic {
  ok: boolean;
  endpoint?: string;
  proxied?: boolean;
  proxyType?: "cloudflare" | "generic_reverse_proxy" | "none";
  statusCode?: number;
  contentType?: string;
  responseSnippet?: string;
  lxcStatus?: string;
  proxmoxVersion?: string;
  latencyMs?: number;
  classification?: string;
  recommendedFix?: string;
  message?: string;
}

export interface VpsRuntimeState {
  status: string;
  uptime?: number;
  cpu?: number;
  cpus?: number;
  memoryMb?: number;
  maxmemMb?: number;
  maxdiskGb?: number;
  lastSyncedAt?: string;
}
