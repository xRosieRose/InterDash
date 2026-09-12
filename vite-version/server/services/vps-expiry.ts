/**
 * InterDash Server — VPS Expiration & Lifecycle Policy Service
 *
 * Implements authoritative, durable VPS expiration tracking and request-time enforcement.
 *
 * Expiry Policy (expire_only):
 *   - An expired VPS remains in its current runtime state.
 *   - Prohibited actions on expired VPS: start, reboot, reinstall, password reset, console, metadata updates.
 *   - Allowed actions on expired VPS: view, stop (shut down running container), delete (clean up container & release IP).
 *   - Admin extension: administrators can extend or clear expiration timestamps.
 *   - Timezone invariant: all calculations use centralized UTC parsing via parseDatabaseTimestampUtc.
 */

import { queryOne, queryAll, execute } from "../db/index.js";
import { parseDatabaseTimestampUtc } from "../utils/timestamp.js";

export type VpsExpiryState = "never" | "active" | "expiring_soon" | "expired";

export type VpsAction =
  | "view"
  | "inspect"
  | "start"
  | "stop"
  | "reboot"
  | "reinstall"
  | "password_reset"
  | "console"
  | "delete"
  | "update_metadata"
  | "extend_expiry";

export interface VpsExpiryInfo {
  expiresAt: string | null;
  state: VpsExpiryState;
  isExpired: boolean;
  daysRemaining: number | null;
}

export class VpsExpiryService {
  private static readonly EXPIRING_SOON_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  /**
   * Determine whether a VPS is expired based on current UTC time.
   */
  public static isExpired(expiresAt: string | null | undefined): boolean {
    if (!expiresAt) return false;
    const expiryTime = parseDatabaseTimestampUtc(expiresAt).getTime();
    if (expiryTime === 0) return false;
    return expiryTime <= Date.now();
  }

  /**
   * Compute the high-level expiration state for UI and filtering.
   */
  public static getExpiryState(expiresAt: string | null | undefined): VpsExpiryState {
    if (!expiresAt) return "never";
    const expiryTime = parseDatabaseTimestampUtc(expiresAt).getTime();
    if (expiryTime === 0) return "never";

    const now = Date.now();
    if (expiryTime <= now) {
      return "expired";
    }

    if (expiryTime <= now + this.EXPIRING_SOON_THRESHOLD_MS) {
      return "expiring_soon";
    }

    return "active";
  }

  /**
   * Compute detailed expiry metadata for an instance.
   */
  public static getExpiryInfo(expiresAt: string | null | undefined): VpsExpiryInfo {
    if (!expiresAt) {
      return {
        expiresAt: null,
        state: "never",
        isExpired: false,
        daysRemaining: null,
      };
    }

    const expiryTime = parseDatabaseTimestampUtc(expiresAt).getTime();
    if (expiryTime === 0) {
      return {
        expiresAt: null,
        state: "never",
        isExpired: false,
        daysRemaining: null,
      };
    }

    const now = Date.now();
    const isExpired = expiryTime <= now;
    const diffMs = expiryTime - now;
    const daysRemaining = isExpired ? 0 : Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    const state = this.getExpiryState(expiresAt);

    return {
      expiresAt,
      state,
      isExpired,
      daysRemaining,
    };
  }

  /**
   * REQUEST-TIME ENFORCEMENT
   * Evaluates whether the requested action is permitted on the specified VPS.
   * Throws a structured 403 error if the action is blocked by expiration policy.
   */
  public static assertVpsActionAllowed(
    vps: { id: string; name?: string; expires_at?: string | null },
    action: VpsAction,
    userRole?: string
  ): void {
    if (!vps.expires_at) {
      return; // Never expires, all authorized actions allowed
    }

    const expiryTime = parseDatabaseTimestampUtc(vps.expires_at).getTime();
    if (expiryTime === 0 || expiryTime > Date.now()) {
      return; // Still active, action allowed
    }

    // Instance is EXPIRED. Evaluate permitted actions.
    const allowedWhenExpired: VpsAction[] = ["view", "inspect", "stop", "delete"];
    if (userRole === "admin") {
      allowedWhenExpired.push("extend_expiry");
    }

    if (!allowedWhenExpired.includes(action)) {
      const expiredDateStr = new Date(expiryTime).toISOString();
      const nowStr = new Date().toISOString();

      const err = new Error(
        `Action '${action}' is prohibited because this VPS has expired (expired at ${expiredDateStr}). You may stop or delete this instance.`
      );
      (err as any).statusCode = 403;
      (err as any).code = "VPS_EXPIRED";
      (err as any).details = {
        vpsId: vps.id,
        action,
        expiredAt: expiredDateStr,
        now: nowStr,
        retryable: false,
      };
      throw err;
    }
  }

