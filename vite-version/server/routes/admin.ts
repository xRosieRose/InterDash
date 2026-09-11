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

import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { queryAll, queryOne, execute } from "../db/index.js";
import { ProxmoxService, resolveProxmoxEndpoint } from "../services/proxmox.js";
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
  const rows = queryAll<any>(
    `SELECT n.id, n.cluster_id, n.name, n.hostname, n.api_url, n.port,
            n.node_name, n.region, n.flag_url, n.auth_token_id, n.allow_insecure_tls,
            n.default_storage, n.default_template_storage, n.default_rootfs_storage,
            n.default_bridge, n.enabled, n.status, n.last_health_check, n.last_verified_at,
            n.health_info, n.verification_info, n.created_at, n.updated_at,
            (SELECT COUNT(*) FROM vps WHERE proxmox_node_id = n.id) as vps_count
     FROM proxmox_nodes n
     ORDER BY n.created_at DESC`
  );

  const nodes = rows.map((n) => {
    const endpoint = resolveProxmoxEndpoint(n.api_url, n.hostname, n.port);
    return {
      ...n,
      hostname: endpoint.hostname,
      port: endpoint.port,
    };
  });

  res.json({ nodes });
});

// ============================================================================
// POST /api/admin/nodes/test-connection — Ephemeral Pre-Save Connection Test
// ============================================================================
router.post("/nodes/test-connection", async (req: Request, res: Response) => {
  const {
    name = "Test Connection",
    hostname,
    apiUrl,
    port,
    nodeName = "pve",
    region = "default",
    flagUrl = null,
    authTokenId,
    authTokenSecret,
    allowInsecureTls = false,
  } = req.body;

  if (!apiUrl || !authTokenId || !authTokenSecret) {
    res.status(400).json({
      error: "Missing required connection parameters (apiUrl, authTokenId, authTokenSecret).",
    });
    return;
  }

  const endpoint = resolveProxmoxEndpoint(String(apiUrl).trim(), hostname, port);

  const testConfig = {
    id: "test",
    name: String(name).trim(),
    hostname: endpoint.hostname,
    apiUrl: String(apiUrl).trim(),
    port: endpoint.port,
    nodeName: String(nodeName).trim(),
    region: String(region).trim(),
    flagUrl: flagUrl ? String(flagUrl).trim() : null,
    authTokenId: String(authTokenId).trim(),
    authTokenSecret: String(authTokenSecret).trim(),
    allowInsecureTls: Boolean(allowInsecureTls),
  };

  try {
    const verification = await ProxmoxService.verifyNode(testConfig, true);
    res.json({ success: true, verification });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Connection test failed: ${msg}` });
  }
});

// ============================================================================
// POST /api/admin/nodes — Add a New Proxmox Node with Verification
// ============================================================================
router.post("/nodes", async (req: Request, res: Response) => {
  const {
    name,
    hostname,
    apiUrl,
    port,
    nodeName = "pve",
    region = "default",
    flagUrl = null,
    authTokenId,
    authTokenSecret,
    allowInsecureTls = false,
    defaultTemplateStorage = null,
    defaultRootfsStorage = null,
    defaultStorage = null,
    defaultBridge = null,
  } = req.body;

  if (!name || !apiUrl || !authTokenId || !authTokenSecret) {
    res.status(400).json({
      error: "Missing required node configuration fields (name, apiUrl, authTokenId, authTokenSecret).",
    });
    return;
  }

  const effectiveRootfs = defaultRootfsStorage || defaultStorage || null;
  const endpoint = resolveProxmoxEndpoint(String(apiUrl).trim(), hostname, port);

  const testConfig = {
    id: "test",
    name: String(name).trim(),
    hostname: endpoint.hostname,
    apiUrl: String(apiUrl).trim(),
    port: endpoint.port,
    nodeName: String(nodeName).trim(),
    region: String(region).trim(),
    flagUrl: flagUrl ? String(flagUrl).trim() : null,
    authTokenId: String(authTokenId).trim(),
    authTokenSecret: String(authTokenSecret).trim(),
    allowInsecureTls: Boolean(allowInsecureTls),
    defaultTemplateStorage: defaultTemplateStorage ? String(defaultTemplateStorage).trim() : null,
    defaultRootfsStorage: effectiveRootfs ? String(effectiveRootfs).trim() : null,
    defaultBridge: defaultBridge ? String(defaultBridge).trim() : null,
  };

  // Perform full pre-flight connection verification
  console.log(`[NODES] Verifying Proxmox node connection to ${endpoint.displayTarget}...`);
  const verification = await ProxmoxService.verifyNode(testConfig, true);

  const initialStatus = verification.status;
  const encryptedSecret = encryptCredential(authTokenSecret);
  const nodeId = uuidv4();

  // Auto-select discovered defaults if not explicitly provided
  const resolvedTemplateStorage =
    defaultTemplateStorage ||
    (verification.templateStorages.length > 0 ? verification.templateStorages[0] : null);
  const resolvedRootfsStorage =
    effectiveRootfs ||
    (verification.rootfsStorages.length > 0 ? verification.rootfsStorages[0] : null);
  const resolvedBridge =
    defaultBridge ||
    (verification.bridges.length > 0 ? verification.bridges[0].iface : null);

  const safeSnapshot = {
    status: verification.status,
    apiVersion: verification.apiVersion,
    actualNodeName: verification.actualNodeName,
    latencyMs: verification.latencyMs,
    templateCount: verification.templates.length,
    templateStorages: verification.templateStorages,
    rootfsStorages: verification.rootfsStorages,
    bridges: verification.bridges.map((b) => b.iface),
    checkedAt: verification.verifiedAt,
  };

  execute(
    `INSERT INTO proxmox_nodes (
      id, name, hostname, api_url, port, node_name, region, flag_url, auth_token_id,
      auth_token_secret_encrypted, allow_insecure_tls, default_storage,
      default_template_storage, default_rootfs_storage, default_bridge,
      enabled, status, last_health_check, last_verified_at, health_info, verification_info,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'), ?, ?, datetime('now'), datetime('now'))`,
    [
      nodeId,
      name.trim(),
      endpoint.hostname,
      apiUrl.trim(),
      endpoint.port,
      (verification.actualNodeName || nodeName).trim(),
      region.trim(),
      flagUrl ? String(flagUrl).trim() : null,
      authTokenId.trim(),
      encryptedSecret,
      allowInsecureTls ? 1 : 0,
      resolvedRootfsStorage,
      resolvedTemplateStorage,
      resolvedRootfsStorage,
      resolvedBridge,
      initialStatus,
      JSON.stringify(safeSnapshot),
      JSON.stringify(safeSnapshot),
    ]
  );

  execute(
    `INSERT INTO audit_logs (user_id, event_type, metadata)
     VALUES (?, 'proxmox_node_created', ?)`,
    [
      req.user?.id,
      JSON.stringify({
        node_id: nodeId,
        name,
        status: initialStatus,
        provisionReady: verification.provisionReady,
      }),
    ]
  );

  res.status(201).json({
    success: true,
    nodeId,
    verification,
    message: verification.provisionReady
      ? "Proxmox node verified and connected successfully (Ready for VPS provisioning)!"
      : `Node saved with status '${initialStatus}'. Notice: ${verification.checks.find((c) => c.status !== "passed")?.message || "Check capabilities."}`,
  });
});

// ============================================================================
// POST /api/admin/nodes/:id/verify — Deep Layered Verification
// ============================================================================
router.post("/nodes/:id/verify", async (req: Request, res: Response) => {
  const { id } = req.params;

  const nodeConfig = ProvisioningService.getNodeConfig(id);
  if (!nodeConfig) {
    res.status(404).json({ error: "Node not found." });
    return;
  }

  try {
    const verification = await ProxmoxService.verifyNode(nodeConfig, true);
    const safeSnapshot = {
      status: verification.status,
      apiVersion: verification.apiVersion,
      actualNodeName: verification.actualNodeName,
      latencyMs: verification.latencyMs,
      templateCount: verification.templates.length,
      templateStorages: verification.templateStorages,
      rootfsStorages: verification.rootfsStorages,
      bridges: verification.bridges.map((b) => b.iface),
      checkedAt: verification.verifiedAt,
    };

    execute(
      `UPDATE proxmox_nodes SET
        status = ?, last_health_check = datetime('now'), last_verified_at = datetime('now'),
        health_info = ?, verification_info = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [verification.status, JSON.stringify(safeSnapshot), JSON.stringify(safeSnapshot), id]
    );

    res.json({ success: true, verification });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Node verification failed: ${msg}` });
  }
});

