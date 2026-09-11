/**
 * InterDash Server — Dedicated VPS Runtime Target Resolver
 *
 * Implements authoritative runtime location discovery and live state normalization.
 * Proxmox VE hypervisors may migrate containers across cluster members.
 * The configured integration (proxmox_nodes) represents the API gateway/endpoint,
 * NOT necessarily the physical cluster node currently running the container.
 *
 * Non-negotiable rules:
 *   - NEVER overwrite proxmox_nodes.node_name when a container moves.
 *   - Try direct query on configured node first; fall back to cluster resource discovery.
 *   - Return distinct error classifications (NOT_FOUND, NODE_UNREACHABLE, PERMISSION_DENIED, etc.).
 *   - Never map all errors to "unknown".
 */

import { queryOne, execute } from "../db/index.js";
import {
  ProxmoxService,
  ProxmoxRequestError,
  type ProxmoxNodeConfig,
} from "./proxmox.js";
import { ProvisioningService } from "./provisioning.js";

export type RuntimeResolutionErrorCode =
  | "FOUND"
  | "NOT_FOUND"
  | "NODE_UNREACHABLE"
  | "CLUSTER_DISCOVERY_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "CONFIGURED_NODE_MISMATCH"
  | "UNKNOWN";

export type NormalizedRuntimeStatus =
  | "running"
  | "stopped"
  | "paused"
  | "busy"
  | "unknown"
  | "not_found"
  | "node_unreachable"
  | "permission_denied";

export interface VpsRuntimeTarget {
  vpsId: string;
  vps: any;
  node: ProxmoxNodeConfig;
  integrationId: string;
  configuredNode: string;
  runtimeNode: string;
  vmid: number;
  runtimeStatus: NormalizedRuntimeStatus;
  runtimeNodeSource: "direct" | "cluster" | "cached" | "configured";
  verifiedAt: string;
  uptime?: number;
  cpus?: number;
  memoryMb?: number;
  maxdiskGb?: number;
  fresh: boolean;
  error?: string;
  errorCode: RuntimeResolutionErrorCode;
}

export class VpsRuntimeResolver {
  /**
   * Resolve runtime location and live state for a VPS instance by ID.
   */
  public static async resolve(vpsId: string): Promise<VpsRuntimeTarget> {
    const vps = queryOne<any>(
      `SELECT v.*, n.id as node_db_id, n.node_name as configured_node_name
       FROM vps v
       JOIN proxmox_nodes n ON v.proxmox_node_id = n.id
       WHERE v.id = ? LIMIT 1`,
      [vpsId]
    );

    if (!vps) {
      const err = new Error("VPS instance not found in control plane database.");
      (err as any).statusCode = 404;
      throw err;
    }

    const node = ProvisioningService.getNodeConfig(vps.proxmox_node_id);
    if (!node) {
      const err = new Error(`Associated Proxmox node '${vps.proxmox_node_id}' is unavailable.`);
      (err as any).statusCode = 502;
      throw err;
    }

    return this.resolveTarget(vps, node);
  }

