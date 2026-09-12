/**
 * InterDash Server — API v1 Instances Control Plane
 *
 * Full VPS lifecycle management consuming canonical backend services:
 * - VpsOperationsService (power, reinstall, password, delete, operations)
 * - ProvisioningService (asynchronous LXC provisioning)
 * - ProxmoxService (runtime status, verification, console termproxy)
 * - VpsExpiryService (authoritative expiration updates)
 * - IdempotencyService (safe re-executions)
 */

import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { requireApiKey, requireApiScope } from "../../middleware/api-auth.js";
import { apiRateLimit } from "../../middleware/api-rate-limit.js";
import { apiSuccess, apiCollection, apiError } from "../../middleware/api-envelope.js";
import { SCOPES } from "../../services/api-scopes.js";
import { queryAll, queryOne, execute } from "../../db/index.js";
import { VpsOperationsService } from "../../services/vps-operations.js";
import { ProvisioningService } from "../../services/provisioning.js";
import { ProxmoxService } from "../../services/proxmox.js";
import { VpsExpiryService } from "../../services/vps-expiry.js";
import { IdempotencyService } from "../../services/idempotency.js";

const router = Router();
router.use(requireApiKey);

/**
 * Public Instance DTO Mapper. Guarantees zero credential leakage.
 */
function toInstanceDTO(row: any): Record<string, any> {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    description: row.description || null,
    status: row.status,
    osImageId: row.os_image_id,
    cpuCores: row.cpu_cores,
    memoryMb: row.memory_mb,
    swapMb: row.swap_mb,
    diskGb: row.disk_gb,
    ipv4Address: row.ipv4_address,
    ipv6Address: row.ipv6_address || null,
    lockState: row.lock_state || null,
    expiresAt: row.expires_at || null,
    lastProxmoxSyncAt: row.last_proxmox_sync_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    node: row.proxmox_node_id
      ? {
          id: row.proxmox_node_id,
          name: row.node_name || row.proxmox_node_id,
          region: row.node_region || null,
          hostname: row.node_hostname || null,
        }
      : null,
    owner: row.owner_user_id
      ? {
          id: row.owner_user_id,
          username: row.owner_username || "Unknown",
          globalName: row.owner_global_name || null,
        }
      : null,
  };
}

/**
 * Helper to verify VPS existence and API principal access.
 */
function verifyVpsAccess(vpsId: string, req: Request): any {
  const vps = queryOne<any>(
    `SELECT v.*, n.name as node_name, n.region as node_region, n.hostname as node_hostname,
            u.username as owner_username, u.global_name as owner_global_name
     FROM vps v
     LEFT JOIN proxmox_nodes n ON v.proxmox_node_id = n.id
     LEFT JOIN users u ON v.owner_user_id = u.id
     WHERE v.id = ?
     LIMIT 1`,
    [vpsId]
  );

  if (!vps) {
    const err = new Error("VPS instance not found.");
    (err as any).statusCode = 404;
    (err as any).code = "INSTANCE_NOT_FOUND";
    throw err;
  }

  // If the API key is restricted to a user ID, verify ownership
  const restrictedUserId = req.apiPrincipal?.metadata?.restricted_user_id;
  if (restrictedUserId && vps.owner_user_id !== restrictedUserId) {
    const err = new Error("Access denied. This API key is restricted to another user account.");
    (err as any).statusCode = 403;
    (err as any).code = "RESOURCE_FORBIDDEN";
    throw err;
  }

  return vps;
}