// ============================================================================
// POST /api/admin/nodes/:id/health — Live Health Check (Backwards Compatible)
// ============================================================================
router.post("/nodes/:id/health", async (req: Request, res: Response) => {
  const { id } = req.params;

  const nodeConfig = ProvisioningService.getNodeConfig(id);
  if (!nodeConfig) {
    res.status(404).json({ error: "Node not found." });
    return;
  }

  const verification = await ProxmoxService.verifyNode(nodeConfig, true);
  const newStatus = verification.status;

  const safeSnapshot = {
    status: verification.status,
    apiVersion: verification.apiVersion,
    actualNodeName: verification.actualNodeName,
    latencyMs: verification.latencyMs,
    templateCount: verification.templates.length,
    templateStorages: verification.templateStorages,
    rootfsStorages: verification.rootfsStorages,
    bridges: verification.bridges.map((b) => b.iface),
    checkedAt: verification.verifiedAt,
  };

  execute(
    `UPDATE proxmox_nodes SET
      status = ?, last_health_check = datetime('now'), last_verified_at = datetime('now'),
      health_info = ?, verification_info = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [newStatus, JSON.stringify(safeSnapshot), JSON.stringify(safeSnapshot), id]
  );

  const health = {
    online: verification.status === "healthy" || verification.status === "degraded",
    version: verification.apiVersion,
    release: verification.apiRelease,
    repoid: verification.repoid,
    nodeStatus: verification.nodeStatus,
    latencyMs: verification.latencyMs,
  };

  res.json({ success: true, health, status: newStatus, verification });
});

// ============================================================================
// GET /api/admin/nodes/:id/capabilities — Discover Node Templates & Storage
// ============================================================================
router.get("/nodes/:id/capabilities", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let nodeConfig: ReturnType<typeof ProvisioningService.getNodeConfig> = null;
    try {
      nodeConfig = ProvisioningService.getNodeConfig(id);
    } catch (cfgErr: unknown) {
      const msg = cfgErr instanceof Error ? cfgErr.message : String(cfgErr);
      res.status(500).json({ error: `Failed to load hypervisor node configuration: ${msg}` });
      return;
    }

    if (!nodeConfig) {
      res.status(404).json({ error: `Proxmox node '${id}' not found in database.` });
      return;
    }

    const forceRefresh = req.query.refresh === "true";
    const verification = await ProxmoxService.verifyNode(nodeConfig, forceRefresh);

    let ipPools: any[] = [];
    try {
      ipPools = queryAll<any>(
        `SELECT p.id, p.name, p.cidr, p.gateway,
                COUNT(CASE WHEN a.status = 'available' THEN 1 END) as available_ips,
                COUNT(a.id) as total_ips
         FROM ip_pools p
         LEFT JOIN ip_addresses a ON a.pool_id = p.id
         WHERE p.node_id = ? OR p.node_id IS NULL
         GROUP BY p.id`,
        [id]
      );
    } catch {
      // Non-critical: allow capabilities to return even if IPAM query encounters an issue
      ipPools = [];
    }

    res.json({
      node: {
        id: nodeConfig.id,
        name: nodeConfig.name,
        nodeName: nodeConfig.nodeName,
        region: nodeConfig.region,
        status: verification.status,
        defaultTemplateStorage: nodeConfig.defaultTemplateStorage,
        defaultRootfsStorage: nodeConfig.defaultRootfsStorage || nodeConfig.defaultStorage,
        defaultBridge: nodeConfig.defaultBridge,
        lastVerifiedAt: verification.verifiedAt,
      },
      health: {
        status: verification.status,
        latencyMs: verification.latencyMs,
        apiVersion: verification.apiVersion,
        apiRelease: verification.apiRelease,
        readReady: verification.readReady,
        provisionReady: verification.provisionReady,
      },
      storages: verification.storages,
      templateStorages: verification.templateStorages,
      rootfsStorages: verification.rootfsStorages,
      templates: verification.templates,
      bridges: verification.bridges,
      permissions: verification.permissions,
      checks: verification.checks,
      ipPools,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Failed to query node capabilities: ${msg}` });
  }
});

