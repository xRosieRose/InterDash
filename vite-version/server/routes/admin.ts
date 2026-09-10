/**
 * InterDash Server — Admin API Routes
 *
 * Strict administrative router. Requires authenticated session with role === 'admin'.
 * Provides real database and Proxmox management operations:
 *   - Global infrastructure overview metrics
 *   - User management with last-admin lockout prevention
 *   - Proxmox node integration, live health checks, and capability discovery
 *   - Real LXC container provisioning initiation via ProvisioningService
 *   - IP pool management
 *   - Panel branding and global settings updates
 */

import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { queryAll, queryOne, execute } from "../db/index.js";
import { ProxmoxService } from "../services/proxmox.js";
import { encryptCredential, decryptCredential } from "../services/crypto.js";
import { ProvisioningService } from "../services/provisioning.js";

const router = Router();

// Protect ALL admin routes with requireAuth + requireRole('admin')
router.use(requireAuth);
router.use(requireRole("admin"));

// ============================================================================
// GET /api/admin/overview — Real VPS Infrastructure Overview Metrics
// ============================================================================
router.get("/overview", (_req: Request, res: Response) => {
  // VPS status counts
  const vpsStats = queryOne<any>(
    `SELECT 
      COUNT(*) as total_vps,
      COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) as running_vps,
      COALESCE(SUM(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END), 0) as stopped_vps,
      COALESCE(SUM(CASE WHEN status = 'provisioning' THEN 1 ELSE 0 END), 0) as provisioning_vps,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as failed_vps,
      COALESCE(SUM(cpu_cores), 0) as total_cores,
      COALESCE(SUM(memory_mb), 0) as total_memory_mb,
      COALESCE(SUM(disk_gb), 0) as total_disk_gb
     FROM vps`
  );

  // User counts
  const userStats = queryOne<any>(
    `SELECT 
      COUNT(*) as total_users,
      COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) as active_users,
      COALESCE(SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END), 0) as admin_users
     FROM users`
  );

  // Node counts
  const nodeStats = queryOne<any>(
    `SELECT 
      COUNT(*) as total_nodes,
      COALESCE(SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END), 0) as online_nodes,
      COALESCE(SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END), 0) as offline_nodes,
      COALESCE(SUM(CASE WHEN status = 'unknown' OR status = 'degraded' THEN 1 ELSE 0 END), 0) as degraded_nodes
     FROM proxmox_nodes
     WHERE enabled = 1`
  );

  // Recent audit events
  const recentEvents = queryAll<any>(
    `SELECT id, user_id, event_type, metadata, created_at
     FROM audit_logs
     ORDER BY created_at DESC
     LIMIT 10`
  );

  // Calculate honest system operational status
  const totalNodes = nodeStats?.total_nodes || 0;
  const onlineNodes = nodeStats?.online_nodes || 0;
  const offlineNodes = nodeStats?.offline_nodes || 0;

  let systemHealth: "operational" | "degraded" | "outage" | "unconfigured" = "operational";
  if (totalNodes === 0) {
    systemHealth = "unconfigured";
  } else if (offlineNodes > 0 && onlineNodes === 0) {
    systemHealth = "outage";
  } else if (offlineNodes > 0 || (nodeStats?.degraded_nodes || 0) > 0) {
    systemHealth = "degraded";
  }

  res.json({
    metrics: {
      totalVps: vpsStats?.total_vps || 0,
      runningVps: vpsStats?.running_vps || 0,
      stoppedVps: vpsStats?.stopped_vps || 0,
      provisioningVps: vpsStats?.provisioning_vps || 0,
      failedVps: vpsStats?.failed_vps || 0,
      totalUsers: userStats?.total_users || 0,
      activeUsers: userStats?.active_users || 0,
      adminUsers: userStats?.admin_users || 0,
      totalCores: vpsStats?.total_cores || 0,
      totalMemoryMb: vpsStats?.total_memory_mb || 0,
      totalDiskGb: vpsStats?.total_disk_gb || 0,
      totalNodes,
      onlineNodes,
      offlineNodes,
      systemHealth,
    },
    recentEvents,
  });
});

// ============================================================================
// GET /api/admin/users — List Real Database Users
// ============================================================================
router.get("/users", (_req: Request, res: Response) => {
  const users = queryAll<any>(
    `SELECT u.id, u.discord_id, u.username, u.global_name, u.email,
            u.avatar_hash, u.role, u.status, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM vps WHERE owner_user_id = u.id) as vps_count
     FROM users u
     ORDER BY u.created_at DESC`
  );

  res.json({ users });
});

