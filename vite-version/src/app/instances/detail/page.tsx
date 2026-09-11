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
  Info,
  ChevronDown,
  ChevronUp,
  Trash2,
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
import type {
  ConsoleState,
  ConsoleControlMessage,
  ConsoleError,
  ConsoleDiagnostic,
} from "@/types/console"

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
  const [copiedField, setCopiedField] = React.useState<string | null>(null)

  // Separated Error Architecture (Phase 2)
  const [pageLoadError, setPageLoadError] = React.useState<string | null>(null)
  const [runtimeSyncError, setRuntimeSyncError] = React.useState<string | null>(null)
  const [operationsSyncError, setOperationsSyncError] = React.useState<string | null>(null)

  // Live hypervisor runtime state (Phase 11)
  const [runtime, setRuntime] = React.useState<{
    status?: string
    uptime?: number
    cpus?: number
    memoryMb?: number
    maxmemMb?: number
    maxdiskGb?: number
    runtimeNode?: string
    runtimeNodeSource?: "direct" | "cluster" | "configured"
    lastVerifiedAt?: string
    fresh: boolean
    error?: string | null
  }>({
    fresh: true,
    error: null,
  })

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
    Array<{ volid: string; sizeBytes?: number; osFamily?: string; version?: string }>
  >([])

  // Operations history
  const [operations, setOperations] = React.useState<any[]>([])

  // Delete VPS Dialog & Operation State (Phase 10 & 13)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [deleteConfirmHostname, setDeleteConfirmHostname] = React.useState("")
  const [isDeletingVps, setIsDeletingVps] = React.useState(false)
  const [deleteOperation, setDeleteOperation] = React.useState<{
    id: string
    status: string
    current_step: string
    error?: string | null
  } | null>(null)

  // Console Subsystem State Machine
  const [consoleState, setConsoleState] = React.useState<ConsoleState>("idle")
  const [consoleStatusMessage, setConsoleStatusMessage] = React.useState<string>("Ready to connect")
  const [consoleError, setConsoleError] = React.useState<ConsoleError | null>(null)
  const [consoleDiagnostic, setConsoleDiagnostic] = React.useState<ConsoleDiagnostic | null>(null)
  const [showDiagnosticsPanel, setShowDiagnosticsPanel] = React.useState(false)
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = React.useState(false)

  // Terminal Reference for Console tab
  const terminalRef = React.useRef<HTMLDivElement>(null)
  const xtermInstance = React.useRef<Terminal | null>(null)
  const fitAddonInstance = React.useRef<FitAddon | null>(null)
  const wsInstance = React.useRef<WebSocket | null>(null)

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

  // 1. Initial Load: VPS metadata (does not depend on runtime telemetry)
  const loadVps = React.useCallback(async (showToast = false) => {
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
      setPageLoadError(null)

      if (showToast) toast.success("Instance details synchronized.")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // Only set pageLoadError if no VPS loaded yet
      setPageLoadError((prev) => (vps ? prev : msg))
      if (showToast) toast.error(msg)
    } finally {
      setIsLoading(false)
      if (showToast) setIsRefreshing(false)
    }
  }, [id, vps])

  // 2. Background Runtime Status: Polls only /api/vps/:id/status (Phase 10 & 12)
  const loadRuntimeStatus = React.useCallback(async (showToast = false) => {
    if (!id) return
    try {
      const res = await fetch(`/api/vps/${id}/status`)
      if (res.ok) {
        const data = await res.json()
        setRuntime({
          status: data.status,
          uptime: data.uptime,
          cpus: data.cpus,
          memoryMb: data.memoryMb,
          maxmemMb: data.maxMemoryMb || data.maxmem,
          maxdiskGb: data.maxDiskGb || data.maxdisk,
          runtimeNode: data.runtimeNode,
          runtimeNodeSource: data.runtimeNodeSource,
          lastVerifiedAt: data.lastVerifiedAt || (data.fresh ? new Date().toISOString() : undefined),
          fresh: data.fresh !== false,
          error: data.fresh === false ? (data.error || "Hypervisor node unreachable") : null,
        })
        if (data.fresh !== false) {
          setRuntimeSyncError(null)
          if (showToast) toast.success("Hypervisor runtime status verified.")
        } else {
          setRuntimeSyncError(data.error || "Current hypervisor state could not be refreshed.")
          if (showToast) toast.error(data.error || "Hypervisor unreachable.")
        }
      } else {
        const errText = await res.text()
        let msg = "Current hypervisor state could not be refreshed."
        try {
          const parsed = JSON.parse(errText)
          if (parsed.error) msg = parsed.error
        } catch {}
        setRuntime((prev) => ({
          ...prev,
          fresh: false,
          error: msg,
        }))
        setRuntimeSyncError(msg)
        if (showToast) toast.error(msg)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setRuntime((prev) => ({
        ...prev,
        fresh: false,
        error: msg,
      }))
      setRuntimeSyncError(msg)
      if (showToast) toast.error(msg)
    }
  }, [id])

  // 3. Load Operations History (Phase 33)
  const loadOperations = React.useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(`/api/vps/${id}/operations`)
      if (res.ok) {
        const data = await res.json()
        setOperations(data.operations || [])
        setOperationsSyncError(null)
      } else {
        setOperationsSyncError("Operation history unavailable.")
      }
    } catch (err: unknown) {
      setOperationsSyncError("Operation history unavailable.")
    }
  }, [id])

  // Fetch backend console diagnostic
  const fetchConsoleDiagnostic = React.useCallback(async () => {
    if (!id) return
    setIsLoadingDiagnostics(true)
    try {
      const res = await fetch(`/api/vps/${id}/console/diagnostic`)
      if (res.ok) {
        const diag: ConsoleDiagnostic = await res.json()
        setConsoleDiagnostic(diag)
      }
    } catch (diagErr) {
      console.error("Failed to fetch console diagnostic:", diagErr)
    } finally {
      setIsLoadingDiagnostics(false)
    }
  }, [id])

  // EXACTLY ONE INITIAL LOADING SEQUENCE ON VPS ID CHANGE (Phase 1)
  React.useEffect(() => {
    if (!id) return
    setIsLoading(true)
    loadVps()
    loadRuntimeStatus()
    loadOperations()
  }, [id])

  // 15-SECOND BACKGROUND RUNTIME POLLING (Phase 1 & Phase 12)
  React.useEffect(() => {
    if (!id) return

    let intervalId: NodeJS.Timeout | null = null

    const startPolling = () => {
      if (intervalId) clearInterval(intervalId)
      intervalId = setInterval(() => {
        if (document.visibilityState === "visible") {
          loadRuntimeStatus()
        }
      }, 15000)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadRuntimeStatus()
        startPolling()
      } else {
        if (intervalId) {
          clearInterval(intervalId)
          intervalId = null
        }
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    startPolling()

    return () => {
      if (intervalId) clearInterval(intervalId)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [id, loadRuntimeStatus])

  // Load node templates via user-authorized reinstall endpoint (Fixes Part 29)
  React.useEffect(() => {
    if (!reinstallDialogOpen || !id) return
    async function loadTemplates() {
      try {
        const res = await fetch(`/api/vps/${id}/reinstall/capabilities`)
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
  }, [reinstallDialogOpen, id, reinstallTemplate])

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
      await loadVps()
      await loadRuntimeStatus()
      await loadOperations()
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
      await loadVps()
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
      await loadOperations()
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
      await loadVps()
      await loadRuntimeStatus()
      await loadOperations()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    } finally {
      setIsReinstalling(false)
    }
  }

  // Poll delete operation progress (Phase 10 & 13)
  const pollDeleteOperation = React.useCallback(
    (operationId: string) => {
      const pollInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/vps/${id}/operations/${operationId}`)
          if (!res.ok) return
          const data = await res.json()
          const op = data.operation
          if (op) {
            setDeleteOperation(op)
            if (op.status === "completed") {
              clearInterval(pollInterval)
              setIsDeletingVps(false)
              toast.success("VPS instance permanently deleted.")
              navigate("/instances")
            } else if (op.status === "failed") {
              clearInterval(pollInterval)
              setIsDeletingVps(false)
              toast.error(op.error || "VPS deletion failed on hypervisor.")
            } else if (op.status === "recovery_required") {
              clearInterval(pollInterval)
              setIsDeletingVps(false)
              toast.error("Proxmox container destroyed but recovery required for final database/network cleanup.")
            }
          }
        } catch (err) {
          console.error("Error polling delete operation:", err)
        }
      }, 1500)
    },
    [id, navigate]
  )

  // Handle Delete VPS confirmation
  const handleDeleteVps = async () => {
    if (!vps || !id) return
    if (deleteConfirmHostname.trim() !== vps.hostname.trim()) {
      toast.error(`Confirmation mismatch: Please type '${vps.hostname}'.`)
      return
    }

    setIsDeletingVps(true)
    try {
      const csrf = await getCsrfHeader()
      const res = await fetch(`/api/vps/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...csrf,
        },
        body: JSON.stringify({
          confirmHostname: deleteConfirmHostname.trim(),
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to initiate VPS deletion.")

      toast.info("VPS destruction operation queued.")
      setDeleteOperation({
        id: data.operationId,
        status: data.status || "queued",
        current_step: "queued",
      })

      pollDeleteOperation(data.operationId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
      setIsDeletingVps(false)
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

  // Format bytes into GB or MB
  const formatBytes = (bytes?: number) => {
    if (!bytes) return "—"
    const gb = bytes / (1024 * 1024 * 1024)
    if (gb >= 1) return `${gb.toFixed(1)} GB`
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(0)} MB`
  }

  // Send terminal resize message according to Proxmox protocol 1:<cols>:<rows>:
  const sendResize = React.useCallback((cols: number, rows: number) => {
    if (wsInstance.current && wsInstance.current.readyState === WebSocket.OPEN) {
      wsInstance.current.send(`1:${cols}:${rows}:`)
    }
  }, [])

  // Connect Console with strict state machine & no premature success
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

    setConsoleState("connecting")
    setConsoleStatusMessage("Connecting to InterDash console gateway...")
    setConsoleError(null)

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

    // Initial neutral connection banner
    term.writeln("\x1b[38;5;244m[Connecting to InterDash console gateway...]\x1b[0m")

    // Forward keystrokes directly to WebSocket once connected
    term.onData((data) => {
      if (wsInstance.current && wsInstance.current.readyState === WebSocket.OPEN) {
        wsInstance.current.send(data)
      }
    })

    // Listen for terminal resize and notify backend
    term.onResize(({ cols, rows }) => {
      sendResize(cols, rows)
    })

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const wsUrl = `${protocol}//${window.location.host}/api/vps/${id}/console/ws`
    const ws = new WebSocket(wsUrl)
    wsInstance.current = ws

    ws.onopen = () => {
      // NOTE: InterDash WebSocket is open, but do NOT mark as "Connected to Hypervisor" yet!
      setConsoleState("checking_runtime")
      setConsoleStatusMessage("Checking VPS runtime state...")
      term.writeln("\x1b[38;5;244m[InterDash gateway established. Checking VPS runtime state...]\x1b[0m")
    }

    ws.onmessage = (event) => {
      const dataStr = typeof event.data === "string" ? event.data : ""

      // Check if this is a structured backend control message
      if (dataStr.startsWith("{")) {
        try {
          const ctrl: ConsoleControlMessage = JSON.parse(dataStr)

          if (ctrl.type === "status" && ctrl.state) {
            setConsoleState(ctrl.state)
            if (ctrl.message) {
              setConsoleStatusMessage(ctrl.message)
            }

            if (ctrl.state === "connected") {
              setConsoleStatusMessage("Terminal connected.")
              term.writeln("\x1b[32m✔ Connected to LXC terminal.\x1b[0m\r\n")
              term.focus()
              // Send initial terminal dimensions
              if (fitAddonInstance.current && xtermInstance.current) {
                fitAddonInstance.current.fit()
                sendResize(xtermInstance.current.cols, xtermInstance.current.rows)
              }
            } else {
              term.writeln(`\x1b[38;5;244m[${ctrl.message || ctrl.state}]\x1b[0m`)
            }
            return
          }

          if (ctrl.type === "error") {
            setConsoleState(ctrl.state || "failed")
            setConsoleStatusMessage(ctrl.message || "Console connection failed.")
            setConsoleError({
              code: ctrl.code || "CONSOLE_ERROR",
              message: ctrl.message || "Console error occurred.",
              details: ctrl.details,
              diagnosticId: ctrl.diagnosticId,
            })
            // Fetch backend diagnostic for detailed cause
            fetchConsoleDiagnostic()
            return
          }
        } catch {
          // Not JSON control message; proceed to write terminal raw data
        }
      }

      // Raw terminal output from Proxmox VE
      term.write(event.data)
    }

    ws.onerror = () => {
      setConsoleState("failed")
      setConsoleStatusMessage("WebSocket stream connection error.")
      setConsoleError({
        code: "WEBSOCKET_ERROR",
        message: "Failed to connect to the InterDash console WebSocket gateway.",
      })
      fetchConsoleDiagnostic()
    }

    ws.onclose = (e) => {
      setConsoleState((prev) => {
        if (prev !== "failed" && prev !== "stopped") {
          setConsoleStatusMessage(`Session disconnected (code ${e.code}).`)
          return "disconnected"
        }
        return prev
      })
    }
  }, [id, sendResize, fetchConsoleDiagnostic])

  // Connect / disconnect on tab change (Phase 1 & Console Independence)
  React.useEffect(() => {
    if (activeTab === "console") {
      // Connect when entering console tab
      const timer = setTimeout(() => {
        connectConsole()
      }, 120)
      return () => clearTimeout(timer)
    } else {
      // Tear down when leaving console tab
      if (wsInstance.current) {
        wsInstance.current.close()
        wsInstance.current = null
      }
      if (xtermInstance.current) {
        xtermInstance.current.dispose()
        xtermInstance.current = null
      }
      setConsoleState("idle")
      setConsoleStatusMessage("Disconnected")
    }
  }, [activeTab, connectConsole])

  // Window resize handler for fitAddon
  React.useEffect(() => {
    const handleResize = () => {
      if (fitAddonInstance.current && xtermInstance.current) {
        try {
          fitAddonInstance.current.fit()
          sendResize(xtermInstance.current.cols, xtermInstance.current.rows)
        } catch {}
      }
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [sendResize])

  if (isLoading && !vps) {
    return (
      <BaseLayout>
        <div className="px-4 lg:px-6 py-24 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-xs">Loading instance telemetry...</p>
        </div>
      </BaseLayout>
    )
  }

  if (pageLoadError && !vps) {
    return (
      <BaseLayout>
        <div className="px-4 lg:px-6 py-20 flex flex-col items-center justify-center gap-3 text-destructive max-w-md mx-auto text-center">
          <AlertTriangle className="size-8" />
          <h3 className="font-semibold text-base">Unable to load VPS</h3>
          <p className="text-xs text-muted-foreground">{pageLoadError}</p>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/instances")}>
              <ChevronLeft className="size-4 mr-1" /> Back to Instances
            </Button>
            <Button size="sm" onClick={() => loadVps(true)}>
              Retry
            </Button>
          </div>
        </div>
      </BaseLayout>
    )
  }

  if (!vps) {
    return null
  }

  const currentStatus = runtime.status || vps.status
  const isRunning = currentStatus === "running"
  const isStopped = currentStatus === "stopped"
  const isBusy = Boolean(vps.lock_state)
  const canDelete = isAdmin || (Boolean(vps) && user?.id === vps?.owner_user_id)
  const activeOp = operations.find((o) => o.status === "queued" || o.status === "running")

  return (
    <BaseLayout>
      <div className="px-4 lg:px-6 space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            to="/instances"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="size-4" /> Back to Instances
          </Link>

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={async () => {
              setIsRefreshing(true)
              try {
                await Promise.all([loadVps(true), loadRuntimeStatus(true), loadOperations()])
              } finally {
                setIsRefreshing(false)
              }
            }}
            disabled={isRefreshing}
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>Refresh Status</span>
          </Button>
        </div>

        {/* Active Operation Recovery Banner (Phase 43) */}
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
              onClick={() => loadOperations()}
            >
              <RefreshCw className="size-3 mr-1" /> Refresh Op
            </Button>
          </div>
        )}

        {/* Subtle Runtime Sync Warning (Phase 2 & Phase 13) */}
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
              onClick={() => loadRuntimeStatus(true)}
            >
              <RefreshCw className="size-3 mr-1.5" /> Retry Sync
            </Button>
          </div>
        )}

        {/* Management Header Card — Strong Visual Hierarchy */}
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
          <div className="flex flex-wrap items-center gap-2">
            {isBusy ? (
              <Badge variant="outline" className="gap-1.5 text-xs py-1.5 px-3 border-amber-500/30 text-amber-500">
                <Loader2 className="size-3.5 animate-spin" />
                <span>Operation in progress...</span>
              </Badge>
            ) : isRunning ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={powerLoading}
                    >
                      <Power className="size-3.5" /> Stop / Shutdown
                      <ChevronDown className="size-3 opacity-60" />
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
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setConfirmDialog({ open: true, action: "reboot" })}
                  disabled={powerLoading}
                >
                  <RefreshCw className="size-3.5" /> Reboot
                </Button>
              </>
            ) : isStopped ? (
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => handlePowerAction("start")}
                disabled={powerLoading}
              >
                {powerLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Power className="size-3.5" />
                )}
                Start VPS
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => handlePowerAction("start")}
                  disabled={powerLoading}
                >
                  {powerLoading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Power className="size-3.5" />
                  )}
                  Start VPS
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={powerLoading}
                    >
                      <Power className="size-3.5" /> Stop / Shutdown
                      <ChevronDown className="size-3 opacity-60" />
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
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setConfirmDialog({ open: true, action: "reboot" })}
                  disabled={powerLoading}
                >
                  <RefreshCw className="size-3.5" /> Reboot
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Full-Width Workspace Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(val) => setSearchParams({ tab: val })}
          className="space-y-4"
        >
          <TabsList className="w-full grid grid-cols-3 max-w-2xl h-10">
            <TabsTrigger value="overview" className="gap-2 text-xs font-medium">
              <LayoutDashboard className="size-4" /> Overview
            </TabsTrigger>
            <TabsTrigger value="console" className="gap-2 text-xs font-medium">
              <TerminalIcon className="size-4" /> Console
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2 text-xs font-medium">
              <SettingsIcon className="size-4" /> Settings
            </TabsTrigger>
          </TabsList>

          {/* ============================================================ */}
          {/* TAB 1: OVERVIEW */}
          {/* ============================================================ */}
          <TabsContent value="overview" className="space-y-6">
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
          </TabsContent>

          {/* ============================================================ */}
          {/* TAB 2: INTERACTIVE CONSOLE */}
          {/* ============================================================ */}
          <TabsContent value="console" className="space-y-4">
            <Card className="border-border overflow-hidden">
              <CardHeader className="bg-zinc-950 p-4 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <TerminalIcon className="size-4 text-zinc-400" />
                  <span className="text-xs font-mono text-zinc-200">
                    root@{vps.hostname}:~#
                  </span>

                  {/* Real Status Badge based on state machine */}
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-2 py-0.5 border-zinc-700 font-mono gap-1.5 ${
                      consoleState === "connected"
                        ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                        : consoleState === "failed"
                        ? "text-red-400 border-red-500/30 bg-red-500/10"
                        : consoleState === "stopped"
                        ? "text-zinc-500 border-zinc-700"
                        : consoleState === "idle" || consoleState === "disconnected"
                        ? "text-zinc-400 border-zinc-800 bg-zinc-900/60"
                        : "text-amber-400 border-amber-500/30 bg-amber-500/10"
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        consoleState === "connected"
                          ? "bg-emerald-400"
                          : consoleState === "failed"
                          ? "bg-red-400"
                          : consoleState === "stopped" || consoleState === "idle" || consoleState === "disconnected"
                          ? "bg-zinc-500"
                          : "bg-amber-400 animate-pulse"
                      }`}
                    />
                    {consoleState === "connected"
                      ? "CONNECTED"
                      : consoleState === "failed"
                      ? "UNAVAILABLE"
                      : consoleState === "stopped"
                      ? "VPS STOPPED"
                      : consoleState === "idle" || consoleState === "disconnected"
                      ? "DISCONNECTED"
                      : "CONNECTING..."}
                  </Badge>

                  {consoleState !== "connected" && (
                    <span className="text-[11px] text-zinc-400 italic">
                      {consoleStatusMessage}
                    </span>
                  )}
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
                    disabled={
                      consoleState === "connecting" ||
                      consoleState === "requesting_termproxy" ||
                      consoleState === "connecting_upstream"
                    }
                  >
                    <RefreshCw className={`size-3 mr-1 ${consoleState === "connecting" ? "animate-spin" : ""}`} />
                    Reconnect
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="p-0 bg-zinc-950 min-h-[560px] relative">
                {isStopped ? (
                  <div className="py-32 flex flex-col items-center justify-center space-y-3 text-center px-4">
                    <Power className="size-8 text-zinc-600" />
                    <h4 className="font-semibold text-sm text-zinc-300">VPS is Stopped</h4>
                    <p className="text-xs text-zinc-500 max-w-sm">
                      Start the container to establish a live interactive terminal session.
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => handlePowerAction("start")}
                        disabled={powerLoading}
                      >
                        Start Container
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs"
                        onClick={connectConsole}
                      >
                        Connect Anyway
                      </Button>
                    </div>
                  </div>
                ) : consoleError || consoleState === "failed" ? (
                  <div className="p-6 max-w-2xl mx-auto my-12 rounded-lg border border-red-500/20 bg-red-950/20 text-zinc-200 space-y-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="size-6 text-red-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <h4 className="font-semibold text-base text-red-200">
                          Console Unavailable
                        </h4>
                        <p className="text-xs text-zinc-300">
                          {consoleError?.message || "Proxmox terminal proxy could not be created."}
                        </p>
                      </div>
                    </div>

                    {consoleError?.code && (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="border-red-500/40 text-red-400 font-mono text-[11px]">
                          {consoleError.code}
                        </Badge>
                      </div>
                    )}

                    {/* Actionable Guidance for Reverse Proxy & Cloudflare */}
                    <div className="rounded-md bg-zinc-900/80 p-3.5 border border-zinc-800 text-xs space-y-2">
                      <div className="flex items-center gap-2 font-medium text-zinc-200">
                        <Info className="size-4 text-blue-400" />
                        <span>Potential Cause & Resolution</span>
                      </div>
                      <p className="text-zinc-400 leading-relaxed">
                        Proxmox VE <code className="font-mono text-zinc-300">pveproxy</code> historically rejects
                        requests formatted with chunked transfer encoding with <code className="font-mono text-amber-400">HTTP 501 Not Implemented</code>.
                      </p>
                      {consoleDiagnostic?.recommendedFix && (
                        <div className="p-2.5 rounded bg-zinc-950 border border-zinc-700/60 font-mono text-[11px] text-amber-300 space-y-1">
                          <p className="font-sans font-medium text-zinc-300">Cloudflare Tunnel Origin Recommendation:</p>
                          <pre className="text-zinc-300 whitespace-pre-wrap">{consoleDiagnostic.recommendedFix}</pre>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-zinc-700 text-zinc-200 hover:bg-zinc-800 text-xs"
                          onClick={connectConsole}
                        >
                          <RefreshCw className="size-3.5 mr-1" /> Retry Connection
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs text-zinc-400 hover:text-zinc-200"
                          onClick={() => {
                            setShowDiagnosticsPanel(!showDiagnosticsPanel)
                            if (!consoleDiagnostic) fetchConsoleDiagnostic()
                          }}
                        >
                          {showDiagnosticsPanel ? (
                            <>
                              <ChevronUp className="size-3.5 mr-1" /> Hide Diagnostics
                            </>
                          ) : (
                            <>
                              <ChevronDown className="size-3.5 mr-1" /> View Diagnostics
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Expandable Diagnostic Panel */}
                    {showDiagnosticsPanel && (
                      <div className="p-3 rounded border border-zinc-800 bg-zinc-900 font-mono text-[11px] space-y-2 mt-2">
                        <div className="flex items-center justify-between text-zinc-400 border-b border-zinc-800 pb-1">
                          <span className="font-sans font-semibold text-zinc-200">Hypervisor Diagnostic Details</span>
                          {isLoadingDiagnostics && <Loader2 className="size-3 animate-spin text-primary" />}
                        </div>

                        {consoleDiagnostic ? (
                          <div className="space-y-1.5 text-zinc-300">
                            {consoleDiagnostic.endpoint && (
                              <p><span className="text-zinc-500">Endpoint:</span> {consoleDiagnostic.endpoint}</p>
                            )}
                            <p><span className="text-zinc-500">Status Code:</span> {consoleDiagnostic.statusCode || "501"}</p>
                            <p><span className="text-zinc-500">Classification:</span> {consoleDiagnostic.classification || "PROXMOX_501_TERM_PROXY"}</p>
                            <p><span className="text-zinc-500">Proxy Detected:</span> {consoleDiagnostic.proxied ? `Yes (${consoleDiagnostic.proxyType})` : "Direct / None"}</p>
                            {consoleDiagnostic.latencyMs !== undefined && (
                              <p><span className="text-zinc-500">Latency:</span> {consoleDiagnostic.latencyMs}ms</p>
                            )}
                            {consoleDiagnostic.responseSnippet && (
                              <div>
                                <span className="text-zinc-500">Response Snippet:</span>
                                <pre className="p-2 rounded bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-400 mt-1 overflow-x-auto whitespace-pre-wrap">
                                  {consoleDiagnostic.responseSnippet}
                                </pre>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-zinc-500 italic">No diagnostic report available.</p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div ref={terminalRef} className="p-4 h-[560px] w-full" />
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
                  Update control plane display labels. Changing display metadata does not modify the internal Linux hostname.
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
                <CardTitle className="text-base">Access & Security</CardTitle>
                <CardDescription className="text-xs">
                  Configure root password directly on the Proxmox hypervisor.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Reset the Linux root password. The password is submitted securely to the hypervisor and is never stored on InterDash servers.
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

            {/* Danger Zone: Permanently Delete VPS (Phase 11 & 13) */}
            {canDelete && (
              <Card className="border-destructive/60 bg-destructive/10">
                <CardHeader>
                  <CardTitle className="text-base text-destructive flex items-center gap-2">
                    <Trash2 className="size-5" /> Danger Zone: Permanently Delete VPS
                  </CardTitle>
                  <CardDescription className="text-xs text-destructive/80">
                    Irreversibly stop and destroy the LXC container on Proxmox VE, release reserved network allocations, and purge instance records.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    This permanently destroys the VPS filesystem and removes the VPS from InterDash. All data on this container will be lost forever.
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setDeleteConfirmHostname("")
                      setDeleteDialogOpen(true)
                    }}
                    disabled={isBusy || isDeletingVps}
                  >
                    <Trash2 className="size-3.5" /> Delete VPS Instance
                  </Button>
                </CardContent>
              </Card>
            )}
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
                      {t.volid.split("/").pop()} {t.sizeBytes ? `(${formatBytes(t.sizeBytes)})` : ""}
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

      {/* Delete VPS Confirmation Dialog (Phase 10 & 13) */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="size-5" /> Permanently Delete VPS
            </DialogTitle>
            <DialogDescription className="text-xs text-foreground/90">
              This will destroy the LXC container on the hypervisor, release assigned IP addresses, and permanently remove the instance from InterDash.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            {/* Instance details summary */}
            <div className="p-3 rounded-lg border bg-muted/30 font-mono text-[11px] space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground font-sans">Instance Name:</span>
                <span className="font-semibold text-foreground">{vps.name || vps.hostname}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground font-sans">Hostname:</span>
                <span className="text-foreground">{vps.hostname}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground font-sans">Container VMID:</span>
                <span className="text-foreground">{vps.proxmox_vmid}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground font-sans">Runtime Node:</span>
                <span className="text-foreground">{runtime.runtimeNode || vps.node_name || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground font-sans">Primary IPv4:</span>
                <span className="text-foreground">{vps.ipv4_address || "DHCP / Unassigned"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground font-sans">Node Region:</span>
                <span className="text-foreground">{vps.node_region || "—"}</span>
              </div>
            </div>

            {/* Warning banner */}
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="size-4 shrink-0" /> Irreversible Action
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                This permanently destroys the VPS filesystem and removes the VPS from InterDash. All data on this container will be lost forever.
              </p>
            </div>

            {/* If actively deleting, display real backend step progression */}
            {isDeletingVps && deleteOperation ? (
              <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin text-destructive" />
                    Deletion Status: <code className="font-mono text-primary uppercase">{deleteOperation.status}</code>
                  </span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    Step: {deleteOperation.current_step}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  {deleteOperation.current_step === "stopping"
                    ? "Gracefully stopping container..."
                    : deleteOperation.current_step === "waiting_for_stop"
                    ? "Waiting for stop task to finalize..."
                    : deleteOperation.current_step === "destroying"
                    ? "Destroying LXC filesystem on Proxmox..."
                    : deleteOperation.current_step === "waiting_for_destroy"
                    ? "Waiting for hypervisor destruction task..."
                    : deleteOperation.current_step === "verifying_absent"
                    ? "Verifying container is completely absent..."
                    : deleteOperation.current_step === "releasing_network"
                    ? "Releasing IPAM and network allocations..."
                    : deleteOperation.current_step === "finalizing"
                    ? "Purging database record..."
                    : deleteOperation.current_step}
                </div>
              </div>
            ) : (
              /* Confirmation Input */
              <div className="space-y-2 p-3 rounded-md bg-destructive/5 border border-destructive/20">
                <Label className="text-destructive font-semibold">
                  Type <code className="font-mono">{vps.hostname}</code> to confirm deletion:
                </Label>
                <Input
                  value={deleteConfirmHostname}
                  onChange={(e) => setDeleteConfirmHostname(e.target.value)}
                  placeholder={vps.hostname}
                  className="font-mono text-xs border-destructive/40"
                  disabled={isDeletingVps}
                />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDeleteDialogOpen(false)
                setDeleteConfirmHostname("")
              }}
              disabled={isDeletingVps}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteVps}
              disabled={
                isDeletingVps ||
                deleteConfirmHostname.trim() !== vps.hostname.trim()
              }
            >
              {isDeletingVps && <Loader2 className="size-3 animate-spin mr-1.5" />}
              Permanently Destroy VPS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BaseLayout>
  )
}
