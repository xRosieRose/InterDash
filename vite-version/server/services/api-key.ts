/**
 * InterDash Server — API Key Canonical Service
 *
 * Provides cryptographically secure key generation, SHA-256 verifier storage,
 * safe non-secret prefix derivation, request-time expiration, instant revocation,
 * atomic key rotation, and throttled usage tracking.
 *
 * INVARIANTS:
 * 1. Raw secret is displayed ONCE on creation/rotation.
 * 2. Raw secret is NEVER persisted to disk or database.
 * 3. Constant-time comparison is used during verification.
 * 4. Only admins may create or manage keys.
 */

import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { queryAll, queryOne, execute, transaction } from "../db/index.js";
import { validateScopes } from "./api-scopes.js";
import { parseDatabaseTimestampUtc } from "../utils/timestamp.js";

export interface ApiKeyRecord {
  id: string;
  name: string;
  description: string | null;
  prefix: string;
  created_by_user_id: string;
  creator_username?: string;
  scopes: string[];
  metadata: Record<string, any> | null;
  status: "active" | "revoked" | "expired";
  rate_limit_rpm: number;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  last_used_user_agent: string | null;
  rotation_parent_id: string | null;
  rotated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateApiKeyInput {
  name: string;
  description?: string;
  scopes: string[];
  expiresAt?: string | null;
  rateLimitRpm?: number;
  metadata?: Record<string, any>;
}

export interface CreateApiKeyResult {
  rawToken: string;
  key: ApiKeyRecord;
}

// In-memory throttling map to prevent hammering the DB with last_used updates
// Key: apiKeyId -> timestamp ms of last DB write
const lastUsedWriteCache = new Map<string, number>();
const THROTTLE_WRITE_MS = 60_000; // write at most once per 60 seconds per key

export class ApiKeyService {
  /**
   * Derive the SHA-256 hash of a bearer token.
   */
  public static hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * Derive safe display prefix from a raw token.
   */
  public static derivePrefix(token: string): string {
    if (token.startsWith("ih_live_") && token.length >= 16) {
      return token.slice(0, 16); // e.g. ih_live_a1b2c3d4
    }
    return token.slice(0, 12);
  }

  /**
   * Generate a cryptographically random API Key with 256 bits of entropy.
   */
  public static createKey(
    input: CreateApiKeyInput,
    creatorUserId: string
  ): CreateApiKeyResult {
    const { name, description, scopes, expiresAt, rateLimitRpm = 120, metadata } = input;

    if (!name || typeof name !== "string" || !name.trim()) {
      const err = new Error("API key name is required.");
      (err as any).statusCode = 400;
      throw err;
    }

    if (!Array.isArray(scopes) || scopes.length === 0) {
      const err = new Error("At least one scope must be selected.");
      (err as any).statusCode = 400;
      throw err;
    }

    const { valid, invalidScopes } = validateScopes(scopes);
    if (!valid) {
      const err = new Error(`Invalid scopes specified: ${invalidScopes.join(", ")}`);
      (err as any).statusCode = 400;
      throw err;
    }

    // Validate ISO timestamp if provided
    let safeExpiresAt: string | null = null;
    if (expiresAt) {
      const parsedDate = new Date(expiresAt);
      if (isNaN(parsedDate.getTime())) {
        const err = new Error("Invalid expiration date format. Must be ISO-8601 string.");
        (err as any).statusCode = 400;
        throw err;
      }
      if (parsedDate <= new Date()) {
        const err = new Error("Expiration date must be in the future.");
        (err as any).statusCode = 400;
        throw err;
      }
      safeExpiresAt = parsedDate.toISOString();
    }

    // Generate 32 bytes (256 bits) of CSPRNG entropy
    const randomHex = crypto.randomBytes(32).toString("hex");
    const rawToken = `ih_live_${randomHex}`;
    const prefix = `ih_live_${randomHex.slice(0, 8)}`;
    const keyHash = this.hashToken(rawToken);

    const keyId = `key_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
    const scopesJson = JSON.stringify(scopes);
    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    const cleanRateLimit = Math.max(10, Math.min(rateLimitRpm, 1000));

    execute(
      `INSERT INTO api_keys (
        id, name, description, prefix, key_hash, created_by_user_id,
        scopes, metadata, status, rate_limit_rpm, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))`,
      [
        keyId,
        name.trim(),
        description?.trim() || null,
        prefix,
        keyHash,
        creatorUserId,
        scopesJson,
        metadataJson,
        cleanRateLimit,
        safeExpiresAt,
      ]
    );

    // Audit event
    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata)
       VALUES (?, 'api_key_created', ?)`,
      [
        creatorUserId,
        JSON.stringify({
          apiKeyId: keyId,
          prefix,
          name: name.trim(),
          scopes,
          expiresAt: safeExpiresAt,
        }),
      ]
    );