  /**
   * Authoritatively discover runtime node and current status.
   */
  public static async resolveTarget(
    vps: any,
    node: ProxmoxNodeConfig
  ): Promise<VpsRuntimeTarget> {
    const configuredNode = node.nodeName || "pve";
    const vmid = vps.proxmox_vmid;
    const nowIso = new Date().toISOString();

    // 1. First: Try direct query on configured node
    try {
      const directStatus = await ProxmoxService.request<{
        status: "running" | "stopped" | "paused";
        name?: string;
        cpus?: number;
        maxmem?: number;
        maxdisk?: number;
        uptime?: number;
      }>(
        node,
        "GET",
        `/api2/json/nodes/${encodeURIComponent(configuredNode)}/lxc/${vmid}/status/current`,
        undefined,
        10000
      );

      if (directStatus.data && directStatus.data.status) {
        const memMb = directStatus.data.maxmem
          ? Math.round(directStatus.data.maxmem / (1024 * 1024))
          : vps.memory_mb;
        const diskGb = directStatus.data.maxdisk
          ? Math.round(directStatus.data.maxdisk / (1024 * 1024 * 1024))
          : vps.disk_gb;

        // Update cached runtime node in database
        try {
          execute(
            `UPDATE vps SET
              runtime_node_name = ?, runtime_node_last_seen_at = datetime('now'),
              last_proxmox_sync_at = ?, runtime_state_fresh = 1,
              runtime_sync_error_code = NULL, runtime_sync_error = NULL
             WHERE id = ?`,
            [configuredNode, nowIso, vps.id]
          );
        } catch {}

        return {
          vpsId: vps.id,
          vps,
          node,
          integrationId: node.id,
          configuredNode,
          runtimeNode: configuredNode,
          vmid,
          runtimeStatus: directStatus.data.status,
          runtimeNodeSource: "direct",
          verifiedAt: nowIso,
          uptime: directStatus.data.uptime,
          cpus: directStatus.data.cpus || vps.cpu_cores,
          memoryMb: memMb,
          maxdiskGb: diskGb,
          fresh: true,
          errorCode: "FOUND",
        };
      }
    } catch (err: unknown) {
      if (err instanceof ProxmoxRequestError) {
        if (err.statusCode === 401 || err.statusCode === 403) {
          return {
            vpsId: vps.id,
            vps,
            node,
            integrationId: node.id,
            configuredNode,
            runtimeNode: configuredNode,
            vmid,
            runtimeStatus: "permission_denied",
            runtimeNodeSource: "configured",
            verifiedAt: nowIso,
            fresh: false,
            error: "Proxmox API authorization failed. Verify API token permissions.",
            errorCode: "PERMISSION_DENIED",
          };
        }
      }
      // Direct query failed (could be 404 because container is on another node in cluster)
      // Proceed to cluster resource discovery
    }

    // 2. Query cluster resource inventory to locate which node currently hosts the VMID
    try {
      const clusterRes = await ProxmoxService.request<
        Array<{
          type: string;
          vmid: number;
          node: string;
          status: string;
          uptime?: number;
          name?: string;
          maxmem?: number;
          maxdisk?: number;
          cpus?: number;
        }>
      >(node, "GET", "/api2/json/cluster/resources?type=vm", undefined, 12000);

      const items = Array.isArray(clusterRes.data) ? clusterRes.data : [];
      const discovered = items.find(
        (i) => (i.type === "lxc" || String(i.type).toLowerCase() === "lxc") && Number(i.vmid) === Number(vmid)
      );

      if (discovered && discovered.node) {
        const runtimeNode = discovered.node;

        // Query detailed status on the discovered runtime node
        try {
          const detailRes = await ProxmoxService.request<{
            status: "running" | "stopped" | "paused";
            name?: string;
            cpus?: number;
            maxmem?: number;
            maxdisk?: number;
            uptime?: number;
          }>(
            node,
            "GET",
            `/api2/json/nodes/${encodeURIComponent(runtimeNode)}/lxc/${vmid}/status/current`,
            undefined,
            10000
          );

          const status = detailRes.data?.status || (discovered.status === "running" ? "running" : "stopped");
          const memMb = detailRes.data?.maxmem
            ? Math.round(detailRes.data.maxmem / (1024 * 1024))
            : discovered.maxmem
            ? Math.round(discovered.maxmem / (1024 * 1024))
            : vps.memory_mb;
          const diskGb = detailRes.data?.maxdisk
            ? Math.round(detailRes.data.maxdisk / (1024 * 1024 * 1024))
            : discovered.maxdisk
            ? Math.round(discovered.maxdisk / (1024 * 1024 * 1024))
            : vps.disk_gb;

          // Update cached runtime node in database (NEVER modify proxmox_nodes.node_name!)
          try {
            execute(
              `UPDATE vps SET
                runtime_node_name = ?, runtime_node_last_seen_at = datetime('now'),
                last_proxmox_sync_at = ?, runtime_state_fresh = 1,
                runtime_sync_error_code = NULL, runtime_sync_error = NULL
               WHERE id = ?`,
              [runtimeNode, nowIso, vps.id]
            );
          } catch {}

          return {
            vpsId: vps.id,
            vps,
            node,
            integrationId: node.id,
            configuredNode,
            runtimeNode,
            vmid,
            runtimeStatus: status,
            runtimeNodeSource: "cluster",
            verifiedAt: nowIso,
            uptime: detailRes.data?.uptime || discovered.uptime,
            cpus: detailRes.data?.cpus || discovered.cpus || vps.cpu_cores,
            memoryMb: memMb,
            maxdiskGb: diskGb,
            fresh: true,
            errorCode: "FOUND",
          };
        } catch {
          // If detailed status on discovered node fails, use cluster discovery summary
          return {
            vpsId: vps.id,
            vps,
            node,
            integrationId: node.id,
            configuredNode,
            runtimeNode,
            vmid,
            runtimeStatus: discovered.status === "running" ? "running" : "stopped",
            runtimeNodeSource: "cluster",
            verifiedAt: nowIso,
            uptime: discovered.uptime,
            cpus: discovered.cpus || vps.cpu_cores,
            memoryMb: vps.memory_mb,
            maxdiskGb: vps.disk_gb,
            fresh: true,
            errorCode: "FOUND",
          };
        }
      }

      // Container was not located in cluster resources
      return {
        vpsId: vps.id,
        vps,
        node,
        integrationId: node.id,
        configuredNode,
        runtimeNode: vps.runtime_node_name || configuredNode,
        vmid,
        runtimeStatus: "not_found",
        runtimeNodeSource: "configured",
        verifiedAt: nowIso,
        fresh: false,
        error: `Container ${vmid} not found on Proxmox cluster nodes.`,
        errorCode: "NOT_FOUND",
      };
    } catch (clusterErr: unknown) {
      const isAuthErr =
        clusterErr instanceof ProxmoxRequestError &&
        (clusterErr.statusCode === 401 || clusterErr.statusCode === 403);

      const code: RuntimeResolutionErrorCode = isAuthErr
        ? "PERMISSION_DENIED"
        : clusterErr instanceof ProxmoxRequestError &&
          (clusterErr.isTimeout || clusterErr.isConnRefused)
        ? "NODE_UNREACHABLE"
        : "CLUSTER_DISCOVERY_UNAVAILABLE";

      const errorMsg =
        clusterErr instanceof Error ? clusterErr.message : "Cluster discovery query failed.";

      return {
        vpsId: vps.id,
        vps,
        node,
        integrationId: node.id,
        configuredNode,
        runtimeNode: vps.runtime_node_name || configuredNode,
        vmid,
        runtimeStatus: "node_unreachable",
        runtimeNodeSource: vps.runtime_node_name ? "cached" : "configured",
        verifiedAt: vps.last_proxmox_sync_at || nowIso,
        uptime: undefined,
        cpus: vps.cpu_cores,
        memoryMb: vps.memory_mb,
        maxdiskGb: vps.disk_gb,
        fresh: false,
        error: errorMsg,
        errorCode: code,
      };
    }
  }
}
