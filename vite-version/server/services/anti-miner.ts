/**
 * InterDash Server — Anti-Miner Canonical Service
 *
 * Implements a multi-vector detection and mitigation engine against cryptocurrency
 * mining abuse across hosted LXC virtual servers.
 *
 * Vectors:
 *   1. Process Signatures: Detection of known mining binaries (xmrig, cpuminer, etc.) & pool args
 *   2. Network Sockets: Detection of connections to known mining ports (3333, 4444, etc.)
 *   3. Sustained High CPU Anomaly: Multi-check telemetry tracking via Proxmox /status/current
 *
 * Policies:
 *   - 'alert': Record incident in database and audit logs without interfering.
 *   - 'kill_process': Terminate the offending mining PID inside the LXC container.
 *   - 'suspend_vps': Forcibly stop the container, apply 'mining_suspended' lock, and prohibit power-on until resolved.
 */

import { v4 as uuidv4 } from "uuid";
import { queryAll, queryOne, execute, transaction } from "../db/index.js";
import { ProxmoxService, type ProxmoxNodeConfig } from "./proxmox.js";
import { VpsRuntimeResolver } from "./runtime-resolver.js";

export type AntiMinerPolicy = "alert" | "kill_process" | "suspend_vps";

export interface AntiMinerConfig {
  enabled: boolean;
  policy: AntiMinerPolicy;
  cpuThreshold: number; // 50 - 100 (%)
  sustainedChecks: number; // 1 - 10 consecutive checks
  scanIntervalSec: number; // 15 - 3600 seconds
  processSignatures: string[];
  networkPorts: number[];
  whitelistVpsIds: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface AntiMinerIncident {
  id: string;
  vpsId: string;
  ownerUserId: string;
  hostname: string;
  triggerType: "process_signature" | "network_mining" | "sustained_high_cpu";
  matchedTarget: string;
  pid: number | null;
  cmdline: string | null;
  actionTaken: "alerted" | "process_killed" | "vps_suspended";
  status: "detected" | "mitigated" | "resolved";
  detailsJson: string | null;
  detectedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  // Joined fields
  vpsName?: string;
  ownerUsername?: string;
  resolvedByUsername?: string;
}

export interface ProcessFinding {
  pid: number;
  user: string;
  cpu: number;
  comm: string;
  cmdline: string;
  matchedSignature: string;
}

export interface NetworkFinding {
  port: number;
  proto: string;
  remote: string;
  matchedTarget: string;
}

export interface ScanResult {
  vpsId: string;
  hostname: string;
  scanned: boolean;
  cpuPercent?: number;
  consecutiveHighCpuChecks?: number;
  processFindings: ProcessFinding[];
  networkFindings: NetworkFinding[];
  incidentsTriggered: number;
  actionsTaken: string[];
  skippedReason?: string;
}

export const DEFAULT_PROCESS_SIGNATURES = [
  "xmrig",
  "minerd",
  "cpuminer",
  "xmr-stak",
  "cryptonight",
  "stratum",
  "ethminer",
  "nbminer",
  "ccminer",
  "nicehash",
  "kinsing",
  "kdevtmpfsi",
  "nanominer",
  "teamredminer",
  "t-rex",
  "gminer",
  "srbminer",
  "randomx",
  "rx/0",
  "donate-level",
  "moneroocean",
  "supportxmr",
  "hashvault",
];

export const DEFAULT_NETWORK_PORTS = [
  3333, 4444, 5555, 7777, 8888, 9999, 14444, 14433, 45560, 45700, 18080, 18081,
];

export class AntiMinerService {
  /**
   * In-memory tracking of consecutive high CPU observations per VPS ID.
   */
  private static highCpuCounter = new Map<string, number>();

  /**
   * Incident deduplication cooldown: prevents spamming incidents for the same
   * trigger on the same VPS within 10 minutes.
   */
  private static incidentCooldown = new Map<string, number>();
  private static readonly COOLDOWN_MS = 10 * 60 * 1000;

