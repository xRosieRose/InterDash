/**
 * InterDash Server — API v1 Real Analytics Control Plane
 *
 * Exposes real infrastructure and user resource utilization metrics.
 * NEVER synthesizes fake CPU, memory, or bandwidth history.
 */

import { Router, type Request, type Response } from "express";
import { requireApiKey, requireApiScope } from "../../middleware/api-auth.js";
import { apiRateLimit } from "../../middleware/api-rate-limit.js";
import { apiSuccess } from "../../middleware/api-envelope.js";
import { SCOPES } from "../../services/api-scopes.js";
import { queryAll, queryOne } from "../../db/index.js";

const router = Router();
router.use(requireApiKey);

// ============================================================================
// GET /api/v1/analytics — Real Infrastructure & User Analytics
// ============================================================================
router.get(
  "/",
  requireApiScope(SCOPES.ANALYTICS_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const restrictedUserId = req.apiPrincipal?.metadata?.restricted_user_id;

    if (restrictedUserId) {
      // User-Scoped Analytics
      const stats = queryOne<any>(
        `SELECT 
          COUNT(*) as total_instances,
          COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) as running_instances,
          COALESCE(SUM(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END), 0) as stopped_instances,
          COALESCE(SUM(cpu_cores), 0) as total_cpu_cores,
          COALESCE(SUM(memory_mb), 0) as total_memory_mb,
          COALESCE(SUM(disk_gb), 0) as total_disk_gb
         FROM vps
         WHERE owner_user_id = ?`,
        [restrictedUserId]
      );

      const osBreakdown = queryAll<any>(
        `SELECT os_image_id, COUNT(*) as count
         FROM vps WHERE owner_user_id = ?
         GROUP BY os_image_id`,
        [restrictedUserId]
      );

      apiSuccess(res, {
        scope: "user",
        metrics: {
          totalInstances: stats?.total_instances || 0,
          runningInstances: stats?.running_instances || 0,
          stoppedInstances: stats?.stopped_instances || 0,
          totalCpuCores: stats?.total_cpu_cores || 0,
          totalMemoryMb: stats?.total_memory_mb || 0,
          totalDiskGb: stats?.total_disk_gb || 0,
          osBreakdown,
        },
      });
      return;
    }

    // Global Fleet Infrastructure Analytics
    const vpsStats = queryOne<any>(
      `SELECT 
        COUNT(*) as total_instances,
        COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) as running_instances,
        COALESCE(SUM(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END), 0) as stopped_instances,
        COALESCE(SUM(CASE WHEN status = 'provisioning' THEN 1 ELSE 0 END), 0) as provisioning_instances,
        COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as failed_instances,
        COALESCE(SUM(cpu_cores), 0) as total_cpu_cores,
        COALESCE(SUM(memory_mb), 0) as total_memory_mb,
        COALESCE(SUM(disk_gb), 0) as total_disk_gb
       FROM vps`
    );

    const nodeStats = queryOne<any>(
      `SELECT 
        COUNT(*) as total_nodes,
        COALESCE(SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END), 0) as online_nodes,
        COALESCE(SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END), 0) as offline_nodes,
        COALESCE(SUM(CASE WHEN status = 'unknown' OR status = 'degraded' THEN 1 ELSE 0 END), 0) as degraded_nodes
       FROM proxmox_nodes
       WHERE enabled = 1`
    );

    const nodeBreakdown = queryAll<any>(
      `SELECT n.id, n.name, n.hostname, n.region, n.status,
              COUNT(v.id) as instance_count,
              COALESCE(SUM(v.cpu_cores), 0) as allocated_cores,
              COALESCE(SUM(v.memory_mb), 0) as allocated_memory_mb
       FROM proxmox_nodes n
       LEFT JOIN vps v ON n.id = v.proxmox_node_id
       WHERE n.enabled = 1
       GROUP BY n.id`
    );

    const osBreakdown = queryAll<any>(
      `SELECT os_image_id, COUNT(*) as count FROM vps GROUP BY os_image_id`
    );

    apiSuccess(res, {
      scope: "fleet",
      metrics: {
        totalInstances: vpsStats?.total_instances || 0,
        runningInstances: vpsStats?.running_instances || 0,
        stoppedInstances: vpsStats?.stopped_instances || 0,
        provisioningInstances: vpsStats?.provisioning_instances || 0,
        failedInstances: vpsStats?.failed_instances || 0,
        totalCpuCores: vpsStats?.total_cpu_cores || 0,
        totalMemoryMb: vpsStats?.total_memory_mb || 0,
        totalDiskGb: vpsStats?.total_disk_gb || 0,
        totalNodes: nodeStats?.total_nodes || 0,
        onlineNodes: nodeStats?.online_nodes || 0,
        offlineNodes: nodeStats?.offline_nodes || 0,
        degradedNodes: nodeStats?.degraded_nodes || 0,
        nodeBreakdown,
        osBreakdown,
      },
    });
  }
);

export default router;