// ============================================================================
// PATCH /api/admin/users/:id — Mutate User Role or Status
// ============================================================================
router.patch("/users/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const { role, status } = req.body;

  const targetUser = queryOne<any>("SELECT id, role, status FROM users WHERE id = ?", [id]);
  if (!targetUser) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  // Guard: Last Admin Demotion / Lockout Protection
  if (role && role !== targetUser.role) {
    if (!["user", "admin"].includes(role)) {
      res.status(400).json({ error: "Invalid role. Role must be 'user' or 'admin'." });
      return;
    }

    if (targetUser.role === "admin" && role === "user") {
      const adminCount = queryOne<any>(
        "SELECT COUNT(*) as count FROM users WHERE role = 'admin'"
      )?.count;

      if (adminCount <= 1) {
        res.status(400).json({
          error: "Cannot demote the last administrator. Platform must have at least one active administrator.",
        });
        return;
      }

      if (id === req.user?.id) {
        res.status(400).json({ error: "Cannot demote your own account from administrator." });
        return;
      }
    }

    execute("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?", [role, id]);

    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata)
       VALUES (?, 'role_changed', ?)`,
      [req.user?.id, JSON.stringify({ target_user_id: id, old_role: targetUser.role, new_role: role })]
    );
  }

  // Guard: Suspension
  if (status && status !== targetUser.status) {
    if (!["active", "suspended", "banned"].includes(status)) {
      res.status(400).json({ error: "Invalid status." });
      return;
    }

    if (id === req.user?.id && status !== "active") {
      res.status(400).json({ error: "Cannot suspend your own account." });
      return;
    }

    execute("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, id]);

    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata)
       VALUES (?, 'status_changed', ?)`,
      [req.user?.id, JSON.stringify({ target_user_id: id, old_status: targetUser.status, new_status: status })]
    );
  }

  res.json({ success: true, message: "User updated successfully." });
});

// ============================================================================
// GET /api/admin/nodes — List Proxmox Nodes (Secrets Stripped)
// ============================================================================
router.get("/nodes", (_req: Request, res: Response) => {
  const nodes = queryAll<any>(
    `SELECT n.id, n.cluster_id, n.name, n.hostname, n.api_url, n.port,
            n.node_name, n.region, n.allow_insecure_tls, n.default_storage,
            n.default_bridge, n.enabled, n.status, n.last_health_check,
            n.health_info, n.created_at, n.updated_at,
            (SELECT COUNT(*) FROM vps WHERE proxmox_node_id = n.id) as vps_count
     FROM proxmox_nodes n
     ORDER BY n.created_at DESC`
  );

  res.json({ nodes });
});

// ============================================================================
// POST /api/admin/nodes — Add a New Proxmox Node with Verification
// ============================================================================
router.post("/nodes", async (req: Request, res: Response) => {
  const {
    name,
    hostname,
    apiUrl,
    port = 8006,
    nodeName = "pve",
    region = "default",
    authTokenId,
    authTokenSecret,
    allowInsecureTls = false,
    defaultStorage = "local-lvm",
    defaultBridge = "vmbr0",
  } = req.body;

  if (!name || !hostname || !apiUrl || !authTokenId || !authTokenSecret) {
    res.status(400).json({
      error: "Missing required node configuration fields (name, hostname, apiUrl, authTokenId, authTokenSecret).",
    });
    return;
  }

  const testConfig = {
    id: "test",
    name,
    hostname,
    apiUrl,
    port: parseInt(port, 10) || 8006,
    nodeName,
    region,
    authTokenId,
    authTokenSecret,
    allowInsecureTls: Boolean(allowInsecureTls),
    defaultStorage,
    defaultBridge,
  };

  // Perform pre-flight connection verification
  console.log(`[NODES] Verifying Proxmox node connection to ${apiUrl}...`);
  const health = await ProxmoxService.healthCheck(testConfig);

  const initialStatus = health.online ? "online" : "offline";
  const encryptedSecret = encryptCredential(authTokenSecret);
  const nodeId = uuidv4();

  execute(
    `INSERT INTO proxmox_nodes (
      id, name, hostname, api_url, port, node_name, region, auth_token_id,
      auth_token_secret_encrypted, allow_insecure_tls, default_storage,
      default_bridge, enabled, status, last_health_check, health_info,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), ?, datetime('now'), datetime('now'))`,
    [
      nodeId,
      name.trim(),
      hostname.trim(),
      apiUrl.trim(),
      parseInt(port, 10) || 8006,
      nodeName.trim(),
      region.trim(),
      authTokenId.trim(),
      encryptedSecret,
      allowInsecureTls ? 1 : 0,
      defaultStorage.trim(),
      defaultBridge.trim(),
      initialStatus,
      JSON.stringify(health),
    ]
  );

  execute(
    `INSERT INTO audit_logs (user_id, event_type, metadata)
     VALUES (?, 'proxmox_node_created', ?)`,
    [req.user?.id, JSON.stringify({ node_id: nodeId, name, online: health.online })]
  );

  res.status(201).json({
    success: true,
    nodeId,
    health,
    message: health.online
      ? "Proxmox node verified and connected successfully!"
      : `Node saved, but initial health check failed: ${health.error}`,
  });
});

