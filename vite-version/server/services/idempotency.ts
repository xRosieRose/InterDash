/**
 * InterDash Server — API Idempotency Engine
 *
 * Implements RFC-compliant idempotency using the `Idempotency-Key` header.
 * Guarantees that retrying a mutative request with the same idempotency key
 * replays the original response without executing duplicate infrastructure operations.
 *
 * Conflicting payloads with the same idempotency key are rejected with 409 Conflict.
 */

import crypto from "node:crypto";
import { queryOne, execute } from "../db/index.js";

export interface IdempotencyCheckResult {
  isMatch: boolean;
  cachedResponse?: {
    statusCode: number;
    headers: Record<string, string>;
    body: any;
  };
}

export class IdempotencyService {
  /**
   * Maximum allowed body size to store in idempotency cache (128 KB).
   */
  private static MAX_BODY_SIZE = 128 * 1024;

  /**
   * Derive canonical SHA-256 hash of the request body.
   */
  public static hashRequestBody(body: any): string {
    if (!body || (typeof body === "object" && Object.keys(body).length === 0)) {
      return "EMPTY_BODY";
    }
    // Normalize keys to ensure consistent JSON stringification
    const normalizedJson = JSON.stringify(body, Object.keys(body).sort());
    return crypto.createHash("sha256").update(normalizedJson).digest("hex");
  }

  /**
   * Check if an idempotency record exists for this API key and idempotency key.
   * Throws 409 if the request hash differs from the stored hash.
   */
  public static checkIdempotency(
    apiKeyId: string,
    idempotencyKey: string,
    method: string,
    path: string,
    body: any
  ): IdempotencyCheckResult {
    // Validate key length (max 128 chars) and format
    if (idempotencyKey.length > 128) {
      const err = new Error("Idempotency-Key header exceeds maximum length of 128 characters.");
      (err as any).statusCode = 400;
      (err as any).code = "INVALID_IDEMPOTENCY_KEY";
      throw err;
    }

    const currentHash = this.hashRequestBody(body);

    const record = queryOne<any>(
      `SELECT * FROM api_idempotency_keys
       WHERE api_key_id = ? AND idempotency_key = ?
       LIMIT 1`,
      [apiKeyId, idempotencyKey]
    );

    if (!record) {
      return { isMatch: false };
    }

    // Check if path or method or payload hash differs
    if (
      record.method !== method ||
      record.path !== path ||
      record.request_hash !== currentHash
    ) {
      const err = new Error(
        `Idempotency conflict: Key '${idempotencyKey}' was already used with different request parameters or endpoint.`
      );
      (err as any).statusCode = 409;
      (err as any).code = "IDEMPOTENCY_CONFLICT";
      (err as any).details = {
        idempotencyKey,
        originalEndpoint: `${record.method} ${record.path}`,
        currentEndpoint: `${method} ${path}`,
      };
      throw err;
    }

    let parsedBody: any;
    try {
      parsedBody = JSON.parse(record.response_body);
    } catch {
      parsedBody = record.response_body;
    }

    let parsedHeaders: Record<string, string> = {};
    if (record.response_headers) {
      try {
        parsedHeaders = JSON.parse(record.response_headers);
      } catch {}
    }

    return {
      isMatch: true,
      cachedResponse: {
        statusCode: record.status_code,
        headers: {
          ...parsedHeaders,
          "x-cache": "IDEMPOTENT-REPLAY",
          "x-idempotency-key": idempotencyKey,
        },
        body: parsedBody,
      },
    };
  }

  /**
   * Persist response for an idempotent operation.
   * Strips out any sensitive credential fields before caching.
   */
  public static saveIdempotentResponse(
    apiKeyId: string,
    idempotencyKey: string,
    method: string,
    path: string,
    body: any,
    statusCode: number,
    headers: Record<string, string>,
    responseBody: any,
    resourceId?: string
  ): void {
    try {
      const requestHash = this.hashRequestBody(body);

      // Sanitize response body if needed (ensure passwords/tickets not stored)
      const sanitizedBody = this.sanitizePayload(responseBody);
      const bodyStr = JSON.stringify(sanitizedBody);

      if (bodyStr.length > this.MAX_BODY_SIZE) {
        console.warn(`[IDEMPOTENCY] Response body too large to cache (${bodyStr.length} bytes).`);
        return;
      }

      const headersToCache = {
        "content-type": headers["content-type"] || "application/json",
      };

      execute(
        `INSERT INTO api_idempotency_keys (
          idempotency_key, api_key_id, method, path, request_hash,
          status_code, response_headers, response_body, resource_id, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+24 hours'))
        ON CONFLICT(api_key_id, idempotency_key) DO UPDATE SET
          status_code = excluded.status_code,
          response_body = excluded.response_body,
          response_headers = excluded.response_headers`,
        [
          idempotencyKey,
          apiKeyId,
          method,
          path,
          requestHash,
          statusCode,
          JSON.stringify(headersToCache),
          bodyStr,
          resourceId || null,
        ]
      );
    } catch (err) {
      console.error("[IDEMPOTENCY] Failed to save response:", err);
    }
  }

  /**
   * Helper to strip known sensitive attributes from cached response
   */
  private static sanitizePayload(payload: any): any {
    if (!payload || typeof payload !== "object") return payload;
    const copy = JSON.parse(JSON.stringify(payload));
    const redactKeys = ["password", "rootPassword", "token", "secret", "clientSecret"];
    
    function redact(obj: any) {
      if (!obj || typeof obj !== "object") return;
      for (const k of Object.keys(obj)) {
        if (redactKeys.includes(k)) {
          obj[k] = "••••••••";
        } else if (typeof obj[k] === "object") {
          redact(obj[k]);
        }
      }
    }

    redact(copy);
    return copy;
  }
}
