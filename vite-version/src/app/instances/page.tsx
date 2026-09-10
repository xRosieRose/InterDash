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
  HelpCircle,
  ChevronRight,
  User as UserIcon,
} from "lucide-react"
import { Link } from "react-router-dom"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
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
import { Tour, useTour, type TourStep } from "@/components/ui/product-tour"

const INSTANCE_TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to InterDash",
    content:
      "Welcome to your Cloud VPS Management Control Plane. Let's take a quick 30-second tour of your cloud infrastructure.",
    placement: "center",
  },
  {
    target: "#tour-metrics",
    title: "Fleet & Cluster Telemetry",
    content:
      "Monitor your total active KVM virtual machines, dedicated vCPU cores, allocated DDR5 RAM, and high-speed NVMe storage at a glance.",
    placement: "bottom",
  },
  {
    target: "#tour-search",
    title: "Instant Search & Filter",
    content:
      "Quickly filter your fleet by VM ID, hostname, IP address, OS distribution, or node region.",
    placement: "bottom",
  },
  {
    target: "#tour-instances-table",
    title: "VPS Management & Console",
    content:
      "Inspect your assigned servers, copy IPv4/IPv6 addresses with one click, and check node uptime status.",
    placement: "top",
  },
  {
    target: "#tour-replay",
    title: "Interactive Tour Anytime",
    content:
      "You're all set! You can replay this interactive walkthrough at any time by clicking the Tour button.",
    placement: "bottom",
  },
]

