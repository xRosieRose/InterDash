/**
 * InterDash Server — Startup Script Canonical Service
 *
 * Manages the platform-wide first-install startup Bash script executed
 * inside newly provisioned or reinstalled LXC virtual servers.
 * Enforces admin authorization, audit logging, and resilient execution.
 */

import { queryOne, execute } from "../db/index.js";
import { ProxmoxService, type ProxmoxNodeConfig } from "./proxmox.js";

export interface StartupScriptConfig {
  enabled: boolean;
  content: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ExecuteStartupScriptParams {
  node: ProxmoxNodeConfig;
  vmid: number;
  vpsId: string;
  hostname: string;
  ipv4?: string | null;
  runtimeNode?: string;
}

export interface StartupScriptExecutionResult {
  executed: boolean;
  success: boolean;
  reason?: string;
  error?: string;
  exitCode?: number;
}

export class StartupScriptService {
  /**
   * Maximum allowed script size: 256 KB.
   */
  public static MAX_SCRIPT_SIZE_BYTES = 256 * 1024;

  /**
   * Retrieve the current startup script configuration.
   */
  public static getConfig(): StartupScriptConfig {
    const rows = queryOne<any>(
      `SELECT
        (SELECT value FROM panel_settings WHERE key = 'startup_script_enabled') as enabled,
        (SELECT value FROM panel_settings WHERE key = 'startup_script_content') as content,
        (SELECT updated_at FROM panel_settings WHERE key = 'startup_script_content') as updated_at,
        (SELECT value FROM panel_settings WHERE key = 'startup_script_updated_by') as updated_by`
    );

    const isEnabled = rows?.enabled === "true" || rows?.enabled === "1";
    const scriptContent = typeof rows?.content === "string" ? rows.content : "";

    return {
      enabled: isEnabled,
      content: scriptContent,
      updatedAt: rows?.updated_at || null,
      updatedBy: rows?.updated_by || null,
    };
  }

  /**
   * Update the startup script configuration and record an audit log event.
   */
  public static updateConfig(
    input: { enabled?: boolean; content?: string },
    userId: string
  ): StartupScriptConfig {
    const current = this.getConfig();

    const newEnabled = input.enabled !== undefined ? Boolean(input.enabled) : current.enabled;
    const newContent = input.content !== undefined ? String(input.content) : current.content;

    if (Buffer.byteLength(newContent, "utf8") > this.MAX_SCRIPT_SIZE_BYTES) {
      const err = new Error(
        `Startup script exceeds maximum size of ${this.MAX_SCRIPT_SIZE_BYTES / 1024} KB.`
      );
      (err as any).statusCode = 400;
      throw err;
    }

    const now = new Date().toISOString();

    execute(
      `INSERT INTO panel_settings (key, value, updated_at)
       VALUES ('startup_script_enabled', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [newEnabled ? "true" : "false", now]
    );

    execute(
      `INSERT INTO panel_settings (key, value, updated_at)
       VALUES ('startup_script_content', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [newContent, now]
    );

    execute(
      `INSERT INTO panel_settings (key, value, updated_at)
       VALUES ('startup_script_updated_by', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [userId, now]
    );

    // Audit Log
    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata)
       VALUES (?, 'startup_script_updated', ?)`,
      [
        userId,
        JSON.stringify({
          enabled: newEnabled,
          contentLength: newContent.length,
          updatedAt: now,
        }),
      ]
    );

    return {
      enabled: newEnabled,
      content: newContent,
      updatedAt: now,
      updatedBy: userId,
    };
  }

  /**
   * Build the complete script payload with injected runtime context variables.
   */
  public static prepareScriptPayload(
    content: string,
    context: { vpsId: string; hostname: string; ipv4?: string | null }
  ): string {
    const safeVpsId = context.vpsId.replace(/[^a-zA-Z0-9_\-]/g, "");
    const safeHostname = context.hostname.replace(/["`$\\]/g, "");
    const safeIpv4 = (context.ipv4 || "dhcp").replace(/["`$\\]/g, "");
    const execTime = new Date().toISOString();

    const envPreamble = [
      `# --- InterDash Injected Environment Context ---`,
      `export INTERDASH_VPS_ID="${safeVpsId}"`,
      `export INTERDASH_HOSTNAME="${safeHostname}"`,
      `export INTERDASH_IPV4="${safeIpv4}"`,
      `export INTERDASH_EXEC_TIME="${execTime}"`,
      `# ----------------------------------------------`,
      ``,
    ].join("\n");

    // If script starts with a shebang, inject preamble after shebang
    const trimmed = content.trim();
    if (trimmed.startsWith("#!")) {
      const firstNewline = trimmed.indexOf("\n");
      if (firstNewline !== -1) {
        const shebang = trimmed.slice(0, firstNewline);
        const rest = trimmed.slice(firstNewline + 1);
        return `${shebang}\n${envPreamble}${rest}`;
      }
    }

    return `#!/usr/bin/env bash\n${envPreamble}${trimmed}`;
  }

  /**
   * Execute the startup script for a newly provisioned or reinstalled VPS.
   * Runs non-destructively: failure in the script logs a warning but does
   * not abort instance creation.
   */
  public static async executeForVps(
    params: ExecuteStartupScriptParams
  ): Promise<StartupScriptExecutionResult> {
    const config = this.getConfig();

    if (!config.enabled) {
      return { executed: false, success: true, reason: "startup_script_disabled" };
    }

    if (!config.content || !config.content.trim()) {
      return { executed: false, success: true, reason: "startup_script_empty" };
    }

    const preparedScript = this.prepareScriptPayload(config.content, {
      vpsId: params.vpsId,
      hostname: params.hostname,
      ipv4: params.ipv4,
    });

    console.log(
      `[STARTUP-SCRIPT] Dispatching first-install startup script to VMID ${params.vmid} (${params.hostname})...`
    );

    try {
      const result = await ProxmoxService.execLxcScript(
        params.node,
        params.vmid,
        preparedScript,
        params.runtimeNode
      );

      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES ('system', 'startup_script_executed', ?)`,
        [
          JSON.stringify({
            vpsId: params.vpsId,
            vmid: params.vmid,
            hostname: params.hostname,
            success: result.ok,
            error: result.error || null,
          }),
        ]
      );

      return {
        executed: true,
        success: result.ok,
        error: result.error,
      };
    } catch (err: any) {
      console.warn(
        `[STARTUP-SCRIPT] Non-fatal error during startup script execution on VMID ${params.vmid}:`,
        err?.message || err
      );

      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES ('system', 'startup_script_failed', ?)`,
        [
          JSON.stringify({
            vpsId: params.vpsId,
            vmid: params.vmid,
            hostname: params.hostname,
            error: err?.message || String(err),
          }),
        ]
      );

      return {
        executed: true,
        success: false,
        error: err?.message || String(err),
      };
    }
  }
}