// ============================================================================
// GET /api/v1/instances — List VPS instances
// ============================================================================
router.get(
  "/",
  requireApiScope(SCOPES.INSTANCES_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "50", 10)));
    const offset = (page - 1) * pageSize;

    const statusFilter = (req.query.status as string) || "";
    const nodeIdFilter = (req.query.nodeId as string) || "";
    const expiryFilter = (req.query.expiry as string || "all").toLowerCase();
    const restrictedUserId = req.apiPrincipal?.metadata?.restricted_user_id;

    const whereConditions: string[] = ["1=1"];
    const params: any[] = [];

    if (restrictedUserId) {
      whereConditions.push("v.owner_user_id = ?");
      params.push(restrictedUserId);
    }

    if (statusFilter) {
      whereConditions.push("v.status = ?");
      params.push(statusFilter);
    }

    if (nodeIdFilter) {
      whereConditions.push("v.proxmox_node_id = ?");
      params.push(nodeIdFilter);
    }

    if (expiryFilter === "expired") {
      whereConditions.push("v.expires_at IS NOT NULL AND v.expires_at <= datetime('now')");
    } else if (expiryFilter === "expiring_soon") {
      whereConditions.push("v.expires_at IS NOT NULL AND v.expires_at > datetime('now') AND v.expires_at <= datetime('now', '+7 days')");
    } else if (expiryFilter === "active") {
      whereConditions.push("(v.expires_at IS NULL OR v.expires_at > datetime('now'))");
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

    const totalRow = queryOne<any>(`SELECT COUNT(*) as count FROM vps v ${whereClause}`, params);
    const total = totalRow?.count || 0;

    const rows = queryAll<any>(
      `SELECT v.*, n.name as node_name, n.region as node_region, n.hostname as node_hostname,
              u.username as owner_username, u.global_name as owner_global_name
       FROM vps v
       LEFT JOIN proxmox_nodes n ON v.proxmox_node_id = n.id
       LEFT JOIN users u ON v.owner_user_id = u.id
       ${whereClause}
       ORDER BY v.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const instances = rows.map(toInstanceDTO);
    apiCollection(res, instances, {
      page,
      pageSize,
      total,
      hasNext: offset + rows.length < total,
    });
  }
);

// ============================================================================
// POST /api/v1/instances — Asynchronously Provision VPS (202 Accepted)
// ============================================================================
router.post(
  "/",
  requireApiScope(SCOPES.PROVISIONING_CREATE),
  apiRateLimit("provision"),
  async (req: Request, res: Response) => {
    const idempotencyKey = req.header("idempotency-key");
    const apiKeyId = req.apiPrincipal!.apiKeyId;

    // Check idempotency if key provided
    if (idempotencyKey) {
      try {
        const check = IdempotencyService.checkIdempotency(
          apiKeyId,
          idempotencyKey,
          req.method,
          req.originalUrl || req.url,
          req.body
        );
        if (check.isMatch && check.cachedResponse) {
          res.status(check.cachedResponse.statusCode);
          for (const [h, v] of Object.entries(check.cachedResponse.headers)) {
            res.setHeader(h, v);
          }
          res.json(check.cachedResponse.body);
          return;
        }
      } catch (err: any) {
        apiError(res, err.statusCode || 409, err.code || "IDEMPOTENCY_CONFLICT", err.message, err.details);
        return;
      }
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
      password,
      networkBridge,
      rootfsStorage,
      ipAssignment = "auto",
      customIpv4,
      customIpv6,
      expiresAt,
    } = req.body || {};

    // Validate required fields
    if (!ownerUserId || !targetNodeId || !hostname || !osTemplate) {
      apiError(
        res,
        400,
        "VALIDATION_ERROR",
        "Missing required provisioning parameters: ownerUserId, targetNodeId, hostname, osTemplate."
      );
      return;
    }

    try {
      // Validate owner exists
      const owner = queryOne<any>("SELECT id FROM users WHERE id = ?", [ownerUserId]);
      if (!owner) {
        apiError(res, 404, "USER_NOT_FOUND", `Owner user '${ownerUserId}' not found.`);
        return;
      }

      // Start asynchronous provisioning job via canonical ProvisioningService
      const job = await ProvisioningService.submitJob({
        ownerUserId,
        targetNodeId,
        requestedByUserId: req.apiPrincipal!.createdByUserId,
        hostname: hostname.trim(),
        name: name ? name.trim() : hostname.trim(),
        description: description?.trim() || undefined,
        osTemplate: osTemplate.trim(),
        cpuCores: Number(cpuCores),
        memoryMb: Number(memoryMb),
        swapMb: Number(swapMb),
        diskGb: Number(diskGb),
        storage: rootfsStorage,
        bridge: networkBridge,
        rootPassword: password,
        sshPublicKey: req.body.sshPublicKey,
        idempotencyKey: idempotencyKey || undefined,
        expiresAt: expiresAt || undefined,
      });

      const responsePayload = {
        data: {
          jobId: job.jobId,
          hostname: hostname.trim(),
          status: job.status,
          statusUrl: `/api/v1/provisioning/jobs/${job.jobId}`,
          message: "VPS provisioning job queued successfully.",
        },
        requestId: req.requestId,
      };

      // Save idempotent response if key was provided
      if (idempotencyKey) {
        IdempotencyService.saveIdempotentResponse(
          apiKeyId,
          idempotencyKey,
          req.method,
          req.originalUrl || req.url,
          req.body,
          202,
          { "content-type": "application/json" },
          responsePayload,
          job.jobId
        );
      }

      res.status(202).json(responsePayload);
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "PROVISIONING_FAILED", err.message);
    }
  }
);

// ============================================================================
// GET /api/v1/instances/:id — Get a specific VPS instance
// ============================================================================
router.get(
  "/:id",
  requireApiScope(SCOPES.INSTANCES_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    try {
      const vps = verifyVpsAccess(req.params.id, req);
      apiSuccess(res, toInstanceDTO(vps));
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "INSTANCE_NOT_FOUND", err.message);
    }
  }
);

// ============================================================================
// PATCH /api/v1/instances/:id — Update Instance Metadata
// ============================================================================
router.patch(
  "/:id",
  requireApiScope(SCOPES.INSTANCES_WRITE),
  apiRateLimit("standard"),
  async (req: Request, res: Response) => {
    try {
      const vps = verifyVpsAccess(req.params.id, req);
      const { name, description } = req.body || {};

      const updates: string[] = ["updated_at = datetime('now')"];
      const params: any[] = [];

      if (name !== undefined) {
        if (!name || typeof name !== "string" || !name.trim()) {
          apiError(res, 400, "VALIDATION_ERROR", "Instance name cannot be empty.");
          return;
        }
        updates.push("name = ?");
        params.push(name.trim());
      }

      if (description !== undefined) {
        updates.push("description = ?");
        params.push(description?.trim() || null);
      }

      params.push(vps.id);
      execute(`UPDATE vps SET ${updates.join(", ")} WHERE id = ?`, params);

      const updated = verifyVpsAccess(vps.id, req);
      apiSuccess(res, toInstanceDTO(updated));
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "INSTANCE_NOT_FOUND", err.message);
    }
  }
);

// ============================================================================
// POST /api/v1/instances/:id/start — Start Instance (202 Accepted)
// ============================================================================
router.post(
  "/:id/start",
  requireApiScope(SCOPES.INSTANCES_POWER),
  apiRateLimit("heavy"),
  async (req: Request, res: Response) => {
    try {
      const vps = verifyVpsAccess(req.params.id, req);
      const result = await VpsOperationsService.startPowerOperation(
        vps.id,
        "start",
        req.apiPrincipal!.createdByUserId
      );

      res.status(202).json({
        data: {
          operationId: result.operationId,
          status: result.status,
          statusUrl: `/api/v1/operations/${result.operationId}`,
          message: "VPS start operation initiated.",
        },
        requestId: req.requestId,
      });
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "POWER_OPERATION_FAILED", err.message);
    }
  }
);

// ============================================================================
// POST /api/v1/instances/:id/stop — Stop Instance (202 Accepted)
// ============================================================================
router.post(
  "/:id/stop",
  requireApiScope(SCOPES.INSTANCES_POWER),
  apiRateLimit("heavy"),
  async (req: Request, res: Response) => {
    try {
      const vps = verifyVpsAccess(req.params.id, req);
      const result = await VpsOperationsService.startPowerOperation(
        vps.id,
        "stop",
        req.apiPrincipal!.createdByUserId
      );

      res.status(202).json({
        data: {
          operationId: result.operationId,
          status: result.status,
          statusUrl: `/api/v1/operations/${result.operationId}`,
          message: "VPS stop operation initiated.",
        },
        requestId: req.requestId,
      });
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "POWER_OPERATION_FAILED", err.message);
    }
  }
);

// ============================================================================
// POST /api/v1/instances/:id/reboot — Reboot Instance (202 Accepted)
// ============================================================================
router.post(
  "/:id/reboot",
  requireApiScope(SCOPES.INSTANCES_POWER),
  apiRateLimit("heavy"),
  async (req: Request, res: Response) => {
    try {
      const vps = verifyVpsAccess(req.params.id, req);
      const result = await VpsOperationsService.startPowerOperation(
        vps.id,
        "reboot",
        req.apiPrincipal!.createdByUserId
      );

      res.status(202).json({
        data: {
          operationId: result.operationId,
          status: result.status,
          statusUrl: `/api/v1/operations/${result.operationId}`,
          message: "VPS reboot operation initiated.",
        },
        requestId: req.requestId,
      });
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "POWER_OPERATION_FAILED", err.message);
    }
  }
);

// ============================================================================
// POST /api/v1/instances/:id/reinstall — Reinstall OS (202 Accepted)
// ============================================================================
router.post(
  "/:id/reinstall",
  requireApiScope(SCOPES.INSTANCES_REINSTALL),
  apiRateLimit("heavy"),
  async (req: Request, res: Response) => {
    try {
      const vps = verifyVpsAccess(req.params.id, req);
      const { osTemplate, rootPassword, confirmHostname } = req.body || {};

      if (!osTemplate || typeof osTemplate !== "string") {
        apiError(res, 400, "VALIDATION_ERROR", "Operating system template is required.");
        return;
      }

      if (!confirmHostname || confirmHostname.trim() !== vps.hostname.trim()) {
        apiError(
          res,
          400,
          "HOSTNAME_MISMATCH",
          `Confirmation mismatch: You must enter the exact VPS hostname '${vps.hostname}' to reinstall.`
        );
        return;
      }

      const result = await VpsOperationsService.startReinstall(
        vps.id,
        req.apiPrincipal!.createdByUserId,
        osTemplate,
        rootPassword,
        confirmHostname
      );

      res.status(202).json({
        data: {
          operationId: result.operationId,
          status: result.status,
          statusUrl: `/api/v1/operations/${result.operationId}`,
          message: "VPS reinstall operation initiated.",
        },
        requestId: req.requestId,
      });
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "REINSTALL_FAILED", err.message);
    }
  }
);

// ============================================================================
// POST /api/v1/instances/:id/password — Reset Root Password
// ============================================================================
router.post(
  "/:id/password",
  requireApiScope(SCOPES.INSTANCES_WRITE),
  apiRateLimit("heavy"),
  async (req: Request, res: Response) => {
    try {
      const vps = verifyVpsAccess(req.params.id, req);
      const { password } = req.body || {};

      if (!password || typeof password !== "string" || password.length < 8) {
        apiError(res, 400, "PASSWORD_POLICY_ERROR", "Password must be at least 8 characters long.");
        return;
      }

      const result = await VpsOperationsService.startPasswordReset(
        vps.id,
        req.apiPrincipal!.createdByUserId,
        password
      );

      res.status(202).json({
        data: {
          operationId: result.operationId,
          status: result.status,
          statusUrl: `/api/v1/operations/${result.operationId}`,
          message: "VPS password reset operation initiated.",
        },
        requestId: req.requestId,
      });
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "PASSWORD_RESET_FAILED", err.message);
    }
  }
);

// ============================================================================
// PATCH /api/v1/instances/:id/expiry — Update Expiry Date
// ============================================================================
router.patch(
  "/:id/expiry",
  requireApiScope(SCOPES.INSTANCES_EXPIRY),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    try {
      const vps = verifyVpsAccess(req.params.id, req);
      const targetExpiry = req.body?.expiresAt !== undefined ? req.body.expiresAt : req.body?.expires_at;

      const result = VpsExpiryService.updateVpsExpiry(
        vps.id,
        targetExpiry !== undefined ? targetExpiry : null,
        req.apiPrincipal!.createdByUserId
      );

      apiSuccess(res, {
        vpsId: vps.id,
        previousExpiry: result.previousExpiry,
        newExpiry: result.newExpiry,
        message: result.message,
      });
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "EXPIRY_UPDATE_FAILED", err.message);
    }
  }
);

// ============================================================================
// DELETE /api/v1/instances/:id — Delete Instance (202 Accepted)
// ============================================================================
router.delete(
  "/:id",
  requireApiScope(SCOPES.INSTANCES_DELETE),
  apiRateLimit("heavy"),
  async (req: Request, res: Response) => {
    try {
      const vps = verifyVpsAccess(req.params.id, req);
      const { confirmHostname } = req.body || {};

      if (confirmHostname && confirmHostname.trim() !== vps.hostname.trim()) {
        apiError(
          res,
          400,
          "HOSTNAME_MISMATCH",
          `Confirmation mismatch: You must enter the exact VPS hostname '${vps.hostname}' to delete.`
        );
        return;
      }

      const result = VpsOperationsService.startDelete(
        vps.id,
        req.apiPrincipal!.createdByUserId,
        confirmHostname
      );

      res.status(202).json({
        data: {
          operationId: result.operationId,
          status: result.status,
          statusUrl: `/api/v1/operations/${result.operationId}`,
          message: "VPS deletion initiated.",
        },
        requestId: req.requestId,
      });
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "DELETE_FAILED", err.message);
    }
  }
);

// ============================================================================
// GET /api/v1/instances/:id/status — Live Runtime Status
// ============================================================================
router.get(
  "/:id/status",
  requireApiScope(SCOPES.INSTANCES_READ),
  apiRateLimit("standard"),
  async (req: Request, res: Response) => {
    try {
      const vps = verifyVpsAccess(req.params.id, req);
      const node = ProvisioningService.getNodeConfig(vps.proxmox_node_id);

      if (!node) {
        apiSuccess(res, {
          dbStatus: vps.status,
          proxmoxStatus: "unknown",
          reachable: false,
          message: "Associated hypervisor node is unavailable.",
        });
        return;
      }

      try {
        const liveStatus = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid);
        apiSuccess(res, {
          dbStatus: vps.status,
          proxmoxStatus: liveStatus.status,
          cpu: liveStatus.cpu,
          memory: liveStatus.mem,
          maxMemory: liveStatus.maxmem,
          uptimeSeconds: liveStatus.uptime,
          reachable: true,
        });
      } catch (proxmoxErr: any) {
        apiSuccess(res, {
          dbStatus: vps.status,
          proxmoxStatus: "unverified",
          reachable: false,
          error: proxmoxErr.message,
        });
      }
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "STATUS_FAILED", err.message);
    }
  }
);

// ============================================================================
// GET /api/v1/instances/:id/operations — Instance Operations History
// ============================================================================
router.get(
  "/:id/operations",
  requireApiScope(SCOPES.OPERATIONS_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    try {
      const vps = verifyVpsAccess(req.params.id, req);
      const operations = VpsOperationsService.getOperations(vps.id);
      apiSuccess(
        res,
        operations.map((op) => ({
          id: op.id,
          vpsId: op.vps_id,
          operationType: op.operation_type,
          status: op.status,
          currentStep: op.current_step,
          errorCode: op.error_code,
          errorMessage: op.error_message,
          createdAt: op.created_at,
          startedAt: op.started_at,
          completedAt: op.completed_at,
        }))
      );
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "OPERATIONS_FAILED", err.message);
    }
  }
);

// ============================================================================
// GET /api/v1/instances/:id/reinstall/capabilities — Discover Safe OS Templates
// ============================================================================
router.get(
  "/:id/reinstall/capabilities",
  requireApiScope(SCOPES.INSTANCES_READ),
  apiRateLimit("standard"),
  async (req: Request, res: Response) => {
    try {
      const vps = verifyVpsAccess(req.params.id, req);
      const node = ProvisioningService.getNodeConfig(vps.proxmox_node_id);
      if (!node) {
        apiError(res, 502, "NODE_UNAVAILABLE", "Associated hypervisor node is unavailable.");
        return;
      }

      const verification = await ProxmoxService.verifyNode(node, false);
      const safeTemplates = (verification.templates || []).map((t) => ({
        volid: t.volid,
        filename: t.filename,
        osFamily: t.osFamily,
        version: t.version,
        architecture: t.architecture,
        sizeBytes: t.sizeBytes,
      }));

      apiSuccess(res, { templates: safeTemplates });
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "CAPABILITIES_FAILED", err.message);
    }
  }
);

// ============================================================================
// POST /api/v1/instances/:id/console — Initiate Secure Console Ticket
// ============================================================================
router.post(
  "/:id/console",
  requireApiScope(SCOPES.INSTANCES_CONSOLE),
  apiRateLimit("standard"),
  async (req: Request, res: Response) => {
    try {
      const vps = verifyVpsAccess(req.params.id, req);
      const node = ProvisioningService.getNodeConfig(vps.proxmox_node_id);
      if (!node) {
        apiError(res, 502, "NODE_UNAVAILABLE", "Associated hypervisor node is unavailable.");
        return;
      }

      const diag = await ProxmoxService.testTermProxy(node, vps.proxmox_vmid);
      if (!diag.ok) {
        apiError(
          res,
          503,
          "CONSOLE_UNAVAILABLE",
          `Console unavailable: ${diag.recommendedFix || "Proxmox termproxy could not be initialized."}`,
          { diagnostic: diag }
        );
        return;
      }

      // Generate opaque session ticket
      const sessionTicket = `term_${uuidv4().replace(/-/g, "")}`;
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min ticket

      apiSuccess(res, {
        sessionTicket,
        vpsId: vps.id,
        vmid: vps.proxmox_vmid,
        wsEndpoint: `/ws/console?ticket=${sessionTicket}`,
        expiresAt,
        message: "Connect to the wsEndpoint via WebSocket with the provided session ticket.",
      });
    } catch (err: any) {
      apiError(res, err.statusCode || 500, err.code || "CONSOLE_FAILED", err.message);
    }
  }
);

export default router;
