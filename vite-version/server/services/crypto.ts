/**
 * InterDash Server — Cryptographic Service
 *
 * AES-256-GCM authenticated encryption for storing sensitive credentials
 * (such as Proxmox API token secrets) at rest in the database.
 *
 * Master encryption key is derived deterministically from SESSION_SECRET
 * or a dedicated ENCRYPTION_KEY server environment variable.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a 32-byte key using SHA-256 over the server secret.
 * Falls back to a persistent keyfile in data/.encryption_key so that
 * server reboots/reloads never invalidate encrypted credentials when SESSION_SECRET is unset.
 */
function getMasterKey(): Buffer {
  if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.trim()) {
    return crypto.createHash("sha256").update(process.env.ENCRYPTION_KEY.trim()).digest();
  }
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim()) {
    return crypto.createHash("sha256").update(process.env.SESSION_SECRET.trim()).digest();
  }

  // Persistent keyfile fallback in data directory
  const keyFilePath = path.resolve(process.cwd(), "data", ".encryption_key");
  try {
    if (fs.existsSync(keyFilePath)) {
      const stored = fs.readFileSync(keyFilePath, "utf8").trim();
      if (stored.length >= 32) {
        return crypto.createHash("sha256").update(stored).digest();
      }
    }
    const generated = crypto.randomBytes(32).toString("hex");
    const dir = path.dirname(keyFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(keyFilePath, generated, { mode: 0o600 });
    return crypto.createHash("sha256").update(generated).digest();
  } catch {
    return crypto.createHash("sha256").update(config.sessionSecret).digest();
  }
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Output format: iv:authTag:ciphertext (all in hex).
 */
export function encryptCredential(plaintext: string): string {
  if (!plaintext) return "";
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt an AES-256-GCM encrypted credential string.
 */
export function decryptCredential(encryptedPayload: string): string {
  if (!encryptedPayload) return "";
  const parts = encryptedPayload.split(":");
  if (parts.length !== 3) {
    // If not in encrypted format (e.g. legacy/plain), return as-is for compatibility
    return encryptedPayload;
  }

  try {
    const [ivHex, authTagHex, encryptedText] = parts;
    const key = getMasterKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    if (authTag.length !== AUTH_TAG_LENGTH) {
      return encryptedPayload;
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch {
    // Return original payload if decryption fails (e.g. secret mismatch or unencrypted)
    return encryptedPayload;
  }
}
