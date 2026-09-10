/**
 * InterDash Server — Analytics API Routes
 *
 * Real infrastructure resource metrics.
 * Role-aware:
 *   - Normal users receive analytics strictly for their own instances.
 *   - Admins receive global fleet infrastructure analytics.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { queryAll, queryOne } from "../db/index.js";

const router = Router();
router.use(requireAuth);

router.get("/", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const isAdmin = req.user.role === "admin";

  if (!isAdmin) {
    // Regular User Scope: Only their own instances
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
      [req.user.id]
    );

    const osBreakdown = queryAll<{ os_image_id: string; count: number }>(
      `SELECT os_image_id, COUNT(*) as count
       FROM vps WHERE owner_user_id = ?
       GROUP BY os_image_id`,
      [req.user.id]
    );

    res.json({
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

  // Admin Scope: Global Fleet Analytics
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

  const osBreakdown = queryAll<{ os_image_id: string; count: number }>(
    `SELECT os_image_id, COUNT(*) as count FROM vps GROUP BY os_image_id`
  );

  res.json({
    scope: "admin",
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
});

export default router;
