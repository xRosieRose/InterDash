/**
 * InterDash Server — Authentication Configuration Service
 *
 * Authoritative provider configuration service backed by persistent panel_settings.
 * Features:
 *   - AES-256-GCM credential encryption at rest for OAuth client secrets
 *   - Redaction: secrets are NEVER returned via GET endpoints (masked as hasClientSecret)
 *   - In-memory cache with immediate invalidation on mutations
 *   - Precedence: database settings -> environment fallback -> unconfigured
 *   - Safe defaults: Discord enabled, Email disabled, Email registration disabled
 */

import { queryAll, queryOne, execute, transaction } from "../db/index.js";
import { config } from "../config.js";
import { encryptCredential, decryptCredential } from "./crypto.js";

export interface PublicAuthProviderStatus {
  discord: {
    enabled: boolean;
    configured: boolean;
  };
  email: {
    enabled: boolean;
    configured: boolean;
    allowRegistration: boolean;
  };
}

export interface AdminAuthSettings {
  discord: {
    enabled: boolean;
    clientId: string;
    hasClientSecret: boolean;
    redirectUri: string;
    configured: boolean;
  };
  email: {
    enabled: boolean;
    allowRegistration: boolean;
    minPasswordLength: number;
    configured: boolean;
  };
}

export interface UpdateAuthSettingsPayload {
  discord?: {
    enabled?: boolean;
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
  };
  email?: {
    enabled?: boolean;
    allowRegistration?: boolean;
    minPasswordLength?: number;
  };
}

export interface ResolvedDiscordConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  isConfigured: boolean;
}

export class AuthConfigService {
  private static cache: Map<string, string> | null = null;
  private static cacheTime = 0;
  private static readonly CACHE_TTL_MS = 60 * 1000; // 60 seconds

  /**
   * Invalidate cached settings
   */
  public static invalidateCache(): void {
    this.cache = null;
    this.cacheTime = 0;
  }