    const key = this.getKeyById(keyId);
    if (!key) {
      throw new Error("Failed to retrieve created API key.");
    }

    return { rawToken, key };
  }

  /**
   * Verify an incoming Bearer token.
   * Returns active API key or throws a safe, structured Error.
   */
  public static verifyApiKey(token: string): ApiKeyRecord {
    if (!token || typeof token !== "string" || !token.startsWith("ih_live_")) {
      const err = new Error("Invalid API key format. Bearer token must start with 'ih_live_'.");
      (err as any).statusCode = 401;
      (err as any).code = "API_KEY_INVALID";
      throw err;
    }

    const candidateHash = this.hashToken(token);

    // Query candidate by key_hash (indexed)
    const row = queryOne<any>(
      `SELECT k.*, u.username as creator_username
       FROM api_keys k
       LEFT JOIN users u ON k.created_by_user_id = u.id
       WHERE k.key_hash = ?
       LIMIT 1`,
      [candidateHash]
    );

    if (!row) {
      const err = new Error("Invalid or unverified API key.");
      (err as any).statusCode = 401;
      (err as any).code = "API_KEY_INVALID";
      throw err;
    }

    // Constant-time comparison of stored hash and computed candidate hash
    const storedHashBuf = Buffer.from(row.key_hash, "utf8");
    const candidateHashBuf = Buffer.from(candidateHash, "utf8");
    if (
      storedHashBuf.length !== candidateHashBuf.length ||
      !crypto.timingSafeEqual(storedHashBuf, candidateHashBuf)
    ) {
      const err = new Error("Invalid API key credential.");
      (err as any).statusCode = 401;
      (err as any).code = "API_KEY_INVALID";
      throw err;
    }

    // Check immediate revocation
    if (row.revoked_at || row.status === "revoked") {
      const err = new Error("This API key has been revoked.");
      (err as any).statusCode = 401;
      (err as any).code = "API_KEY_REVOKED";
      throw err;
    }

    // Check request-time expiration
    if (row.expires_at) {
      const expiryDate = parseDatabaseTimestampUtc(row.expires_at);
      if (expiryDate <= new Date()) {
        // Mark status as expired if not already
        if (row.status !== "expired") {
          execute("UPDATE api_keys SET status = 'expired', updated_at = datetime('now') WHERE id = ?", [row.id]);
        }
        const err = new Error("This API key has expired.");
        (err as any).statusCode = 401;
        (err as any).code = "API_KEY_EXPIRED";
        throw err;
      }
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      prefix: row.prefix,
      created_by_user_id: row.created_by_user_id,
      creator_username: row.creator_username,
      scopes: JSON.parse(row.scopes || "[]"),
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      status: row.status,
      rate_limit_rpm: row.rate_limit_rpm || 120,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
      revoked_by_user_id: row.revoked_by_user_id,
      last_used_at: row.last_used_at,
      last_used_ip: row.last_used_ip,
      last_used_user_agent: row.last_used_user_agent,
      rotation_parent_id: row.rotation_parent_id,
      rotated_at: row.rotated_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * Throttled usage tracking. Updates last_used_at at most once every 60s per key.
   */
  public static trackUsageAsync(apiKeyId: string, ip?: string, userAgent?: string): void {
    const now = Date.now();
    const lastWrite = lastUsedWriteCache.get(apiKeyId) || 0;
    if (now - lastWrite >= THROTTLE_WRITE_MS) {
      lastUsedWriteCache.set(apiKeyId, now);
      // Run update asynchronously
      setImmediate(() => {
        try {
          execute(
            `UPDATE api_keys
             SET last_used_at = datetime('now'),
                 last_used_ip = COALESCE(?, last_used_ip),
                 last_used_user_agent = COALESCE(?, last_used_user_agent)
             WHERE id = ?`,
            [ip || null, userAgent ? userAgent.slice(0, 255) : null, apiKeyId]
          );
        } catch (err) {
          console.error("[API_KEY] Failed to update last_used:", err);
        }
      });
    }
  }

  /**
   * Record request telemetry into api_usage_metrics.
   */
  public static recordMetric(
    apiKeyId: string,
    endpoint: string,
    method: string,
    statusCode: number,
    responseTimeMs: number,
    ipAddress?: string
  ): void {
    setImmediate(() => {
      try {
        execute(
          `INSERT INTO api_usage_metrics (api_key_id, endpoint, method, status_code, response_time_ms, ip_address, created_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
          [apiKeyId, endpoint, method, statusCode, responseTimeMs, ipAddress || null]
        );
      } catch (err) {
        // Telemetry failure should never crash request flow
        console.error("[API_KEY] Failed to record usage metric:", err);
      }
    });
  }

  /**
   * Rotate an API key atomically:
   * 1. Revoke the old key immediately.
   * 2. Generate a new key with identical scopes and metadata.
   * 3. Return the new raw secret ONCE.
   */
  public static rotateKey(id: string, adminUserId: string): CreateApiKeyResult {
    return transaction(() => {
      const existing = queryOne<any>("SELECT * FROM api_keys WHERE id = ?", [id]);
      if (!existing) {
        const err = new Error("API key not found.");
        (err as any).statusCode = 404;
        throw err;
      }

      if (existing.revoked_at || existing.status === "revoked") {
        const err = new Error("Cannot rotate an already revoked API key.");
        (err as any).statusCode = 400;
        throw err;
      }

      const nowIso = new Date().toISOString();

      // Revoke the old key
      execute(
        `UPDATE api_keys
         SET status = 'revoked',
             revoked_at = datetime('now'),
             revoked_by_user_id = ?,
             rotated_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`,
        [adminUserId, id]
      );

      // Generate replacement key
      const randomHex = crypto.randomBytes(32).toString("hex");
      const rawToken = `ih_live_${randomHex}`;
      const prefix = `ih_live_${randomHex.slice(0, 8)}`;
      const keyHash = this.hashToken(rawToken);
      const newKeyId = `key_${uuidv4().replace(/-/g, "").slice(0, 16)}`;

      execute(
        `INSERT INTO api_keys (
          id, name, description, prefix, key_hash, created_by_user_id,
          scopes, metadata, status, rate_limit_rpm, expires_at, rotation_parent_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          newKeyId,
          existing.name,
          existing.description,
          prefix,
          keyHash,
          adminUserId,
          existing.scopes,
          existing.metadata,
          existing.rate_limit_rpm || 120,
          existing.expires_at,
          id, // parent is the old key
        ]
      );

      // Audit both
      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'api_key_rotated', ?)`,
        [
          adminUserId,
          JSON.stringify({
            oldKeyId: id,
            oldPrefix: existing.prefix,
            newKeyId,
            newPrefix: prefix,
          }),
        ]
      );

      const key = this.getKeyById(newKeyId)!;
      return { rawToken, key };
    });
  }

  /**
   * Immediately revoke an API key.
   */
  public static revokeKey(id: string, adminUserId: string): ApiKeyRecord {
    const existing = queryOne<any>("SELECT * FROM api_keys WHERE id = ?", [id]);
    if (!existing) {
      const err = new Error("API key not found.");
      (err as any).statusCode = 404;
      throw err;
    }

    if (existing.revoked_at || existing.status === "revoked") {
      return this.getKeyById(id)!;
    }

    execute(
      `UPDATE api_keys
       SET status = 'revoked',
           revoked_at = datetime('now'),
           revoked_by_user_id = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [adminUserId, id]
    );

    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata)
       VALUES (?, 'api_key_revoked', ?)`,
      [adminUserId, JSON.stringify({ apiKeyId: id, prefix: existing.prefix, name: existing.name })]
    );

    return this.getKeyById(id)!;
  }

  /**
   * Update API key metadata, scopes, or rate limits.
   */
  public static updateKey(
    id: string,
    updates: {
      name?: string;
      description?: string;
      scopes?: string[];
      expiresAt?: string | null;
      rateLimitRpm?: number;
    },
    adminUserId: string
  ): ApiKeyRecord {
    const existing = queryOne<any>("SELECT * FROM api_keys WHERE id = ?", [id]);
    if (!existing) {
      const err = new Error("API key not found.");
      (err as any).statusCode = 404;
      throw err;
    }

    const setClauses: string[] = ["updated_at = datetime('now')"];
    const params: any[] = [];

    if (updates.name !== undefined) {
      if (!updates.name.trim()) {
        const err = new Error("Key name cannot be empty.");
        (err as any).statusCode = 400;
        throw err;
      }
      setClauses.push("name = ?");
      params.push(updates.name.trim());
    }

    if (updates.description !== undefined) {
      setClauses.push("description = ?");
      params.push(updates.description?.trim() || null);
    }

    if (updates.scopes !== undefined) {
      const { valid, invalidScopes } = validateScopes(updates.scopes);
      if (!valid) {
        const err = new Error(`Invalid scopes specified: ${invalidScopes.join(", ")}`);
        (err as any).statusCode = 400;
        throw err;
      }
      setClauses.push("scopes = ?");
      params.push(JSON.stringify(updates.scopes));
    }

    if (updates.expiresAt !== undefined) {
      if (updates.expiresAt === null) {
        setClauses.push("expires_at = NULL");
      } else {
        const d = new Date(updates.expiresAt);
        if (isNaN(d.getTime())) {
          const err = new Error("Invalid expiration date format.");
          (err as any).statusCode = 400;
          throw err;
        }
        setClauses.push("expires_at = ?");
        params.push(d.toISOString());
      }
    }

    if (updates.rateLimitRpm !== undefined) {
      const cleanRpm = Math.max(10, Math.min(updates.rateLimitRpm, 1000));
      setClauses.push("rate_limit_rpm = ?");
      params.push(cleanRpm);
    }

    params.push(id);
    execute(`UPDATE api_keys SET ${setClauses.join(", ")} WHERE id = ?`, params);

    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata)
       VALUES (?, 'api_key_updated', ?)`,
      [adminUserId, JSON.stringify({ apiKeyId: id, updates })]
    );

    return this.getKeyById(id)!;
  }

  /**
   * Delete an API key record (administrative purge).
   */
  public static deleteKey(id: string, adminUserId: string): void {
    const existing = queryOne<any>("SELECT * FROM api_keys WHERE id = ?", [id]);
    if (!existing) {
      const err = new Error("API key not found.");
      (err as any).statusCode = 404;
      throw err;
    }

    execute("DELETE FROM api_keys WHERE id = ?", [id]);

    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata)
       VALUES (?, 'api_key_purged', ?)`,
      [adminUserId, JSON.stringify({ apiKeyId: id, prefix: existing.prefix, name: existing.name })]
    );
  }

  /**
   * List all API keys for administrators.
   * NEVER returns key_hash or raw tokens.
   */
  public static listKeys(): ApiKeyRecord[] {
    const rows = queryAll<any>(
      `SELECT k.id, k.name, k.description, k.prefix, k.created_by_user_id,
              k.scopes, k.metadata, k.status, k.rate_limit_rpm,
              k.expires_at, k.revoked_at, k.revoked_by_user_id,
              k.last_used_at, k.last_used_ip, k.last_used_user_agent,
              k.rotation_parent_id, k.rotated_at, k.created_at, k.updated_at,
              u.username as creator_username
       FROM api_keys k
       LEFT JOIN users u ON k.created_by_user_id = u.id
       ORDER BY k.created_at DESC`
    );

    return rows.map((r) => {
      // Re-evaluate active vs expired on list
      let status = r.status;
      if (r.revoked_at) {
        status = "revoked";
      } else if (r.expires_at && parseDatabaseTimestampUtc(r.expires_at) <= new Date()) {
        status = "expired";
      }

      return {
        id: r.id,
        name: r.name,
        description: r.description,
        prefix: r.prefix,
        created_by_user_id: r.created_by_user_id,
        creator_username: r.creator_username,
        scopes: JSON.parse(r.scopes || "[]"),
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
        status,
        rate_limit_rpm: r.rate_limit_rpm || 120,
        expires_at: r.expires_at,
        revoked_at: r.revoked_at,
        revoked_by_user_id: r.revoked_by_user_id,
        last_used_at: r.last_used_at,
        last_used_ip: r.last_used_ip,
        last_used_user_agent: r.last_used_user_agent,
        rotation_parent_id: r.rotation_parent_id,
        rotated_at: r.rotated_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });
  }

  /**
   * Get an API key by ID.
   */
  public static getKeyById(id: string): ApiKeyRecord | null {
    const r = queryOne<any>(
      `SELECT k.id, k.name, k.description, k.prefix, k.created_by_user_id,
              k.scopes, k.metadata, k.status, k.rate_limit_rpm,
              k.expires_at, k.revoked_at, k.revoked_by_user_id,
              k.last_used_at, k.last_used_ip, k.last_used_user_agent,
              k.rotation_parent_id, k.rotated_at, k.created_at, k.updated_at,
              u.username as creator_username
       FROM api_keys k
       LEFT JOIN users u ON k.created_by_user_id = u.id
       WHERE k.id = ?
       LIMIT 1`,
      [id]
    );

    if (!r) return null;

    let status = r.status;
    if (r.revoked_at) {
      status = "revoked";
    } else if (r.expires_at && parseDatabaseTimestampUtc(r.expires_at) <= new Date()) {
      status = "expired";
    }

    return {
      id: r.id,
      name: r.name,
      description: r.description,
      prefix: r.prefix,
      created_by_user_id: r.created_by_user_id,
      creator_username: r.creator_username,
      scopes: JSON.parse(r.scopes || "[]"),
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
      status,
      rate_limit_rpm: r.rate_limit_rpm || 120,
      expires_at: r.expires_at,
      revoked_at: r.revoked_at,
      revoked_by_user_id: r.revoked_by_user_id,
      last_used_at: r.last_used_at,
      last_used_ip: r.last_used_ip,
      last_used_user_agent: r.last_used_user_agent,
      rotation_parent_id: r.rotation_parent_id,
      rotated_at: r.rotated_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  /**
   * Query recent usage telemetry for an API key.
   */
  public static getKeyUsage(id: string, limit: number = 50): any {
    const totalRequests = queryOne<any>(
      "SELECT COUNT(*) as count FROM api_usage_metrics WHERE api_key_id = ?",
      [id]
    )?.count || 0;

    const recent = queryAll<any>(
      `SELECT endpoint, method, status_code, response_time_ms, ip_address, created_at
       FROM api_usage_metrics
       WHERE api_key_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [id, Math.min(limit, 200)]
    );

    const endpointsBreakdown = queryAll<any>(
      `SELECT endpoint, method, COUNT(*) as count, AVG(response_time_ms) as avg_latency_ms
       FROM api_usage_metrics
       WHERE api_key_id = ?
       GROUP BY endpoint, method
       ORDER BY count DESC
       LIMIT 10`,
      [id]
    );

    return {
      totalRequests,
      recentRequests: recent,
      topEndpoints: endpointsBreakdown,
    };
  }

  /**
   * Periodic maintenance: Purge old usage metrics and expired idempotency keys.
   */
  public static cleanupOldMetrics(): void {
    try {
      // Keep usage metrics for 30 days
      execute("DELETE FROM api_usage_metrics WHERE datetime(created_at) < datetime('now', '-30 days')");
      // Keep idempotency keys for 24 hours
      execute("DELETE FROM api_idempotency_keys WHERE datetime(expires_at) < datetime('now')");
    } catch (err) {
      console.error("[API_KEY] Cleanup error:", err);
    }
  }
}
