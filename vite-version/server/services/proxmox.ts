/**
 * InterDash Server — Proxmox VE API Integration Service
 *
 * Real Proxmox VE v2 REST API integration.
 * Communicates with Proxmox hypervisors using PVEAPIToken authentication:
 *   Authorization: PVEAPIToken=USER@REALM!TOKENID=UUID
 *
 * All credentials remain server-side.
 * TLS certificate validation is enabled by default with an explicit opt-in
 * per node for self-signed certificates (allow_insecure_tls).
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { WebSocket } from "ws";

export interface ProxmoxNodeConfig {
  id: string;
  name: string;
  hostname: string;
  apiUrl: string;
  port: number;
  nodeName: string; // PVE cluster node name, e.g. "pve"
  region: string;
  flagUrl?: string | null;
  authTokenId: string; // e.g. "root@pam!interdash"
  authTokenSecret: string; // decrypted token secret
  allowInsecureTls: boolean;
  defaultTemplateStorage?: string | null;
  defaultRootfsStorage?: string | null;
  defaultBridge?: string | null;
  defaultStorage?: string; // legacy fallback
  enabled?: boolean;
  status?: NodeOperationalStatus;
}

export type VerificationStatus = "passed" | "warning" | "failed";

export type NodeOperationalStatus =
  | "healthy"
  | "online" // legacy synonym for healthy
  | "degraded"
  | "offline"
  | "misconfigured"
  | "unverified"
  | "unknown"
  | "disabled"
  | "draining"
  | "deleting";

export interface ProxmoxVerificationCheck {
  id: string;
  title: string;
  category: "network" | "auth" | "cluster" | "storage" | "sdn" | "system";
  status: VerificationStatus;
  message: string;
  detail?: string;
  durationMs: number;
  critical: boolean;
}

export interface ProxmoxVerificationReport {
  overallStatus: VerificationStatus;
  checks: ProxmoxVerificationCheck[];
  summary: {
    total: number;
    passed: number;
    warnings: number;
    failed: number;
    criticalFailures: number;
  };
  durationMs: number;
  timestamp: string;
  endpoint: string;
  proxied: boolean;
  proxyType: "cloudflare" | "reverse_proxy" | "direct";
  nodeName: string;
  pveVersion?: string;
  recommendedActions: string[];
}

export interface NodeCapabilities {
  version: {
    release: string;
    version: string;
    repoId?: string;
  };
  storages: {
    id: string;
    type: string;
    content: string[];
    shared: boolean;
    active: boolean;
    totalBytes: number;
    usedBytes: number;
    availBytes: number;
  }[];
  templates: {
    volid: string;
    format: string;
    sizeBytes: number;
    storage: string;
  }[];
  bridges: string[];
  sdnVnets: string[];
  nodes: {
    name: string;
    online: boolean;
    ip?: string;
    cpuUsage?: number;
    memUsage?: number;
  }[];
}

export interface ProxmoxStorage {
  storage: string;
  type: string;
  active: boolean;
  content: string[];
  supportsTemplates: boolean;
  supportsRootfs: boolean;
  totalBytes?: number;
  usedBytes?: number;
  availBytes?: number;
}

export interface ProxmoxTemplate {
  volid: string;
  storage: string;
  filename: string;
  format: string;
  sizeBytes: number;
  osFamily?: string;
  version?: string;
  architecture?: string;
}

export interface ProxmoxBridge {
  iface: string;
  type: string;
  active: boolean;
  comments?: string;
}

export type PermissionCapabilityStatus = "verified" | "not_verified" | "denied";

export interface ProxmoxPermissions {
  canListNodes: PermissionCapabilityStatus;
  canListStorage: PermissionCapabilityStatus;
  canListTemplates: PermissionCapabilityStatus;
  canReadContainer: PermissionCapabilityStatus;
  canAllocateVmid: PermissionCapabilityStatus;
  canCreateLxc: PermissionCapabilityStatus;
  canModifyLxc: PermissionCapabilityStatus;
  canDeleteLxc: PermissionCapabilityStatus;
}

export interface NodeVerificationResult {
  status: NodeOperationalStatus;
  reachable: boolean;
  authenticated: boolean;
  identityVerified: boolean;
  readReady: boolean;
  provisionReady: boolean;
  latencyMs?: number;
  apiVersion?: string;
  apiRelease?: string;
  repoid?: string;
  expectedNodeName: string;
  actualNodeName?: string;
  clusterNodes?: string[];
  nodeStatus?: {
    status?: string;
    uptime?: number;
    cpu?: number;
    cpus?: number;
    memory?: {
      used?: number;
      total?: number;
      free?: number;
    };
    rootfs?: {
      used?: number;
      total?: number;
      free?: number;
    };
  };
  permissions: ProxmoxPermissions;
  storages: ProxmoxStorage[];
  templateStorages: string[];
  rootfsStorages: string[];
  templates: ProxmoxTemplate[];
  bridges: ProxmoxBridge[];
  checks: NodeVerificationCheck[];
  verifiedAt: string;
  error?: string;
}

export interface ProxmoxHealthResult {
  online: boolean;
  version?: string;
  release?: string;
  repoid?: string;
  nodeStatus?: Record<string, unknown>;
  latencyMs?: number;
  error?: string;
}

export interface ProxmoxCreateLxcParams {
  vmid: number;
  hostname: string;
  ostemplate: string;
  cores: number;
  memoryMb: number;
  swapMb: number;
  diskGb: number;
  storage?: string; // rootfs storage
  bridge?: string;
  ipv4?: string;
  ipv4Gateway?: string;
  ipv6?: string;
  password?: string;
  sshPublicKeys?: string;
  description?: string;
  unprivileged?: boolean;
  startAfterCreate?: boolean;
}

export type ProxmoxErrorClassification =
  | "TERM_PROXY_501"
  | "PROXMOX_501"
  | "PROXMOX_501_TERM_PROXY"
  | "PROXY_501"
  | "CLOUDFLARE_501"
  | "REVERSE_PROXY_501"
  | "AUTHENTICATION_FAILURE"
  | "AUTHORIZATION_FAILURE"
  | "TERM_PROXY_AUTH_FAILURE"
  | "TERM_PROXY_NOT_FOUND"
  | "TLS_FAILURE"
  | "TIMEOUT"
  | "CONNECTION_REFUSED"
  | "NODE_NOT_FOUND"
  | "NODE_UNREACHABLE"
  | "LXC_NOT_FOUND"
  | "LXC_STOPPED"
  | "LXC_LOCKED"
  | "TERM_PROXY_INVALID_RESPONSE"
  | "WEBSOCKET_FAILURE"
  | "WEBSOCKET_CONNECTION_FAILURE"
  | "WEBSOCKET_HANDSHAKE_FAILURE"
  | "TERMPROXY_HANDSHAKE_REJECTED"
  | "PROXMOX_CONSOLE_UPGRADE_DENIED"
  | "UNSUPPORTED_CONSOLE_PROTOCOL"
  | "UNKNOWN_CONSOLE_FAILURE";

export type LxcRuntimeTargetResult =
  | {
      ok: true;
      nodeName: string;
      vmid: number;
      status?: string;
      uptime?: number;
      discoveredFrom: "direct" | "cluster";
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "discovery_unavailable"
        | "authorization_failed"
        | "node_unreachable";
      message?: string;
    };

export interface LxcStatusResult {
  ok: boolean;
  status: "running" | "stopped" | "unknown";
  runtimeNode: string;
  runtimeNodeSource: "direct" | "cluster" | "configured";
  vmid?: number;
  name?: string;
  cpus?: number;
  maxmem?: number;
  maxdisk?: number;
  uptime?: number;
  lastVerifiedAt?: string;
  classification?: string;
  error?: string;
}

export interface ConsoleDiagnosticStageResult {
  status: "ok" | "failed" | "skipped";
  httpStatus?: number;
  code?: string;
  message?: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

export interface ConsoleDiagnosticResult {
  ok: boolean;
  endpoint: string;
  proxied: boolean;
  proxyType: "cloudflare" | "reverse_proxy" | "direct";
  statusCode?: number;
  statusMessage?: string;
  contentType?: string;
  responseSnippet?: string;
  lxcStatus?: string;
  runtimeNode?: string;
  runtimeNodeSource?: "direct" | "cluster" | "configured";
  proxmoxVersion?: string;
  latencyMs: number;
  classification: ProxmoxErrorClassification;
  recommendedFix?: string;
  port?: number;
  user?: string;
  stages?: {
    runtime?: ConsoleDiagnosticStageResult & { node?: string };
    api?: ConsoleDiagnosticStageResult;
    termproxy?: ConsoleDiagnosticStageResult;
    upstreamUpgrade?: ConsoleDiagnosticStageResult;
    termproxyHandshake?: ConsoleDiagnosticStageResult;
  };
}

export class ProxmoxRequestError extends Error {
  public statusCode?: number;
  public statusMessage?: string;
  public contentType?: string;
  public safeBodySnippet?: string;
  public safeHeaders?: Record<string, string>;
  public endpoint?: string;
  public method?: string;
  public latency?: number;
  public isTlsError: boolean;
  public isTimeout: boolean;
  public isConnRefused: boolean;
  public proxyDetected: boolean;
  public proxyType: "cloudflare" | "reverse_proxy" | "direct";
  public classification: ProxmoxErrorClassification;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      statusMessage?: string;
      contentType?: string;
      safeBodySnippet?: string;
      safeHeaders?: Record<string, string>;
      endpoint?: string;
      method?: string;
      latency?: number;
      isTlsError?: boolean;
      isTimeout?: boolean;
      isConnRefused?: boolean;
      proxyDetected?: boolean;
      proxyType?: "cloudflare" | "reverse_proxy" | "direct";
      classification?: ProxmoxErrorClassification;
    }
  ) {
    super(message);
    this.name = "ProxmoxRequestError";
    this.statusCode = options?.statusCode;
    this.statusMessage = options?.statusMessage;
    this.contentType = options?.contentType;
    this.safeBodySnippet = options?.safeBodySnippet;
    this.safeHeaders = options?.safeHeaders;
    this.endpoint = options?.endpoint;
    this.method = options?.method;
    this.latency = options?.latency;
    this.isTlsError = Boolean(options?.isTlsError);
    this.isTimeout = Boolean(options?.isTimeout);
    this.isConnRefused = Boolean(options?.isConnRefused);
    this.proxyDetected = Boolean(options?.proxyDetected);
    this.proxyType = options?.proxyType || "direct";

    if (options?.classification) {
      this.classification = options.classification;
    } else if (options?.isTlsError) {
      this.classification = "TLS_FAILURE";
    } else if (options?.isTimeout) {
      this.classification = "TIMEOUT";
    } else if (options?.isConnRefused) {
      this.classification = "CONNECTION_REFUSED";
    } else if (options?.statusCode === 401) {
      this.classification = "AUTHENTICATION_FAILURE";
    } else if (options?.statusCode === 403) {
      this.classification = "AUTHORIZATION_FAILURE";
    } else if (options?.statusCode === 404) {
      this.classification = "LXC_NOT_FOUND";
    } else if (options?.statusCode === 501) {
      this.classification = options.proxyType === "cloudflare"
        ? "CLOUDFLARE_501"
        : options.proxyType === "reverse_proxy"
        ? "REVERSE_PROXY_501"
        : "PROXMOX_501_TERM_PROXY";
    } else {
      this.classification = "UNKNOWN_CONSOLE_FAILURE";
    }
  }
}

/**
 * Parses presentation metadata from template filenames without inventing ground truth.
 * Authoritative fields remain volid, storage, format, and sizeBytes.
 */