  /**
   * Retrieve current anti-miner configuration with fallback defaults.
   */
  public static getConfig(): AntiMinerConfig {
    const rows = queryAll<{ key: string; value: string; updated_at?: string }>(
      `SELECT key, value, updated_at FROM panel_settings WHERE key LIKE 'anti_miner_%'`
    );

    const map = new Map<string, { value: string; updatedAt?: string }>();
    for (const r of rows) {
      map.set(r.key, { value: r.value, updatedAt: r.updated_at });
    }

    const enabled = map.get("anti_miner_enabled")?.value === "true";
    const rawPolicy = map.get("anti_miner_policy")?.value;
    const policy: AntiMinerPolicy =
      rawPolicy === "kill_process" || rawPolicy === "suspend_vps" ? rawPolicy : "alert";

    const rawCpu = parseInt(map.get("anti_miner_cpu_threshold")?.value || "90", 10);
    const cpuThreshold = Number.isFinite(rawCpu) ? Math.min(100, Math.max(50, rawCpu)) : 90;

    const rawChecks = parseInt(map.get("anti_miner_sustained_checks")?.value || "3", 10);
    const sustainedChecks = Number.isFinite(rawChecks) ? Math.min(10, Math.max(1, rawChecks)) : 3;

    const rawInterval = parseInt(map.get("anti_miner_scan_interval_sec")?.value || "60", 10);
    const scanIntervalSec = Number.isFinite(rawInterval)
      ? Math.min(3600, Math.max(15, rawInterval))
      : 60;

    let processSignatures = DEFAULT_PROCESS_SIGNATURES;
    try {
      const parsed = JSON.parse(map.get("anti_miner_process_signatures")?.value || "[]");
      if (Array.isArray(parsed) && parsed.length > 0) {
        processSignatures = parsed.map(String).map((s) => s.toLowerCase().trim()).filter(Boolean);
      }
    } catch {
      // fallback to defaults
    }

    let networkPorts = DEFAULT_NETWORK_PORTS;
    try {
      const parsed = JSON.parse(map.get("anti_miner_network_ports")?.value || "[]");
      if (Array.isArray(parsed) && parsed.length > 0) {
        networkPorts = parsed
          .map(Number)
          .filter((p) => Number.isFinite(p) && p > 0 && p <= 65535);
      }
    } catch {
      // fallback to defaults
    }

    let whitelistVpsIds: string[] = [];
    try {
      const parsed = JSON.parse(map.get("anti_miner_whitelist_vps_ids")?.value || "[]");
      if (Array.isArray(parsed)) {
        whitelistVpsIds = parsed.map(String).filter(Boolean);
      }
    } catch {
      // fallback to empty
    }

    const updatedAt = map.get("anti_miner_enabled")?.updatedAt || null;
    const updatedBy = map.get("anti_miner_updated_by")?.value || null;

    return {
      enabled,
      policy,
      cpuThreshold,
      sustainedChecks,
      scanIntervalSec,
      processSignatures,
      networkPorts,
      whitelistVpsIds,
      updatedAt,
      updatedBy,
    };
  }

