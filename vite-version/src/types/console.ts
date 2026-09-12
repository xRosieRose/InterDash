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

export interface ConsoleFailure {
  stage: ConsoleFailureStage;
  code: string;
  httpStatus?: number;
  websocketCode?: number;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

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

export interface ConsoleError {
  code: string;
  message: string;
  stage?: ConsoleFailureStage;
  httpStatus?: number;
  websocketCode?: number;
  retryable?: boolean;
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

export interface ConsoleDiagnosticStage {
  status: "ok" | "failed" | "skipped";
  httpStatus?: number;
  code?: string;
  message?: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
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
  runtimeNode?: string;
  runtimeNodeSource?: string;
  proxmoxVersion?: string;
  latencyMs?: number;
  classification?: string;
  recommendedFix?: string;
  message?: string;
  stages?: {
    runtime?: ConsoleDiagnosticStage & { node?: string };
    api?: ConsoleDiagnosticStage;
    termproxy?: ConsoleDiagnosticStage;
    upstreamUpgrade?: ConsoleDiagnosticStage;
    termproxyHandshake?: ConsoleDiagnosticStage;
  };
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