export function parseTemplatePresentationMetadata(filename: string): {
  osFamily?: string;
  version?: string;
  architecture?: string;
} {
  const lower = filename.toLowerCase();
  let osFamily: string | undefined;
  if (lower.includes("ubuntu")) osFamily = "ubuntu";
  else if (lower.includes("debian")) osFamily = "debian";
  else if (lower.includes("alpine")) osFamily = "alpine";
  else if (lower.includes("centos")) osFamily = "centos";
  else if (lower.includes("rocky")) osFamily = "rocky";
  else if (lower.includes("almalinux") || lower.includes("alma")) osFamily = "almalinux";
  else if (lower.includes("fedora")) osFamily = "fedora";
  else if (lower.includes("archlinux") || lower.includes("arch")) osFamily = "archlinux";

  let architecture: string | undefined;
  if (lower.includes("amd64") || lower.includes("x86_64")) architecture = "amd64";
  else if (lower.includes("arm64") || lower.includes("aarch64")) architecture = "arm64";
  else if (lower.includes("i386") || lower.includes("x86")) architecture = "i386";

  let version: string | undefined;
  const verMatch = filename.match(/[-_](\d+(?:\.\d+)*)/);
  if (verMatch) {
    version = verMatch[1];
  }

  return { osFamily, version, architecture };
}

export interface ResolvedProxmoxEndpoint {
  protocol: "https:" | "http:";
  isHttps: boolean;
  hostname: string;
  port: number;
  pathname: string;
  displayTarget: string;
}

/**
 * Resolves the effective target endpoint, protocol, port, and display string for a Proxmox hypervisor.
 *
 * Rules:
 * 1. If apiUrl explicitly contains a port (e.g. "https://domain:8006" or "http://ip:8080"), that port is authoritative.
 * 2. If apiUrl does NOT contain a port (e.g. "https://pve-pe.kinetichost.pro"):
 *    - If configuredPort is non-default (e.g. custom reverse proxy port like 8443), use it.
 *    - NEVER force legacy default 8006 when apiUrl specifies a clean domain URL without a port!
 *    - Default standard HTTPS port to 443, standard HTTP port to 80.
 * 3. displayTarget formats cleanly without default ports (e.g. "pve-pe.kinetichost.pro" instead of "pve-pe.kinetichost.pro:8006").
 */