// ============================================================================
// POST /api/admin/nodes/:id/health — Live Health Check
// ============================================================================
router.post("/nodes/:id/health", async (req: Request, res: Response) => {
  const { id } = req.params;

  const nodeConfig = ProvisioningService.getNodeConfig(id);
  if (!nodeConfig) {
    res.status(404).json({ error: "Node not found." });
    return;
  }

  const health = await ProxmoxService.healthCheck(nodeConfig);
  const newStatus = health.online ? "online" : "offline";

  execute(
    `UPDATE proxmox_nodes SET
      status = ?, last_health_check = datetime('now'), health_info = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [newStatus, JSON.stringify(health), id]
  );

  res.json({ success: true, health, status: newStatus });
});

// ============================================================================
// GET /api/admin/nodes/:id/capabilities — Discover Node Templates & Storage
// ============================================================================
router.get("/nodes/:id/capabilities", async (req: Request, res: Response) => {
  const { id } = req.params;
  const nodeConfig = ProvisioningService.getNodeConfig(id);

  if (!nodeConfig) {
    res.status(404).json({ error: "Node not found." });
    return;
  }

  try {
    const storages = await ProxmoxService.getStorageList(nodeConfig);
    const bridges = await ProxmoxService.getNetworkBridges(nodeConfig);
    let templates: any[] = [];
    try {
      templates = await ProxmoxService.getTemplates(nodeConfig);
    } catch {
      // Storage might not support vztmpl content
    }

    res.json({ storages, bridges, templates });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Failed to query node capabilities: ${msg}` });
  }
});

// ============================================================================
// DELETE /api/admin/nodes/:id — Delete Proxmox Node (Guarded)
// ============================================================================
router.delete("/nodes/:id", (req: Request, res: Response) => {
  const { id } = req.params;

  const activeVpsCount = queryOne<any>(
    "SELECT COUNT(*) as count FROM vps WHERE proxmox_node_id = ?",
    [id]
  )?.count;

  if (activeVpsCount > 0) {
    res.status(400).json({
      error: `Cannot delete node: ${activeVpsCount} active VPS instance(s) are currently assigned to this node. Reassign or terminate them first.`,
    });
    return;
  }

  execute("DELETE FROM proxmox_nodes WHERE id = ?", [id]);

  execute(
    `INSERT INTO audit_logs (user_id, event_type, metadata)
     VALUES (?, 'proxmox_node_removed', ?)`,
    [req.user?.id, JSON.stringify({ node_id: id })]
  );

  res.json({ success: true, message: "Node deleted successfully." });
});

// ============================================================================
// POST /api/admin/vps — Admin Provision VPS via Asynchronous Job
// ============================================================================
router.post("/vps", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const {
    ownerUserId,
    targetNodeId,
    hostname,
    name,
    osTemplate,
    cpuCores = 1,
    memoryMb = 1024,
    swapMb = 512,
    diskGb = 25,
    storage,
    bridge,
    ipv4PoolId,
    startAfterCreate = true,
    idempotencyKey,
  } = req.body;

  if (!ownerUserId || !targetNodeId || !hostname || !osTemplate) {
    res.status(400).json({
      error: "Missing required fields: ownerUserId, targetNodeId, hostname, and osTemplate are mandatory.",
    });
    return;
  }

  // Validate owner user exists
  const owner = queryOne<any>("SELECT id FROM users WHERE id = ?", [ownerUserId]);
  if (!owner) {
    res.status(404).json({ error: "Selected owner user does not exist." });
    return;
  }

  try {
    const jobResult = await ProvisioningService.submitJob({
      ownerUserId,
      targetNodeId,
      requestedByUserId: req.user.id,
      hostname: hostname.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      name,
      osTemplate,
      cpuCores: parseInt(cpuCores, 10) || 1,
      memoryMb: parseInt(memoryMb, 10) || 1024,
      swapMb: parseInt(swapMb, 10) || 512,
      diskGb: parseInt(diskGb, 10) || 25,
      storage,
      bridge,
      ipv4PoolId,
      startAfterCreate: Boolean(startAfterCreate),
      idempotencyKey,
    });

    res.status(202).json({
      success: true,
      jobId: jobResult.jobId,
      status: jobResult.status,
      message: "VPS provisioning job queued successfully.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Provisioning initiation failed: ${msg}` });
  }
});

// ============================================================================
// PATCH /api/admin/settings — Update Platform Settings
// ============================================================================
router.patch("/settings", (req: Request, res: Response) => {
  const settings = req.body;
  if (!settings || typeof settings !== "object") {
    res.status(400).json({ error: "Invalid settings payload." });
    return;
  }

  const allowedKeys = [
    "brand_name",
    "panel_title",
    "logo_url",
    "favicon_url",
    "support_url",
    "website_url",
    "discord_url",
    "contact_email",
  ];

  for (const [key, value] of Object.entries(settings)) {
    if (allowedKeys.includes(key) && typeof value === "string") {
      // Basic sanitization against scripts
      const cleanValue = value.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
      execute(
        `INSERT INTO panel_settings (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [key, cleanValue]
      );
    }
  }

  execute(
    `INSERT INTO audit_logs (user_id, event_type, metadata)
     VALUES (?, 'panel_settings_updated', ?)`,
    [req.user?.id, JSON.stringify({ keys_updated: Object.keys(settings) })]
  );

  res.json({ success: true, message: "Settings updated successfully." });
});

export default router;