  /**
   * Background and startup reconciliation worker.
   * Finds all expired VPS instances and logs detection events idempotently.
   */
  public static async reconcileExpiredVps(): Promise<number> {
    const expiredInstances = queryAll<{
      id: string;
      name: string;
      hostname: string;
      status: string;
      expires_at: string;
    }>(
      `SELECT id, name, hostname, status, expires_at
       FROM vps
       WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')`
    );

    if (expiredInstances.length === 0) {
      return 0;
    }

    // Deduplicated audit logging: check if already logged in the last 24 hours
    for (const vps of expiredInstances) {
      try {
        const recentAudit = queryOne<{ count: number }>(
          `SELECT COUNT(*) as count FROM audit_logs
           WHERE event_type = 'vps_expired_detected'
             AND metadata LIKE ?
             AND created_at >= datetime('now', '-24 hours')`,
          [`%"vps_id":"${vps.id}"%`]
        );

        if (!recentAudit || recentAudit.count === 0) {
          execute(
            `INSERT INTO audit_logs (user_id, event_type, metadata)
             VALUES (NULL, 'vps_expired_detected', ?)`,
            [
              JSON.stringify({
                vps_id: vps.id,
                hostname: vps.hostname,
                status: vps.status,
                expires_at: vps.expires_at,
              }),
            ]
          );
        }
      } catch {
        // Non-fatal audit log catch
      }
    }

    return expiredInstances.length;
  }

  /**
   * Admin extension or clearing of VPS expiration.
   */
  public static updateVpsExpiry(
    vpsId: string,
    expiresAt: string | null,
    adminUserId: string
  ): { oldExpiry: string | null; newExpiry: string | null } {
    const vps = queryOne<{ id: string; expires_at: string | null; hostname: string }>(
      "SELECT id, expires_at, hostname FROM vps WHERE id = ? LIMIT 1",
      [vpsId]
    );

    if (!vps) {
      const err = new Error("VPS instance not found.");
      (err as any).statusCode = 404;
      throw err;
    }

    let normalizedExpiry: string | null = null;
    if (expiresAt !== null && expiresAt !== undefined && String(expiresAt).trim() !== "") {
      const trimmed = String(expiresAt).trim();
      const parsedTime = parseDatabaseTimestampUtc(trimmed).getTime();

      if (isNaN(parsedTime) || parsedTime === 0) {
        const err = new Error("Invalid expiration timestamp format. Must be an ISO 8601 string.");
        (err as any).statusCode = 400;
        (err as any).code = "INVALID_EXPIRY_DATE";
        throw err;
      }

      if (parsedTime <= Date.now()) {
        const err = new Error("New expiration date must be in the future.");
        (err as any).statusCode = 400;
        (err as any).code = "INVALID_EXPIRY_DATE";
        throw err;
      }

      normalizedExpiry = new Date(parsedTime).toISOString();
    }

    execute(
      `UPDATE vps SET expires_at = ?, updated_at = datetime('now') WHERE id = ?`,
      [normalizedExpiry, vpsId]
    );

    // Audit log
    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata) VALUES (?, 'vps_expiry_updated', ?)`,
      [
        adminUserId,
        JSON.stringify({
          vps_id: vpsId,
          hostname: vps.hostname,
          old_expiry: vps.expires_at,
          new_expiry: normalizedExpiry,
        }),
      ]
    );

    return {
      oldExpiry: vps.expires_at,
      newExpiry: normalizedExpiry,
    };
  }
}