// ============================================================================
// PATCH /api/admin/nodes/:id — Update Proxmox Node Metadata & Settings
// ============================================================================
router.patch("/nodes/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const targetNode = queryOne<any>("SELECT id, name FROM proxmox_nodes WHERE id = ?", [id]);
  if (!targetNode) {
    res.status(404).json({ error: "Proxmox node not found." });
    return;
  }

  const {
    name,
    hostname,
    apiUrl,
    port,
    nodeName,
    authTokenId,
    authTokenSecret,
    region,
    flagUrl,
    defaultStorage,
    defaultTemplateStorage,
    defaultRootfsStorage,
    defaultBridge,
    allowInsecureTls,
    enabled,
  } = req.body;

  const updates: string[] = [];
  const params: any[] = [];

  if (name !== undefined) {
    updates.push("name = ?");
    params.push(String(name).trim());
  }
  if (apiUrl !== undefined) {
    const rawApiUrl = String(apiUrl).trim();
    const endpoint = resolveProxmoxEndpoint(rawApiUrl, hostname, port);
    updates.push("api_url = ?");
    params.push(rawApiUrl);
    updates.push("port = ?");
    params.push(endpoint.port);
    updates.push("hostname = ?");
    params.push(endpoint.hostname);
  } else {
    if (hostname !== undefined) {
      updates.push("hostname = ?");
      params.push(String(hostname).trim());
    }
    if (port !== undefined) {
      updates.push("port = ?");
      params.push(parseInt(port, 10));
    }
  }
  if (nodeName !== undefined) {
    updates.push("node_name = ?");
    params.push(String(nodeName).trim());
  }
  if (authTokenId !== undefined) {
    updates.push("auth_token_id = ?");
    params.push(String(authTokenId).trim());
  }
  if (authTokenSecret !== undefined && String(authTokenSecret).trim() !== "") {
    updates.push("auth_token_secret_encrypted = ?");
    params.push(encryptCredential(String(authTokenSecret).trim()));
  }
  if (region !== undefined) {
    updates.push("region = ?");
    params.push(String(region).trim());
  }
  if (flagUrl !== undefined) {
    updates.push("flag_url = ?");
    params.push(flagUrl ? String(flagUrl).trim() : null);
  }
  if (defaultStorage !== undefined) {
    updates.push("default_storage = ?");
    params.push(String(defaultStorage).trim());
  }
  if (defaultTemplateStorage !== undefined) {
    updates.push("default_template_storage = ?");
    params.push(defaultTemplateStorage ? String(defaultTemplateStorage).trim() : null);
  }
  if (defaultRootfsStorage !== undefined) {
    updates.push("default_rootfs_storage = ?");
    params.push(defaultRootfsStorage ? String(defaultRootfsStorage).trim() : null);
  }
  if (defaultBridge !== undefined) {
    updates.push("default_bridge = ?");
    params.push(defaultBridge ? String(defaultBridge).trim() : null);
  }
  if (allowInsecureTls !== undefined) {
    updates.push("allow_insecure_tls = ?");
    params.push(allowInsecureTls ? 1 : 0);
  }
  if (enabled !== undefined) {
    updates.push("enabled = ?");
    params.push(enabled ? 1 : 0);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: "No fields provided for update." });
    return;
  }

  updates.push("updated_at = datetime('now')");
  params.push(id);

  execute(`UPDATE proxmox_nodes SET ${updates.join(", ")} WHERE id = ?`, params);

  // Invalidate capability cache for this node
  ProxmoxService.invalidateCache(id);

  execute(
    `INSERT INTO audit_logs (user_id, event_type, metadata)
     VALUES (?, 'proxmox_node_updated', ?)`,
    [req.user?.id, JSON.stringify({ node_id: id, updated_fields: Object.keys(req.body) })]
  );

  res.json({ success: true, message: "Node updated successfully." });
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
// POST /api/admin/vps/preflight — Preflight Deployment Verification
// ============================================================================
router.post("/vps/preflight", async (req: Request, res: Response) => {
  const {
    ownerUserId,
    targetNodeId,
    hostname,
    osTemplate,
    templateVolid,
    cpuCores = 1,
    memoryMb = 1024,
    diskGb = 25,
    storage,
    rootfsStorage,
    bridge,
    ipv4PoolId,
  } = req.body;

  const checks: Array<{ name: string; status: "passed" | "failed" | "warning"; message: string }> = [];

  // Check 1: Owner User
  if (ownerUserId) {
    const owner = queryOne<any>("SELECT id FROM users WHERE id = ?", [ownerUserId]);
    if (!owner) {
      checks.push({ name: "owner", status: "failed", message: "Target owner user does not exist." });
    } else {
      checks.push({ name: "owner", status: "passed", message: "Owner user verified." });
    }
  }

  // Check 2: Target Node
  const nodeConfig = ProvisioningService.getNodeConfig(targetNodeId);
  if (!nodeConfig) {
    checks.push({ name: "node", status: "failed", message: "Target Proxmox node does not exist or is disabled." });
    res.status(422).json({ valid: false, error: "Target Proxmox node does not exist or is disabled.", checks });
    return;
  }
  checks.push({ name: "node", status: "passed", message: `Node '${nodeConfig.name}' active.` });

  const effectiveTemplate = templateVolid || osTemplate;
  const effectiveStorage = rootfsStorage || storage || nodeConfig.defaultRootfsStorage || nodeConfig.defaultStorage;

  // Check 3: Live Node Verification & Capabilities
  try {
    const verification = await ProxmoxService.verifyNode(nodeConfig, true);
    if (!verification.reachable) {
      checks.push({ name: "connectivity", status: "failed", message: "Proxmox node is unreachable." });
    } else if (!verification.identityVerified) {
      checks.push({ name: "identity", status: "failed", message: `Node identity mismatch: ${verification.error || "mismatch"}` });
    } else {
      checks.push({ name: "connectivity", status: "passed", message: `Node is online (${verification.latencyMs}ms).` });
    }

    // Check 4: Template existence
    if (effectiveTemplate) {
      const templateMatch = verification.templates.find(
        (t) => t.volid.toLowerCase() === String(effectiveTemplate).trim().toLowerCase()
      );
      if (!templateMatch) {
        checks.push({
          name: "template",
          status: "failed",
          message: `Template '${effectiveTemplate}' was not found on node '${nodeConfig.name}'. Discovered: [${verification.templates.map((t) => t.volid).join(", ")}]`,
        });
      } else {
        checks.push({
          name: "template",
          status: "passed",
          message: `Template verified in storage '${templateMatch.storage}' (${templateMatch.filename}).`,
        });
      }
    }

    // Check 5: Rootfs Storage
    if (effectiveStorage) {
      const rootfsMatch = verification.storages.find(
        (s) => s.storage.toLowerCase() === String(effectiveStorage).trim().toLowerCase()
      );
      if (!rootfsMatch) {
        checks.push({
          name: "rootfs_storage",
          status: "failed",
          message: `Rootfs storage pool '${effectiveStorage}' was not found on node.`,
        });
      } else if (!rootfsMatch.supportsRootfs) {
        checks.push({
          name: "rootfs_storage",
          status: "failed",
          message: `Storage pool '${effectiveStorage}' does not support container root disks ('rootdir').`,
        });
      } else {
        checks.push({
          name: "rootfs_storage",
          status: "passed",
          message: `Rootfs storage '${effectiveStorage}' active and supports rootdir.`,
        });
      }
    }

    // Check 6: Network Bridge
    const effectiveBridge = bridge || nodeConfig.defaultBridge;
    if (effectiveBridge) {
      const bridgeMatch = verification.bridges.find(
        (b) => b.iface.toLowerCase() === String(effectiveBridge).trim().toLowerCase()
      );
      if (!bridgeMatch) {
        checks.push({
          name: "bridge",
          status: "failed",
          message: `Network bridge '${effectiveBridge}' is not available on node.`,
        });
      } else {
        checks.push({
          name: "bridge",
          status: "passed",
          message: `Network bridge '${effectiveBridge}' verified.`,
        });
      }
    }

    // Check 7: IPAM
    if (ipv4PoolId && ipv4PoolId !== "auto") {
      const availableIp = queryOne<any>(
        `SELECT id FROM ip_addresses WHERE pool_id = ? AND status = 'available' LIMIT 1`,
        [ipv4PoolId]
      );
      if (!availableIp) {
        checks.push({
          name: "ipam",
          status: "failed",
          message: "No available IPv4 address remaining in the selected pool.",
        });
      } else {
        checks.push({ name: "ipam", status: "passed", message: "Dedicated IPv4 address available." });
      }
    }

    // Check 8: Resource limits
    const parsedCores = parseInt(cpuCores, 10);
    const parsedMemory = parseInt(memoryMb, 10);
    const parsedDisk = parseInt(diskGb, 10);

    if (isNaN(parsedCores) || parsedCores < 1 || parsedCores > 64) {
      checks.push({ name: "resources", status: "failed", message: "Cores must be between 1 and 64." });
    } else if (isNaN(parsedMemory) || parsedMemory < 256 || parsedMemory > 131072) {
      checks.push({ name: "resources", status: "failed", message: "Memory must be between 256 and 131072 MB." });
    } else if (isNaN(parsedDisk) || parsedDisk < 5 || parsedDisk > 2048) {
      checks.push({ name: "resources", status: "failed", message: "Disk must be between 5 and 2048 GB." });
    } else {
      checks.push({ name: "resources", status: "passed", message: "Hardware resource boundaries valid." });
    }

    const valid = checks.every((c) => c.status !== "failed");
    if (!valid) {
      const failedCheck = checks.find((c) => c.status === "failed");
      res.status(422).json({
        valid: false,
        error: failedCheck?.message || "Preflight validation failed.",
        checks,
      });
      return;
    }
    res.json({ valid: true, checks });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({ name: "error", status: "failed", message: `Preflight failed: ${msg}` });
    res.status(422).json({ valid: false, error: msg, checks });
  }
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
    description,
    osTemplate,
    cpuCores = 1,
    memoryMb = 1024,
    swapMb = 512,
    diskGb = 25,
    storage,
    bridge,
    ipv4PoolId,
    startAfterCreate = true,
    rootPassword,
    sshPublicKey,
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

  // Validate target node exists & is enabled
  const nodeConfig = ProvisioningService.getNodeConfig(targetNodeId);
  if (!nodeConfig) {
    res.status(404).json({ error: "Target Proxmox node does not exist or is disabled." });
    return;
  }

  // Resource boundaries validation
  const parsedCores = parseInt(cpuCores, 10);
  const parsedMemory = parseInt(memoryMb, 10);
  const parsedDisk = parseInt(diskGb, 10);
  const parsedSwap = parseInt(swapMb, 10) || 512;

  if (isNaN(parsedCores) || parsedCores < 1 || parsedCores > 64) {
    res.status(400).json({ error: "CPU cores must be an integer between 1 and 64." });
    return;
  }
  if (isNaN(parsedMemory) || parsedMemory < 256 || parsedMemory > 131072) {
    res.status(400).json({ error: "Memory must be between 256 MB and 131072 MB." });
    return;
  }
  if (isNaN(parsedDisk) || parsedDisk < 5 || parsedDisk > 2048) {
    res.status(400).json({ error: "Disk size must be between 5 GB and 2048 GB." });
    return;
  }

  // Hostname validation
  const cleanHostname = hostname.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(cleanHostname)) {
    res.status(400).json({
      error: "Hostname must be 1-63 lowercase alphanumeric characters or hyphens, starting with an alphanumeric character.",
    });
    return;
  }

  // Root Password & SSH Key validation / generation
  let effectivePassword = rootPassword?.trim();
  let generatedPassword = false;

  if (!effectivePassword) {
    // Cryptographically secure password generation
    effectivePassword = crypto.randomBytes(12).toString("base64url");
    generatedPassword = true;
  } else if (effectivePassword.length < 8) {
    res.status(400).json({ error: "Root password must be at least 8 characters long." });
    return;
  }

  if (sshPublicKey && typeof sshPublicKey === "string") {
    const trimmedKey = sshPublicKey.trim();
    if (!/^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp\d+)\s+[A-Za-z0-9+/=]+/.test(trimmedKey)) {
      res.status(400).json({ error: "Invalid SSH Public Key format. Must be an OpenSSH public key." });
      return;
    }
  }

  try {
    const jobResult = await ProvisioningService.submitJob({
      ownerUserId,
      targetNodeId,
      requestedByUserId: req.user.id,
      hostname: cleanHostname,
      name: name?.trim() || `${cleanHostname} Instance`,
      description: description?.trim() || undefined,
      osTemplate: osTemplate.trim(),
      cpuCores: parsedCores,
      memoryMb: parsedMemory,
      swapMb: parsedSwap,
      diskGb: parsedDisk,
      storage: storage || nodeConfig.defaultRootfsStorage || nodeConfig.defaultStorage,
      bridge: bridge || nodeConfig.defaultBridge,
      ipv4PoolId: ipv4PoolId || undefined,
      startAfterCreate: Boolean(startAfterCreate),
      rootPassword: effectivePassword,
      sshPublicKey: sshPublicKey?.trim() || undefined,
      idempotencyKey,
    });

    res.status(202).json({
      success: true,
      jobId: jobResult.jobId,
      status: jobResult.status,
      isDuplicate: jobResult.isDuplicate,
      generatedPassword: generatedPassword ? effectivePassword : undefined,
      message: "VPS provisioning job queued successfully.",
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: `Provisioning initiation failed: ${err.message}` });
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
      let cleanValue = value.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "").trim();

      // Normalize Imgur URLs to direct image endpoints if needed
      if ((key === "logo_url" || key === "favicon_url") && cleanValue) {
        const imgurPageMatch = cleanValue.match(/^https?:\/\/(?:www\.)?imgur\.com\/([a-zA-Z0-9]+)$/);
        if (imgurPageMatch) {
          cleanValue = `https://i.imgur.com/${imgurPageMatch[1]}.png`;
        }
        const imgurDirectNoExt = cleanValue.match(/^https?:\/\/i\.imgur\.com\/([a-zA-Z0-9]+)$/);
        if (imgurDirectNoExt) {
          cleanValue = `https://i.imgur.com/${imgurDirectNoExt[1]}.png`;
        }
      }

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