  /**
   * Load all panel_settings into key-value map with short-lived cache
   */
  private static getSettingsMap(): Map<string, string> {
    const now = Date.now();
    if (this.cache && now - this.cacheTime < this.CACHE_TTL_MS) {
      return this.cache;
    }

    const rows = queryAll<{ key: string; value: string }>(
      "SELECT key, value FROM panel_settings"
    );
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.key, row.value);
    }

    this.cache = map;
    this.cacheTime = now;
    return map;
  }

  /**
   * Resolve active Discord configuration with database precedence and environment fallback
   */
  public static getResolvedDiscordConfig(): ResolvedDiscordConfig {
    const settings = this.getSettingsMap();

    // Enabled status: defaults to true
    const enabledRaw = settings.get("auth_discord_enabled");
    const enabled = enabledRaw !== undefined ? enabledRaw === "true" : true;

    // Client ID: DB override if set, else env fallback
    const dbClientId = (settings.get("auth_discord_client_id") || "").trim();
    const clientId = dbClientId || config.discord.clientId || "";

    // Client Secret: Decrypted DB secret if set, else env fallback
    const encryptedSecret = settings.get("auth_discord_client_secret_encrypted") || "";
    let clientSecret = "";
    if (encryptedSecret) {
      clientSecret = decryptCredential(encryptedSecret);
    }
    if (!clientSecret) {
      clientSecret = config.discord.clientSecret || "";
    }

    // Redirect URI: DB override if set, else env fallback
    const dbRedirectUri = (settings.get("auth_discord_redirect_uri") || "").trim();
    const redirectUri = dbRedirectUri || config.discord.redirectUri || "";

    const isSnowflake = /^\d{17,21}$/.test(clientId);
    const hasSecret = Boolean(
      clientSecret &&
      clientSecret !== "mock_discord_client_secret" &&
      clientSecret.length > 8
    );
    const isConfigured = Boolean(clientId && (isSnowflake || !config.isProd) && hasSecret && redirectUri);

    return {
      enabled,
      clientId,
      clientSecret,
      redirectUri,
      isConfigured,
    };
  }

  /**
   * Check if Discord authentication is currently enabled
   */
  public static isDiscordEnabled(): boolean {
    const discord = this.getResolvedDiscordConfig();
    return discord.enabled;
  }

  /**
   * Check if Email authentication is currently enabled
   */
  public static isEmailEnabled(): boolean {
    const settings = this.getSettingsMap();
    return settings.get("auth_email_enabled") === "true";
  }

  /**
   * Check if public Email registration is allowed
   */
  public static isEmailRegistrationAllowed(): boolean {
    const settings = this.getSettingsMap();
    return (
      this.isEmailEnabled() &&
      settings.get("auth_email_allow_registration") === "true"
    );
  }

  /**
   * Minimum required password length
   */
  public static getMinPasswordLength(): number {
    const settings = this.getSettingsMap();
    const val = parseInt(settings.get("auth_email_min_password_length") || "8", 10);
    return isNaN(val) || val < 8 ? 8 : val;
  }

  /**
   * Public provider status — safe for unauthenticated login page
   * NEVER returns client secrets or internal URLs
   */
  public static getPublicStatus(): PublicAuthProviderStatus {
    const discord = this.getResolvedDiscordConfig();
    const emailEnabled = this.isEmailEnabled();
    const emailRegistration = this.isEmailRegistrationAllowed();

    return {
      discord: {
        enabled: discord.enabled,
        configured: discord.isConfigured,
      },
      email: {
        enabled: emailEnabled,
        configured: true, // Native scrypt provider is always configured
        allowRegistration: emailRegistration,
      },
    };
  }

  /**
   * Administrative settings view with masked secrets
   */
  public static getAdminSettings(): AdminAuthSettings {
    const discord = this.getResolvedDiscordConfig();
    const settings = this.getSettingsMap();

    const emailEnabled = settings.get("auth_email_enabled") === "true";
    const emailAllowReg = settings.get("auth_email_allow_registration") === "true";
    const minPasswordLength = this.getMinPasswordLength();

    return {
      discord: {
        enabled: discord.enabled,
        clientId: discord.clientId,
        hasClientSecret: Boolean(discord.clientSecret),
        redirectUri: discord.redirectUri,
        configured: discord.isConfigured,
      },
      email: {
        enabled: emailEnabled,
        allowRegistration: emailAllowReg,
        minPasswordLength,
        configured: true,
      },
    };
  }

  /**
   * Update administrative authentication settings
   */
  public static updateAdminSettings(
    payload: UpdateAuthSettingsPayload,
    adminUserId: string
  ): AdminAuthSettings {
    if (!payload || typeof payload !== "object") {
      const err = new Error("Invalid settings payload.");
      (err as any).statusCode = 400;
      throw err;
    }

    const currentDiscord = this.getResolvedDiscordConfig();
    const settings = this.getSettingsMap();

    // Safety rule: At least one authentication provider must remain enabled
    let willDiscordBeEnabled = currentDiscord.enabled;
    if (payload.discord && payload.discord.enabled !== undefined) {
      willDiscordBeEnabled = Boolean(payload.discord.enabled);
    }

    let willEmailBeEnabled = this.isEmailEnabled();
    if (payload.email && payload.email.enabled !== undefined) {
      willEmailBeEnabled = Boolean(payload.email.enabled);
    }

    if (!willDiscordBeEnabled && !willEmailBeEnabled) {
      const err = new Error(
        "Cannot disable all authentication providers. At least one authentication method must remain active."
      );
      (err as any).statusCode = 400;
      (err as any).code = "ALL_AUTH_PROVIDERS_DISABLED";
      throw err;
    }

    // 1. Process Discord updates
    if (payload.discord) {
      const { enabled, clientId, clientSecret, redirectUri } = payload.discord;

      if (clientId !== undefined) {
        const cleanId = String(clientId).trim();
        if (cleanId && config.isProd && !/^\d{17,21}$/.test(cleanId)) {
          const err = new Error("Discord Client ID must be a numeric 17-21 digit Application ID.");
          (err as any).statusCode = 400;
          throw err;
        }
        execute(
          `INSERT INTO panel_settings (key, value, updated_at) VALUES ('auth_discord_client_id', ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          [cleanId]
        );
      }

      // If clientSecret provided as non-empty string, encrypt and save.
      // If undefined, preserve existing secret.
      if (clientSecret !== undefined && typeof clientSecret === "string") {
        const cleanSecret = clientSecret.trim();
        if (cleanSecret) {
          const encrypted = encryptCredential(cleanSecret);
          execute(
            `INSERT INTO panel_settings (key, value, updated_at) VALUES ('auth_discord_client_secret_encrypted', ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
            [encrypted]
          );
        }
      }

      if (redirectUri !== undefined) {
        const cleanUri = String(redirectUri).trim();
        if (cleanUri && !cleanUri.startsWith("http://") && !cleanUri.startsWith("https://")) {
          const err = new Error("Discord Redirect URI must begin with http:// or https://");
          (err as any).statusCode = 400;
          throw err;
        }
        execute(
          `INSERT INTO panel_settings (key, value, updated_at) VALUES ('auth_discord_redirect_uri', ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          [cleanUri]
        );
      }

      if (enabled !== undefined) {
        const boolVal = Boolean(enabled);
        // If enabling, validate required configuration
        if (boolVal) {
          const targetClientId = clientId !== undefined ? String(clientId).trim() : currentDiscord.clientId;
          const targetSecret =
            clientSecret && clientSecret.trim()
              ? clientSecret.trim()
              : currentDiscord.clientSecret;
          const targetRedirect = redirectUri !== undefined ? String(redirectUri).trim() : currentDiscord.redirectUri;

          if (!targetClientId || !targetSecret || !targetRedirect) {
            const err = new Error(
              "Cannot enable Discord authentication without Client ID, Client Secret, and Redirect URI."
            );
            (err as any).statusCode = 400;
            (err as any).code = "AUTH_PROVIDER_MISCONFIGURED";
            throw err;
          }
        }

        execute(
          `INSERT INTO panel_settings (key, value, updated_at) VALUES ('auth_discord_enabled', ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          [boolVal ? "true" : "false"]
        );
      }
    }

    // 2. Process Email updates
    if (payload.email) {
      const { enabled, allowRegistration, minPasswordLength } = payload.email;

      if (enabled !== undefined) {
        execute(
          `INSERT INTO panel_settings (key, value, updated_at) VALUES ('auth_email_enabled', ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          [Boolean(enabled) ? "true" : "false"]
        );
      }

      if (allowRegistration !== undefined) {
        execute(
          `INSERT INTO panel_settings (key, value, updated_at) VALUES ('auth_email_allow_registration', ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          [Boolean(allowRegistration) ? "true" : "false"]
        );
      }

      if (minPasswordLength !== undefined) {
        const minLen = Math.max(8, Math.min(128, parseInt(String(minPasswordLength), 10) || 8));
        execute(
          `INSERT INTO panel_settings (key, value, updated_at) VALUES ('auth_email_min_password_length', ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          [String(minLen)]
        );
      }
    }

    // Invalidate cache immediately
    this.invalidateCache();

    // Audit log
    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata) VALUES (?, 'auth_settings_updated', ?)`,
      [adminUserId, JSON.stringify({ keys_updated: Object.keys(payload) })]
    );

    return this.getAdminSettings();
  }
}
