"use client"

import * as React from "react"
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom"
import {
  Server,
  Cpu,
  HardDrive,
  Activity,
  Network,
  Power,
  RefreshCw,
  Terminal as TerminalIcon,
  Settings as SettingsIcon,
  LayoutDashboard,
  Copy,
  Check,
  AlertTriangle,
  Loader2,
  ChevronLeft,
  Key,
  Eye,
  EyeOff,
  Sparkles,
  ShieldAlert,
  Clock,
} from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { useAuth } from "@/contexts/auth-context"
import type { VpsRecord } from "@/types/vps"

// Xterm imports
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"

export default function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const activeTab = searchParams.get("tab") || "overview"

  const [vps, setVps] = React.useState<VpsRecord | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [copiedField, setCopiedField] = React.useState<string | null>(null)

  // Live telemetry
  const [telemetry, setTelemetry] = React.useState<{
    uptime?: number
    cpus?: number
    memoryMb?: number
    maxmemMb?: number
    maxdiskGb?: number
    lastSyncedAt?: string
  } | null>(null)

  // Power action state
  const [powerLoading, setPowerLoading] = React.useState(false)
  const [confirmDialog, setConfirmDialog] = React.useState<{
    open: boolean
    action: "stop" | "force-stop" | "reboot"
  }>({ open: false, action: "stop" })

  // Settings form states
  const [editName, setEditName] = React.useState("")
  const [editDescription, setEditDescription] = React.useState("")
  const [isSavingMetadata, setIsSavingMetadata] = React.useState(false)

  // Password reset dialog
  const [passwordDialogOpen, setPasswordDialogOpen] = React.useState(false)
  const [newPassword, setNewPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [isResettingPassword, setIsResettingPassword] = React.useState(false)

  // Reinstall dialog & states
  const [reinstallDialogOpen, setReinstallDialogOpen] = React.useState(false)
  const [reinstallTemplate, setReinstallTemplate] = React.useState("")
  const [reinstallPassword, setReinstallPassword] = React.useState("")
  const [reinstallSshKey, setReinstallSshKey] = React.useState("")
  const [confirmHostnameInput, setConfirmHostnameInput] = React.useState("")
  const [isReinstalling, setIsReinstalling] = React.useState(false)
  const [availableTemplates, setAvailableTemplates] = React.useState<
    Array<{ volid: string; size: number }>
  >([])

  // Operations history
  const [operations, setOperations] = React.useState<any[]>([])

  // Load VPS details
  const fetchVps = React.useCallback(async (showToast = false) => {
    if (!id) return
    try {
      if (showToast) setIsRefreshing(true)
      const res = await fetch(`/api/vps/${id}`)
      if (!res.ok) {
        if (res.status === 403) throw new Error("Access denied. You do not own this instance.")
        if (res.status === 404) throw new Error("VPS instance not found.")
        throw new Error("Failed to load instance.")
      }
      const data = await res.json()
      setVps(data.instance)
      setEditName(data.instance.name || "")
      setEditDescription(data.instance.description || "")

      if (showToast) toast.success("Instance details synchronized.")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      if (showToast) toast.error(msg)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [id])

  // Load live status & telemetry
  const fetchTelemetry = React.useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(`/api/vps/${id}/status`)
      if (res.ok) {
        const data = await res.json()
        setTelemetry(data)
        if (data.status && vps && vps.status !== data.status) {
          setVps((prev) => (prev ? { ...prev, status: data.status } : null))
        }
      }
    } catch {}
  }, [id, vps])

  // Load operations
  const fetchOperations = React.useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(`/api/vps/${id}/operations`)
      if (res.ok) {
        const data = await res.json()
        setOperations(data.operations || [])
      }
    } catch {}
  }, [id])

  React.useEffect(() => {
    fetchVps()
    fetchTelemetry()
    fetchOperations()
  }, [fetchVps, fetchTelemetry, fetchOperations])

  // Load node templates when opening reinstall dialog
  React.useEffect(() => {
    if (!reinstallDialogOpen || !vps?.proxmox_node_id) return
    async function loadTemplates() {
      try {
        const res = await fetch(`/api/admin/nodes/${vps?.proxmox_node_id}/capabilities`)
        if (res.ok) {
          const data = await res.json()
          const tmpls = data.templates || []
          setAvailableTemplates(tmpls)
          if (tmpls.length && !reinstallTemplate) {
            setReinstallTemplate(tmpls[0].volid)
          }
        }
      } catch {}
    }
    loadTemplates()
  }, [reinstallDialogOpen, vps?.proxmox_node_id, reinstallTemplate])

  // Helper for CSRF header
  const getCsrfHeader = async (): Promise<Record<string, string>> => {
    try {
      const res = await fetch("/api/auth/csrf")
      if (res.ok) {
        const data = await res.json()
        if (data.token) {
          return { "x-csrf-token": String(data.token) }
        }
      }
    } catch {}
    return {}
  }

  // Power action handler
  const handlePowerAction = async (action: "start" | "stop" | "force-stop" | "reboot") => {
    if (!id) return
    setPowerLoading(true)
    try {
      const csrf = await getCsrfHeader()
      const isForce = action === "force-stop"
      const payloadAction = isForce ? "stop" : action

      const res = await fetch(`/api/vps/${id}/power`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...csrf,
        },
        body: JSON.stringify({ action: payloadAction, force: isForce }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Operation failed.")

      toast.success(`Power command '${action}' completed.`)
      await fetchVps()
      await fetchTelemetry()
      await fetchOperations()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    } finally {
      setPowerLoading(false)
      setConfirmDialog({ open: false, action: "stop" })
    }
  }

  // Metadata update handler
  const handleSaveMetadata = async () => {
    if (!id) return
    setIsSavingMetadata(true)
    try {
      const csrf = await getCsrfHeader()
      const res = await fetch(`/api/vps/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...csrf,
        },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim(),
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update metadata.")

      toast.success("Display Name & Description updated.")
      await fetchVps()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    } finally {
      setIsSavingMetadata(false)
    }
  }

  // Password reset handler
  const handleResetPassword = async () => {
    if (!id) return
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters.")
      return
    }

    setIsResettingPassword(true)
    try {
      const csrf = await getCsrfHeader()
      const res = await fetch(`/api/vps/${id}/password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...csrf,
        },
        body: JSON.stringify({ password: newPassword }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to reset password.")

      toast.success("Root password updated successfully on hypervisor.")
      setPasswordDialogOpen(false)
      setNewPassword("")
      await fetchOperations()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    } finally {
      setIsResettingPassword(false)
    }
  }

  // Reinstall handler
  const handleReinstall = async () => {
    if (!id || !vps) return
    if (confirmHostnameInput.trim() !== vps.hostname.trim()) {
      toast.error(`Confirmation mismatch: Please type '${vps.hostname}'.`)
      return
    }

    setIsReinstalling(true)
    try {
      const csrf = await getCsrfHeader()
      const res = await fetch(`/api/vps/${id}/reinstall`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...csrf,
        },
        body: JSON.stringify({
          template: reinstallTemplate,
          rootPassword: reinstallPassword.trim() || undefined,
          sshKey: reinstallSshKey.trim() || undefined,
          confirmHostname: confirmHostnameInput.trim(),
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to reinstall VPS.")

      toast.success("VPS reinstalled and restored successfully.")
      setReinstallDialogOpen(false)
      setConfirmHostnameInput("")
      await fetchVps()
      await fetchTelemetry()
      await fetchOperations()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    } finally {
      setIsReinstalling(false)
    }
  }

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    toast.success(`Copied ${field} to clipboard`)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const formatUptime = (seconds?: number) => {
    if (!seconds || seconds <= 0) return "—"
    const d = Math.floor(seconds / (3600 * 24))
    const h = Math.floor((seconds % (3600 * 24)) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (d > 0) return `${d}d ${h}h ${m}m`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  // Terminal Reference for Console tab
  const terminalRef = React.useRef<HTMLDivElement>(null)
  const xtermInstance = React.useRef<Terminal | null>(null)
  const fitAddonInstance = React.useRef<FitAddon | null>(null)
  const wsInstance = React.useRef<WebSocket | null>(null)
  const [consoleConnected, setConsoleConnected] = React.useState(false)

  // Initialize and tear down interactive console
  const connectConsole = React.useCallback(() => {
    if (!terminalRef.current || !id) return

    // Clean previous socket and terminal
    if (wsInstance.current) {
      wsInstance.current.close()
      wsInstance.current = null
    }
    if (xtermInstance.current) {
      xtermInstance.current.dispose()
      xtermInstance.current = null
    }

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#09090b",
        foreground: "#f4f4f5",
        cursor: "#3b82f6",
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    fitAddon.fit()

    xtermInstance.current = term
    fitAddonInstance.current = fitAddon

    term.writeln("\x1b[38;5;244mEstablishing secure encrypted connection to LXC terminal...\x1b[0m")

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const wsUrl = `${protocol}//${window.location.host}/api/vps/${id}/console/ws`
    const ws = new WebSocket(wsUrl)
    wsInstance.current = ws

    ws.onopen = () => {
      setConsoleConnected(true)
      term.writeln("\x1b[32m✔ Connected to hypervisor termproxy.\x1b[0m\r\n")
      term.focus()
    }

    ws.onmessage = (event) => {
      term.write(event.data)
    }

    ws.onerror = () => {
      term.writeln("\r\n\x1b[31m[WebSocket connection error]\x1b[0m")
      setConsoleConnected(false)
    }

    ws.onclose = (e) => {
      term.writeln(`\r\n\x1b[38;5;244m[Console session disconnected (code: ${e.code})]\x1b[0m`)
      setConsoleConnected(false)
    }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })
  }, [id])

  React.useEffect(() => {
    if (activeTab === "console" && vps?.status === "running") {
      const timer = setTimeout(() => {
        connectConsole()
      }, 100)
      return () => {
        clearTimeout(timer)
        if (wsInstance.current) {
          wsInstance.current.close()
          wsInstance.current = null
        }
        if (xtermInstance.current) {
          xtermInstance.current.dispose()
          xtermInstance.current = null
        }
      }
    }
  }, [activeTab, vps?.status, connectConsole])

  // Handle terminal fit on resize
  React.useEffect(() => {
    const handleResize = () => {
      if (fitAddonInstance.current && activeTab === "console") {
        try {
          fitAddonInstance.current.fit()
        } catch {}
      }
    }
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [activeTab])

  if (isLoading) {
    return (
      <BaseLayout>
        <div className="py-24 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm font-mono">Loading VPS instance management plane...</p>
        </div>
      </BaseLayout>
    )
  }

  if (error || !vps) {
    return (
      <BaseLayout>
        <div className="py-20 flex flex-col items-center justify-center gap-3 text-destructive max-w-md mx-auto text-center">
          <AlertTriangle className="size-8" />
          <h3 className="font-semibold text-base">Unable to load VPS</h3>
          <p className="text-xs text-muted-foreground">{error || "The requested VPS could not be found."}</p>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/instances")}>
              <ChevronLeft className="size-4 mr-1" /> Back to Instances
            </Button>
            <Button size="sm" onClick={() => fetchVps(true)}>
              Retry
            </Button>
          </div>
        </div>
      </BaseLayout>
    )
  }

  const isRunning = vps.status === "running"
  const isStopped = vps.status === "stopped"
  const isBusy = vps.lock_state !== null && vps.lock_state !== undefined

  return (
    <BaseLayout>
      <div className="space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            to="/instances"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="size-4" /> Back to Instances
          </Link>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => {
                fetchVps(true)
                fetchTelemetry()
                fetchOperations()
              }}
              disabled={isRefreshing}
            >
              <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              <span>Refresh Status</span>
            </Button>
          </div>
        </div>

        {/* Management Header Card */}
        <div className="p-6 rounded-lg border border-border bg-card shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-foreground font-mono">
                {vps.hostname}
              </h1>
              <Badge
                variant={
                  isRunning
                    ? "default"
                    : isStopped
                    ? "secondary"
                    : isBusy
                    ? "outline"
                    : "destructive"
                }
                className="gap-1.5 capitalize text-xs"
              >
                <span
                  className={`size-2 rounded-full ${
                    isRunning
                      ? "bg-emerald-400 animate-pulse"
                      : isStopped
                      ? "bg-zinc-400"
                      : "bg-amber-400 animate-pulse"
                  }`}
                />
                {isBusy ? `Busy (${vps.lock_state})` : vps.status}
              </Badge>
              <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                VMID: {vps.proxmox_vmid}
              </Badge>
              {vps.node_name && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  {vps.node_flag_url && (
                    <img
                      src={vps.node_flag_url}
                      alt=""
                      className="w-3.5 h-2 object-cover rounded-[1px] shrink-0"
                    />
                  )}
                  <span>{vps.node_name}</span>
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {vps.name} {vps.description ? `• ${vps.description}` : ""}
            </p>
          </div>

          {/* Real Power Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {isRunning ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={powerLoading || isBusy}
                    >
                      <Power className="size-3.5" /> Stop / Shutdown
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => setConfirmDialog({ open: true, action: "stop" })}
                      className="text-xs"
                    >
                      Graceful Shutdown (ACPI)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setConfirmDialog({ open: true, action: "force-stop" })}
                      className="text-xs text-destructive"
                    >
                      Force Stop (Immediate)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={() => setConfirmDialog({ open: true, action: "reboot" })}
                  disabled={powerLoading || isBusy}
                >
                  <RefreshCw className="size-3.5" /> Reboot
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => handlePowerAction("start")}
                disabled={powerLoading || isBusy}
              >
                {powerLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Power className="size-3.5" />
                )}
                Start VPS
              </Button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <Tabs
          value={activeTab}
          onValueChange={(val) => setSearchParams({ tab: val })}
          className="space-y-4"
        >
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="overview" className="gap-1.5 text-xs">
              <LayoutDashboard className="size-3.5" /> Overview
            </TabsTrigger>
            <TabsTrigger value="console" className="gap-1.5 text-xs">
              <TerminalIcon className="size-3.5" /> Console
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5 text-xs">
              <SettingsIcon className="size-3.5" /> Settings
            </TabsTrigger>
          </TabsList>

          {/* ============================================================ */}
          {/* TAB 1: OVERVIEW */}
          {/* ============================================================ */}
          <TabsContent value="overview" className="space-y-6">
            {/* Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardDescription className="text-xs flex items-center justify-between">
                    <span>vCPU Allocation</span>
                    <Cpu className="size-4 text-primary" />
                  </CardDescription>
                  <CardTitle className="text-2xl font-mono">{vps.cpu_cores} Cores</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 text-[11px] text-muted-foreground">
                  Proxmox LXC dedicated execution limit
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardDescription className="text-xs flex items-center justify-between">
                    <span>Memory (RAM)</span>
                    <Server className="size-4 text-primary" />
                  </CardDescription>
                  <CardTitle className="text-2xl font-mono">{vps.memory_mb} MB</CardTitle>
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
                    <span>Hypervisor Uptime</span>
                    <Clock className="size-4 text-primary" />
                  </CardDescription>
                  <CardTitle className="text-2xl font-mono">
                    {formatUptime(telemetry?.uptime)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 text-[11px] text-muted-foreground">
                  Live state from Proxmox VE
                </CardContent>
              </Card>
            </div>

            {/* Infrastructure & Network Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Network Details */}
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
                          className="h-6 w-6"
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
                    <span className="font-mono text-muted-foreground">
                      {vps.ipv6_address || "Not configured"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1.5 border-b">
                    <span className="text-muted-foreground">Interface</span>
                    <span className="font-mono font-medium">eth0 (virtio)</span>
                  </div>

                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-muted-foreground">Bridge Adapter</span>
                    <span className="font-mono font-medium">vmbr0</span>
                  </div>
                </CardContent>
              </Card>

              {/* System & Hypervisor Specs */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Server className="size-4 text-primary" /> System & Hypervisor Details
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Underlying container specifications and node binding.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div className="flex items-center justify-between py-1.5 border-b">
                    <span className="text-muted-foreground">OS Image</span>
                    <span className="font-mono font-medium truncate max-w-[200px]" title={vps.os_image_id}>
                      {vps.os_image_id.split("/").pop() || vps.os_image_id}
                    </span>
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
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1.5 border-b">
                    <span className="text-muted-foreground">Cluster VMID</span>
                    <span className="font-mono font-medium">{vps.proxmox_vmid}</span>
                  </div>

                  {isAdmin && (
                    <div className="flex items-center justify-between py-1.5 border-b">
                      <span className="text-muted-foreground">Assigned User</span>
                      <span className="font-medium">
                        {vps.owner_global_name || vps.owner_username || "—"}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-muted-foreground">Last Sync</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {vps.last_proxmox_sync_at
                        ? new Date(vps.last_proxmox_sync_at).toLocaleString()
                        : "Never"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Recent Operations Log */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="size-4 text-primary" /> Lifecycle Operation Audit Log
                </CardTitle>
                <CardDescription className="text-xs">
                  Audited state mutations executed on this instance.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {operations.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    No lifecycle operations recorded yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {operations.map((op) => (
                      <div
                        key={op.id}
                        className="flex items-center justify-between p-2.5 rounded border bg-muted/20 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`size-2 rounded-full ${
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
                          <span className="text-muted-foreground">({op.current_step})</span>
                        </div>
                        <span className="text-muted-foreground font-mono text-[11px]">
                          {new Date(op.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================ */}
          {/* TAB 2: INTERACTIVE CONSOLE */}
          {/* ============================================================ */}
          <TabsContent value="console" className="space-y-4">
            <Card className="border-border overflow-hidden">
              <CardHeader className="bg-zinc-950 p-4 border-b border-zinc-800 flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <TerminalIcon className="size-4 text-zinc-400" />
                  <span className="text-xs font-mono text-zinc-200">
                    root@{vps.hostname}:~# (xterm.js termproxy)
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 h-4 border-zinc-700 font-mono ${
                      consoleConnected ? "text-emerald-400" : "text-zinc-500"
                    }`}
                  >
                    {consoleConnected ? "LIVE SOCKET" : "DISCONNECTED"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                    onClick={() => {
                      if (xtermInstance.current) {
                        xtermInstance.current.clear()
                      }
                    }}
                  >
                    Clear
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    onClick={connectConsole}
                    disabled={!isRunning}
                  >
                    Reconnect
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="p-0 bg-zinc-950 min-h-[480px]">
                {isStopped ? (
                  <div className="py-28 flex flex-col items-center justify-center space-y-3 text-center px-4">
                    <Power className="size-8 text-zinc-600" />
                    <h4 className="font-semibold text-sm text-zinc-300">VPS is Stopped</h4>
                    <p className="text-xs text-zinc-500 max-w-sm">
                      Start the container to establish a live interactive console session.
                    </p>
                    <Button
                      size="sm"
                      className="mt-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => handlePowerAction("start")}
                      disabled={powerLoading}
                    >
                      Start Container
                    </Button>
                  </div>
                ) : (
                  <div ref={terminalRef} className="p-4 h-[480px] w-full" />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================ */}
          {/* TAB 3: SETTINGS */}
          {/* ============================================================ */}
          <TabsContent value="settings" className="space-y-6">
            {/* General Metadata Editor */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">General Metadata</CardTitle>
                <CardDescription className="text-xs">
                  Update control plane display labels. Changing the display label does not modify the Linux hostname.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Display Name</Label>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="e.g. Production Web Frontend"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Description / Notes</Label>
                  <Textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Describe purpose or services hosted on this VPS"
                    className="h-20 resize-none text-xs"
                  />
                </div>
              </CardContent>
              <CardFooter className="border-t p-4 flex justify-end">
                <Button size="sm" onClick={handleSaveMetadata} disabled={isSavingMetadata}>
                  {isSavingMetadata && <Loader2 className="size-3.5 animate-spin mr-1" />}
                  Save Changes
                </Button>
              </CardFooter>
            </Card>

            {/* Authentication & Root Password */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Authentication & Credentials</CardTitle>
                <CardDescription className="text-xs">
                  Configure root password directly on the Proxmox hypervisor.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Reset the Linux root password. The password is submitted to the hypervisor and is never stored on InterDash servers.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setPasswordDialogOpen(true)}
                >
                  <Key className="size-3.5" /> Change Root Password
                </Button>
              </CardContent>
            </Card>

            {/* Danger Zone: Destructive OS Reinstall */}
            <Card className="border-destructive/40 bg-destructive/5">
              <CardHeader>
                <CardTitle className="text-base text-destructive flex items-center gap-2">
                  <ShieldAlert className="size-5" /> Danger Zone: Destructive OS Reinstall
                </CardTitle>
                <CardDescription className="text-xs text-destructive/80">
                  Reinstalling will wipe all existing filesystem data and rebuild the container with a clean OS template.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  This action destroys all applications, databases, and local files on the container. The VMID, IP address, and hardware specs will be preserved.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setReinstallDialogOpen(true)}
                  disabled={isBusy}
                >
                  Reinstall Operating System
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Confirmation Dialog for Stop / Reboot */}
      <Dialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog({ ...confirmDialog, open })}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-500" /> Confirm Power Action
            </DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to{" "}
              <strong className="text-foreground">
                {confirmDialog.action === "reboot"
                  ? "reboot"
                  : confirmDialog.action === "force-stop"
                  ? "force stop"
                  : "gracefully shut down"}
              </strong>{" "}
              instance <code className="font-mono text-foreground">{vps.hostname}</code>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDialog({ open: false, action: "stop" })}
            >
              Cancel
            </Button>
            <Button
              variant={confirmDialog.action.includes("stop") ? "destructive" : "default"}
              size="sm"
              onClick={() => handlePowerAction(confirmDialog.action)}
              disabled={powerLoading}
            >
              {powerLoading && <Loader2 className="size-3 animate-spin mr-1" />}
              Confirm Action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Root Password Dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="size-5 text-primary" /> Change Root Password
            </DialogTitle>
            <DialogDescription className="text-xs">
              Set a new root password for <code className="font-mono">{vps.hostname}</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>New Root Password</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[11px] gap-1 text-primary"
                  onClick={() => {
                    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*"
                    let pass = ""
                    for (let i = 0; i < 16; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length))
                    setNewPassword(pass)
                    setShowPassword(true)
                  }}
                >
                  <Sparkles className="size-3" /> Auto-Generate
                </Button>
              </div>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Minimum 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full w-9 text-muted-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPasswordDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleResetPassword}
              disabled={isResettingPassword || newPassword.length < 8}
            >
              {isResettingPassword && <Loader2 className="size-3 animate-spin mr-1" />}
              Apply Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Destructive Reinstall Dialog */}
      <Dialog open={reinstallDialogOpen} onOpenChange={setReinstallDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <ShieldAlert className="size-5" /> Confirm Destructive Reinstall
            </DialogTitle>
            <DialogDescription className="text-xs text-foreground/90">
              Reinstalling this VPS will erase the existing filesystem and applications. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-1.5">
              <Label>Target OS Template</Label>
              <Select value={reinstallTemplate} onValueChange={setReinstallTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Select OS template" />
                </SelectTrigger>
                <SelectContent>
                  {availableTemplates.map((t) => (
                    <SelectItem key={t.volid} value={t.volid}>
                      {t.volid.split("/").pop()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>New Root Password (Optional)</Label>
              <Input
                type="password"
                placeholder="Leave blank to generate securely"
                value={reinstallPassword}
                onChange={(e) => setReinstallPassword(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>New SSH Public Key (Optional)</Label>
              <Textarea
                placeholder="ssh-ed25519 AAAAC3... key"
                value={reinstallSshKey}
                onChange={(e) => setReinstallSshKey(e.target.value)}
                className="font-mono text-[11px] h-14 resize-none"
              />
            </div>

            <div className="space-y-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <Label className="text-destructive font-semibold">
                Type "{vps.hostname}" to confirm destructive reinstall:
              </Label>
              <Input
                value={confirmHostnameInput}
                onChange={(e) => setConfirmHostnameInput(e.target.value)}
                placeholder={vps.hostname}
                className="font-mono text-xs border-destructive/40"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setReinstallDialogOpen(false)
                setConfirmHostnameInput("")
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleReinstall}
              disabled={
                isReinstalling ||
                confirmHostnameInput.trim() !== vps.hostname.trim() ||
                !reinstallTemplate
              }
            >
              {isReinstalling && <Loader2 className="size-3 animate-spin mr-1" />}
              Erase & Reinstall
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BaseLayout>
  )
}
