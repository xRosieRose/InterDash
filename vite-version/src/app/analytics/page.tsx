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
import { useSettings } from "@/contexts/settings-context"

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
  const { settings } = useSettings()
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

        {/* Key Resource Allocation Cards - features-8 elevated aesthetic */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* Card 1: Total VPS Instances */}
          <Card className="relative overflow-hidden border-border bg-card/80 backdrop-blur-sm transition-all hover:border-primary/40 hover:shadow-lg group">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="relative flex aspect-square size-11 rounded-full border border-emerald-500/30 before:absolute before:-inset-1.5 before:rounded-full before:border before:border-emerald-500/15 bg-emerald-500/10 shrink-0">
                  <Server className="m-auto size-5 text-emerald-500 dark:text-emerald-400" />
                </div>
                <Badge
                  variant="outline"
                  className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10 text-xs font-medium"
                >
                  {metrics.runningInstances} Active
                </Badge>
              </div>
              <div className="mt-4 space-y-1">
                <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Total VPS Instances
                </CardDescription>
                <CardTitle className="text-3xl font-bold tabular-nums tracking-tight">
                  {metrics.totalInstances}
                </CardTitle>
              </div>
              <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 text-emerald-500 font-medium">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {metrics.runningInstances} running
                </span>
                <span>•</span>
                <span>{metrics.stoppedInstances} stopped</span>
              </div>
            </CardHeader>
            <svg className="absolute -bottom-3 -right-3 w-40 h-16 opacity-15 group-hover:opacity-25 transition-opacity text-emerald-500 pointer-events-none" viewBox="0 0 254 104" fill="none">
              <path d="M112.891 97.7C140.366 97.08 171.004 94.67 201.087 87.51C210.43 85.28 219.615 82.64 228.284 78.24C239.348 71.31 245.555 63.94 242.498 45.61C231.169 38.3 194.482 25.53 162.64 21.29C158.034 20.39 157.115 17.89 162.389 15.52C179.805 15.35 212.998 24.46 236.423 34.12C247.474 41.82 251.841 65.48 242.921 76.63C220.502 88.29 172.738 99.21 114.506 103.79C67.9334 102.97 19.1771 87.51 5.41318 75.77C-1.13794 59.17 13.4863 37.43 50.5431 15.72C86.4883 5.13 153.151 0.13 177.013 2.94C218.04 9.01 244.933 19.64 246.997 23.61C242.63 24.58 204.117 13.43 157.558 7.52C102.154 8.06 46.5758 23.29 14.9818 44.65C5.61172 67.24 22.8564 82.32 51.3902 92.58C90.0219 97.74 112.891 97.7 112.891 97.7Z" fill="currentColor" />
            </svg>
          </Card>

          {/* Card 2: Allocated Compute */}
          <Card className="relative overflow-hidden border-border bg-card/80 backdrop-blur-sm transition-all hover:border-primary/40 hover:shadow-lg group">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="relative flex aspect-square size-11 rounded-full border border-primary/25 before:absolute before:-inset-1.5 before:rounded-full before:border before:border-primary/10 bg-primary/10 shrink-0">
                  <Cpu className="m-auto size-5 text-primary" />
                </div>
                <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary text-xs font-medium">
                  Compute
                </Badge>
              </div>
              <div className="mt-4 space-y-1">
                <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Allocated Compute
                </CardDescription>
                <CardTitle className="text-3xl font-bold tabular-nums tracking-tight">
                  {metrics.totalCpuCores} <span className="text-lg font-normal text-muted-foreground">vCPUs</span>
                </CardTitle>
              </div>
              <div className="pt-1 text-xs text-muted-foreground">
                Dedicated hypervisor execution cores
              </div>
            </CardHeader>
            <svg className="absolute -bottom-2 -right-4 w-44 h-16 opacity-15 group-hover:opacity-25 transition-opacity text-primary pointer-events-none" viewBox="0 0 386 123" fill="none">
              <path d="M3 121C3 121 15 93 36 87C56 81 80 80 91 80C102 80 116 64 125 92C132 92 142 78 153 80C165 83 186 92 193 92C199 92 205 64 213 64C220 64 237 93 243 92C248 90 257 60 265 60C271 60 283 87 285 87C293 87 304 73 311 73C321 65 333 64 345 62C362 80 383 106 383 106" stroke="currentColor" strokeWidth="3" />
            </svg>
          </Card>

          {/* Card 3: Allocated Memory */}
          <Card className="relative overflow-hidden border-border bg-card/80 backdrop-blur-sm transition-all hover:border-primary/40 hover:shadow-lg group">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="relative flex aspect-square size-11 rounded-full border border-primary/25 before:absolute before:-inset-1.5 before:rounded-full before:border before:border-primary/10 bg-primary/10 shrink-0">
                  <Activity className="m-auto size-5 text-primary" />
                </div>
                <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary text-xs font-medium">
                  Memory
                </Badge>
              </div>
              <div className="mt-4 space-y-1">
                <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Allocated Memory
                </CardDescription>
                <CardTitle className="text-3xl font-bold tabular-nums tracking-tight">
                  {memoryGb} <span className="text-lg font-normal text-muted-foreground">GB RAM</span>
                </CardTitle>
              </div>
              <div className="pt-1 text-xs text-muted-foreground">
                {metrics.totalMemoryMb} MB total allocated buffer
              </div>
            </CardHeader>
            <svg className="absolute -bottom-4 -right-4 w-36 h-20 opacity-15 group-hover:opacity-25 transition-opacity text-primary pointer-events-none" viewBox="0 0 212 143" fill="none">
              <path d="M44 55C50 40 59 32 70 27C81 21 93 18 106 18C118 18 130 21 141 26C152 32 161 39 169 50" stroke="currentColor" strokeWidth="3" />
              <path d="M67 18C70 8 77 6 84 4C91 2 98 1 106 1C113 1 121 2 128 4C135 5 142 8 149 11" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
            </svg>
          </Card>

          {/* Card 4: Allocated Storage */}
          <Card className="relative overflow-hidden border-border bg-card/80 backdrop-blur-sm transition-all hover:border-primary/40 hover:shadow-lg group">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="relative flex aspect-square size-11 rounded-full border border-primary/25 before:absolute before:-inset-1.5 before:rounded-full before:border before:border-primary/10 bg-primary/10 shrink-0">
                  <HardDrive className="m-auto size-5 text-primary" />
                </div>
                <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary text-xs font-medium">
                  NVMe RootFS
                </Badge>
              </div>
              <div className="mt-4 space-y-1">
                <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Allocated Storage
                </CardDescription>
                <CardTitle className="text-3xl font-bold tabular-nums tracking-tight">
                  {metrics.totalDiskGb} <span className="text-lg font-normal text-muted-foreground">GB</span>
                </CardTitle>
              </div>
              <div className="pt-1 text-xs text-muted-foreground">
                High-IOPS PCIe 4.0 SSD rootfs capacity
              </div>
            </CardHeader>
            <svg className="absolute -bottom-2 -right-2 w-44 h-16 opacity-15 group-hover:opacity-25 transition-opacity text-primary pointer-events-none" viewBox="0 0 366 231" fill="none">
              <path d="M0 231V179L2 180L4 183L7 178L11 191V155L14 142V154L19 158L22 148V142L26 129V120L31 120V130L35 130L40 138V126L47 103V92L52 89L56 87L60 103L65 122L70 109L73 123V130L78 134V138L83 142V130L89 116V122L93 123L96 122V137L101 120L106 140L110 130L115 152L119 140V148L125 158L131 155L138 158L144 169L148 151L154 145L159 140L163 116V109L166 109L176 98L180 98V81L184 56L188 106L193 75V98L200 75L203 113L207 94L212 81L216 62L220 75L226 84L230 75L236 102L241 98L245 87L251 96L257 99L264 75L267 58L276 13L282 20L287 73L294 61L300 0L305 22L312 105L318 105L325 80L333 52L340 87L348 82L355 94L360 108L365 95V231H0Z" fill="currentColor" fillOpacity="0.3" />
            </svg>
          </Card>
        </div>

        {/* Scope-Specific Sections */}
        {scope === "admin" && metrics.nodeBreakdown && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Proxmox VE Node Health & Distribution</CardTitle>
              <CardDescription>
                Hypervisor endpoints currently integrated into the {settings.brand_name || "InterDash"} control plane.
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
