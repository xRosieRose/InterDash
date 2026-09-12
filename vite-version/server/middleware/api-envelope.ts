/**
 * InterDash Server — API Envelope & Request ID Middleware
 *
 * Provides standard response envelopes, request ID tracking, and safe error serialization.
 */

import { v4 as uuidv4 } from "uuid";
import type { Request, Response, NextFunction } from "express";

/**
 * Extend Express Request with API-specific context
 */
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      startTime?: number;
    }
  }
}

/**
 * Extract or generate standard X-Request-ID.
 * Validates length and safe characters to prevent header injection.
 */
export function apiRequestId(req: Request, res: Response, next: NextFunction): void {
  req.startTime = Date.now();
  const incoming = req.header("x-request-id");

  // Validate incoming request ID: max 64 chars, alphanumeric + hyphens/underscores
  if (incoming && typeof incoming === "string" && /^[a-zA-Z0-9\-_]{4,64}$/.test(incoming)) {
    req.requestId = incoming;
  } else {
    req.requestId = uuidv4();
  }

  res.setHeader("X-Request-ID", req.requestId);
  next();
}

/**
 * Standard Single-Resource Success Envelope
 */
export function apiSuccess<T = any>(
  res: Response,
  data: T,
  meta?: Record<string, any>,
  statusCode: number = 200
): Response {
  const req = (res as any).req as Request;
  const envelope: any = {
    data,
    requestId: req?.requestId || res.getHeader("X-Request-ID") || uuidv4(),
  };

  if (meta && Object.keys(meta).length > 0) {
    envelope.meta = meta;
  }

  return res.status(statusCode).json(envelope);
}

/**
 * Standard Collection Success Envelope with Pagination
 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
}

export function apiCollection<T = any>(
  res: Response,
  data: T[],
  pagination: PaginationMeta,
  meta?: Record<string, any>,
  statusCode: number = 200
): Response {
  const req = (res as any).req as Request;
  const envelope: any = {
    data,
    pagination,
    requestId: req?.requestId || res.getHeader("X-Request-ID") || uuidv4(),
  };

  if (meta && Object.keys(meta).length > 0) {
    envelope.meta = meta;
  }

  return res.status(statusCode).json(envelope);
}

/**
 * Standard Error Envelope
 */
export function apiError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, any>
): Response {
  const req = (res as any).req as Request;
  const envelope: any = {
    error: {
      code,
      message,
    },
    requestId: req?.requestId || res.getHeader("X-Request-ID") || uuidv4(),
  };

  if (details && Object.keys(details).length > 0) {
    envelope.error.details = details;
  }

  return res.status(statusCode).json(envelope);
}