export function resolveProxmoxEndpoint(
  apiUrl: string,
  configuredHostname?: string,
  configuredPort?: number
): ResolvedProxmoxEndpoint {
  let rawUrl = (apiUrl || "").trim();
  if (!rawUrl && configuredHostname) {
    rawUrl = configuredHostname.trim();
  }
  if (!/^https?:\/\//i.test(rawUrl)) {
    rawUrl = `https://${rawUrl}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    parsed = new URL("https://localhost");
  }

  const isHttps = parsed.protocol === "https:";
  const protocol: "https:" | "http:" = isHttps ? "https:" : "http:";
  const hostname = parsed.hostname || configuredHostname || "localhost";

  let port: number;
  if (parsed.port) {
    port = parseInt(parsed.port, 10);
  } else if (
    configuredPort !== undefined &&
    configuredPort !== null &&
    Number(configuredPort) !== 8006 &&
    Number(configuredPort) !== (isHttps ? 443 : 80)
  ) {
    port = Number(configuredPort);
  } else {
    port = isHttps ? 443 : 80;
  }

  const isStandardPort = (isHttps && port === 443) || (!isHttps && port === 80);
  const displayTarget = isStandardPort ? hostname : `${hostname}:${port}`;

  return {
    protocol,
    isHttps,
    hostname,
    port,
    pathname: parsed.pathname.replace(/\/+$/, ""),
    displayTarget,
  };
}

export class ProxmoxService {
  /**
   * Short-lived in-memory cache for node capability results (30-60s TTL)
   */
  private static capabilityCache = new Map<
    string,
    { result: NodeVerificationResult; expiresAt: number }
  >();

  public static getCachedVerification(nodeId: string): NodeVerificationResult | null {
    const cached = this.capabilityCache.get(nodeId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.result;
    }
    if (cached) {
      this.capabilityCache.delete(nodeId);
    }
    return null;
  }

  public static setCachedVerification(
    nodeId: string,
    result: NodeVerificationResult,
    ttlMs = 45_000
  ): void {
    this.capabilityCache.set(nodeId, {
      result,
      expiresAt: Date.now() + ttlMs,
    });
  }

  public static invalidateCache(nodeId?: string): void {
    if (nodeId) {
      this.capabilityCache.delete(nodeId);
    } else {
      this.capabilityCache.clear();
    }
  }

  /**
   * Low-level HTTP/HTTPS request to Proxmox VE API.
   * Enforces server-side credentials and never exposes secrets in responses or logs.
   */
  public static async request<T = unknown>(
    node: ProxmoxNodeConfig,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
    timeoutMs = 15000
  ): Promise<{ status: number; data: T }> {
    return new Promise((resolve, reject) => {
      let endpoint: ResolvedProxmoxEndpoint;
      try {
        endpoint = resolveProxmoxEndpoint(node.apiUrl, node.hostname, node.port);
      } catch (err: unknown) {
        return reject(
          new ProxmoxRequestError(
            `Invalid Proxmox API URL: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }

      const client = endpoint.isHttps ? https : http;
      const isMutation = method === "POST" || method === "PUT" || method === "DELETE";
      const hasBody = body !== undefined && body !== null;
      const postData = hasBody ? JSON.stringify(body) : "";

      const headers: Record<string, string> = {
        Authorization: `PVEAPIToken=${node.authTokenId}=${node.authTokenSecret}`,
        Accept: "application/json",
      };

      if (hasBody) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = Buffer.byteLength(postData, "utf8").toString();
      } else if (isMutation) {
        // Explicitly set Content-Length: 0 for body-less mutations (such as POST /termproxy).
        // Proxmox pveproxy (AnyEvent::HTTPD) rejects chunked transfer encoding with HTTP 501.
        headers["Content-Length"] = "0";
      }

      const agent = endpoint.isHttps
        ? new https.Agent({
            rejectUnauthorized: !node.allowInsecureTls,
          })
        : undefined;

      const fullPath = `${endpoint.pathname}${path.startsWith("/") ? path : `/${path}`}`;
      const reqStartTime = Date.now();

      const req = client.request(
        {
          protocol: endpoint.protocol,
          hostname: endpoint.hostname,
          port: endpoint.port,
          path: fullPath,
          method,
          headers,
          agent,
          timeout: timeoutMs,
        },
        (res) => {
          let rawData = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            rawData += chunk;
          });
          res.on("end", () => {
            const latency = Date.now() - reqStartTime;
            const statusCode = res.statusCode || 500;
            const statusMessage = res.statusMessage || "";
            const contentType = (res.headers["content-type"] || "").toString();

            // Collect safe response headers only
            const safeHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              const lower = k.toLowerCase();
              if (
                ["server", "cf-ray", "via", "date", "content-type", "content-length"].includes(lower) &&
                typeof v === "string"
              ) {
                safeHeaders[lower] = v;
              }
            }

            // Proxy detection heuristics
            const serverHdr = (res.headers["server"] || "").toString().toLowerCase();
            const cfRay = res.headers["cf-ray"];
            const viaHdr = res.headers["via"];
            let proxyDetected = false;
            let proxyType: "cloudflare" | "reverse_proxy" | "direct" = "direct";

            if (serverHdr.includes("cloudflare") || Boolean(cfRay)) {
              proxyDetected = true;
              proxyType = "cloudflare";
            } else if (
              Boolean(viaHdr) ||
              serverHdr.includes("nginx") ||
              serverHdr.includes("caddy") ||
              serverHdr.includes("apache") ||
              serverHdr.includes("envoy")
            ) {
              proxyDetected = true;
              proxyType = "reverse_proxy";
            }

            const safeBodySnippet = rawData
              ? rawData.slice(0, 300).replace(/[\r\n\t]+/g, " ").trim()
              : "";

            // Determine error classification
            let classification: ProxmoxErrorClassification = "UNKNOWN_CONSOLE_FAILURE";
            if (statusCode >= 200 && statusCode < 300) {
              // OK
            } else if (statusCode === 501) {
              if (path.includes("termproxy")) {
                if (proxyType === "cloudflare") {
                  classification = "CLOUDFLARE_501";
                } else if (proxyType === "reverse_proxy") {
                  classification = "REVERSE_PROXY_501";
                } else {
                  classification = "PROXMOX_501_TERM_PROXY";
                }
              } else {
                classification = proxyType === "cloudflare" ? "CLOUDFLARE_501" : "PROXY_501";
              }
            } else if (statusCode === 401) {
              classification = "AUTHENTICATION_FAILURE";
            } else if (statusCode === 403) {
              classification = "AUTHORIZATION_FAILURE";
            } else if (statusCode === 404) {
              classification = path.includes("/lxc/") ? "LXC_NOT_FOUND" : "NODE_NOT_FOUND";
            }

            if (statusCode >= 200 && statusCode < 300) {
              try {
                const json = rawData ? JSON.parse(rawData) : {};
                resolve({ status: statusCode, data: (json.data !== undefined ? json.data : json) as T });
              } catch {
                reject(
                  new ProxmoxRequestError(
                    `Proxmox API Error [${method} ${path}]: Malformed JSON in HTTP ${statusCode} response`,
                    {
                      statusCode,
                      statusMessage,
                      contentType,
                      safeBodySnippet,
                      safeHeaders,
                      endpoint: endpoint.displayTarget,
                      method,
                      latency,
                      proxyDetected,
                      proxyType,
                      classification: "TERM_PROXY_INVALID_RESPONSE",
                    }
                  )
                );
              }
            } else {
              let errMsg = `HTTP ${statusCode}: ${statusMessage || "Error"}`;
              try {
                const json = rawData ? JSON.parse(rawData) : null;
                if (json) {
                  errMsg =
                    json.errors ||
                    json.message ||
                    (typeof json.data === "string" ? json.data : null) ||
                    errMsg;
                  if (typeof errMsg === "object") {
                    errMsg = JSON.stringify(errMsg);
                  }
                }
              } catch {
                if (safeBodySnippet) {
                  errMsg = `${errMsg} (${safeBodySnippet})`;
                }
              }

              if (statusCode === 401) {
                errMsg = "Authentication failed. Invalid Proxmox API Token ID or Secret.";
              } else if (statusCode === 403) {
                errMsg = "Permission denied. Proxmox API Token lacks privileges for this action.";
              } else if (statusCode === 501 && path.includes("termproxy")) {
                if (proxyType === "cloudflare") {
                  errMsg =
                    "Proxmox termproxy returned HTTP 501 through Cloudflare Tunnel. Verify WebSocket support and disableChunkedEncoding: true in cloudflared originRequest configuration.";
                } else if (proxyType === "reverse_proxy") {
                  errMsg =
                    "Proxmox termproxy returned HTTP 501 through reverse proxy. Ensure reverse proxy does not force chunked transfer encoding.";
                } else {
                  errMsg = "Proxmox termproxy returned HTTP 501 Not Implemented.";
                }
              }

              reject(
                new ProxmoxRequestError(`Proxmox API Error [${method} ${path}]: ${errMsg}`, {
                  statusCode,
                  statusMessage,
                  contentType,
                  safeBodySnippet,
                  safeHeaders,
                  endpoint: endpoint.displayTarget,
                  method,
                  latency,
                  proxyDetected,
                  proxyType,
                  classification,
                })
              );
            }
          });
        }
      );

      req.on("error", (err: NodeJS.ErrnoException) => {
        const latency = Date.now() - reqStartTime;
        const isTls =
          err.message.includes("certificate") ||
          err.message.includes("self-signed") ||
          err.code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
          err.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
          err.code === "CERT_HAS_EXPIRED";

        const isConnRefused = err.code === "ECONNREFUSED";
        const isTimeout = err.code === "ETIMEDOUT";

        let userMsg = `Proxmox Connection Failed [${endpoint.displayTarget}]: ${err.message}`;
        if (isTls) {
          userMsg = `TLS certificate validation failed for [${endpoint.displayTarget}]. If Proxmox uses a default self-signed certificate, enable 'Allow Self-Signed TLS'.`;
        } else if (isConnRefused) {
          userMsg = `Connection refused at [${endpoint.displayTarget}]. Verify that Proxmox is online and the API port is accessible.`;
        }

        reject(
          new ProxmoxRequestError(userMsg, {
            statusCode: undefined,
            endpoint: endpoint.displayTarget,
            method,
            latency,
            isTlsError: isTls,
            isTimeout,
            isConnRefused,
            classification: isTls
              ? "TLS_FAILURE"
              : isTimeout
              ? "TIMEOUT"
              : isConnRefused
              ? "CONNECTION_REFUSED"
              : "UNKNOWN_CONSOLE_FAILURE",
          })
        );
      });

      req.on("timeout", () => {
        req.destroy();
        reject(
          new ProxmoxRequestError(
            `Proxmox Connection Timeout [${endpoint.displayTarget}] after ${Math.max(1, Math.round(timeoutMs / 1000))}s`,
            {
              endpoint: endpoint.displayTarget,
              method,
              isTimeout: true,
              classification: "TIMEOUT",
            }
          )
        );
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  /**
   * Discover real cluster nodes via GET /api2/json/nodes
   */
  public static async getClusterNodes(
    node: ProxmoxNodeConfig
  ): Promise<Array<{ node: string; status: string; cpu?: number; mem?: number; maxmem?: number; uptime?: number }>> {
    const res = await this.request<
      Array<{ node: string; status: string; cpu?: number; mem?: number; maxmem?: number; uptime?: number }>
    >(node, "GET", "/api2/json/nodes");
    return Array.isArray(res.data) ? res.data : [];
  }

  /**
   * Query the live status of the target Proxmox node
   */
  public static async getNodeStatus(
    node: ProxmoxNodeConfig
  ): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(
      node,
      "GET",
      `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/status`
    );
    return res.data || {};
  }

  /**
   * Discover available storage pools on the Proxmox node.
   * Normalizes content types into supportsTemplates (vztmpl) and supportsRootfs (rootdir/images).
   */
  public static async getStorageList(
    node: ProxmoxNodeConfig
  ): Promise<ProxmoxStorage[]> {
    let rawList: Array<{
      storage: string;
      type?: string;
      active?: number | boolean;
      content?: string | string[];
      total?: number;
      used?: number;
      avail?: number;
    }> = [];

    try {
      const res = await this.request<
        Array<{
          storage: string;
          type?: string;
          active?: number | boolean;
          content?: string | string[];
          total?: number;
          used?: number;
          avail?: number;
        }>
      >(node, "GET", `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/storage`);
      if (Array.isArray(res.data)) {
        rawList = res.data;
      }
    } catch (err: unknown) {
      // If node-level storage query fails (e.g. cluster level fallback needed), attempt cluster /storage
      try {
        const clusterRes = await this.request<
          Array<{
            storage: string;
            type?: string;
            active?: number | boolean;
            content?: string | string[];
            nodes?: string;
          }>
        >(node, "GET", "/api2/json/storage");
        if (Array.isArray(clusterRes.data)) {
          rawList = clusterRes.data.filter((s) => {
            if (!s.nodes) return true;
            const targetNodes = s.nodes.split(",").map((n) => n.trim().toLowerCase());
            return targetNodes.includes(node.nodeName.toLowerCase());
          });
        }
      } catch {
        throw err;
      }
    }

    const normalized: ProxmoxStorage[] = rawList.map((s) => {
      let contentList: string[] = [];
      if (typeof s.content === "string") {
        contentList = s.content.split(",").map((c) => c.trim().toLowerCase());
      } else if (Array.isArray(s.content)) {
        contentList = s.content.map((c) => String(c).trim().toLowerCase());
      }

      const active = s.active !== undefined ? s.active !== 0 && s.active !== false : true;

      return {
        storage: s.storage,
        type: s.type || "unknown",
        active,
        content: contentList,
        supportsTemplates: contentList.includes("vztmpl"),
        supportsRootfs: contentList.includes("rootdir") || contentList.includes("images"),
        totalBytes: typeof s.total === "number" ? s.total : undefined,
        usedBytes: typeof s.used === "number" ? s.used : undefined,
        availBytes: typeof s.avail === "number" ? s.avail : undefined,
      };
    });

    return normalized;
  }

  /**
   * Discover available LXC container templates across ALL usable Proxmox storage pools.
   * Scans all active storages that support 'vztmpl'.
   * Merges and deduplicates results by authoritative volid.
   * Never restricts discovery to only defaultStorage.
   */
  public static async getTemplates(
    node: ProxmoxNodeConfig,
    storageName?: string
  ): Promise<ProxmoxTemplate[]> {
    const templatesMap = new Map<string, ProxmoxTemplate>();

    // 1. Determine candidate storages
    let candidateStorages: string[] = [];

    if (storageName) {
      candidateStorages = [storageName];
    } else {
      try {
        const storages = await this.getStorageList(node);
        candidateStorages = storages
          .filter((s) => s.active && s.supportsTemplates)
          .map((s) => s.storage);
      } catch (storageErr) {
        // If storage discovery failed, do not invent fake templates; rethrow
        throw storageErr;
      }
    }

    // 2. Query each candidate storage for vztmpl content
    for (const storage of candidateStorages) {
      try {
        let items: Array<{ volid?: string; format?: string; size?: number; content?: string }> = [];

        // Attempt 1: Query with ?content=vztmpl filter
        try {
          const res = await this.request<
            Array<{ volid?: string; format?: string; size?: number; content?: string }>
          >(
            node,
            "GET",
            `/api2/json/nodes/${encodeURIComponent(
              node.nodeName
            )}/storage/${encodeURIComponent(storage)}/content?content=vztmpl`
          );
          if (Array.isArray(res.data) && res.data.length > 0) {
            items = res.data;
          }
        } catch {
          // Some storage plugins reject content query param, fallback to unfiltered /content
        }

        // Attempt 2: Fallback to unfiltered /content
        if (items.length === 0) {
          try {
            const resAll = await this.request<
              Array<{ volid?: string; format?: string; size?: number; content?: string }>
            >(
              node,
              "GET",
              `/api2/json/nodes/${encodeURIComponent(
                node.nodeName
              )}/storage/${encodeURIComponent(storage)}/content`
            );
            if (Array.isArray(resAll.data)) {
              items = resAll.data;
            }
          } catch {
            // Storage content unreadable
          }
        }

        // Parse and filter container templates
        for (const item of items) {
          if (item && item.volid) {
            const volidLower = item.volid.toLowerCase();
            const isTemplate =
              item.content === "vztmpl" ||
              volidLower.includes("/vztmpl/") ||
              volidLower.includes(":vztmpl/") ||
              volidLower.endsWith(".tar.zst") ||
              volidLower.endsWith(".tar.xz") ||
              volidLower.endsWith(".tar.gz") ||
              volidLower.endsWith(".tzst") ||
              volidLower.endsWith(".txz") ||
              volidLower.endsWith(".tgz");

            if (isTemplate) {
              const filename = item.volid.split("/").pop() || item.volid.split(":").pop() || item.volid;
              const format = item.format || (filename.includes(".tar.zst") ? "tar.zst" : filename.includes(".tar.xz") ? "tar.xz" : "tar.gz");
              const meta = parseTemplatePresentationMetadata(filename);

              templatesMap.set(item.volid, {
                volid: item.volid,
                storage,
                filename,
                format,
                sizeBytes: item.size || 0,
                osFamily: meta.osFamily,
                version: meta.version,
                architecture: meta.architecture,
              });
            }
          }
        }
      } catch {
        // Individual storage query failed, continue scanning other pools
      }
    }

    const results = Array.from(templatesMap.values());
    results.sort((a, b) => a.volid.localeCompare(b.volid));
    return results;
  }

  /**
   * Discover available network bridges on the Proxmox node
   */
  public static async getNetworkBridges(
    node: ProxmoxNodeConfig
  ): Promise<ProxmoxBridge[]> {
    const res = await this.request<
      Array<{ iface: string; type?: string; active?: number | boolean; comments?: string }>
    >(node, "GET", `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/network?type=bridge`);

    if (!Array.isArray(res.data)) return [];

    return res.data.map((b) => ({
      iface: b.iface,
      type: b.type || "bridge",
      active: b.active !== undefined ? b.active !== 0 && b.active !== false : true,
      comments: b.comments,
    }));
  }

  /**
   * Allocate the next available cluster-wide VMID from Proxmox
   */
  public static async getNextVmid(node: ProxmoxNodeConfig): Promise<number> {
    const res = await this.request<number | string>(
      node,
      "GET",
      "/api2/json/cluster/nextid"
    );
    const vmid = typeof res.data === "string" ? parseInt(res.data, 10) : res.data;
    if (!vmid || isNaN(vmid)) {
      throw new Error("Proxmox did not return a valid numeric VMID");
    }
    return vmid;
  }

  /**
   * Comprehensive Layered Node Verification Service
   * Answers definitively whether a Proxmox node is reachable, authenticated, identity-verified,
   * capability-discovered, and ready for VPS provisioning.
   */
  public static async verifyNode(
    node: ProxmoxNodeConfig,
    forceRefresh = false
  ): Promise<NodeVerificationResult> {
    if (!forceRefresh && node.id && node.id !== "test") {
      const cached = this.getCachedVerification(node.id);
      if (cached) return cached;
    }

    const checks: NodeVerificationCheck[] = [];
    const startTime = Date.now();

    let reachable = false;
    let authenticated = false;
    let identityVerified = false;
    let apiVersion: string | undefined;
    let apiRelease: string | undefined;
    let repoid: string | undefined;
    let actualNodeName: string | undefined;
    let matchedNode: { node: string; status: string } | undefined;
    let clusterNodesList: string[] = [];
    let latencyMs: number | undefined;

    let nodeStatusData: Record<string, unknown> | undefined;
    let storages: ProxmoxStorage[] = [];
    let templates: ProxmoxTemplate[] = [];
    let bridges: ProxmoxBridge[] = [];

    const permissions: ProxmoxPermissions = {
      canListNodes: "not_verified",
      canListStorage: "not_verified",
      canListTemplates: "not_verified",
      canReadContainer: "not_verified",
      canAllocateVmid: "not_verified",
      canCreateLxc: "not_verified",
      canModifyLxc: "not_verified",
      canDeleteLxc: "not_verified",
    };

    const endpoint = resolveProxmoxEndpoint(node.apiUrl, node.hostname, node.port);

    // --------------------------------------------------------------------------
    // LAYER 1-4: Connectivity, TLS, Authentication, Proxmox Version
    // --------------------------------------------------------------------------
    try {
      const verRes = await this.request<{
        release: string;
        repo_id: string;
        version: string;
      }>(node, "GET", "/api2/json/version");

      latencyMs = Date.now() - startTime;
      reachable = true;
      authenticated = true;
      apiVersion = verRes.data.version;
      apiRelease = verRes.data.release;
      repoid = verRes.data.repo_id;

      // CHECK 1: Connectivity
      checks.push({
        name: "connectivity",
        status: "passed",
        message: `Connected successfully to ${endpoint.displayTarget} (${latencyMs}ms)`,
        details: { latencyMs, apiUrl: node.apiUrl, port: endpoint.port },
      });

      // CHECK 2: TLS Validation
      if (node.allowInsecureTls) {
        checks.push({
          name: "tls_validation",
          status: "warning",
          message: "TLS verification disabled for self-signed certificates (allow_insecure_tls active).",
        });
      } else {
        checks.push({
          name: "tls_validation",
          status: "passed",
          message: "TLS certificate validated successfully with strict verification.",
        });
      }

      // CHECK 3: API Authentication
      checks.push({
        name: "api_authentication",
        status: "passed",
        message: `Authenticated with API Token ID '${node.authTokenId}'.`,
      });

      // CHECK 4: API Version
      checks.push({
        name: "api_version",
        status: "passed",
        message: `Proxmox VE v${apiVersion} (${apiRelease || "release"}) confirmed.`,
        details: { version: apiVersion, release: apiRelease, repoid },
      });
    } catch (err: unknown) {
      latencyMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isTls = err instanceof ProxmoxRequestError && err.isTlsError;
      const isAuth = err instanceof ProxmoxRequestError && err.statusCode === 401;

      if (isTls) {
        checks.push({
          name: "connectivity",
          status: "passed",
          message: `Reachable at ${endpoint.displayTarget}, but TLS handshake failed.`,
        });
        checks.push({
          name: "tls_validation",
          status: "failed",
          message: errorMsg,
        });
      } else if (isAuth) {
        reachable = true;
        checks.push({
          name: "connectivity",
          status: "passed",
          message: `Connected to ${endpoint.displayTarget} (${latencyMs}ms)`,
        });
        checks.push({
          name: "api_authentication",
          status: "failed",
          message: "Proxmox API Token was rejected. Check Token ID and Secret permissions.",
        });
      } else {
        checks.push({
          name: "connectivity",
          status: "failed",
          message: errorMsg,
        });
      }

      const failResult: NodeVerificationResult = {
        status: isAuth ? "misconfigured" : "offline",
        reachable,
        authenticated: false,
        identityVerified: false,
        readReady: false,
        provisionReady: false,
        latencyMs,
        expectedNodeName: node.nodeName,
        checks,
        permissions,
        storages: [],
        templateStorages: [],
        rootfsStorages: [],
        templates: [],
        bridges: [],
        verifiedAt: new Date().toISOString(),
        error: errorMsg,
      };

      return failResult;
    }

    // --------------------------------------------------------------------------
    // LAYER 5-6: Cluster Identity & Node Identity Verification
    // --------------------------------------------------------------------------
    try {
      const clusterNodes = await this.getClusterNodes(node);
      permissions.canListNodes = "verified";
      clusterNodesList = clusterNodes.map((n) => n.node);

      checks.push({
        name: "cluster_identity",
        status: "passed",
        message: `Proxmox cluster verified with ${clusterNodes.length} node(s): ${clusterNodesList.join(", ")}`,
        details: { clusterNodes: clusterNodesList },
      });

      matchedNode = clusterNodes.find(
        (n) => n.node.toLowerCase() === node.nodeName.trim().toLowerCase()
      );

      if (matchedNode) {
        if (matchedNode.status && matchedNode.status !== "online") {
          checks.push({
            name: "target_node_status",
            status: "failed",
            message: `Target node '${node.nodeName}' is reported as '${matchedNode.status}' in cluster.`,
            details: { clusterStatus: matchedNode.status },
          });
        }
        identityVerified = true;
        actualNodeName = matchedNode.node;
        checks.push({
          name: "node_identity",
          status: "passed",
          message: `Target node '${node.nodeName}' verified and matches cluster node identity '${actualNodeName}'.`,
          details: { configured: node.nodeName, actual: actualNodeName },
        });
      } else {
        identityVerified = false;
        checks.push({
          name: "node_identity",
          status: "failed",
          message: `Node identity mismatch! Configured '${node.nodeName}' does not exist in cluster. Real cluster node(s): [${clusterNodesList.join(", ")}].`,
          details: { configured: node.nodeName, available: clusterNodesList },
        });
      }
    } catch {
      // If /nodes list is restricted by token ACL, fallback to direct node status query
      permissions.canListNodes = "denied";
      try {
        await this.getNodeStatus(node);
        identityVerified = true;
        actualNodeName = node.nodeName;
        checks.push({
          name: "node_identity",
          status: "passed",
          message: `Target node '${node.nodeName}' verified directly via node status endpoint.`,
        });
      } catch (statusErr: unknown) {
        identityVerified = false;
        const msg = statusErr instanceof Error ? statusErr.message : String(statusErr);
        checks.push({
          name: "node_identity",
          status: "failed",
          message: `Cannot verify node '${node.nodeName}': ${msg}`,
        });
      }
    }

    // If node identity cannot be verified, fail verification early as misconfigured
    if (!identityVerified) {
      const failResult: NodeVerificationResult = {
        status: "misconfigured",
        reachable: true,
        authenticated: true,
        identityVerified: false,
        readReady: false,
        provisionReady: false,
        latencyMs,
        apiVersion,
        apiRelease,
        repoid,
        expectedNodeName: node.nodeName,
        actualNodeName,
        clusterNodes: clusterNodesList,
        checks,
        permissions,
        storages: [],
        templateStorages: [],
        rootfsStorages: [],
        templates: [],
        bridges: [],
        verifiedAt: new Date().toISOString(),
        error: `Proxmox node identity mismatch: '${node.nodeName}' does not match any cluster node.`,
      };
      return failResult;
    }

    // --------------------------------------------------------------------------
    // LAYER 7: Target Node Runtime Status
    // --------------------------------------------------------------------------
    try {
      nodeStatusData = await this.getNodeStatus(node);
      checks.push({
        name: "node_status",
        status: "passed",
        message: `Node '${node.nodeName}' is online and responding.`,
        details: {
          uptime: nodeStatusData.uptime,
          cpu: nodeStatusData.cpu,
          memory: nodeStatusData.memory,
        },
      });
    } catch (err: unknown) {
      checks.push({
        name: "node_status",
        status: "warning",
        message: `Could not retrieve full node status: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // --------------------------------------------------------------------------
    // LAYER 8: Storage Discovery
    // --------------------------------------------------------------------------
    try {
      storages = await this.getStorageList(node);
      permissions.canListStorage = "verified";

      if (storages.length === 0) {
        checks.push({
          name: "storage_discovery",
          status: "failed",
          message: `No storage pools discovered for node '${node.nodeName}'. Verify API token storage permissions.`,
        });
      } else {
        console.log(`[VERIFY] Storage discovery for '${node.nodeName}': ${storages.length} pool(s) found`);
        for (const s of storages) {
          console.log(`[VERIFY]   Pool '${s.storage}': type=${s.type}, active=${s.active}, content=[${s.content.join(',')}], vztmpl=${s.supportsTemplates}, rootdir=${s.supportsRootfs}`);
        }
        checks.push({
          name: "storage_discovery",
          status: "passed",
          message: `Discovered ${storages.length} storage pool(s): ${storages.map((s) => s.storage).join(", ")}.`,
          details: { count: storages.length },
        });
      }
    } catch (err: unknown) {
      permissions.canListStorage = "denied";
      checks.push({
        name: "storage_discovery",
        status: "failed",
        message: `Failed to query storage pools on node: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // --------------------------------------------------------------------------
    // LAYER 9: Template-Capable Storage Discovery
    // --------------------------------------------------------------------------
    const templateStorages = storages
      .filter((s) => s.active && s.supportsTemplates)
      .map((s) => s.storage);
    console.log(`[VERIFY] Template-capable storages for '${node.nodeName}': [${templateStorages.join(', ')}] (${templateStorages.length} found)`);

    if (templateStorages.length > 0) {
      checks.push({
        name: "template_storage_discovery",
        status: "passed",
        message: `Storage pool(s) supporting container templates (vztmpl): ${templateStorages.join(", ")}.`,
        details: { templateStorages },
      });
    } else {
      checks.push({
        name: "template_storage_discovery",
        status: "warning",
        message: `No active storage pool on node '${node.nodeName}' is configured with content type 'vztmpl'.`,
      });
    }

    // --------------------------------------------------------------------------
    // LAYER 10: LXC Container Template Discovery
    // --------------------------------------------------------------------------
    try {
      templates = await this.getTemplates(node);
      permissions.canListTemplates = "verified";
      console.log(`[VERIFY] Template discovery for '${node.nodeName}': ${templates.length} template(s) found`);
      for (const t of templates) {
        console.log(`[VERIFY]   Template: volid='${t.volid}', storage='${t.storage}', filename='${t.filename}'`);
      }

      if (templates.length > 0) {
        checks.push({
          name: "template_discovery",
          status: "passed",
          message: `Discovered ${templates.length} container template(s) across storage pools.`,
          details: {
            count: templates.length,
            templates: templates.map((t) => `${t.volid} (${t.storage})`),
          },
        });
      } else if (templateStorages.length > 0) {
        checks.push({
          name: "template_discovery",
          status: "warning",
          message: `Template-capable storage (${templateStorages.join(", ")}) detected, but contains 0 container templates (.tar.zst/.tar.xz).`,
        });
      } else {
        checks.push({
          name: "template_discovery",
          status: "warning",
          message: "No container templates discovered because no template-capable storage was found.",
        });
      }
    } catch (err: unknown) {
      permissions.canListTemplates = "denied";
      checks.push({
        name: "template_discovery",
        status: "failed",
        message: `Failed to query container templates: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // --------------------------------------------------------------------------
    // LAYER 11: Rootfs-Capable Storage Discovery
    // --------------------------------------------------------------------------
    const rootfsStorages = storages
      .filter((s) => s.active && s.supportsRootfs)
      .map((s) => s.storage);
    console.log(`[VERIFY] Rootfs-capable storages for '${node.nodeName}': [${rootfsStorages.join(', ')}] (${rootfsStorages.length} found)`);

    if (rootfsStorages.length > 0) {
      checks.push({
        name: "rootfs_storage_discovery",
        status: "passed",
        message: `Storage pool(s) supporting container root disks (rootdir/images): ${rootfsStorages.join(", ")}.`,
        details: { rootfsStorages },
      });
    } else {
      checks.push({
        name: "rootfs_storage_discovery",
        status: "warning",
        message: `No active storage pool on node '${node.nodeName}' is configured with content type 'rootdir' or 'images'.`,
      });
    }

    // --------------------------------------------------------------------------
    // LAYER 12: Network Bridge Discovery
    // --------------------------------------------------------------------------
    try {
      bridges = await this.getNetworkBridges(node);
      if (bridges.length > 0) {
        checks.push({
          name: "bridge_discovery",
          status: "passed",
          message: `Discovered ${bridges.length} network bridge(s): ${bridges.map((b) => b.iface).join(", ")}.`,
          details: { bridges: bridges.map((b) => b.iface) },
        });
      } else {
        checks.push({
          name: "bridge_discovery",
          status: "warning",
          message: `No network bridges (e.g. vmbr0) discovered on node '${node.nodeName}'.`,
        });
      }
    } catch (err: unknown) {
      checks.push({
        name: "bridge_discovery",
        status: "warning",
        message: `Could not query network bridges: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // --------------------------------------------------------------------------
    // LAYER 13: Permission & Capability Checks
    // --------------------------------------------------------------------------
    try {
      await this.getNextVmid(node);
      permissions.canAllocateVmid = "verified";
      checks.push({
        name: "vmid_allocation_permission",
        status: "passed",
        message: "VMID allocation permission confirmed (/cluster/nextid).",
      });
    } catch {
      permissions.canAllocateVmid = "denied";
      checks.push({
        name: "vmid_allocation_permission",
        status: "failed",
        message: "Token lacks VMID allocation permission (/cluster/nextid).",
      });
    }

    // Test access to /access/permissions if readable
    try {
      const permRes = await this.request<Record<string, Record<string, number>>>(
        node,
        "GET",
        "/api2/json/access/permissions"
      );
      if (permRes.data) {
        const rootPerms = permRes.data["/"] || {};
        const vmsPerms = permRes.data["/vms"] || {};
        const hasVmsAlloc = Boolean(
          rootPerms["VM.Allocate"] ||
          vmsPerms["VM.Allocate"] ||
          rootPerms["Administrator"] ||
          vmsPerms["Administrator"]
        );
        if (hasVmsAlloc) {
          permissions.canCreateLxc = "verified";
          permissions.canModifyLxc = "verified";
          permissions.canDeleteLxc = "verified";
        }
      }
    } catch {
      // Token cannot query access table; remains 'not_verified' safely without fake failure
    }

    // --------------------------------------------------------------------------
    // LAYER 14: Aggregate Operational Readiness
    // --------------------------------------------------------------------------
    const readReady = Boolean(reachable && authenticated && identityVerified);
    console.log(`[VERIFY] Provision readiness checks for '${node.nodeName}':
  readReady=${readReady} (reachable=${reachable}, authenticated=${authenticated}, identityVerified=${identityVerified})
  templateStorages=${templateStorages.length}
  templates=${templates.length}
  rootfsStorages=${rootfsStorages.length}
  bridges=${bridges.length}
  canAllocateVmid=${permissions.canAllocateVmid}`);
    const provisionReady = Boolean(
      readReady &&
      templateStorages.length > 0 &&
      templates.length > 0 &&
      rootfsStorages.length > 0 &&
      bridges.length > 0 &&
      permissions.canAllocateVmid === "verified"
    );
    console.log(`[VERIFY] Final provisionReady for '${node.nodeName}': ${provisionReady}`);

    const isTargetOffline = Boolean(
      matchedNode && matchedNode.status && matchedNode.status !== "online"
    );

    let status: NodeOperationalStatus = "healthy";
    if (!reachable || isTargetOffline) {
      status = "offline";
    } else if (!authenticated || !identityVerified) {
      status = "misconfigured";
    } else if (!provisionReady) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    checks.push({
      name: "provisioning_readiness",
      status: provisionReady ? "passed" : "warning",
      message: provisionReady
        ? "Node is fully configured and ready for VPS provisioning."
        : "Node is connected, but missing required capabilities for VPS provisioning (see diagnostics above).",
    });

    const parsedNodeStatus = nodeStatusData
      ? {
          status: String(nodeStatusData.status || "online"),
          uptime: typeof nodeStatusData.uptime === "number" ? nodeStatusData.uptime : undefined,
          cpu: typeof nodeStatusData.cpu === "number" ? nodeStatusData.cpu : undefined,
          cpus: typeof nodeStatusData.cpus === "number" ? nodeStatusData.cpus : undefined,
          memory:
            typeof nodeStatusData.memory === "object" && nodeStatusData.memory !== null
              ? (nodeStatusData.memory as { used?: number; total?: number; free?: number })
              : undefined,
          rootfs:
            typeof nodeStatusData.rootfs === "object" && nodeStatusData.rootfs !== null
              ? (nodeStatusData.rootfs as { used?: number; total?: number; free?: number })
              : undefined,
        }
      : undefined;

    const result: NodeVerificationResult = {
      status,
      reachable,
      authenticated,
      identityVerified,
      readReady,
      provisionReady,
      latencyMs,
      apiVersion,
      apiRelease,
      repoid,
      expectedNodeName: node.nodeName,
      actualNodeName: actualNodeName || node.nodeName,
      clusterNodes: clusterNodesList,
      nodeStatus: parsedNodeStatus,
      permissions,
      storages,
      templateStorages,
      rootfsStorages,
      templates,
      bridges,
      checks,
      verifiedAt: new Date().toISOString(),
    };

    if (node.id && node.id !== "test") {
      this.setCachedVerification(node.id, result);
    }

    return result;
  }

  /**
   * Backwards-compatible health check wrapper leveraging layered verification
   */
  public static async healthCheck(node: ProxmoxNodeConfig): Promise<ProxmoxHealthResult> {
    const startTime = Date.now();
    try {
      const verRes = await this.request<{
        release: string;
        repo_id: string;
        version: string;
      }>(node, "GET", "/api2/json/version");

      let nodeStatus: Record<string, unknown> | undefined;
      try {
        nodeStatus = await this.getNodeStatus(node);
      } catch {}

      return {
        online: true,
        version: verRes.data.version,
        release: verRes.data.release,
        repoid: verRes.data.repo_id,
        nodeStatus,
        latencyMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      return {
        online: false,
        latencyMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Create an LXC Container through Proxmox API.
   * Rootfs storage is strictly decoupled from template storage.
   */
  public static async createLxc(
    node: ProxmoxNodeConfig,
    params: ProxmoxCreateLxcParams,
    runtimeNode?: string
  ): Promise<{ upid: string; vmid: number }> {
    const rootfsStorage =
      params.storage || node.defaultRootfsStorage || node.defaultStorage;
    if (!rootfsStorage) {
      throw new Error(
        "Rootfs storage is required for container creation. Please specify a rootfs storage or configure defaultRootfsStorage on the node."
      );
    }
    const bridge = params.bridge || node.defaultBridge;
    if (!bridge) {
      throw new Error(
        "Network bridge is required for container creation. Please specify a bridge or configure defaultBridge on the node."
      );
    }

    let net0 = `name=eth0,bridge=${bridge}`;
    if (params.ipv4) {
      net0 += `,ip=${params.ipv4}`;
      if (params.ipv4Gateway) {
        net0 += `,gw=${params.ipv4Gateway}`;
      }
    } else {
      net0 += ",ip=dhcp";
    }

    if (params.ipv6) {
      net0 += `,ip6=${params.ipv6}`;
    }

    const payload: Record<string, unknown> = {
      vmid: params.vmid,
      ostemplate: params.ostemplate,
      hostname: params.hostname,
      cores: params.cores,
      memory: params.memoryMb,
      swap: params.swapMb,
      rootfs: `${rootfsStorage}:${params.diskGb}`,
      net0,
      unprivileged: params.unprivileged !== undefined ? (params.unprivileged ? 1 : 0) : 1,
      start: params.startAfterCreate ? 1 : 0,
      onboot: 1,
      features: "nesting=1",
    };

    if (params.password) {
      payload.password = params.password;
    }
    if (params.sshPublicKeys) {
      payload["ssh-public-keys"] = params.sshPublicKeys.trim();
    }
    if (params.description) {
      payload.description = params.description;
    }

    const target = runtimeNode || node.nodeName;
    const res = await this.request<string>(
      node,
      "POST",
      `/api2/json/nodes/${encodeURIComponent(target)}/lxc`,
      payload
    );

    return {
      upid: typeof res.data === "string" ? res.data : String(res.data),
      vmid: params.vmid,
    };
  }

  /**
   * Start an LXC container
   */
  public static async startLxc(
    node: ProxmoxNodeConfig,
    vmid: number,
    runtimeNode?: string
  ): Promise<{ upid: string }> {
    const target = runtimeNode || node.nodeName;
    const res = await this.request<string>(
      node,
      "POST",
      `/api2/json/nodes/${encodeURIComponent(target)}/lxc/${vmid}/status/start`
    );
    return { upid: typeof res.data === "string" ? res.data : String(res.data) };
  }

  /**
   * Gracefully shut down an LXC container
   */
  public static async shutdownLxc(
    node: ProxmoxNodeConfig,
    vmid: number,
    runtimeNode?: string
  ): Promise<{ upid: string }> {
    const target = runtimeNode || node.nodeName;
    const res = await this.request<string>(
      node,
      "POST",
      `/api2/json/nodes/${encodeURIComponent(target)}/lxc/${vmid}/status/shutdown`
    );
    return { upid: typeof res.data === "string" ? res.data : String(res.data) };
  }

  /**
   * Forcibly stop an LXC container
   */
  public static async stopLxc(
    node: ProxmoxNodeConfig,
    vmid: number,
    runtimeNode?: string
  ): Promise<{ upid: string }> {
    const target = runtimeNode || node.nodeName;
    const res = await this.request<string>(
      node,
      "POST",
      `/api2/json/nodes/${encodeURIComponent(target)}/lxc/${vmid}/status/stop`
    );
    return { upid: typeof res.data === "string" ? res.data : String(res.data) };
  }

  /**
   * Reboot an LXC container
   */
  public static async rebootLxc(
    node: ProxmoxNodeConfig,
    vmid: number,
    runtimeNode?: string
  ): Promise<{ upid: string }> {
    const target = runtimeNode || node.nodeName;
    const res = await this.request<string>(
      node,
      "POST",
      `/api2/json/nodes/${encodeURIComponent(target)}/lxc/${vmid}/status/reboot`
    );
    return { upid: typeof res.data === "string" ? res.data : String(res.data) };
  }

  /**
   * Execute a Bash script inside a running LXC container.
   * Transmits the script via base64 encoded payload to /root/.interdash-startup.sh
   * and pipes logs to /var/log/interdash-startup.log.
   */
  public static async execLxcScript(
    node: ProxmoxNodeConfig,
    vmid: number,
    scriptContent: string,
    runtimeNode?: string
  ): Promise<{ ok: boolean; upid?: string; output?: string; error?: string }> {
    let target = runtimeNode;
    if (!target) {
      const resolved = await this.resolveLxcRuntimeTarget(node, vmid);
      target = resolved.ok ? resolved.nodeName : node.nodeName;
    }

    const b64 = Buffer.from(scriptContent, "utf8").toString("base64");
    const shellCommand = [
      "/bin/bash",
      "-c",
      `mkdir -p /root && echo '${b64}' | base64 -d > /root/.interdash-startup.sh && chmod 700 /root/.interdash-startup.sh && /root/.interdash-startup.sh >> /var/log/interdash-startup.log 2>&1`,
    ];

    try {
      const res = await this.request<any>(
        node,
        "POST",
        `/api2/json/nodes/${encodeURIComponent(target)}/lxc/${vmid}/exec`,
        { command: shellCommand }
      );

      const upid = typeof res?.data === "string" ? res.data : res?.data?.upid;
      return { ok: true, upid };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  /**
   * Destroy an LXC container and purge its volumes
   */
  public static async destroyLxc(
    node: ProxmoxNodeConfig,
    vmid: number,
    purge = true,
    runtimeNode?: string
  ): Promise<{ upid: string }> {
    const target = runtimeNode || node.nodeName;
    const res = await this.request<string>(
      node,
      "DELETE",
      `/api2/json/nodes/${encodeURIComponent(target)}/lxc/${vmid}?purge=${purge ? 1 : 0}`
    );
    return { upid: typeof res.data === "string" ? res.data : String(res.data) };
  }

  /**
   * Read the configuration of an LXC container
   */
  public static async getLxcConfig(
    node: ProxmoxNodeConfig,
    vmid: number,
    runtimeNode?: string
  ): Promise<Record<string, unknown>> {
    const target = runtimeNode || node.nodeName;
    const res = await this.request<Record<string, unknown>>(
      node,
      "GET",
      `/api2/json/nodes/${encodeURIComponent(target)}/lxc/${vmid}/config`
    );
    return res.data || {};
  }

  /**
   * Update configuration parameters on an LXC container
   */
  public static async updateLxcConfig(
    node: ProxmoxNodeConfig,
    vmid: number,
    configPayload: Record<string, unknown>,
    runtimeNode?: string
  ): Promise<void> {
    const target = runtimeNode || node.nodeName;
    await this.request(
      node,
      "PUT",
      `/api2/json/nodes/${encodeURIComponent(target)}/lxc/${vmid}/config`,
      configPayload
    );
  }

  /**
   * Update the root password of an LXC container
   */
  public static async setLxcPassword(
    node: ProxmoxNodeConfig,
    vmid: number,
    password: string,
    runtimeNode?: string
  ): Promise<void> {
    await this.updateLxcConfig(node, vmid, { password }, runtimeNode);
  }

  /**
   * Check if an LXC container currently has an active lock state (e.g. backup, create, disk)
   */
  public static async checkLxcLocked(
    node: ProxmoxNodeConfig,
    vmid: number,
    runtimeNode?: string
  ): Promise<{ locked: boolean; lockName?: string }> {
    try {
      const config = await this.getLxcConfig(node, vmid, runtimeNode);
      if (config.lock && typeof config.lock === "string" && config.lock.trim().length > 0) {
        return { locked: true, lockName: config.lock.trim() };
      }
      return { locked: false };
    } catch {
      return { locked: false };
    }
  }

  /**
   * Request API Version from Proxmox VE
   */
  public static async getApiVersion(
    node: ProxmoxNodeConfig
  ): Promise<{ release: string; repo_id: string; version: string }> {
    const res = await this.request<{
      release: string;
      repo_id: string;
      version: string;
    }>(node, "GET", "/api2/json/version");
    return res.data;
  }

  /**
   * Authoritatively resolve the current runtime hypervisor node hosting an LXC container.
   *
   * Flow:
   * 1. Try configured node: GET /api2/json/nodes/{nodeName}/lxc/{vmid}/status/current
   *    If 200 OK: return { ok: true, nodeName: node.nodeName, vmid, status, uptime, discoveredFrom: "direct" }
   * 2. If genuine not-found / location failure (404, or node mismatch):
   *    Query cluster resource inventory: GET /api2/json/cluster/resources?type=vm
   *    Filter explicitly for item.type === "lxc" && Number(item.vmid) === Number(vmid)
   * 3. If found:
   *    return actual runtime node { ok: true, nodeName: item.node, discoveredFrom: "cluster" }
   * 4. If not found on any cluster node:
   *    return typed failure { ok: false, reason: "not_found" }
   * 5. If cluster query itself fails:
   *    return typed failure without collapsing into not_found
   */
  public static async resolveLxcRuntimeTarget(
    node: ProxmoxNodeConfig,
    vmid: number
  ): Promise<LxcRuntimeTargetResult> {
    // 1. Try configured node first
    try {
      const res = await this.request<{
        status?: "running" | "stopped";
        uptime?: number;
      }>(
        node,
        "GET",
        `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/lxc/${vmid}/status/current`
      );

      return {
        ok: true,
        nodeName: node.nodeName,
        vmid,
        status: res.data?.status,
        uptime: res.data?.uptime,
        discoveredFrom: "direct",
      };
    } catch (err: unknown) {
      if (err instanceof ProxmoxRequestError) {
        if (err.statusCode === 401 || err.statusCode === 403) {
          return {
            ok: false,
            reason: "authorization_failed",
            message: err.message || "Proxmox API authorization failed. Check token permissions and privilege separation.",
          };
        }
      }
      // Direct query failed (e.g. 404 container not on this node, or node name mismatch)
      // Fall through to cluster discovery
    }

    // 2. Query cluster resource inventory
    try {
      const clusterRes = await this.request<
        Array<{
          id: string;
          type: string;
          vmid: number | string;
          node: string;
          status?: string;
          uptime?: number;
        }>
      >(node, "GET", "/api2/json/cluster/resources?type=vm");

      const items = Array.isArray(clusterRes.data) ? clusterRes.data : [];
      const match = items.find(
        (it) => it.type === "lxc" && Number(it.vmid) === Number(vmid)
      );

      if (match && match.node) {
        return {
          ok: true,
          nodeName: match.node,
          vmid,
          status: match.status,
          uptime: match.uptime,
          discoveredFrom: "cluster",
        };
      }

      return {
        ok: false,
        reason: "not_found",
        message: `Container ${vmid} was not found in Proxmox cluster resources.`,
      };
    } catch (clusterErr: unknown) {
      if (clusterErr instanceof ProxmoxRequestError) {
        if (clusterErr.statusCode === 401 || clusterErr.statusCode === 403) {
          return {
            ok: false,
            reason: "authorization_failed",
            message: clusterErr.message,
          };
        }
        if (clusterErr.isConnRefused || clusterErr.isTimeout || clusterErr.isTlsError) {
          return {
            ok: false,
            reason: "node_unreachable",
            message: clusterErr.message,
          };
        }
      }
      return {
        ok: false,
        reason: "discovery_unavailable",
        message: clusterErr instanceof Error ? clusterErr.message : String(clusterErr),
      };
    }
  }

  /**
   * Request a termproxy ticket for real interactive console sessions
   */
  public static async createLxcTermProxy(
    node: ProxmoxNodeConfig,
    vmid: number,
    runtimeNode?: string
  ): Promise<{ port: number; ticket: string; upid: string; user: string; runtimeNode: string }> {
    let targetNode = runtimeNode;
    if (!targetNode) {
      const resolved = await this.resolveLxcRuntimeTarget(node, vmid);
      targetNode = resolved.ok ? resolved.nodeName : node.nodeName;
    }

    const res = await this.request<{
      port?: number | string;
      ticket?: string;
      upid?: string;
      user?: string;
    }>(
      node,
      "POST",
      `/api2/json/nodes/${encodeURIComponent(targetNode)}/lxc/${vmid}/termproxy`
    );

    if (!res.data) {
      throw new ProxmoxRequestError(
        "Proxmox termproxy returned an empty response body.",
        {
          classification: "TERM_PROXY_INVALID_RESPONSE",
          statusCode: 200,
        }
      );
    }

    const rawPort = res.data.port;
    const portNum = typeof rawPort === "string" ? parseInt(rawPort, 10) : Number(rawPort);
    const ticket = res.data.ticket;

    if (!portNum || isNaN(portNum) || portNum <= 0 || !ticket || typeof ticket !== "string" || ticket.trim().length === 0) {
      throw new ProxmoxRequestError(
        "Proxmox termproxy returned invalid response: missing or invalid port/ticket.",
        {
          classification: "TERM_PROXY_INVALID_RESPONSE",
          statusCode: 200,
          safeBodySnippet: JSON.stringify(res.data),
        }
      );
    }

    return {
      port: portNum,
      ticket: ticket.trim(),
      upid: res.data.upid || "",
      user: (res.data.user || node.authTokenId || "root@pam").trim(),
      runtimeNode: targetNode,
    };
  }

  /**
   * Direct server-side diagnostic method for Proxmox LXC termproxy
   */
  public static async testTermProxy(
    node: ProxmoxNodeConfig,
    vmid: number
  ): Promise<ConsoleDiagnosticResult> {
    const startTime = Date.now();
    const endpoint = resolveProxmoxEndpoint(node.apiUrl, node.hostname, node.port);

    const stages: NonNullable<ConsoleDiagnosticResult["stages"]> = {
      runtime: { status: "skipped" },
      api: { status: "skipped" },
      termproxy: { status: "skipped" },
      upstreamUpgrade: { status: "skipped" },
      termproxyHandshake: { status: "skipped" },
    };

    // 1. Verify container exists and check status with cluster awareness
    let lxcStatus: string = "unknown";
    let runtimeNode: string = node.nodeName;
    let runtimeNodeSource: "direct" | "cluster" | "configured" = "configured";

    try {
      const statusRes = await this.getLxcStatus(node, vmid);
      lxcStatus = statusRes.status;
      runtimeNode = statusRes.runtimeNode;
      runtimeNodeSource = statusRes.runtimeNodeSource;
      stages.runtime = {
        status: statusRes.ok ? "ok" : "failed",
        node: runtimeNode,
        latencyMs: Date.now() - startTime,
        message: statusRes.ok ? `LXC verified on node '${runtimeNode}'` : statusRes.error,
      };

      if (lxcStatus === "stopped") {
        return {
          ok: false,
          endpoint: endpoint.displayTarget,
          proxied: false,
          proxyType: "direct",
          statusCode: 200,
          lxcStatus,
          runtimeNode,
          runtimeNodeSource,
          latencyMs: Date.now() - startTime,
          classification: "LXC_STOPPED",
          recommendedFix: "VPS is stopped. Start it to open the console.",
          stages,
        };
      }
      if (!statusRes.ok && statusRes.classification === "LXC_NOT_FOUND") {
        return {
          ok: false,
          endpoint: endpoint.displayTarget,
          proxied: false,
          proxyType: "direct",
          statusCode: 404,
          lxcStatus: "not_found",
          runtimeNode,
          runtimeNodeSource,
          latencyMs: Date.now() - startTime,
          classification: "LXC_NOT_FOUND",
          recommendedFix: "The Proxmox container was not found on this hypervisor node or cluster.",
          stages,
        };
      }
    } catch (err: unknown) {
      if (err instanceof ProxmoxRequestError) {
        if (err.classification === "LXC_NOT_FOUND" || err.statusCode === 404) {
          stages.runtime = {
            status: "failed",
            node: runtimeNode,
            latencyMs: Date.now() - startTime,
            message: "Container not found",
          };
          return {
            ok: false,
            endpoint: endpoint.displayTarget,
            proxied: err.proxyDetected,
            proxyType: err.proxyType,
            statusCode: 404,
            lxcStatus: "not_found",
            runtimeNode,
            runtimeNodeSource,
            latencyMs: Date.now() - startTime,
            classification: "LXC_NOT_FOUND",
            recommendedFix: "The Proxmox container was not found on this hypervisor node.",
            stages,
          };
        }
      }
    }

    // 2. Query PVE version (API verification)
    let pveVersion: string | undefined;
    try {
      const apiStart = Date.now();
      const ver = await this.getApiVersion(node);
      pveVersion = ver.release || ver.version;
      stages.api = {
        status: "ok",
        latencyMs: Date.now() - apiStart,
        message: `Proxmox VE API reachable (v${pveVersion})`,
      };
    } catch (err: unknown) {
      stages.api = {
        status: "failed",
        latencyMs: Date.now() - startTime,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // 3. Attempt createLxcTermProxy
    let termproxy: { port: number; ticket: string; upid: string; user: string; runtimeNode: string };
    try {
      const termStart = Date.now();
      termproxy = await this.createLxcTermProxy(node, vmid, runtimeNode);
      stages.termproxy = {
        status: "ok",
        latencyMs: Date.now() - termStart,
        message: `Termproxy allocated port ${termproxy.port}`,
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - startTime;
      stages.termproxy = {
        status: "failed",
        latencyMs,
        message: err instanceof Error ? err.message : String(err),
      };

      if (err instanceof ProxmoxRequestError) {
        let recommendedFix: string | undefined;
        if (err.classification === "CLOUDFLARE_501") {
          recommendedFix =
            "Cloudflare Tunnel detected. Add 'disableChunkedEncoding: true' and enable WebSockets in originRequest.";
        } else if (err.classification === "REVERSE_PROXY_501") {
          recommendedFix =
            "Reverse proxy detected. Verify WebSocket support and ensure chunked transfer encoding is not forced.";
        } else if (err.classification === "AUTHENTICATION_FAILURE") {
          recommendedFix = "Verify Proxmox API Token ID and Token Secret.";
        } else if (err.classification === "AUTHORIZATION_FAILURE") {
          recommendedFix =
            "Verify Proxmox API Token has VM.Console or Sys.Console permissions and 'Privilege Separation' is unchecked.";
        }

        return {
          ok: false,
          endpoint: endpoint.displayTarget,
          proxied: err.proxyDetected,
          proxyType: err.proxyType,
          statusCode: err.statusCode,
          statusMessage: err.statusMessage,
          contentType: err.contentType,
          responseSnippet: err.safeBodySnippet,
          lxcStatus,
          runtimeNode,
          runtimeNodeSource,
          proxmoxVersion: pveVersion,
          latencyMs,
          classification: err.classification,
          recommendedFix,
          stages,
        };
      }

      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        endpoint: endpoint.displayTarget,
        proxied: false,
        proxyType: "direct",
        lxcStatus,
        runtimeNode,
        runtimeNodeSource,
        proxmoxVersion: pveVersion,
        latencyMs,
        classification: "UNKNOWN_CONSOLE_FAILURE",
        recommendedFix: msg,
        stages,
      };
    }

    // 4. Probe upstream WebSocket HTTP 101 upgrade & termproxy handshake
    const wsProtocol = endpoint.isHttps ? "wss" : "ws";
    const wsPort =
      (endpoint.isHttps && endpoint.port === 443) || (!endpoint.isHttps && endpoint.port === 80)
        ? ""
        : `:${endpoint.port}`;
    const cleanBase = `${wsProtocol}://${endpoint.hostname}${wsPort}${endpoint.pathname}`;
    const upstreamUrl = `${cleanBase}/api2/json/nodes/${encodeURIComponent(
      runtimeNode
    )}/lxc/${vmid}/vncwebsocket?port=${termproxy.port}&vncticket=${encodeURIComponent(
      termproxy.ticket
    )}`;

    const wsAgent = endpoint.isHttps
      ? new https.Agent({ rejectUnauthorized: !node.allowInsecureTls })
      : undefined;

    try {
      const probeStart = Date.now();
      const probeResult = await new Promise<{
        upgradeOk: boolean;
        handshakeOk: boolean;
        httpStatus?: number;
        code?: string;
        message?: string;
        recommendedFix?: string;
      }>((resolve) => {
        let finished = false;
        let probeWs: WebSocket | null = null;
        const timer = setTimeout(() => {
          if (finished) return;
          finished = true;
          try { probeWs?.terminate(); } catch {}
          resolve({
            upgradeOk: false,
            handshakeOk: false,
            code: "UPSTREAM_TIMEOUT",
            message: "Upstream WebSocket connection probe timed out after 5000ms.",
            recommendedFix: "Check network connectivity to the Proxmox host.",
          });
        }, 5000);

        try {
          probeWs = new WebSocket(upstreamUrl, ["binary"], {
            agent: wsAgent,
            rejectUnauthorized: !node.allowInsecureTls,
            headers: {
              Authorization: `PVEAPIToken=${node.authTokenId}=${node.authTokenSecret}`,
              "User-Agent": "InterDash-Console-Probe/1.0",
            },
          });
        } catch (wsInitErr) {
          clearTimeout(timer);
          finished = true;
          resolve({
            upgradeOk: false,
            handshakeOk: false,
            code: "WEBSOCKET_CONNECTION_FAILURE",
            message: wsInitErr instanceof Error ? wsInitErr.message : String(wsInitErr),
          });
          return;
        }

          probeWs.on("error", (err) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            try { probeWs?.terminate(); } catch {}
            resolve({
              upgradeOk: false,
              handshakeOk: false,
              code: "WEBSOCKET_CONNECTION_FAILURE",
              message: err.message,
            });
          });

          probeWs.on("unexpected-response", (_req, res) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            try { probeWs?.terminate(); } catch {}
            const classified = classifyConsoleUpgradeError(res.statusCode, res.statusMessage);
            resolve({
              upgradeOk: false,
              handshakeOk: false,
              httpStatus: res.statusCode,
              code: classified.code,
              message: classified.message,
              recommendedFix: classified.recommendedFix,
            });
          });

          probeWs.on("open", () => {
            try {
              probeWs?.send(`${termproxy.user}:${termproxy.ticket}\n`);
            } catch {}
          });

          probeWs.on("message", (msgData) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            const parsed = parseTermproxyResponse(typeof msgData === "string" ? msgData : (msgData as Buffer));
            try { probeWs?.close(1000); } catch {}
            if (parsed.ready) {
              resolve({ upgradeOk: true, handshakeOk: true });
            } else {
              resolve({
                upgradeOk: true,
                handshakeOk: false,
                code: "TERMPROXY_UNEXPECTED_RESPONSE",
                message: "Proxmox termproxy returned unexpected response during handshake.",
                recommendedFix: "Verify container console process is running and healthy.",
              });
            }
          });

          probeWs.on("close", (code) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve({
              upgradeOk: true,
              handshakeOk: false,
              code: "TERMPROXY_HANDSHAKE_REJECTED",
              message: `Proxmox termproxy closed connection during handshake (code ${code}). Verify that API Token has VM.Console permissions and Privilege Separation is unchecked.`,
              recommendedFix: "Verify Proxmox API Token has VM.Console permissions and Privilege Separation is unchecked in Proxmox Datacenter token settings.",
            });
          });
      });

      const probeLatency = Date.now() - probeStart;
      stages.upstreamUpgrade = {
        status: probeResult.upgradeOk ? "ok" : "failed",
        httpStatus: probeResult.httpStatus || (probeResult.upgradeOk ? 101 : undefined),
        code: probeResult.upgradeOk ? undefined : probeResult.code,
        message: probeResult.upgradeOk ? "HTTP 101 Switching Protocols accepted" : probeResult.message,
        latencyMs: probeLatency,
      };

      stages.termproxyHandshake = {
        status: probeResult.handshakeOk ? "ok" : (probeResult.upgradeOk ? "failed" : "skipped"),
        code: probeResult.handshakeOk ? undefined : probeResult.code,
        message: probeResult.handshakeOk ? "Handshake accepted ('OK')" : probeResult.message,
        latencyMs: probeLatency,
      };

      if (!probeResult.upgradeOk || !probeResult.handshakeOk) {
        return {
          ok: false,
          endpoint: endpoint.displayTarget,
          proxied: false,
          proxyType: "direct",
          statusCode: probeResult.httpStatus || 200,
          lxcStatus,
          runtimeNode: termproxy.runtimeNode,
          runtimeNodeSource,
          proxmoxVersion: pveVersion,
          latencyMs: Date.now() - startTime,
          classification: (probeResult.code as ProxmoxErrorClassification) || "UNKNOWN_CONSOLE_FAILURE",
          recommendedFix: probeResult.recommendedFix || probeResult.message,
          port: termproxy.port,
          user: termproxy.user,
          stages,
        };
      }
    } catch {
      // Diagnostic probe failed gracefully
    }

    return {
      ok: true,
      endpoint: endpoint.displayTarget,
      proxied: false,
      proxyType: "direct",
      statusCode: 200,
      lxcStatus,
      runtimeNode: termproxy.runtimeNode,
      runtimeNodeSource,
      proxmoxVersion: pveVersion,
      latencyMs: Date.now() - startTime,
      classification: "PROXMOX_501_TERM_PROXY",
      port: termproxy.port,
      user: termproxy.user,
      stages,
    };
  }

  /**
   * Centralized Proxmox background task polling with timeout and error handling
   */
  public static async waitForProxmoxTask(
    node: ProxmoxNodeConfig,
    upid: string,
    timeoutMs = 120_000,
    intervalMs = 1_500
  ): Promise<{ exitstatus: string }> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const taskStatus = await this.getTaskStatus(node, upid);
      if (taskStatus.status === "stopped") {
        const exitstatus = taskStatus.exitstatus || "OK";
        if (exitstatus !== "OK") {
          throw new Error(`Proxmox task failed: ${exitstatus}`);
        }
        return { exitstatus };
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(
      `Proxmox task timed out after ${Math.round(timeoutMs / 1000)}s [UPID: ${upid}]`
    );
  }

  /**
   * Poll a Proxmox background task by UPID
   */
  public static async getTaskStatus(
    node: ProxmoxNodeConfig,
    upid: string
  ): Promise<{ status: "running" | "stopped"; exitstatus?: string }> {
    const res = await this.request<{
      status: "running" | "stopped";
      exitstatus?: string;
    }>(
      node,
      "GET",
      `/api2/json/nodes/${encodeURIComponent(
        node.nodeName
      )}/tasks/${encodeURIComponent(upid)}/status`
    );
    return res.data;
  }

  /**
   * Query the live status of an LXC container with authoritative cluster-aware runtime resolution.
   */
  public static async getLxcStatus(
    node: ProxmoxNodeConfig,
    vmid: number,
    runtimeNode?: string
  ): Promise<LxcStatusResult> {
    const effectiveNode = runtimeNode || node.nodeName;

    // Step 1: Query the node's current container status
    try {
      const res = await this.request<{
        status: "running" | "stopped";
        name?: string;
        cpus?: number;
        maxmem?: number;
        maxdisk?: number;
        uptime?: number;
      }>(
        node,
        "GET",
        `/api2/json/nodes/${encodeURIComponent(effectiveNode)}/lxc/${vmid}/status/current`
      );

      return {
        ok: true,
        status: res.data.status,
        runtimeNode: effectiveNode,
        runtimeNodeSource: runtimeNode ? "direct" : "configured",
        name: res.data.name,
        cpus: res.data.cpus,
        maxmem: res.data.maxmem,
        maxdisk: res.data.maxdisk,
        uptime: res.data.uptime,
        lastVerifiedAt: new Date().toISOString(),
      };
    } catch (err: unknown) {
      // Step 2: If runtimeNode was not pinned and direct query failed, attempt cluster resolution
      if (!runtimeNode) {
        const target = await this.resolveLxcRuntimeTarget(node, vmid);
        if (target.ok && target.nodeName !== effectiveNode) {
          try {
            const res = await this.request<{
              status: "running" | "stopped";
              name?: string;
              cpus?: number;
              maxmem?: number;
              maxdisk?: number;
              uptime?: number;
            }>(
              node,
              "GET",
              `/api2/json/nodes/${encodeURIComponent(target.nodeName)}/lxc/${vmid}/status/current`
            );

            return {
              ok: true,
              status: res.data.status,
              runtimeNode: target.nodeName,
              runtimeNodeSource: "cluster",
              name: res.data.name,
              cpus: res.data.cpus,
              maxmem: res.data.maxmem,
              maxdisk: res.data.maxdisk,
              uptime: res.data.uptime,
              lastVerifiedAt: new Date().toISOString(),
            };
          } catch (retryErr: unknown) {
            err = retryErr;
          }
        }
      }

      // Step 3: Return structured failure without throwing or swallowing diagnostic info
      const classification =
        err instanceof ProxmoxRequestError ? err.classification : "UNKNOWN_CONSOLE_FAILURE";
      const errorMsg = err instanceof Error ? err.message : String(err);

      return {
        ok: false,
        status: "unknown",
        runtimeNode: effectiveNode,
        runtimeNodeSource: "configured",
        classification,
        error: errorMsg,
      };
    }
  }
}

/**
 * Proxmox termproxy application protocol framing helpers
 */
export function buildTermproxyInputFrame(data: string | Buffer): string {
  const str = typeof data === "string" ? data : data.toString("utf8");
  const byteLength = Buffer.byteLength(str, "utf8");
  return `0:${byteLength}:${str}`;
}

export function buildTermproxyResizeFrame(cols: number, rows: number): string {
  const safeCols = Math.max(1, Math.min(cols, 1000));
  const safeRows = Math.max(1, Math.min(rows, 1000));
  return `1:${safeCols}:${safeRows}:`;
}

export function buildTermproxyKeepaliveFrame(): string {
  return "2";
}

/**
 * Robust parser for Proxmox termproxy initial handshake response
 */
export function parseTermproxyResponse(data: Buffer | string): {
  ready: boolean;
  remaining?: Buffer;
  rawText: string;
} {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  const rawText = buf.toString("utf8");

  // Proxmox termproxy writes "OK" (bytes 79, 75) upon successful ticket validation
  if (buf.length >= 2 && buf[0] === 0x4f && buf[1] === 0x4b) {
    const remaining = buf.subarray(2);
    return {
      ready: true,
      remaining: remaining.length > 0 ? remaining : undefined,
      rawText,
    };
  }

  // Also check if string representation starts with "OK"
  if (rawText.startsWith("OK")) {
    const okByteLen = Buffer.byteLength("OK", "utf8");
    const remaining = buf.subarray(okByteLen);
    return {
      ready: true,
      remaining: remaining.length > 0 ? remaining : undefined,
      rawText,
    };
  }

  return {
    ready: false,
    rawText,
  };
}

/**
 * Classify HTTP status codes received during WebSocket upgrade
 */
export function classifyConsoleUpgradeError(
  statusCode?: number,
  statusText?: string,
  headers?: Record<string, string>,
  bodySnippet?: string
): {
  code: string;
  classification: ProxmoxErrorClassification;
  message: string;
  retryable: boolean;
  recommendedFix?: string;
} {
  const status = statusCode || 0;

  if (status === 401) {
    return {
      code: "PROXMOX_CONSOLE_AUTH_FAILED",
      classification: "AUTHENTICATION_FAILURE",
      message: "Proxmox console WebSocket upgrade authentication failed (HTTP 401). Verify API token ID and secret.",
      retryable: false,
      recommendedFix: "Verify Proxmox API Token credentials.",
    };
  }

  if (status === 403) {
    return {
      code: "PROXMOX_CONSOLE_UPGRADE_DENIED",
      classification: "AUTHORIZATION_FAILURE",
      message: "Proxmox rejected console WebSocket upgrade with HTTP 403 Forbidden. The API token lacks VM.Console permission or Privilege Separation is enabled in Proxmox.",
      retryable: false,
      recommendedFix: "Ensure the API token has 'VM.Console' permission and 'Privilege Separation' is unchecked in Proxmox datacenter token settings.",
    };
  }

  if (status === 404) {
    return {
      code: "PROXMOX_CONSOLE_ENDPOINT_NOT_FOUND",
      classification: "LXC_NOT_FOUND",
      message: "Proxmox console WebSocket endpoint not found (HTTP 404). The container or node may have been moved.",
      retryable: false,
      recommendedFix: "Check runtime node and container ID.",
    };
  }

  if (status === 426) {
    return {
      code: "PROXMOX_CONSOLE_UPGRADE_REJECTED",
      classification: "REVERSE_PROXY_501",
      message: "Hypervisor or intermediary requested protocol upgrade (HTTP 426). Verify WebSocket upgrade headers.",
      retryable: false,
      recommendedFix: "Ensure reverse proxy supports WebSocket upgrades.",
    };
  }

  if (status === 501) {
    const isCloudflare =
      headers?.["server"]?.toLowerCase().includes("cloudflare") || headers?.["cf-ray"] !== undefined;
    return {
      code: isCloudflare ? "CLOUDFLARE_501_WEBSOCKET" : "REVERSE_PROXY_501_WEBSOCKET",
      classification: isCloudflare ? "CLOUDFLARE_501" : "REVERSE_PROXY_501",
      message: isCloudflare
        ? "Proxmox console WebSocket upgrade returned HTTP 501 through Cloudflare Tunnel. Verify WebSockets are enabled and disableChunkedEncoding: true in cloudflared originRequest."
        : "Proxmox console WebSocket upgrade returned HTTP 501 Not Implemented through reverse proxy.",
      retryable: false,
      recommendedFix: "Ensure Cloudflare tunnel or reverse proxy has WebSocket proxying enabled and chunked encoding disabled.",
    };
  }

  if (status >= 502 && status <= 504) {
    return {
      code: "PROXMOX_GATEWAY_ERROR",
      classification: "CONNECTION_REFUSED",
      message: `Upstream gateway error (HTTP ${status}) contacting Proxmox console. The hypervisor or tunnel may be temporarily unreachable.`,
      retryable: true,
      recommendedFix: "Check Proxmox server health and network connectivity.",
    };
  }

  return {
    code: "PROXMOX_CONSOLE_UPGRADE_FAILED",
    classification: "UNKNOWN_CONSOLE_FAILURE",
    message: `Proxmox console WebSocket upgrade failed with HTTP ${status} ${statusText || ""}`.trim(),
    retryable: status >= 500,
    recommendedFix: "Inspect hypervisor logs for more details.",
  };
}

