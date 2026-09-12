import * as React from "react"
import {
  Server,
  Cpu,
  HardDrive,
  Activity,
  Network,
  Copy,
  Check,
  Clock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { VpsRecord } from "@/types/vps"
import type { VpsRuntimeInfo } from "@/hooks/use-vps-runtime"
import type { VpsOperationItem } from "@/hooks/use-vps-operations"

interface OverviewTabProps {
  vps: VpsRecord
  runtime: VpsRuntimeInfo
  operations: VpsOperationItem[]
  operationsSyncError: string | null
  isAdmin: boolean
  loadOperations: () => Promise<void>
}

export function OverviewTab({
  vps,
  runtime,
  operations,
  operationsSyncError,
  isAdmin,
  loadOperations,
}: OverviewTabProps) {
  const [copiedField, setCopiedField] = React.useState<string | null>(null)

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(label)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const formatUptime = (seconds?: number) => {
    if (!seconds) return "—"
    const d = Math.floor(seconds / (3600 * 24))
    const h = Math.floor((seconds % (3600 * 24)) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const parts = []
    if (d > 0) parts.push(`${d}d`)
    if (h > 0) parts.push(`${h}h`)
    parts.push(`${m}m`)
    return parts.join(" ")
  }

  const currentStatus = runtime.status || vps.status || "unknown"
  const isRunning = currentStatus === "running"
  const isStopped = currentStatus === "stopped"

  return (
    <div className="space-y-6">
      {/* Top Resource Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              <span>CPU Allocation</span>
              <Cpu className="size-4 text-primary" />
            </CardDescription>
            <CardTitle className="text-2xl font-mono">{vps.cpu_cores} vCPU</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-[11px] text-muted-foreground">
            Dedicated LXC execution limit
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              <span>Memory (RAM)</span>
              <Server className="size-4 text-primary" />
            </CardDescription>
            <CardTitle className="text-2xl font-mono">
              {vps.memory_mb >= 1024
                ? `${(vps.memory_mb / 1024).toFixed(0)} GB`
                : `${vps.memory_mb} MB`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-[11px] text-muted-foreground">
            Swap allocated: {vps.swap_mb} MB
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              <span>Storage Volume</span>
              <HardDrive className="size-4 text-primary" />
            </CardDescription>
            <CardTitle className="text-2xl font-mono">{vps.disk_gb} GB</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-[11px] text-muted-foreground">
            High-IOPS PCIe SSD rootfs volume
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              <span>Primary Network</span>
              <Network className="size-4 text-primary" />
            </CardDescription>
            <CardTitle className="text-base font-mono truncate">
              {vps.ipv4_address || "DHCP / Unassigned"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-[11px] text-muted-foreground">
            {vps.ipv6_address ? "IPv4 + IPv6 Dual Stack" : "IPv4 Interface configured"}
          </CardContent>
        </Card>
      </div>

      {/* Middle Row: System Details & Network Routing (2 columns) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* System & Infrastructure Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="size-4 text-primary" /> System & Infrastructure
            </CardTitle>
            <CardDescription className="text-xs">
              Underlying container specifications and node binding.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex items-center justify-between py-1.5 border-b">
              <span className="text-muted-foreground">Operating System</span>
              <span className="font-mono font-medium truncate max-w-[200px]" title={vps.os_image_id}>
                {vps.os_image_id.split("/").pop() || vps.os_image_id}
              </span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b">
              <span className="text-muted-foreground">Hostname</span>
              <span className="font-mono font-medium">{vps.hostname}</span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b">
              <span className="text-muted-foreground">Proxmox Node</span>
              <span className="font-medium flex items-center gap-1.5">
                {vps.node_flag_url && (
                  <img
                    src={vps.node_flag_url}
                    alt=""
                    className="w-3.5 h-2 object-cover rounded-[1px]"
                  />
                )}
                <span>{vps.node_name || "Proxmox Node"} ({vps.node_region || "default"})</span>
                {runtime.runtimeNode && runtime.runtimeNode !== vps.node_name && (
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/30 ml-1">
                    Runtime: {runtime.runtimeNode} ({runtime.runtimeNodeSource || "cluster"})
                  </Badge>
                )}
              </span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b">
              <span className="text-muted-foreground">Container VMID</span>
              <span className="font-mono font-medium">{vps.proxmox_vmid}</span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b">
              <span className="text-muted-foreground">Expiration</span>
              <span className="font-medium flex items-center gap-1.5">
                {vps.expires_at ? (
                  <>
                    <span className={`font-mono text-[11px] ${new Date(vps.expires_at).getTime() <= Date.now() ? "text-destructive font-semibold" : ""}`}>
                      {new Date(vps.expires_at).toLocaleString()}
                    </span>
                    {new Date(vps.expires_at).getTime() <= Date.now() && (
                      <Badge variant="destructive" className="text-[10px] py-0 px-1">Expired</Badge>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground text-[11px]">Never (Indefinite)</span>
                )}
              </span>
            </div>

            {isAdmin && (
              <div className="flex items-center justify-between py-1.5">
                <span className="text-muted-foreground">Assigned User</span>
                <span className="font-medium">
                  {vps.owner_global_name || vps.owner_username || "—"}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Network & Routing Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Network className="size-4 text-primary" /> Network & Routing
            </CardTitle>
            <CardDescription className="text-xs">
              Allocated interface binding and gateway details.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex items-center justify-between py-1.5 border-b">
              <span className="text-muted-foreground">IPv4 Address</span>
              <div className="flex items-center gap-2 font-mono font-medium">
                <span>{vps.ipv4_address || "DHCP / Unassigned"}</span>
                {vps.ipv4_address && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => copyToClipboard(vps.ipv4_address!, "IPv4")}
                  >
                    {copiedField === "IPv4" ? (
                      <Check className="size-3 text-emerald-500" />
                    ) : (
                      <Copy className="size-3 text-muted-foreground" />
                    )}
                  </Button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b">
              <span className="text-muted-foreground">IPv6 Address</span>
              <div className="flex items-center gap-2 font-mono font-medium">
                <span className="text-muted-foreground">
                  {vps.ipv6_address || "Not configured"}
                </span>
                {vps.ipv6_address && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => copyToClipboard(vps.ipv6_address!, "IPv6")}
                  >
                    {copiedField === "IPv6" ? (
                      <Check className="size-3 text-emerald-500" />
                    ) : (
                      <Copy className="size-3 text-muted-foreground" />
                    )}
                  </Button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b">
              <span className="text-muted-foreground">Gateway</span>
              <span className="font-mono font-medium">
                {vps.ipv4_address ? "10.0.0.1" : "Auto"}
              </span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b">
              <span className="text-muted-foreground">Bridge Adapter</span>
              <span className="font-mono font-medium">vmbr0</span>
            </div>

            <div className="flex items-center justify-between py-1.5">
              <span className="text-muted-foreground">Interface</span>
              <span className="font-mono font-medium">eth0 (virtio)</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row: Runtime Health & Recent Operations (2 columns) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Runtime & Health */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="size-4 text-primary" /> Runtime & Health
            </CardTitle>
            <CardDescription className="text-xs">
              Live hypervisor telemetry and synchronization state.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex items-center justify-between py-1.5 border-b">
              <span className="text-muted-foreground">Container State</span>
              <div className="flex items-center gap-1.5">
                <Badge
                  variant={isRunning ? "default" : isStopped ? "secondary" : "outline"}
                  className="text-[11px] capitalize"
                >
                  {currentStatus}
                </Badge>
                {!runtime.fresh && (
                  <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">
                    Stale
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b">
              <span className="text-muted-foreground">Uptime</span>
              <span className="font-mono font-medium">
                {formatUptime(runtime.uptime)}
              </span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b">
              <span className="text-muted-foreground">Hypervisor Status</span>
              {runtime.fresh ? (
                <span className="font-medium text-emerald-500 flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  Online & Verified
                </span>
              ) : (
                <span className="font-medium text-amber-500 flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-amber-500" />
                  Sync Degraded
                </span>
              )}
            </div>

            <div className="flex items-center justify-between py-1.5">
              <span className="text-muted-foreground">Last Proxmox Sync</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {runtime.lastVerifiedAt
                  ? new Date(runtime.lastVerifiedAt).toLocaleString()
                  : vps.last_proxmox_sync_at
                  ? new Date(vps.last_proxmox_sync_at).toLocaleString()
                  : "Never"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Recent Operations Log */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="size-4 text-primary" /> Recent Operations
            </CardTitle>
            <CardDescription className="text-xs">
              Audited lifecycle mutations executed on this instance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {operationsSyncError ? (
              <div className="flex flex-col items-center justify-center py-6 gap-2 text-xs text-muted-foreground">
                <p>{operationsSyncError}</p>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => loadOperations()}>
                  Retry
                </Button>
              </div>
            ) : operations.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">
                No lifecycle operations recorded yet.
              </p>
            ) : (
              <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                {operations.slice(0, 5).map((op) => (
                  <div
                    key={op.id}
                    className="flex items-center justify-between p-2 rounded border bg-muted/20 text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          op.status === "completed"
                            ? "bg-emerald-500"
                            : op.status === "failed"
                            ? "bg-destructive"
                            : "bg-amber-500 animate-pulse"
                        }`}
                      />
                      <span className="font-semibold uppercase tracking-wider font-mono">
                        {op.operation_type}
                      </span>
                      <span className="text-muted-foreground truncate">
                        ({op.current_step})
                      </span>
                    </div>
                    <span className="text-muted-foreground font-mono text-[11px] shrink-0">
                      {new Date(op.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