export default function InstancesPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const tour = useTour("interdash_instances_tour_seen")

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

  const hasAutoPromptedRef = React.useRef(false)

  // Auto-prompt onboarding tour ONCE on first visit after instances load
  React.useEffect(() => {
    if (isLoading || hasAutoPromptedRef.current) return

    if (!tour.seen()) {
      hasAutoPromptedRef.current = true
      const timer = window.setTimeout(() => {
        tour.start()
      }, 500)
      return () => window.clearTimeout(timer)
    }
  }, [isLoading, tour])

  return (
    <BaseLayout
      title="Cloud VPS Instances"
      description="View assigned cloud VPS instances, network IP allocations, and hypervisor statuses."
    >
      <div className="@container/main px-4 lg:px-6 space-y-6">
        {/* Top Summary Metric Cards - features-8 elevated aesthetic */}
        <div id="tour-metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* Card 1: Active VPS Instances */}
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
                  {runningCount} / {totalCount} Active
                </Badge>
              </div>
              <div className="mt-4 space-y-1">
                <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Fleet Instances
                </CardDescription>
                <CardTitle className="text-3xl font-bold tabular-nums tracking-tight">
                  {totalCount}
                </CardTitle>
              </div>
              <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 text-emerald-500 font-medium">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {runningCount} Running
                </span>
                <span>•</span>
                <span>{stoppedCount} Stopped</span>
              </div>
            </CardHeader>
            {/* Ambient Background Wave SVG */}
            <svg className="absolute -bottom-3 -right-3 w-40 h-16 opacity-15 group-hover:opacity-25 transition-opacity text-emerald-500 pointer-events-none" viewBox="0 0 254 104" fill="none">
              <path d="M112.891 97.7C140.366 97.08 171.004 94.67 201.087 87.51C210.43 85.28 219.615 82.64 228.284 78.24C239.348 71.31 245.555 63.94 242.498 45.61C231.169 38.3 194.482 25.53 162.64 21.29C158.034 20.39 157.115 17.89 162.389 15.52C179.805 15.35 212.998 24.46 236.423 34.12C247.474 41.82 251.841 65.48 242.921 76.63C220.502 88.29 172.738 99.21 114.506 103.79C67.9334 102.97 19.1771 87.51 5.41318 75.77C-1.13794 59.17 13.4863 37.43 50.5431 15.72C86.4883 5.13 153.151 0.13 177.013 2.94C218.04 9.01 244.933 19.64 246.997 23.61C242.63 24.58 204.117 13.43 157.558 7.52C102.154 8.06 46.5758 23.29 14.9818 44.65C5.61172 67.24 22.8564 82.32 51.3902 92.58C90.0219 97.74 112.891 97.7 112.891 97.7Z" fill="currentColor" />
            </svg>
          </Card>

          {/* Card 2: Allocated Cores */}
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
                  Virtual Cores
                </CardDescription>
                <CardTitle className="text-3xl font-bold tabular-nums tracking-tight">
                  {totalCores} <span className="text-lg font-normal text-muted-foreground">vCPUs</span>
                </CardTitle>
              </div>
              <div className="pt-1 text-xs text-muted-foreground">
                Dedicated hypervisor execution threads
              </div>
            </CardHeader>
            {/* Micro Telemetry Wave SVG */}
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
                  Allocated RAM
                </CardDescription>
                <CardTitle className="text-3xl font-bold tabular-nums tracking-tight">
                  {totalMemoryGb} <span className="text-lg font-normal text-muted-foreground">GB</span>
                </CardTitle>
              </div>
              <div className="pt-1 text-xs text-muted-foreground">
                High-speed DDR5 pooled memory capacity
              </div>
            </CardHeader>
            {/* Concentric radar circle micro-accent */}
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
                  Storage Volume
                </CardDescription>
                <CardTitle className="text-3xl font-bold tabular-nums tracking-tight">
                  {totalDiskGb} <span className="text-lg font-normal text-muted-foreground">GB</span>
                </CardTitle>
              </div>
              <div className="pt-1 text-xs text-muted-foreground">
                High-IOPS PCIe 4.0 SSD rootfs allocation
              </div>
            </CardHeader>
            {/* Sparkline gradient fill SVG */}
            <svg className="absolute -bottom-2 -right-2 w-44 h-16 opacity-15 group-hover:opacity-25 transition-opacity text-primary pointer-events-none" viewBox="0 0 366 231" fill="none">
              <path d="M0 231V179L2 180L4 183L7 178L11 191V155L14 142V154L19 158L22 148V142L26 129V120L31 120V130L35 130L40 138V126L47 103V92L52 89L56 87L60 103L65 122L70 109L73 123V130L78 134V138L83 142V130L89 116V122L93 123L96 122V137L101 120L106 140L110 130L115 152L119 140V148L125 158L131 155L138 158L144 169L148 151L154 145L159 140L163 116V109L166 109L176 98L180 98V81L184 56L188 106L193 75V98L200 75L203 113L207 94L212 81L216 62L220 75L226 84L230 75L236 102L241 98L245 87L251 96L257 99L264 75L267 58L276 13L282 20L287 73L294 61L300 0L305 22L312 105L318 105L325 80L333 52L340 87L348 82L355 94L360 108L365 95V231H0Z" fill="currentColor" fillOpacity="0.3" />
            </svg>
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
              <Button
                id="tour-replay"
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs cursor-pointer"
                onClick={() => tour.start()}
                title="Interactive Onboarding Tour"
              >
                <HelpCircle className="size-3.5 text-primary" />
                <span className="hidden sm:inline">Tour</span>
              </Button>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div id="tour-search" className="relative flex-1 sm:w-64">
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
                  id="tour-provision"
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
          <div id="tour-instances-table" className="rounded-md border border-border bg-card">
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
                    {isAdmin && <TableHead>Assigned User</TableHead>}
                    <TableHead>OS / Template</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Hypervisor / Node</TableHead>
                    <TableHead>Allocated Specs</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInstances.map((inst) => {
                    const isRunning = inst.status === "running"
                    return (
                      <TableRow key={inst.id} className="hover:bg-muted/40 transition-colors">
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
                          <Link
                            to={`/instances/${inst.id}`}
                            className="flex flex-col group cursor-pointer"
                          >
                            <span className="font-mono font-semibold text-sm text-foreground group-hover:text-primary transition-colors">
                              {inst.hostname}
                            </span>
                            <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                              {inst.name}
                            </span>
                          </Link>
                        </TableCell>

                        {/* Owner (Admin only) */}
                        {isAdmin && (
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-xs">
                              <UserIcon className="size-3 text-muted-foreground" />
                              <span className="font-medium text-foreground truncate max-w-[140px]">
                                {inst.owner_global_name || inst.owner_username || "Unknown"}
                              </span>
                            </div>
                          </TableCell>
                        )}

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

                        {/* Manage Action */}
                        <TableCell className="text-right">
                          <Link to={`/instances/${inst.id}`}>
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 hover:border-primary">
                              Manage <ChevronRight className="size-3 text-muted-foreground" />
                            </Button>
                          </Link>
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

      {/* Interactive Onboarding Tour */}
      <Tour
        steps={INSTANCE_TOUR_STEPS}
        open={tour.open}
        onOpenChange={(isOpen) => {
          tour.setOpen(isOpen)
          if (!isOpen) {
            tour.markSeen()
          }
        }}
        index={tour.index}
        onIndexChange={tour.setIndex}
        onFinish={() => {
          tour.setOpen(false)
          tour.markSeen()
        }}
        onSkip={() => {
          tour.setOpen(false)
          tour.markSeen()
        }}
      />
    </BaseLayout>
  )
}
