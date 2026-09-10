"use client"

import * as React from "react"
import {
  Server,
  Cpu,
  Activity,
  HardDrive,
  Copy,
  Check,
  Search,
  Plus,
  RefreshCw,
  Loader2,
  AlertCircle,
} from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/contexts/auth-context"
import { AdminDeployModal } from "@/components/vps/admin-deploy-modal"
import type { VpsRecord } from "@/types/vps"
import { toast } from "sonner"

export default function InstancesPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const [instances, setInstances] = React.useState<VpsRecord[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [activeTab, setActiveTab] = React.useState<"all" | "running" | "stopped">("all")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [copiedIp, setCopiedIp] = React.useState<string | null>(null)
  const [adminDeployOpen, setAdminDeployOpen] = React.useState(false)

  const fetchInstances = React.useCallback(async (showToast = false) => {
    try {
      if (showToast) setIsRefreshing(true)
      const res = await fetch("/api/vps")
      if (!res.ok) {
        throw new Error("Unable to retrieve infrastructure data.")
      }
      const data = await res.json()
      setInstances(data.instances || [])
      setError(null)
      if (showToast) {
        toast.success("Instance inventory updated.")
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load instances"
      setError(msg)
      if (showToast) {
        toast.error(msg)
      }
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    fetchInstances()
  }, [fetchInstances])

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopiedIp(text)
    toast.success(`Copied ${label} to clipboard`, {
      description: text,
      duration: 2000,
    })
    setTimeout(() => setCopiedIp(null), 2000)
  }

  // Filter instances
  const filteredInstances = React.useMemo(() => {
    return instances.filter((inst) => {
      if (activeTab === "running" && inst.status !== "running") return false
      if (activeTab === "stopped" && inst.status !== "stopped") return false

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        return (
          inst.name?.toLowerCase().includes(q) ||
          inst.hostname.toLowerCase().includes(q) ||
          (inst.ipv4_address && inst.ipv4_address.toLowerCase().includes(q)) ||
          (inst.node_name && inst.node_name.toLowerCase().includes(q)) ||
          inst.os_image_id.toLowerCase().includes(q)
        )
      }

      return true
    })
  }, [instances, activeTab, searchQuery])

  // Calculated summary metrics
  const totalCount = instances.length
  const runningCount = instances.filter((i) => i.status === "running").length
  const stoppedCount = instances.filter((i) => i.status === "stopped").length
  const totalCores = instances.reduce((acc, curr) => acc + (curr.cpu_cores || 0), 0)
  const totalMemoryGb = (
    instances.reduce((acc, curr) => acc + (curr.memory_mb || 0), 0) / 1024
  ).toFixed(1)
  const totalDiskGb = instances.reduce((acc, curr) => acc + (curr.disk_gb || 0), 0)

  return (
    <BaseLayout
      title="Cloud VPS Instances"
      description="View assigned cloud VPS instances, network IP allocations, and hypervisor statuses."
    >
      <div className="@container/main px-4 lg:px-6 space-y-6">
        {/* Top Summary Metric Cards */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="border-border bg-gradient-to-t from-primary/5 to-card shadow-xs">
            <CardHeader>
              <CardDescription className="flex items-center justify-between">
                <span>Active VPS Instances</span>
                <Server className="size-4 text-primary" />
              </CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums sm:text-3xl">
                {totalCount}
              </CardTitle>
              <CardAction>
                <Badge
                  variant="outline"
                  className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                >
                  {runningCount} Running
                </Badge>
              </CardAction>
            </CardHeader>
          </Card>

          <Card className="border-border bg-gradient-to-t from-primary/5 to-card shadow-xs">
            <CardHeader>
              <CardDescription className="flex items-center justify-between">
                <span>Allocated Cores</span>
                <Cpu className="size-4 text-primary" />
              </CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums sm:text-3xl">
                {totalCores} <span className="text-sm font-normal text-muted-foreground">vCPUs</span>
              </CardTitle>
              <CardAction>
                <Badge variant="outline">Compute</Badge>
              </CardAction>
            </CardHeader>
          </Card>

          <Card className="border-border bg-gradient-to-t from-primary/5 to-card shadow-xs">
            <CardHeader>
              <CardDescription className="flex items-center justify-between">
                <span>Allocated Memory</span>
                <Activity className="size-4 text-primary" />
              </CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums sm:text-3xl">
                {totalMemoryGb} <span className="text-sm font-normal text-muted-foreground">GB RAM</span>
              </CardTitle>
              <CardAction>
                <Badge variant="outline">Memory</Badge>
              </CardAction>
            </CardHeader>
          </Card>

          <Card className="border-border bg-gradient-to-t from-primary/5 to-card shadow-xs">
            <CardHeader>
              <CardDescription className="flex items-center justify-between">
                <span>Allocated Storage</span>
                <HardDrive className="size-4 text-primary" />
              </CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums sm:text-3xl">
                {totalDiskGb} <span className="text-sm font-normal text-muted-foreground">GB SSD</span>
              </CardTitle>
              <CardAction>
                <Badge variant="outline">RootFS</Badge>
              </CardAction>
            </CardHeader>
          </Card>
        </div>

        {/* Table & Toolbar */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as "all" | "running" | "stopped")}
              >
                <TabsList>
                  <TabsTrigger value="all">
                    All <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">{totalCount}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="running">
                    Running <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">{runningCount}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="stopped">
                    Stopped <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">{stoppedCount}</Badge>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => fetchInstances(true)}
                disabled={isRefreshing}
                title="Refresh inventory"
              >
                <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              </Button>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder="Filter instances..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-9 text-xs"
                />
              </div>

              {/* Admin Provisioning Trigger (Only rendered for Admins) */}
              {isAdmin && (
                <Button
                  size="sm"
                  className="h-9 gap-1 text-xs shrink-0"
                  onClick={() => setAdminDeployOpen(true)}
                >
                  <Plus className="size-3.5" /> Provision VPS
                </Button>
              )}
            </div>
          </div>

          {/* Table Content */}
          <div className="rounded-md border border-border bg-card">
            {isLoading ? (
              <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <Loader2 className="size-6 animate-spin text-primary" />
                <p className="text-xs font-mono">Loading assigned VPS instances...</p>
              </div>
            ) : error ? (
              <div className="py-16 flex flex-col items-center justify-center gap-3 text-destructive">
                <AlertCircle className="size-6" />
                <p className="text-sm font-medium">{error}</p>
                <Button variant="outline" size="sm" onClick={() => fetchInstances(true)}>
                  Retry
                </Button>
              </div>
            ) : filteredInstances.length === 0 ? (
              <div className="py-20 text-center space-y-2">
                <Server className="size-8 mx-auto text-muted-foreground/40" />
                <h4 className="font-semibold text-sm">No VPS instances found</h4>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  {searchQuery
                    ? "No instances match your search query."
                    : "No VPS instances are currently assigned to your account."}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[110px]">Status</TableHead>
                    <TableHead>Hostname / Name</TableHead>
                    <TableHead>OS / Template</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Hypervisor / Node</TableHead>
                    <TableHead>Allocated Specs</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInstances.map((inst) => {
                    const isRunning = inst.status === "running"
                    return (
                      <TableRow key={inst.id}>
                        {/* Status */}
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span
                              className={`size-2 rounded-full ${
                                isRunning
                                  ? "bg-emerald-500 animate-pulse"
                                  : inst.status === "stopped"
                                  ? "bg-zinc-500"
                                  : "bg-amber-500"
                              }`}
                            />
                            <span className="text-xs font-medium capitalize text-muted-foreground">
                              {inst.status}
                            </span>
                          </div>
                        </TableCell>

                        {/* Hostname & Name */}
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-mono font-semibold text-sm text-foreground">
                              {inst.hostname}
                            </span>
                            <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                              {inst.name}
                            </span>
                          </div>
                        </TableCell>

                        {/* OS Template */}
                        <TableCell>
                          <Badge variant="outline" className="text-xs font-mono font-medium py-0">
                            {inst.os_image_id.split("/").pop()?.split("_")[0] || inst.os_image_id}
                          </Badge>
                        </TableCell>

                        {/* IPv4 */}
                        <TableCell>
                          <div className="flex items-center gap-1.5 font-mono text-xs">
                            <span className="text-foreground">
                              {inst.ipv4_address || "DHCP / Unassigned"}
                            </span>
                            {inst.ipv4_address && (
                              <button
                                onClick={() => copyToClipboard(inst.ipv4_address!, "IPv4")}
                                className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded cursor-pointer"
                                title="Copy IPv4"
                              >
                                {copiedIp === inst.ipv4_address ? (
                                  <Check className="size-3 text-emerald-500" />
                                ) : (
                                  <Copy className="size-3" />
                                )}
                              </button>
                            )}
                          </div>
                        </TableCell>

                        {/* Hypervisor Node & Region */}
                        <TableCell>
                          <div className="flex flex-col text-xs">
                            <span className="font-medium text-foreground flex items-center gap-1.5">
                              {inst.node_flag_url && (
                                <img
                                  src={inst.node_flag_url}
                                  alt={inst.node_region || "region"}
                                  className="w-4 h-2.5 object-cover rounded-[1px] border border-border/60 shrink-0"
                                />
                              )}
                              {inst.node_name || "Proxmox Node"}
                            </span>
                            <span className="text-muted-foreground font-mono">
                              VMID: {inst.proxmox_vmid} ({inst.node_region || "default"})
                            </span>
                          </div>
                        </TableCell>

                        {/* Specs */}
                        <TableCell>
                          <div className="flex flex-col text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {inst.cpu_cores} vCPU • {inst.memory_mb} MB RAM
                            </span>
                            <span>{inst.disk_gb} GB NVMe SSD</span>
                          </div>
                        </TableCell>

                        {/* Created Date */}
                        <TableCell className="text-right text-xs font-mono text-muted-foreground">
                          {inst.created_at ? inst.created_at.split("T")[0] : "—"}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>

      {/* Admin Provisioning Modal */}
      {isAdmin && (
        <AdminDeployModal
          open={adminDeployOpen}
          onOpenChange={setAdminDeployOpen}
          onSuccess={() => fetchInstances(false)}
        />
      )}
    </BaseLayout>
  )
}
