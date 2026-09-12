import * as React from "react"
import { Link } from "react-router-dom"
import {
  ChevronLeft,
  RefreshCw,
  Copy,
  Check,
  AlertTriangle,
  Loader2,
  Clock,
  Calendar,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { useAuth } from "@/contexts/auth-context"
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
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const [copiedField, setCopiedField] = React.useState<string | null>(null)
  const [extendOpen, setExtendOpen] = React.useState(false)
  const [extendPreset, setExtendPreset] = React.useState<"never" | "7d" | "30d" | "90d" | "custom">("30d")
  const [customDate, setCustomDate] = React.useState("")
  const [isUpdatingExpiry, setIsUpdatingExpiry] = React.useState(false)

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(label)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const isBusy = !!vps.lock_state
  const currentStatus = runtime.status || vps.status || "unknown"
  const isRunning = currentStatus === "running"
  const isStopped = currentStatus === "stopped"

  // Expiry calculation
  const isExpired = vps.expires_at ? new Date(vps.expires_at).getTime() <= Date.now() : false
  const isExpiringSoon = vps.expires_at ? (() => {
    const diff = new Date(vps.expires_at).getTime() - Date.now()
    return diff > 0 && diff <= 72 * 3600 * 1000
  })() : false

  const handleUpdateExpiry = async () => {
    setIsUpdatingExpiry(true)
    try {
      let targetExpiresAt: string | null = null

      if (extendPreset === "never") {
        targetExpiresAt = null
      } else if (extendPreset === "7d") {
        targetExpiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
      } else if (extendPreset === "30d") {
        targetExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
      } else if (extendPreset === "90d") {
        targetExpiresAt = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString()
      } else if (extendPreset === "custom") {
        if (!customDate) {
          toast.error("Please enter a valid date and time.")
          setIsUpdatingExpiry(false)
          return
        }
        targetExpiresAt = new Date(customDate).toISOString()
      }

      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch(`/api/admin/vps/${vps.id}/expiry`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({ expires_at: targetExpiresAt }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update VPS expiry.")

      toast.success("VPS expiry updated successfully!")
      setExtendOpen(false)
      await onRefreshAll()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error updating expiry")
    } finally {
      setIsUpdatingExpiry(false)
    }
  }

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

        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => setExtendOpen(true)}
            >
              <Clock className="size-3.5 text-primary" />
              <span>Extend Expiry</span>
            </Button>
          )}

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
      </div>

      {/* Expired VPS Banner */}
      {isExpired && (
        <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-destructive">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              <strong>VPS Expired:</strong> This instance reached its expiry deadline ({new Date(vps.expires_at!).toLocaleString()}). Start, reboot, reinstall, and web console actions are suspended.
            </span>
          </div>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10 shrink-0 self-start sm:self-auto"
              onClick={() => setExtendOpen(true)}
            >
              <Clock className="size-3 mr-1" /> Extend Expiry
            </Button>
          )}
        </div>
      )}

      {/* Expiring Soon Banner */}
      {!isExpired && isExpiringSoon && (
        <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-600 dark:text-amber-400">
          <div className="flex items-center gap-2">
            <Clock className="size-4 shrink-0 text-amber-500" />
            <span>
              <strong>Expiring Soon:</strong> This instance will expire on {new Date(vps.expires_at!).toLocaleString()}.
            </span>
          </div>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 shrink-0 self-start sm:self-auto"
              onClick={() => setExtendOpen(true)}
            >
              <Clock className="size-3 mr-1" /> Extend Expiry
            </Button>
          )}
        </div>
      )}

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

            {/* Expiry Badge */}
            <Badge
              variant={isExpired ? "destructive" : isExpiringSoon ? "outline" : "secondary"}
              className={`gap-1 text-xs ${
                isExpired
                  ? "bg-destructive/15 text-destructive border-destructive/30"
                  : isExpiringSoon
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                  : ""
              }`}
            >
              <Clock className="size-3" />
              <span>
                {vps.expires_at
                  ? isExpired
                    ? `Expired (${new Date(vps.expires_at).toLocaleDateString()})`
                    : `Expires ${new Date(vps.expires_at).toLocaleDateString()}`
                  : "Never Expires"}
              </span>
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

      {/* Admin Extend Expiry Dialog */}
      {isAdmin && (
        <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Clock className="size-5 text-primary" /> Extend Instance Expiry
              </DialogTitle>
              <DialogDescription>
                Modify or remove the expiration deadline for <strong>{vps.hostname}</strong>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-3 text-sm">
              <div className="rounded-lg border p-3 bg-muted/20 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Expiration:</span>
                  <span className="font-mono font-medium">
                    {vps.expires_at ? new Date(vps.expires_at).toLocaleString() : "Never (Indefinite)"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Status:</span>
                  <span className={isExpired ? "text-destructive font-medium" : "text-emerald-500 font-medium"}>
                    {isExpired ? "Expired" : "Active"}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>New Expiration Duration</Label>
                <Select
                  value={extendPreset}
                  onValueChange={(val) => setExtendPreset(val as typeof extendPreset)}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Select duration" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7d">Extend 7 Days from now</SelectItem>
                    <SelectItem value="30d">Extend 30 Days from now</SelectItem>
                    <SelectItem value="90d">Extend 90 Days from now</SelectItem>
                    <SelectItem value="never">Never (Remove Expiration)</SelectItem>
                    <SelectItem value="custom">Custom Date & Time</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {extendPreset === "custom" && (
                <div className="space-y-2">
                  <Label htmlFor="custom-expiry">Custom Expiry Date & Time</Label>
                  <div className="relative">
                    <Calendar className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="custom-expiry"
                      type="datetime-local"
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                      className="pl-9 text-xs h-9 font-mono"
                    />
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExtendOpen(false)}
                disabled={isUpdatingExpiry}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleUpdateExpiry}
                disabled={isUpdatingExpiry}
                className="gap-2"
              >
                {isUpdatingExpiry && <Loader2 className="size-3.5 animate-spin" />}
                Save Expiration
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
