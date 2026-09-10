"use client"

import * as React from "react"
import {
  Server,
  Users,
  HardDrive,
  Cpu,
  Plus,
  RefreshCw,
  Clock,
  AlertTriangle,
  XCircle,
  Loader2,
} from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { AdminDeployModal } from "@/components/vps/admin-deploy-modal"
import { toast } from "sonner"

interface OverviewData {
  metrics: {
    totalVps: number
    runningVps: number
    stoppedVps: number
    provisioningVps: number
    failedVps: number
    totalUsers: number
    activeUsers: number
    adminUsers: number
    totalCores: number
    totalMemoryMb: number
    totalDiskGb: number
    totalNodes: number
    onlineNodes: number
    offlineNodes: number
    systemHealth: "operational" | "degraded" | "outage" | "unconfigured"
  }
  recentEvents: Array<{
    id: number
    user_id: string
    event_type: string
    metadata: string
    created_at: string
  }>
}

export default function AdminOverviewPage() {
  const [data, setData] = React.useState<OverviewData | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [deployModalOpen, setDeployModalOpen] = React.useState(false)

  const fetchOverview = React.useCallback(async (showToast = false) => {
    try {
      if (showToast) setIsRefreshing(true)
      const res = await fetch("/api/admin/overview")
      if (!res.ok) throw new Error("Failed to load admin overview metrics.")
      const json = await res.json()
      setData(json)
      if (showToast) toast.success("Overview metrics refreshed.")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load metrics")
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    fetchOverview()
  }, [fetchOverview])

  if (isLoading) {
    return (
      <BaseLayout title="Infrastructure Overview" description="Hypervisor cluster & platform administration">
        <div className="py-24 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-xs font-mono">Aggregating platform & hypervisor metrics...</p>
        </div>
      </BaseLayout>
    )
  }

  const metrics = data?.metrics || {
    totalVps: 0,
    runningVps: 0,
    stoppedVps: 0,
    provisioningVps: 0,
    failedVps: 0,
    totalUsers: 0,
    activeUsers: 0,
    adminUsers: 0,
    totalCores: 0,
    totalMemoryMb: 0,
    totalDiskGb: 0,
    totalNodes: 0,
    onlineNodes: 0,
    offlineNodes: 0,
    systemHealth: "unconfigured" as const,
  }

  const memoryGb = (metrics.totalMemoryMb / 1024).toFixed(1)

  const getSystemHealthBadge = () => {
    switch (metrics.systemHealth) {
      case "operational":
        return (
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-500 gap-1.5 py-1">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            All Hypervisor Nodes Healthy
          </Badge>
        )
      case "degraded":
        return (
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-500 gap-1.5 py-1">
            <AlertTriangle className="size-3 text-amber-500" />
            Node Degraded / Offline Detected
          </Badge>
        )
      case "outage":
        return (
          <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive gap-1.5 py-1">
            <XCircle className="size-3 text-destructive" />
            Hypervisor Cluster Outage
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground gap-1.5 py-1">
            No Proxmox Nodes Configured
          </Badge>
        )
    }
  }

  return (
    <BaseLayout
      title="Infrastructure Overview"
      description="Live platform control plane, hypervisor node status, and global resource allocation."
    >
      <div className="@container/main px-4 lg:px-6 space-y-6">
        {/* Header Actions & Health Status */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border border-border bg-card">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold tracking-tight">System Operational Health</h2>
              {getSystemHealthBadge()}
            </div>
            <p className="text-xs text-muted-foreground">
              Real-time synchronization with Proxmox VE hypervisors and SQLite persistence.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => fetchOverview(true)}
              disabled={isRefreshing}
            >
              <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setDeployModalOpen(true)}
            >
              <Plus className="size-3.5" /> Provision VPS
            </Button>
          </div>
        </div>

        {/* Primary Metric Cards - features-8 elevated aesthetic */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* Card 1: Global VPS Fleet */}
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
                  {metrics.runningVps} / {metrics.totalVps} Online
                </Badge>
              </div>
              <div className="mt-4 space-y-1">
                <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Global VPS Fleet
                </CardDescription>
                <CardTitle className="text-3xl font-bold tabular-nums tracking-tight">
                  {metrics.totalVps}
                </CardTitle>
              </div>
              <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 text-emerald-500 font-medium">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {metrics.runningVps} running
                </span>
                <span>•</span>
                <span>{metrics.stoppedVps} stopped</span>
                {metrics.failedVps > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-destructive font-medium">{metrics.failedVps} error</span>
                  </>
                )}
              </div>
            </CardHeader>
            <svg className="absolute -bottom-3 -right-3 w-40 h-16 opacity-15 group-hover:opacity-25 transition-opacity text-emerald-500 pointer-events-none" viewBox="0 0 254 104" fill="none">
              <path d="M112.891 97.7C140.366 97.08 171.004 94.67 201.087 87.51C210.43 85.28 219.615 82.64 228.284 78.24C239.348 71.31 245.555 63.94 242.498 45.61C231.169 38.3 194.482 25.53 162.64 21.29C158.034 20.39 157.115 17.89 162.389 15.52C179.805 15.35 212.998 24.46 236.423 34.12C247.474 41.82 251.841 65.48 242.921 76.63C220.502 88.29 172.738 99.21 114.506 103.79C67.9334 102.97 19.1771 87.51 5.41318 75.77C-1.13794 59.17 13.4863 37.43 50.5431 15.72C86.4883 5.13 153.151 0.13 177.013 2.94C218.04 9.01 244.933 19.64 246.997 23.61C242.63 24.58 204.117 13.43 157.558 7.52C102.154 8.06 46.5758 23.29 14.9818 44.65C5.61172 67.24 22.8564 82.32 51.3902 92.58C90.0219 97.74 112.891 97.7 112.891 97.7Z" fill="currentColor" />
            </svg>
          </Card>

          {/* Card 2: Registered Users */}
          <Card className="relative overflow-hidden border-border bg-card/80 backdrop-blur-sm transition-all hover:border-primary/40 hover:shadow-lg group">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="relative flex aspect-square size-11 rounded-full border border-primary/25 before:absolute before:-inset-1.5 before:rounded-full before:border before:border-primary/10 bg-primary/10 shrink-0">
                  <Users className="m-auto size-5 text-primary" />
                </div>
                <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary text-xs font-medium">
                  {metrics.activeUsers} Active
                </Badge>
              </div>
              <div className="mt-4 space-y-1">
                <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Registered Users
                </CardDescription>
                <CardTitle className="text-3xl font-bold tabular-nums tracking-tight">
                  {metrics.totalUsers}
                </CardTitle>
              </div>
              <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                <span>{metrics.activeUsers} active accounts</span>
                <span>•</span>
                <span className="text-primary font-medium">{metrics.adminUsers} admin(s)</span>
              </div>
            </CardHeader>
            {/* Concentric Ring User Accent SVG */}
            <svg className="absolute -bottom-4 -right-4 w-36 h-20 opacity-15 group-hover:opacity-25 transition-opacity text-primary pointer-events-none" viewBox="0 0 212 143" fill="none">
              <path d="M44 55C50 40 59 32 70 27C81 21 93 18 106 18C118 18 130 21 141 26C152 32 161 39 169 50" stroke="currentColor" strokeWidth="3" />
              <circle cx="106" cy="90" r="25" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
            </svg>
          </Card>

          {/* Card 3: Proxmox Nodes */}
          <Card className="relative overflow-hidden border-border bg-card/80 backdrop-blur-sm transition-all hover:border-primary/40 hover:shadow-lg group">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="relative flex aspect-square size-11 rounded-full border border-primary/25 before:absolute before:-inset-1.5 before:rounded-full before:border before:border-primary/10 bg-primary/10 shrink-0">
                  <HardDrive className="m-auto size-5 text-primary" />
                </div>
                <Badge
                  variant="outline"
                  className={
                    metrics.offlineNodes > 0
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-500 text-xs font-medium"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 text-xs font-medium"
                  }
                >
                  {metrics.onlineNodes}/{metrics.totalNodes} Online
                </Badge>
              </div>
              <div className="mt-4 space-y-1">
                <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Proxmox Nodes
                </CardDescription>
                <CardTitle className="text-3xl font-bold tabular-nums tracking-tight">
                  {metrics.totalNodes}
                </CardTitle>
              </div>
              <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                <span className="text-emerald-500 font-medium">{metrics.onlineNodes} online</span>
                <span>•</span>
                <span className={metrics.offlineNodes > 0 ? "text-destructive font-medium" : ""}>
                  {metrics.offlineNodes} unreachable
                </span>
              </div>
            </CardHeader>
            <svg className="absolute -bottom-2 -right-4 w-44 h-16 opacity-15 group-hover:opacity-25 transition-opacity text-primary pointer-events-none" viewBox="0 0 386 123" fill="none">
              <path d="M3 121C3 121 15 93 36 87C56 81 80 80 91 80C102 80 116 64 125 92C132 92 142 78 153 80C165 83 186 92 193 92C199 92 205 64 213 64C220 64 237 93 243 92C248 90 257 60 265 60C271 60 283 87 285 87C293 87 304 73 311 73C321 65 333 64 345 62C362 80 383 106 383 106" stroke="currentColor" strokeWidth="3" />
            </svg>
          </Card>

          {/* Card 4: Allocated Compute */}
          <Card className="relative overflow-hidden border-border bg-card/80 backdrop-blur-sm transition-all hover:border-primary/40 hover:shadow-lg group">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="relative flex aspect-square size-11 rounded-full border border-primary/25 before:absolute before:-inset-1.5 before:rounded-full before:border before:border-primary/10 bg-primary/10 shrink-0">
                  <Cpu className="m-auto size-5 text-primary" />
                </div>
                <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary text-xs font-medium">
                  Fleet Compute
                </Badge>
              </div>
              <div className="mt-4 space-y-1">
                <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Allocated Compute
                </CardDescription>
                <CardTitle className="text-3xl font-bold tabular-nums tracking-tight">
                  {metrics.totalCores} <span className="text-lg font-normal text-muted-foreground">vCPUs</span>
                </CardTitle>
              </div>
              <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                <span>{memoryGb} GB RAM</span>
                <span>•</span>
                <span>{metrics.totalDiskGb} GB Storage</span>
              </div>
            </CardHeader>
            <svg className="absolute -bottom-2 -right-2 w-44 h-16 opacity-15 group-hover:opacity-25 transition-opacity text-primary pointer-events-none" viewBox="0 0 366 231" fill="none">
              <path d="M0 231V179L2 180L4 183L7 178L11 191V155L14 142V154L19 158L22 148V142L26 129V120L31 120V130L35 130L40 138V126L47 103V92L52 89L56 87L60 103L65 122L70 109L73 123V130L78 134V138L83 142V130L89 116V122L93 123L96 122V137L101 120L106 140L110 130L115 152L119 140V148L125 158L131 155L138 158L144 169L148 151L154 145L159 140L163 116V109L166 109L176 98L180 98V81L184 56L188 106L193 75V98L200 75L203 113L207 94L212 81L216 62L220 75L226 84L230 75L236 102L241 98L245 87L251 96L257 99L264 75L267 58L276 13L282 20L287 73L294 61L300 0L305 22L312 105L318 105L325 80L333 52L340 87L348 82L355 94L360 108L365 95V231H0Z" fill="currentColor" fillOpacity="0.3" />
            </svg>
          </Card>
        </div>

        {/* Audit Log / Recent Events */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Clock className="size-4 text-primary" /> Recent Infrastructure & Audit Events
            </CardTitle>
            <CardDescription>
              Chronological log of administrative actions, user logins, and provisioning requests.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data?.recentEvents && data.recentEvents.length > 0 ? (
              <div className="divide-y divide-border text-xs">
                {data.recentEvents.map((evt) => (
                  <div key={evt.id} className="py-2.5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 truncate">
                      <Badge variant="outline" className="font-mono text-[10px] py-0">
                        {evt.event_type}
                      </Badge>
                      <span className="text-muted-foreground truncate font-mono">
                        {evt.metadata ? evt.metadata.substring(0, 100) : "—"}
                      </span>
                    </div>
                    <span className="text-muted-foreground font-mono shrink-0">
                      {evt.created_at ? evt.created_at.replace("T", " ").substring(0, 16) : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-6 text-center">
                No recent audit events recorded.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Admin Provisioning Modal */}
      <AdminDeployModal
        open={deployModalOpen}
        onOpenChange={setDeployModalOpen}
        onSuccess={() => fetchOverview(false)}
      />
    </BaseLayout>
  )
}
