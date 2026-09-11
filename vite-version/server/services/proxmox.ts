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
}

export type VerificationStatus = "passed" | "warning" | "failed";

export type NodeOperationalStatus =
  | "healthy"
  | "degraded"
  | "offline"
  | "misconfigured"
  | "unverified"
  | "unknown";

export interface NodeVerificationCheck {
  name: string;
  status: VerificationStatus;
  message: string;
  details?: Record<string, unknown>;
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

export class ProxmoxRequestError extends Error {
  public statusCode?: number;
  public isTlsError: boolean;
  public isTimeout: boolean;
  public isConnRefused: boolean;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      isTlsError?: boolean;
      isTimeout?: boolean;
      isConnRefused?: boolean;
    }
  ) {
    super(message);
    this.name = "ProxmoxRequestError";
    this.statusCode = options?.statusCode;
    this.isTlsError = Boolean(options?.isTlsError);
    this.isTimeout = Boolean(options?.isTimeout);
    this.isConnRefused = Boolean(options?.isConnRefused);
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
      const cleanBase = node.apiUrl.replace(/\/+$/, "");
      const fullUrlStr = `${cleanBase}${path.startsWith("/") ? path : `/${path}`}`;
      let parsed: URL;
      try {
        parsed = new URL(fullUrlStr);
      } catch (err: unknown) {
        return reject(
          new ProxmoxRequestError(
            `Invalid Proxmox API URL: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }

      const isHttps = parsed.protocol === "https:";
      const client = isHttps ? https : http;
      const postData = body ? JSON.stringify(body) : "";

      const headers: Record<string, string> = {
        Authorization: `PVEAPIToken=${node.authTokenId}=${node.authTokenSecret}`,
        Accept: "application/json",
      };

      if (body) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = Buffer.byteLength(postData).toString();
      }

      const agent = isHttps
        ? new https.Agent({
            rejectUnauthorized: !node.allowInsecureTls,
          })
        : undefined;

      const req = client.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || node.port || (isHttps ? 8006 : 80),
          path: parsed.pathname + parsed.search,
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
            try {
              const json = rawData ? JSON.parse(rawData) : {};
              const statusCode = res.statusCode || 500;

              if (statusCode >= 200 && statusCode < 300) {
                resolve({ status: statusCode, data: (json.data !== undefined ? json.data : json) as T });
              } else {
                let errMsg =
                  json.errors ||
                  json.message ||
                  (typeof json.data === "string" ? json.data : null) ||
                  `HTTP ${statusCode}: ${res.statusMessage}`;

                if (typeof errMsg === "object") {
                  errMsg = JSON.stringify(errMsg);
                }

                if (statusCode === 401) {
                  errMsg = "Authentication failed. Invalid Proxmox API Token ID or Secret.";
                } else if (statusCode === 403) {
                  errMsg = "Permission denied. Proxmox API Token lacks privileges for this action.";
                }

                reject(
                  new ProxmoxRequestError(`Proxmox API Error [${method} ${path}]: ${errMsg}`, {
                    statusCode,
                  })
                );
              }
            } catch {
              reject(
                new ProxmoxRequestError(
                  `Proxmox API Error [${method} ${path}]: Invalid JSON response (HTTP ${res.statusCode})`,
                  { statusCode: res.statusCode }
                )
              );
            }
          });
        }
      );

      req.on("error", (err: NodeJS.ErrnoException) => {
        const isTls =
          err.message.includes("certificate") ||
          err.message.includes("self-signed") ||
          err.code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
          err.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
          err.code === "CERT_HAS_EXPIRED";

        const isConnRefused = err.code === "ECONNREFUSED";

        let userMsg = `Proxmox Connection Failed [${node.hostname}:${node.port}]: ${err.message}`;
        if (isTls) {
          userMsg = `TLS certificate validation failed for [${node.hostname}:${node.port}]. If Proxmox uses a default self-signed certificate, enable 'Allow Self-Signed TLS'.`;
        } else if (isConnRefused) {
          userMsg = `Connection refused at [${node.hostname}:${node.port}]. Verify that Proxmox is online and the API port is accessible.`;
        }

        reject(
          new ProxmoxRequestError(userMsg, {
            isTlsError: isTls,
            isConnRefused,
          })
        );
      });

      req.on("timeout", () => {
        req.destroy();
        reject(
          new ProxmoxRequestError(
            `Proxmox Connection Timeout [${node.hostname}:${node.port}] after ${Math.max(1, Math.round(timeoutMs / 1000))}s`,
            { isTimeout: true }
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
   * Normalizes content types into supportsTemplates (vztmpl) and supportsRootfs (rootdir).
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
        supportsRootfs: contentList.includes("rootdir"),
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
        message: `Connected successfully to ${node.hostname}:${node.port} (${latencyMs}ms)`,
        details: { latencyMs, apiUrl: node.apiUrl },
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
          message: `Reachable at ${node.hostname}:${node.port}, but TLS handshake failed.`,
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
          message: `Connected to ${node.hostname}:${node.port} (${latencyMs}ms)`,
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

    if (rootfsStorages.length > 0) {
      checks.push({
        name: "rootfs_storage_discovery",
        status: "passed",
        message: `Storage pool(s) supporting container root disks (rootdir): ${rootfsStorages.join(", ")}.`,
        details: { rootfsStorages },
      });
    } else {
      checks.push({
        name: "rootfs_storage_discovery",
        status: "warning",
        message: `No active storage pool on node '${node.nodeName}' is configured with content type 'rootdir'.`,
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
    const provisionReady = Boolean(
      readReady &&
      templateStorages.length > 0 &&
      templates.length > 0 &&
      rootfsStorages.length > 0 &&
      bridges.length > 0 &&
      permissions.canAllocateVmid === "verified"
    );

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
    params: ProxmoxCreateLxcParams
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

    const res = await this.request<string>(
      node,
      "POST",
      `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/lxc`,
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
    vmid: number
  ): Promise<{ upid: string }> {
    const res = await this.request<string>(
      node,
      "POST",
      `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/lxc/${vmid}/status/start`
    );
    return { upid: typeof res.data === "string" ? res.data : String(res.data) };
  }

  /**
   * Gracefully shut down an LXC container
   */
  public static async shutdownLxc(
    node: ProxmoxNodeConfig,
    vmid: number
  ): Promise<{ upid: string }> {
    const res = await this.request<string>(
      node,
      "POST",
      `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/lxc/${vmid}/status/shutdown`
    );
    return { upid: typeof res.data === "string" ? res.data : String(res.data) };
  }

  /**
   * Forcibly stop an LXC container
   */
  public static async stopLxc(
    node: ProxmoxNodeConfig,
    vmid: number
  ): Promise<{ upid: string }> {
    const res = await this.request<string>(
      node,
      "POST",
      `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/lxc/${vmid}/status/stop`
    );
    return { upid: typeof res.data === "string" ? res.data : String(res.data) };
  }

  /**
   * Reboot an LXC container
   */
  public static async rebootLxc(
    node: ProxmoxNodeConfig,
    vmid: number
  ): Promise<{ upid: string }> {
    const res = await this.request<string>(
      node,
      "POST",
      `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/lxc/${vmid}/status/reboot`
    );
    return { upid: typeof res.data === "string" ? res.data : String(res.data) };
  }

  /**
   * Destroy an LXC container and purge its volumes
   */
  public static async destroyLxc(
    node: ProxmoxNodeConfig,
    vmid: number,
    purge = true
  ): Promise<{ upid: string }> {
    const res = await this.request<string>(
      node,
      "DELETE",
      `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/lxc/${vmid}?purge=${purge ? 1 : 0}`
    );
    return { upid: typeof res.data === "string" ? res.data : String(res.data) };
  }

  /**
   * Read the configuration of an LXC container
   */
  public static async getLxcConfig(
    node: ProxmoxNodeConfig,
    vmid: number
  ): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(
      node,
      "GET",
      `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/lxc/${vmid}/config`
    );
    return res.data || {};
  }

  /**
   * Update configuration parameters on an LXC container
   */
  public static async updateLxcConfig(
    node: ProxmoxNodeConfig,
    vmid: number,
    configPayload: Record<string, unknown>
  ): Promise<void> {
    await this.request(
      node,
      "PUT",
      `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/lxc/${vmid}/config`,
      configPayload
    );
  }

  /**
   * Update the root password of an LXC container
   */
  public static async setLxcPassword(
    node: ProxmoxNodeConfig,
    vmid: number,
    password: string
  ): Promise<void> {
    await this.updateLxcConfig(node, vmid, { password });
  }

  /**
   * Check if an LXC container currently has an active lock state (e.g. backup, create, disk)
   */
  public static async checkLxcLocked(
    node: ProxmoxNodeConfig,
    vmid: number
  ): Promise<{ locked: boolean; lockName?: string }> {
    try {
      const config = await this.getLxcConfig(node, vmid);
      if (config.lock && typeof config.lock === "string" && config.lock.trim().length > 0) {
        return { locked: true, lockName: config.lock.trim() };
      }
      return { locked: false };
    } catch {
      return { locked: false };
    }
  }

  /**
   * Request a termproxy ticket for real interactive console sessions
   */
  public static async createLxcTermProxy(
    node: ProxmoxNodeConfig,
    vmid: number
  ): Promise<{ port: number; ticket: string; upid: string; user: string }> {
    const res = await this.request<{
      port: number | string;
      ticket: string;
      upid: string;
      user: string;
    }>(
      node,
      "POST",
      `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/lxc/${vmid}/termproxy`
    );

    const portNum = typeof res.data.port === "string" ? parseInt(res.data.port, 10) : res.data.port;
    return {
      port: portNum,
      ticket: res.data.ticket,
      upid: res.data.upid,
      user: res.data.user || "root@pam",
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
   * Query the live status of an LXC container
   */
  public static async getLxcStatus(
    node: ProxmoxNodeConfig,
    vmid: number
  ): Promise<{
    status: "running" | "stopped" | "unknown";
    name?: string;
    cpus?: number;
    maxmem?: number;
    maxdisk?: number;
    uptime?: number;
  }> {
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
        `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/lxc/${vmid}/status/current`
      );
      return res.data;
    } catch {
      return { status: "unknown" };
    }
  }
}
