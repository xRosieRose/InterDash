"use client"

import * as React from "react"
import {
  Activity,
  Cpu,
  Server,
  HardDrive,
  AlertTriangle,
  Info,
  Loader2,
} from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface AnalyticsData {
  scope: "user" | "admin"
  metrics: {
    totalInstances: number
    runningInstances: number
    stoppedInstances: number
    provisioningInstances?: number
    failedInstances?: number
    totalCpuCores: number
    totalMemoryMb: number
    totalDiskGb: number
    totalNodes?: number
    onlineNodes?: number
    offlineNodes?: number
    degradedNodes?: number
    nodeBreakdown?: Array<{
      id: string
      name: string
      hostname: string
      region: string
      status: string
      instance_count: number
      allocated_cores: number
      allocated_memory_mb: number
    }>
    osBreakdown?: Array<{
      os_image_id: string
      count: number
    }>
  }
}

export default function AnalyticsPage() {
  const [data, setData] = React.useState<AnalyticsData | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    async function loadAnalytics() {
      try {
        const res = await fetch("/api/analytics")
        if (!res.ok) throw new Error("Failed to load infrastructure telemetry.")
        const json = await res.json()
        setData(json)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Error loading metrics")
      } finally {
        setIsLoading(false)
      }
    }

    loadAnalytics()
  }, [])

  if (isLoading) {
    return (
      <BaseLayout title="Infrastructure Analytics" description="Cloud resource allocations & hypervisor telemetry">
        <div className="py-24 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-xs font-mono">Loading real-time resource allocations...</p>
        </div>
      </BaseLayout>
    )
  }

  if (error || !data) {
    return (
      <BaseLayout title="Infrastructure Analytics" description="Cloud resource allocations & hypervisor telemetry">
        <div className="py-16 text-center text-destructive space-y-2">
          <AlertTriangle className="size-8 mx-auto" />
          <p className="text-sm font-medium">{error || "No telemetry available"}</p>
        </div>
      </BaseLayout>
    )
  }

  const { metrics, scope } = data
  const memoryGb = (metrics.totalMemoryMb / 1024).toFixed(1)

  return (
    <BaseLayout
      title={scope === "admin" ? "Global Infrastructure Analytics" : "Instance Resource Analytics"}
      description={
        scope === "admin"
          ? "Fleet-wide hypervisor health, cluster capacity, and aggregated compute allocations."
          : "Total compute, memory, and storage allocations across your cloud VPS instances."
      }
    >
      <div className="@container/main px-4 lg:px-6 space-y-6">
        {/* Honest Architecture Notice Banner */}
        <div className="flex items-start gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs">
          <Info className="size-4 text-primary shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-foreground">Authoritative Infrastructure Metrics</span>
            <p className="text-muted-foreground">
              These values represent genuine database-backed allocations and Proxmox VE hypervisor status.
              Real-time streaming agent telemetry is scheduled for integration in the next dedicated phase.
            </p>
          </div>
        </div>

        {/* Key Resource Allocation Cards */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total VPS Instances</CardTitle>
              <Server className="size-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{metrics.totalInstances}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {metrics.runningInstances} running • {metrics.stoppedInstances} stopped
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Allocated Compute</CardTitle>
              <Cpu className="size-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">
                {metrics.totalCpuCores} <span className="text-xs font-normal text-muted-foreground">vCPUs</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Dedicated hypervisor cores</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Allocated Memory</CardTitle>
              <Activity className="size-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">
                {memoryGb} <span className="text-xs font-normal text-muted-foreground">GB RAM</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{metrics.totalMemoryMb} MB total allocated</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Allocated Storage</CardTitle>
              <HardDrive className="size-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">
                {metrics.totalDiskGb} <span className="text-xs font-normal text-muted-foreground">GB</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">NVMe SSD rootfs capacity</p>
            </CardContent>
          </Card>
        </div>

        {/* Scope-Specific Sections */}
        {scope === "admin" && metrics.nodeBreakdown && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Proxmox VE Node Health & Distribution</CardTitle>
              <CardDescription>
                Hypervisor endpoints currently integrated into the InterDash control plane.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {metrics.nodeBreakdown.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">
                  No Proxmox nodes have been added to the control plane yet. Add nodes in Admin → Nodes.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {metrics.nodeBreakdown.map((n) => (
                    <div key={n.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className={`size-2 rounded-full ${
                            n.status === "online"
                              ? "bg-emerald-500"
                              : n.status === "offline"
                              ? "bg-destructive"
                              : "bg-amber-500"
                          }`}
                        />
                        <span className="font-semibold text-foreground">{n.name}</span>
                        <span className="text-muted-foreground font-mono">({n.hostname})</span>
                        <Badge variant="outline" className="text-[10px] py-0">
                          {n.region}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-4 text-muted-foreground">
                        <span>{n.instance_count} instance(s)</span>
                        <span>{n.allocated_cores} vCPU</span>
                        <span>{(n.allocated_memory_mb / 1024).toFixed(1)} GB RAM</span>
                        <Badge
                          variant="secondary"
                          className={`capitalize text-[10px] ${
                            n.status === "online" ? "text-emerald-500" : "text-destructive"
                          }`}
                        >
                          {n.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Operating System Distribution */}
        {metrics.osBreakdown && metrics.osBreakdown.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">OS Template Breakdown</CardTitle>
              <CardDescription>Container template distributions across assigned instances.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {metrics.osBreakdown.map((os) => {
                  const label = os.os_image_id.split("/").pop()?.split("_")[0] || os.os_image_id
                  const pct = Math.round((os.count / (metrics.totalInstances || 1)) * 100)
                  return (
                    <div key={os.os_image_id} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-mono text-muted-foreground">{label}</span>
                        <span className="font-semibold">{os.count} instance(s) ({pct}%)</span>
                      </div>
                      <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </BaseLayout>
  )
}
