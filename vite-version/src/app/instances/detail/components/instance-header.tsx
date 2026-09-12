import * as React from "react"
import { Link } from "react-router-dom"
import {
  ChevronLeft,
  RefreshCw,
  Copy,
  Check,
  AlertTriangle,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PowerActions } from "./power-actions"
import type { VpsRecord } from "@/types/vps"
import type { VpsRuntimeInfo } from "@/hooks/use-vps-runtime"
import type { VpsOperationItem } from "@/hooks/use-vps-operations"

interface InstanceHeaderProps {
  vps: VpsRecord
  runtime: VpsRuntimeInfo
  runtimeSyncError: string | null
  activeOp: VpsOperationItem | null
  isRefreshing: boolean
  onRefreshAll: () => Promise<void>
  onRetrySync: () => Promise<void>
  onRefreshOp: () => Promise<void>
  onActionComplete: () => void
}

export function InstanceHeader({
  vps,
  runtime,
  runtimeSyncError,
  activeOp,
  isRefreshing,
  onRefreshAll,
  onRetrySync,
  onRefreshOp,
  onActionComplete,
}: InstanceHeaderProps) {
  const [copiedField, setCopiedField] = React.useState<string | null>(null)

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(label)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const isBusy = !!vps.lock_state
  const currentStatus = runtime.status || vps.status || "unknown"
  const isRunning = currentStatus === "running"
  const isStopped = currentStatus === "stopped"

  return (
    <div className="space-y-4">
      {/* Top Bar Navigation */}
      <div className="flex items-center justify-between">
        <Link
          to="/instances"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-4" /> Back to Instances
        </Link>

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 text-xs"
          onClick={onRefreshAll}
          disabled={isRefreshing}
        >
          <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          <span>Refresh Status</span>
        </Button>
      </div>

      {/* Active Operation Recovery Banner */}
      {activeOp && (
        <div className="p-3 rounded-md bg-blue-500/10 border border-blue-500/25 flex items-center justify-between gap-3 text-xs text-blue-600 dark:text-blue-400">
          <div className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin shrink-0 text-blue-500" />
            <span>
              <strong>Operation in progress:</strong>{" "}
              <span className="font-mono uppercase">{activeOp.operation_type}</span>{" "}
              (Step: <span className="font-mono">{activeOp.current_step}</span>).
              Processing on hypervisor...
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 shrink-0"
            onClick={onRefreshOp}
          >
            <RefreshCw className="size-3 mr-1" /> Refresh Op
          </Button>
        </div>
      )}

      {/* Stale Telemetry / Runtime Sync Warning */}
      {(!runtime.fresh || runtimeSyncError) && (
        <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-600 dark:text-amber-400">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              Current hypervisor state could not be refreshed
              {runtime.error ? ` (${runtime.error})` : ""}.{" "}
              {runtime.lastVerifiedAt ? (
                <span className="text-muted-foreground font-mono">
                  Last verified: {new Date(runtime.lastVerifiedAt).toLocaleTimeString()}
                </span>
              ) : (
                <span className="text-muted-foreground">Displaying last known state.</span>
              )}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 shrink-0 self-start sm:self-auto"
            onClick={onRetrySync}
          >
            <RefreshCw className="size-3 mr-1.5" /> Retry Sync
          </Button>
        </div>
      )}

      {/* Main Header Card */}
      <div className="p-6 rounded-lg border border-border bg-card shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {vps.name || vps.hostname}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-xs text-muted-foreground">{vps.hostname}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                onClick={() => copyToClipboard(vps.hostname, "Hostname")}
              >
                {copiedField === "Hostname" ? (
                  <Check className="size-3 text-emerald-500" />
                ) : (
                  <Copy className="size-3" />
                )}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={isRunning ? "default" : isStopped ? "secondary" : "outline"}
              className={`gap-1.5 capitalize text-xs ${
                isRunning
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : isStopped
                  ? "bg-zinc-500/10 text-zinc-500 border-zinc-500/20"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
              }`}
            >
              <span
                className={`size-2 rounded-full ${
                  isRunning
                    ? "bg-emerald-500 animate-pulse"
                    : isStopped
                    ? "bg-zinc-400"
                    : "bg-amber-500 animate-pulse"
                }`}
              />
              {isBusy ? `Busy (${vps.lock_state})` : currentStatus}
            </Badge>

            {!runtime.fresh && (
              <Badge
                variant="outline"
                className="text-[11px] gap-1 text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10"
              >
                <AlertTriangle className="size-3" />
                <span>Stale Telemetry</span>
              </Badge>
            )}

            <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
              CT {vps.proxmox_vmid}
            </Badge>

            <Badge variant="secondary" className="gap-1 text-xs">
              {vps.node_flag_url && (
                <img
                  src={vps.node_flag_url}
                  alt=""
                  className="w-3.5 h-2 object-cover rounded-[1px] shrink-0"
                />
              )}
              <span>{vps.node_name || "Proxmox Node"} · {vps.node_region || "default"}</span>
              {runtime.runtimeNode && runtime.runtimeNode !== vps.node_name && (
                <span className="text-primary font-mono text-[10px] ml-1">
                  (Target: {runtime.runtimeNode})
                </span>
              )}
            </Badge>
          </div>
        </div>

        {/* Dynamic Power Controls */}
        <PowerActions
          vps={vps}
          currentStatus={currentStatus}
          isBusy={isBusy}
          isRunning={isRunning}
          isStopped={isStopped}
          onActionComplete={onActionComplete}
        />
      </div>
    </div>
  )
}