  /**
   * Update anti-miner configuration and record an audit log event.
   */
  public static updateConfig(
    input: Partial<{
      enabled: boolean;
      policy: AntiMinerPolicy;
      cpuThreshold: number;
      sustainedChecks: number;
      scanIntervalSec: number;
      processSignatures: string[];
      networkPorts: number[];
      whitelistVpsIds: string[];
    }>,
    userId: string
  ): AntiMinerConfig {
    const current = this.getConfig();

    const newEnabled = input.enabled !== undefined ? Boolean(input.enabled) : current.enabled;

    let newPolicy: AntiMinerPolicy = current.policy;
    if (input.policy && ["alert", "kill_process", "suspend_vps"].includes(input.policy)) {
      newPolicy = input.policy;
    }

    let newCpu = current.cpuThreshold;
    if (typeof input.cpuThreshold === "number" && !isNaN(input.cpuThreshold)) {
      newCpu = Math.min(100, Math.max(50, Math.round(input.cpuThreshold)));
    }

    let newChecks = current.sustainedChecks;
    if (typeof input.sustainedChecks === "number" && !isNaN(input.sustainedChecks)) {
      newChecks = Math.min(10, Math.max(1, Math.round(input.sustainedChecks)));
    }

    let newInterval = current.scanIntervalSec;
    if (typeof input.scanIntervalSec === "number" && !isNaN(input.scanIntervalSec)) {
      newInterval = Math.min(3600, Math.max(15, Math.round(input.scanIntervalSec)));
    }

    let newSignatures = current.processSignatures;
    if (Array.isArray(input.processSignatures)) {
      newSignatures = Array.from(
        new Set(
          input.processSignatures
            .map(String)
            .map((s) => s.toLowerCase().trim())
            .filter((s) => s.length > 0 && s.length <= 64)
        )
      );
    }

    let newPorts = current.networkPorts;
    if (Array.isArray(input.networkPorts)) {
      newPorts = Array.from(
        new Set(
          input.networkPorts
            .map(Number)
            .filter((p) => Number.isFinite(p) && p > 0 && p <= 65535)
        )
      );
    }

    let newWhitelist = current.whitelistVpsIds;
    if (Array.isArray(input.whitelistVpsIds)) {
      newWhitelist = Array.from(new Set(input.whitelistVpsIds.map(String).filter(Boolean)));
    }

    const now = new Date().toISOString();

    const settingsToSave: [string, string][] = [
      ["anti_miner_enabled", newEnabled ? "true" : "false"],
      ["anti_miner_policy", newPolicy],
      ["anti_miner_cpu_threshold", String(newCpu)],
      ["anti_miner_sustained_checks", String(newChecks)],
      ["anti_miner_scan_interval_sec", String(newInterval)],
      ["anti_miner_process_signatures", JSON.stringify(newSignatures)],
      ["anti_miner_network_ports", JSON.stringify(newPorts)],
      ["anti_miner_whitelist_vps_ids", JSON.stringify(newWhitelist)],
      ["anti_miner_updated_by", userId],
    ];

    for (const [k, v] of settingsToSave) {
      execute(
        `INSERT INTO panel_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [k, v, now]
      );
    }

    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata)
       VALUES (?, 'anti_miner_config_updated', ?)`,
      [
        userId,
        JSON.stringify({
          enabled: newEnabled,
          policy: newPolicy,
          cpuThreshold: newCpu,
          sustainedChecks: newChecks,
          scanIntervalSec: newInterval,
          signaturesCount: newSignatures.length,
          portsCount: newPorts.length,
          whitelistCount: newWhitelist.length,
        }),
      ]
    );

    return {
      enabled: newEnabled,
      policy: newPolicy,
      cpuThreshold: newCpu,
      sustainedChecks: newChecks,
      scanIntervalSec: newInterval,
      processSignatures: newSignatures,
      networkPorts: newPorts,
      whitelistVpsIds: newWhitelist,
      updatedAt: now,
      updatedBy: userId,
    };
  }

  /**
   * Parse `ps -eo pid,user,%cpu,%mem,comm,args` output and detect matching signatures.
   */
  public static parseProcessInspectionOutput(
    output: string,
    signatures: string[]
  ): ProcessFinding[] {
    if (!output || typeof output !== "string") return [];

    const findings: ProcessFinding[] = [];
    const lines = output.split(/\r?\n/);

    const cleanSignatures = signatures.map((s) => s.toLowerCase().trim()).filter(Boolean);
    if (cleanSignatures.length === 0) return [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("PID") || line.startsWith("COMMAND")) continue;

      // Format: <PID> <USER> <%CPU> <%MEM> <COMM> <ARGS...>
      const parts = line.split(/\s+/);
      if (parts.length < 5) continue;

      const pid = parseInt(parts[0], 10);
      if (isNaN(pid) || pid <= 0) continue;

      const user = parts[1];
      const cpu = parseFloat(parts[2]) || 0;
      const comm = parts[4] || "";
      const args = parts.slice(4).join(" ");
      const searchTarget = (comm + " " + args).toLowerCase();

      for (const sig of cleanSignatures) {
        if (searchTarget.includes(sig)) {
          findings.push({
            pid,
            user,
            cpu,
            comm,
            cmdline: args.slice(0, 500),
            matchedSignature: sig,
          });
          break; // Avoid duplicate finding for the same line
        }
      }
    }

    return findings;
  }

  /**
   * Parse `ss -tupn` or `netstat -tupn` output and detect connections to known mining ports.
   */
  public static parseNetworkInspectionOutput(
    output: string,
    targetPorts: number[]
  ): NetworkFinding[] {
    if (!output || typeof output !== "string") return [];

    const findings: NetworkFinding[] = [];
    const lines = output.split(/\r?\n/);
    const portSet = new Set(targetPorts);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("Netid") || line.startsWith("Active") || line.startsWith("Proto")) continue;

      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;

