/**
 * InterDash Server — Password Security Service
 *
 * Implements cryptographically secure password hashing using native Node.js scrypt.
 * Uses 128-bit random salt and constant-time comparison via crypto.timingSafeEqual.
 * Never stores plaintext passwords.
 */

import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);

const SALT_BYTES = 16;
const KEY_LENGTH = 64; // 512 bits
const SCRYPT_OPTIONS = {
  N: 16384, // CPU/memory cost
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
};

// Constant dummy hash used for timing attack protection on nonexistent accounts
const DUMMY_HASH =
  "scrypt:00112233445566778899aabbccddeeff:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export class PasswordService {
  /**
   * Hash a plaintext password with a unique cryptographically random salt.
   * Format: `scrypt:<saltHex>:<keyHex>`
   */
  public static async hash(password: string): Promise<string> {
    if (!password || typeof password !== "string") {
      throw new Error("Password must be a non-empty string.");
    }

    const salt = crypto.randomBytes(SALT_BYTES).toString("hex");
    const derivedKey = (await scryptAsync(
      password,
      salt,
      KEY_LENGTH,
      SCRYPT_OPTIONS
    )) as Buffer;

    return `scrypt:${salt}:${derivedKey.toString("hex")}`;
  }

  /**
   * Verify a candidate password against a stored scrypt hash string.
   * Uses constant-time comparison to protect against timing attacks.
   */
  public static async verify(
    candidate: string,
    storedHash: string | null | undefined
  ): Promise<boolean> {
    if (!candidate || !storedHash || typeof candidate !== "string") {
      return false;
    }

    const parts = storedHash.split(":");
    if (parts.length !== 3 || parts[0] !== "scrypt") {
      return false;
    }

    const [, salt, expectedKeyHex] = parts;
    const expectedKey = Buffer.from(expectedKeyHex, "hex");

    if (expectedKey.length !== KEY_LENGTH) {
      return false;
    }

    try {
      const candidateKey = (await scryptAsync(
        candidate,
        salt,
        KEY_LENGTH,
        SCRYPT_OPTIONS
      )) as Buffer;

      return crypto.timingSafeEqual(expectedKey, candidateKey);
    } catch {
      return false;
    }
  }

  /**
   * Perform dummy scrypt operation to prevent timing leaks when a user does not exist.
   */
  public static async dummyVerify(): Promise<void> {
    try {
      await this.verify("dummy-candidate-password", DUMMY_HASH);
    } catch {
      // Ignore
    }
  }
}
