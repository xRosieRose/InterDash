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

        {/* Primary Metric Cards */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Global VPS Fleet</CardTitle>
              <Server className="size-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{metrics.totalVps}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {metrics.runningVps} running • {metrics.stoppedVps} stopped • {metrics.failedVps} error
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Registered Users</CardTitle>
              <Users className="size-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{metrics.totalUsers}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {metrics.activeUsers} active accounts • {metrics.adminUsers} admin(s)
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Proxmox Nodes</CardTitle>
              <HardDrive className="size-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{metrics.totalNodes}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {metrics.onlineNodes} online • {metrics.offlineNodes} unreachable
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
                {metrics.totalCores} <span className="text-xs font-normal text-muted-foreground">vCPUs</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {memoryGb} GB RAM • {metrics.totalDiskGb} GB Storage
              </p>
            </CardContent>
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