      const proto = parts[0];
      const addresses = [parts[3], parts[4], parts[5]].filter(Boolean);

      let portMatched = false;
      for (const addr of addresses) {
        const lastColon = addr.lastIndexOf(":");
        if (lastColon !== -1) {
          const portStr = addr.slice(lastColon + 1);
          const port = parseInt(portStr, 10);
          if (portSet.has(port)) {
            findings.push({
              port,
              proto,
              remote: addr,
              matchedTarget: `mining_port_${port}`,
            });
            portMatched = true;
            break;
          }
        }
      }

      // Also check for literal string "stratum" in socket line
      if (!portMatched && line.toLowerCase().includes("stratum")) {
        findings.push({
          port: 0,
          proto,
          remote: parts[5] || parts[4] || "",
          matchedTarget: "stratum_protocol",
        });
      }
    }

    return findings;
  }

  /**
   * Scan a single VPS instance using multi-vector analysis.
   */
  public static async scanVps(
    vpsId: string,
    options?: { force?: boolean }
  ): Promise<ScanResult> {
    const config = this.getConfig();

    const vps = queryOne<any>(
      `SELECT v.*, n.name as node_name, n.hostname as node_hostname
       FROM vps v
       LEFT JOIN proxmox_nodes n ON v.proxmox_node_id = n.id
       WHERE v.id = ?`,
      [vpsId]
    );

    if (!vps) {
      return {
        vpsId,
        hostname: "unknown",
        scanned: false,
        processFindings: [],
        networkFindings: [],
        incidentsTriggered: 0,
        actionsTaken: [],
        skippedReason: "vps_not_found",
      };
    }

    if (!options?.force && config.whitelistVpsIds.includes(vps.id)) {
      return {
        vpsId,
        hostname: vps.hostname,
        scanned: false,
        processFindings: [],
        networkFindings: [],
        incidentsTriggered: 0,
        actionsTaken: [],
        skippedReason: "whitelisted",
      };
    }

    if (vps.status !== "running") {
      this.highCpuCounter.delete(vpsId);
      return {
        vpsId,
        hostname: vps.hostname,
        scanned: false,
        processFindings: [],
        networkFindings: [],
        incidentsTriggered: 0,
        actionsTaken: [],
        skippedReason: `status_${vps.status}`,
      };
    }

    // Resolve target Proxmox node
    let target;
    try {
      target = await VpsRuntimeResolver.resolve(vpsId);
    } catch (err: any) {
      return {
        vpsId,
        hostname: vps.hostname,
        scanned: false,
        processFindings: [],
        networkFindings: [],
        incidentsTriggered: 0,
        actionsTaken: [],
        skippedReason: `runtime_resolution_failed: ${err.message}`,
      };
    }

    const { node, runtimeNode } = target;

    // 1. Vector C: Live Proxmox Telemetry CPU utilization
    let cpuPercent = 0;
    try {
      const pveStatus = await ProxmoxService.getLxcStatus(node, vps.proxmox_vmid, runtimeNode);
      if (pveStatus.ok && pveStatus.status === "running") {
        const rawCpu = pveStatus.cpu !== undefined ? pveStatus.cpu : 0;
        const cores = pveStatus.cpus && pveStatus.cpus > 0 ? pveStatus.cpus : 1;
        // In Proxmox, cpu is a float. If normalized to cores or fraction:
        cpuPercent = Math.min(100, Math.round((rawCpu / cores) * 100));
        if (cpuPercent === 0 && rawCpu > 0) {
          cpuPercent = Math.min(100, Math.round(rawCpu * 100));
        }
      }
    } catch {
      // non-fatal telemetry query failure
    }

    // Update consecutive high-CPU tracking
    let consecutiveChecks = this.highCpuCounter.get(vpsId) || 0;
    if (cpuPercent >= config.cpuThreshold) {
      consecutiveChecks += 1;
      this.highCpuCounter.set(vpsId, consecutiveChecks);
    } else {
      consecutiveChecks = 0;
      this.highCpuCounter.delete(vpsId);
    }

    // 2. Vector A & B: Inside container process and socket inspection
    let processFindings: ProcessFinding[] = [];
    let networkFindings: NetworkFinding[] = [];

    // Form inspection script to execute inside LXC
    const inspectScript = `#!/bin/sh
# InterDash Non-Destructive Anti-Miner Inspection
ps -eo pid,user,%cpu,%mem,comm,args 2>/dev/null | head -n 80
echo "---NET---"
ss -tupn 2>/dev/null || netstat -tupn 2>/dev/null || true
`;

    try {
      const execRes = await ProxmoxService.execLxcScript(
        node,
        vps.proxmox_vmid,
        inspectScript,
        runtimeNode
      );
      if (execRes.ok && execRes.output) {
        const splitParts = execRes.output.split("---NET---");
        const psOut = splitParts[0] || "";
        const netOut = splitParts[1] || "";

        processFindings = this.parseProcessInspectionOutput(psOut, config.processSignatures);
        networkFindings = this.parseNetworkInspectionOutput(netOut, config.networkPorts);
      }
    } catch {
      // Non-fatal if container cannot execute inspection
    }

    let incidentsTriggered = 0;
    const actionsTaken: string[] = [];

    // Trigger 1: Process Signatures
    for (const pf of processFindings) {
      const incidentResult = await this.handleDetectionIncident({
        vps,
        node,
        runtimeNode,
        policy: config.policy,
        triggerType: "process_signature",
        matchedTarget: pf.matchedSignature,
        pid: pf.pid,
        cmdline: pf.cmdline,
        details: {
          cpu: pf.cpu,
          user: pf.user,
          comm: pf.comm,
        },
      });

      if (incidentResult.recorded) {
        incidentsTriggered++;
        actionsTaken.push(incidentResult.actionTaken);
      }

      // If policy was suspend_vps, container is now stopped; stop further checks
      if (config.policy === "suspend_vps" && incidentResult.actionTaken === "vps_suspended") {
        break;
      }
    }

    // Trigger 2: Network Mining (if VPS not already suspended)
    if (vps.lock_state !== "mining_suspended") {
      for (const nf of networkFindings) {
        const incidentResult = await this.handleDetectionIncident({
          vps,
          node,
          runtimeNode,
          policy: config.policy,
          triggerType: "network_mining",
          matchedTarget: nf.matchedTarget,
          pid: null,
          cmdline: null,
          details: {
            port: nf.port,
            proto: nf.proto,
            remote: nf.remote,
          },
        });

        if (incidentResult.recorded) {
          incidentsTriggered++;
          actionsTaken.push(incidentResult.actionTaken);
        }

        if (config.policy === "suspend_vps" && incidentResult.actionTaken === "vps_suspended") {
          break;
        }
      }
    }

    // Trigger 3: Sustained High CPU Anomaly (if sustained >= threshold and not already suspended)
    if (
      vps.lock_state !== "mining_suspended" &&
      consecutiveChecks >= config.sustainedChecks &&
      processFindings.length === 0 // only flag as standalone anomaly if not already flagged by signature
    ) {
      const incidentResult = await this.handleDetectionIncident({
        vps,
        node,
        runtimeNode,
        policy: config.policy,
        triggerType: "sustained_high_cpu",
        matchedTarget: `CPU ${cpuPercent}% (${consecutiveChecks} consecutive checks)`,
        pid: null,
        cmdline: null,
        details: {
          cpuPercent,
          consecutiveChecks,
          threshold: config.cpuThreshold,
        },
      });

      if (incidentResult.recorded) {
        incidentsTriggered++;
        actionsTaken.push(incidentResult.actionTaken);
      }
    }

    return {
      vpsId,
      hostname: vps.hostname,
      scanned: true,
      cpuPercent,
      consecutiveHighCpuChecks: consecutiveChecks,
      processFindings,
      networkFindings,
      incidentsTriggered,
      actionsTaken,
    };
  }

  /**
   * Internal handler to record incident and apply configured policy action.
   */
  public static async handleDetectionIncident(params: {
    vps: any;
    node: ProxmoxNodeConfig;
    runtimeNode?: string;
    policy: AntiMinerPolicy;
    triggerType: "process_signature" | "network_mining" | "sustained_high_cpu";
    matchedTarget: string;
    pid: number | null;
    cmdline: string | null;
    details: Record<string, unknown>;
  }): Promise<{ recorded: boolean; actionTaken: string }> {
    const { vps, node, runtimeNode, policy, triggerType, matchedTarget, pid, cmdline, details } =
      params;

    // Deduplication check: key = vpsId:triggerType:matchedTarget
    const cooldownKey = `${vps.id}:${triggerType}:${matchedTarget}`;
    const lastTriggered = this.incidentCooldown.get(cooldownKey);
    const now = Date.now();

    if (lastTriggered && now - lastTriggered < this.COOLDOWN_MS) {
      return { recorded: false, actionTaken: "cooldown_skipped" };
    }

    this.incidentCooldown.set(cooldownKey, now);

    let actionTaken: "alerted" | "process_killed" | "vps_suspended" = "alerted";
    let incidentStatus: "detected" | "mitigated" = "detected";

    if (policy === "kill_process" && pid && pid > 1) {
      try {
        console.warn(
          `[ANTI-MINER] Terminating offending mining process PID ${pid} inside VMID ${vps.proxmox_vmid}...`
        );
        await ProxmoxService.execLxcCommand(
          node,
          vps.proxmox_vmid,
          ["/bin/kill", "-9", String(pid)],
          runtimeNode
        );
        actionTaken = "process_killed";
        incidentStatus = "mitigated";
      } catch (err) {
        console.error(`[ANTI-MINER] Failed to kill PID ${pid}:`, err);
        actionTaken = "alerted";
      }
    } else if (policy === "suspend_vps") {
      try {
        console.warn(
          `[ANTI-MINER] Suspending VPS ${vps.id} (${vps.hostname}) due to cryptomining activity...`
        );
        await ProxmoxService.stopLxc(node, vps.proxmox_vmid, runtimeNode);
        actionTaken = "vps_suspended";

        // Mark VPS lock_state as mining_suspended and status as stopped
        execute(
          `UPDATE vps SET status = 'stopped', lock_state = 'mining_suspended', updated_at = datetime('now') WHERE id = ?`,
          [vps.id]
        );
      } catch (err) {
        console.error(`[ANTI-MINER] Failed to suspend LXC ${vps.proxmox_vmid}:`, err);
        actionTaken = "alerted";
      }
    }

    const incidentId = uuidv4();
    const detectedAt = new Date().toISOString();

    execute(
      `INSERT INTO anti_miner_incidents (
        id, vps_id, owner_user_id, hostname, trigger_type, matched_target,
        pid, cmdline, action_taken, status, details_json, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        incidentId,
        vps.id,
        vps.owner_user_id,
        vps.hostname,
        triggerType,
        matchedTarget,
        pid,
        cmdline,
        actionTaken,
        incidentStatus,
        JSON.stringify(details),
        detectedAt,
      ]
    );

    execute(
      `INSERT INTO audit_logs (user_id, event_type, metadata)
       VALUES ('system', 'anti_miner_incident_detected', ?)`,
      [
        JSON.stringify({
          incidentId,
          vpsId: vps.id,
          hostname: vps.hostname,
          ownerUserId: vps.owner_user_id,
          triggerType,
          matchedTarget,
          actionTaken,
          pid,
        }),
      ]
    );

    return { recorded: true, actionTaken };
  }

  /**
   * Run background scan on all running instances.
   */
  public static async runScheduledScan(): Promise<{
    skipped: boolean;
    reason?: string;
    totalRunning: number;
    scannedCount: number;
    incidentsTriggered: number;
  }> {
    const config = this.getConfig();
    if (!config.enabled) {
      return {
        skipped: true,
        reason: "anti_miner_disabled",
        totalRunning: 0,
        scannedCount: 0,
        incidentsTriggered: 0,
      };
    }

    const runningInstances = queryAll<{ id: string }>(
      "SELECT id FROM vps WHERE status = 'running'"
    );

    let scannedCount = 0;
    let incidentsTriggered = 0;

    for (const inst of runningInstances) {
      try {
        const res = await this.scanVps(inst.id);
        if (res.scanned) {
          scannedCount++;
          incidentsTriggered += res.incidentsTriggered;
        }
      } catch (err: any) {
        console.warn(`[ANTI-MINER] Error scanning VPS ${inst.id}:`, err?.message || err);
      }
    }

    return {
      skipped: false,
      totalRunning: runningInstances.length,
      scannedCount,
      incidentsTriggered,
    };
  }

  /**
   * List detected incidents with pagination and filtering.
   */
  public static listIncidents(options?: {
    status?: "all" | "detected" | "mitigated" | "resolved";
    vpsId?: string;
    limit?: number;
    offset?: number;
  }): { incidents: AntiMinerIncident[]; total: number } {
    const statusFilter = options?.status && options.status !== "all" ? options.status : null;
    const vpsIdFilter = options?.vpsId || null;
    const limit = Math.min(100, Math.max(1, options?.limit || 50));
    const offset = Math.max(0, options?.offset || 0);

    const conditions: string[] = [];
    const params: any[] = [];

    if (statusFilter) {
      conditions.push("i.status = ?");
      params.push(statusFilter);
    }

    if (vpsIdFilter) {
      conditions.push("i.vps_id = ?");
      params.push(vpsIdFilter);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRow = queryOne<any>(
      `SELECT COUNT(*) as total FROM anti_miner_incidents i ${whereClause}`,
      params
    );
    const total = countRow?.total || 0;

    const query = `
      SELECT 
        i.id, i.vps_id, i.owner_user_id, i.hostname, i.trigger_type,
        i.matched_target, i.pid, i.cmdline, i.action_taken, i.status,
        i.details_json, i.detected_at, i.resolved_at, i.resolved_by,
        v.name as vps_name,
        u.username as owner_username,
        admin.username as resolved_by_username
      FROM anti_miner_incidents i
      LEFT JOIN vps v ON i.vps_id = v.id
      LEFT JOIN users u ON i.owner_user_id = u.id
      LEFT JOIN users admin ON i.resolved_by = admin.id
      ${whereClause}
      ORDER BY i.detected_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = queryAll<any>(query, [...params, limit, offset]);

    const incidents: AntiMinerIncident[] = rows.map((r) => ({
      id: r.id,
      vpsId: r.vps_id,
      ownerUserId: r.owner_user_id,
      hostname: r.hostname,
      triggerType: r.trigger_type,
      matchedTarget: r.matched_target,
      pid: r.pid,
      cmdline: r.cmdline,
      actionTaken: r.action_taken,
      status: r.status,
      detailsJson: r.details_json,
      detectedAt: r.detected_at,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
      vpsName: r.vps_name || undefined,
      ownerUsername: r.owner_username || undefined,
      resolvedByUsername: r.resolved_by_username || undefined,
    }));

    return { incidents, total };
  }

  /**
   * Resolve an incident, clear VPS suspension lock, and record audit log.
   */
  public static resolveIncident(
    incidentId: string,
    adminUserId: string,
    _notes?: string
  ): { success: boolean; incidentId: string; vpsUnlocked: boolean } {
    return transaction(() => {
      const incident = queryOne<any>("SELECT * FROM anti_miner_incidents WHERE id = ?", [
        incidentId,
      ]);

      if (!incident) {
        const err = new Error("Anti-miner incident not found.");
        (err as any).statusCode = 404;
        throw err;
      }

      const now = new Date().toISOString();

      execute(
        `UPDATE anti_miner_incidents
         SET status = 'resolved', resolved_at = ?, resolved_by = ?
         WHERE id = ?`,
        [now, adminUserId, incidentId]
      );

      // Check if VPS is currently suspended with 'mining_suspended'
      const vps = queryOne<any>("SELECT id, lock_state FROM vps WHERE id = ?", [incident.vps_id]);

      let vpsUnlocked = false;
      if (vps && vps.lock_state === "mining_suspended") {
        execute(
          `UPDATE vps SET lock_state = NULL, updated_at = datetime('now') WHERE id = ?`,
          [vps.id]
        );
        vpsUnlocked = true;
      }

      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata)
         VALUES (?, 'anti_miner_incident_resolved', ?)`,
        [
          adminUserId,
          JSON.stringify({
            incidentId,
            vpsId: incident.vps_id,
            vpsUnlocked,
            resolvedAt: now,
          }),
        ]
      );

      return { success: true, incidentId, vpsUnlocked };
    });
  }
}
