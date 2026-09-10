/**
 * InterDash Server — Security Middleware
 *
 * Security headers and CSRF protection.
 */

import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { config } from "../config.js";

/**
 * Security headers via Helmet.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "https:",
      ],
      connectSrc: ["'self'", "https://discord.com", "https://cdn.discordapp.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Required for external images
  crossOriginResourcePolicy: false, // Allow external image CDNs (e.g. Imgur, Unsplash, Discord)
  hsts: config.isProd
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
});

/**
 * CSRF token generation and validation.
 *
 * We use the Signed Double-Submit Cookie pattern:
 * 1. Server sets a random CSRF token in a readable cookie
 * 2. Client reads the cookie and sends it as a header
 * 3. Server validates header matches cookie
 */

const CSRF_COOKIE = "interdash_csrf";
const CSRF_HEADER = "x-csrf-token";

/**
 * Set CSRF cookie on every response (if not already set).
 */
export function csrfCookieSetter(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.cookies[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString("hex");
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // Must be readable by JS
      secure: config.isProd,
      sameSite: "lax",
      path: "/",
      maxAge: config.session.maxAge,
    });
  }
  next();
}

/**
 * Validate CSRF token on state-changing requests.
 */
export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const safeMethods = ["GET", "HEAD", "OPTIONS"];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const cookieToken = req.cookies[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER] as string | undefined;

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ error: "CSRF validation failed." });
    return;
  }

  next();
}
