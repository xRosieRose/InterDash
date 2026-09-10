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
  authTokenId: string; // e.g. "root@pam!interdash"
  authTokenSecret: string; // decrypted token secret
  allowInsecureTls: boolean;
  defaultStorage: string;
  defaultBridge: string;
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
  storage?: string;
  bridge?: string;
  ipv4?: string;
  ipv4Gateway?: string;
  ipv6?: string;
  startAfterCreate?: boolean;
}

export class ProxmoxService {
  /**
   * Low-level HTTP/HTTPS request to Proxmox VE API
   */
  private static async request<T = unknown>(
    node: ProxmoxNodeConfig,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: Record<string, unknown>
  ): Promise<{ status: number; data: T }> {
    return new Promise((resolve, reject) => {
      // Build clean URL
      const cleanBase = node.apiUrl.replace(/\/+$/, "");
      const fullUrlStr = `${cleanBase}${path.startsWith("/") ? path : `/${path}`}`;
      const parsed = new URL(fullUrlStr);

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
          timeout: 15000,
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
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve({ status: res.statusCode, data: (json.data ?? json) as T });
              } else {
                const errMsg =
                  json.errors ||
                  json.message ||
                  (typeof json.data === "string" ? json.data : null) ||
                  `HTTP ${res.statusCode}: ${res.statusMessage}`;
                reject(
                  new Error(
                    `Proxmox API Error [${method} ${path}]: ${
                      typeof errMsg === "object" ? JSON.stringify(errMsg) : errMsg
                    }`
                  )
                );
              }
            } catch {
              reject(
                new Error(
                  `Proxmox API Error [${method} ${path}]: Invalid JSON response (HTTP ${res.statusCode})`
                )
              );
            }
          });
        }
      );

      req.on("error", (err) => {
        reject(
          new Error(
            `Proxmox Connection Failed [${node.hostname}:${node.port}]: ${err.message}`
          )
        );
      });

      req.on("timeout", () => {
        req.destroy();
        reject(
          new Error(
            `Proxmox Connection Timeout [${node.hostname}:${node.port}] after 15s`
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
   * Perform real health check against Proxmox VE API
   */
  public static async healthCheck(node: ProxmoxNodeConfig): Promise<ProxmoxHealthResult> {
    const startTime = Date.now();
    try {
      // Query Proxmox VE version
      const verRes = await this.request<{
        release: string;
        repo_id: string;
        version: string;
      }>(node, "GET", "/api2/json/version");

      const latencyMs = Date.now() - startTime;

      // Also attempt node status query if nodeName is configured
      let nodeStatus: Record<string, unknown> | undefined;
      try {
        const statusRes = await this.request<Record<string, unknown>>(
          node,
          "GET",
          `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/status`
        );
        nodeStatus = statusRes.data;
      } catch {
        // Node status might require additional privileges; version check is primary
      }

      return {
        online: true,
        version: verRes.data.version,
        release: verRes.data.release,
        repoid: verRes.data.repo_id,
        nodeStatus,
        latencyMs,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        online: false,
        latencyMs: Date.now() - startTime,
        error: errorMsg,
      };
    }
  }

  /**
   * Discover available storage pools on the Proxmox node
   */
  public static async getStorageList(
    node: ProxmoxNodeConfig
  ): Promise<Array<{ storage: string; type: string; active: number; content: string }>> {
    const res = await this.request<
      Array<{ storage: string; type: string; active: number; content: string }>
    >(node, "GET", `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/storage`);
    return res.data || [];
  }

  /**
   * Discover available templates/images on a specific storage pool
   */
  public static async getTemplates(
    node: ProxmoxNodeConfig,
    storageName?: string
  ): Promise<Array<{ volid: string; format: string; size: number }>> {
    const storage = storageName || node.defaultStorage;
    const res = await this.request<
      Array<{ volid: string; format: string; size: number }>
    >(
      node,
      "GET",
      `/api2/json/nodes/${encodeURIComponent(
        node.nodeName
      )}/storage/${encodeURIComponent(storage)}/content?content=vztmpl`
    );
    return res.data || [];
  }

  /**
   * Discover available network bridges on the Proxmox node
   */
  public static async getNetworkBridges(
    node: ProxmoxNodeConfig
  ): Promise<Array<{ iface: string; type: string; active: number }>> {
    const res = await this.request<
      Array<{ iface: string; type: string; active: number }>
    >(node, "GET", `/api2/json/nodes/${encodeURIComponent(node.nodeName)}/network?type=bridge`);
    return res.data || [];
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
   * Create an LXC Container through Proxmox API
   */
  public static async createLxc(
    node: ProxmoxNodeConfig,
    params: ProxmoxCreateLxcParams
  ): Promise<{ upid: string; vmid: number }> {
    const storage = params.storage || node.defaultStorage;
    const bridge = params.bridge || node.defaultBridge;

    // Construct net0 string
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
      rootfs: `${storage}:${params.diskGb}`,
      net0,
      unprivileged: 1,
      start: params.startAfterCreate ? 1 : 0,
      onboot: 1,
      features: "nesting=1",
    };

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
