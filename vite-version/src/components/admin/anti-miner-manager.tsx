/**
 * InterDash — Admin Anti-Miner Protection Manager Component
 *
 * Provides a dedicated control center for detecting and preventing cryptocurrency
 * mining on hosted LXC virtual servers. Features multi-vector detection tuning,
 * configurable enforcement policies (alert, kill_process, suspend_vps),
 * custom process and port signatures, VPS whitelisting, on-demand scanning,
 * and incident mitigation logs with one-click VPS resolution.
 */

import * as React from "react"
import {
  ShieldAlert,
  ShieldCheck,
  Cpu,
  Activity,
  Radio,
  Save,
  Loader2,
  RefreshCw,
  Plus,
  X,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Unlock,
  Eye,
  Sliders,
  Terminal,
  Zap,
  Clock,
  Filter,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"

interface AntiMinerConfig {
  enabled: boolean
  policy: "alert" | "kill_process" | "suspend_vps"
  cpuThreshold: number
  sustainedChecks: number
  scanIntervalSec: number
  processSignatures: string[]
  networkPorts: number[]
  whitelistVpsIds: string[]
  updatedAt: string | null
  updatedBy: string | null
}

interface IncidentItem {
  id: string
  vpsId: string
  hostname: string
  ownerUserId: string
  triggerType: "process_signature" | "network_mining" | "sustained_high_cpu"
  matchedTarget: string
  pid: number | null
  cmdline: string | null
  actionTaken: "alerted" | "process_killed" | "vps_suspended"
  status: "detected" | "mitigated" | "resolved"
  detailsJson: string | null
  detectedAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  vpsName?: string
  ownerUsername?: string
  resolvedByUsername?: string
}

export function AntiMinerManager() {
  const [config, setConfig] = React.useState<AntiMinerConfig | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isScanning, setIsScanning] = React.useState(false)

  // Incident history state
  const [incidents, setIncidents] = React.useState<IncidentItem[]>([])
  const [incidentsTotal, setIncidentsTotal] = React.useState(0)
  const [incidentFilter, setIncidentFilter] = React.useState<string>("all")
  const [isLoadingIncidents, setIsLoadingIncidents] = React.useState(false)
  const [resolvingId, setResolvingId] = React.useState<string | null>(null)

  // Local form state
  const [enabled, setEnabled] = React.useState(false)
  const [policy, setPolicy] = React.useState<"alert" | "kill_process" | "suspend_vps">("alert")
  const [cpuThreshold, setCpuThreshold] = React.useState(90)
  const [sustainedChecks, setSustainedChecks] = React.useState(3)
  const [scanIntervalSec, setScanIntervalSec] = React.useState(60)
  const [processSignatures, setProcessSignatures] = React.useState<string[]>([])
  const [networkPorts, setNetworkPorts] = React.useState<number[]>([])
  const [whitelistVpsIds, setWhitelistVpsIds] = React.useState<string[]>([])

  // Input states for chips
  const [newSigInput, setNewSigInput] = React.useState("")
  const [newPortInput, setNewPortInput] = React.useState("")
  const [newWhitelistInput, setNewWhitelistInput] = React.useState("")

  // Fetch configuration
  const fetchConfig = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings/anti-miner")
      if (res.ok) {
        const data: AntiMinerConfig = await res.json()
        setConfig(data)
        setEnabled(data.enabled)
        setPolicy(data.policy)
        setCpuThreshold(data.cpuThreshold)
        setSustainedChecks(data.sustainedChecks)
        setScanIntervalSec(data.scanIntervalSec)
        setProcessSignatures(data.processSignatures)
        setNetworkPorts(data.networkPorts)
        setWhitelistVpsIds(data.whitelistVpsIds)
      } else {
        toast.error("Failed to load anti-miner configuration.")
      }
    } catch {
      toast.error("Network error loading anti-miner settings.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Fetch incidents
  const fetchIncidents = React.useCallback(async () => {
    setIsLoadingIncidents(true)
    try {
      const q = incidentFilter !== "all" ? `?status=${incidentFilter}` : ""
      const res = await fetch(`/api/admin/anti-miner/incidents${q}`)
      if (res.ok) {
        const data = await res.json()
        setIncidents(data.incidents || [])
        setIncidentsTotal(data.total || 0)
      }
    } catch {
      // non-fatal
    } finally {
      setIsLoadingIncidents(false)
    }
  }, [incidentFilter])

  React.useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  React.useEffect(() => {
    fetchIncidents()
  }, [fetchIncidents])

  // Save settings handler
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)

    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch("/api/admin/settings/anti-miner", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({
          enabled,
          policy,
          cpuThreshold,
          sustainedChecks,
          scanIntervalSec,
          processSignatures,
          networkPorts,
          whitelistVpsIds,
        }),
      })

      const data = await res.json()
      if (res.ok) {
        toast.success("Anti-Miner settings updated successfully.")
        fetchConfig()
      } else {
        toast.error(data.error || "Failed to update anti-miner settings.")
      }
    } catch {
      toast.error("Network error while saving settings.")
    } finally {
      setIsSaving(false)
    }
  }

  // Trigger manual on-demand scan
  const handleScanNow = async () => {
    setIsScanning(true)
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch("/api/admin/anti-miner/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({}),
      })

      const data = await res.json()
      if (res.ok) {
        const bulk = data.result
        toast.success(
          `Anti-miner scan completed: ${bulk.scannedCount} running instances scanned, ${bulk.incidentsTriggered} incident(s) detected.`
        )
        fetchIncidents()
      } else {
        toast.error(data.error || "Failed to complete scan.")
      }
    } catch {
      toast.error("Network error during scan execution.")
    } finally {
      setIsScanning(false)
    }
  }

  // Resolve incident
  const handleResolve = async (incidentId: string) => {
    setResolvingId(incidentId)
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch(`/api/admin/anti-miner/incidents/${incidentId}/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({}),
      })

      const data = await res.json()
      if (res.ok) {
        toast.success(data.message || "Incident resolved successfully.")
        fetchIncidents()
      } else {
        toast.error(data.error || "Failed to resolve incident.")
      }
    } catch {
      toast.error("Error connecting to server.")
    } finally {
      setResolvingId(null)
    }
  }

  // Add process signature
  const handleAddSignature = () => {
    const clean = newSigInput.trim().toLowerCase()
    if (!clean) return
    if (processSignatures.includes(clean)) {
      toast.error("Signature already exists.")
      return
    }
    setProcessSignatures([...processSignatures, clean])
    setNewSigInput("")
  }

  // Remove process signature
  const handleRemoveSignature = (sig: string) => {
    setProcessSignatures(processSignatures.filter((s) => s !== sig))
  }

  // Add port
  const handleAddPort = () => {
    const port = parseInt(newPortInput.trim(), 10)
    if (isNaN(port) || port <= 0 || port > 65535) {
      toast.error("Please enter a valid TCP port number (1 - 65535).")
      return
    }
    if (networkPorts.includes(port)) {
      toast.error("Port already configured.")
      return
    }
    setNetworkPorts([...networkPorts, port].sort((a, b) => a - b))
    setNewPortInput("")
  }

  // Remove port
  const handleRemovePort = (port: number) => {
    setNetworkPorts(networkPorts.filter((p) => p !== port))
  }

  // Add whitelist
  const handleAddWhitelist = () => {
    const clean = newWhitelistInput.trim()
    if (!clean) return
    if (whitelistVpsIds.includes(clean)) {
      toast.error("VPS ID already whitelisted.")
      return
    }
    setWhitelistVpsIds([...whitelistVpsIds, clean])
    setNewWhitelistInput("")
  }

  // Remove whitelist
  const handleRemoveWhitelist = (vpsId: string) => {
    setWhitelistVpsIds(whitelistVpsIds.filter((id) => id !== vpsId))
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-3">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading Anti-Miner protection engine...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Master Status & On-Demand Actions */}
      <Card className="border-border/60 bg-gradient-to-r from-card via-card to-muted/20">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div
                className={`size-12 rounded-xl flex items-center justify-center shrink-0 border ${
                  enabled
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500 shadow-sm shadow-emerald-500/10"
                    : "bg-muted border-border text-muted-foreground"
                }`}
              >
                {enabled ? <ShieldCheck className="size-6" /> : <ShieldAlert className="size-6" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold tracking-tight">Anti-Miner Protection</h3>
                  <Badge variant={enabled ? "default" : "secondary"} className="text-xs">
                    {enabled ? "Active Protection" : "Disabled"}
                  </Badge>
                  {enabled && (
                    <Badge variant="outline" className="text-xs uppercase font-mono">
                      Policy: {policy}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Protects hosted LXC containers from cryptocurrency miners, unauthorized Stratum
                  pools, and persistent CPU abuse.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleScanNow}
                disabled={isScanning}
                className="gap-2 shrink-0 cursor-pointer shadow-xs"
              >
                {isScanning ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                <span>Scan All Instances</span>
              </Button>

              <div className="flex items-center gap-2 pl-2 border-l">
                <Switch
                  id="anti-miner-master-toggle"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  aria-label="Toggle anti-miner master protection"
                />
                <Label htmlFor="anti-miner-master-toggle" className="text-sm font-medium cursor-pointer">
                  {enabled ? "Enabled" : "Disabled"}
                </Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Configuration Form */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* Policy Selector Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Zap className="size-4 text-primary" /> Enforcement Policy
            </CardTitle>
            <CardDescription>
              Specify what action InterDash automatically executes when cryptocurrency mining is
              detected inside an LXC instance.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Option 1: Alert */}
            <div
              onClick={() => setPolicy("alert")}
              className={`p-4 rounded-xl border-2 transition-all cursor-pointer space-y-2 ${
                policy === "alert"
                  ? "border-primary bg-primary/5 shadow-xs"
                  : "border-border/60 hover:border-border hover:bg-muted/30"
              }`}
            >
              <div className="flex items-center justify-between">
                <Badge variant={policy === "alert" ? "default" : "outline"} className="gap-1 text-xs">
                  <Eye className="size-3" /> Monitor & Alert
                </Badge>
                {policy === "alert" && <CheckCircle2 className="size-4 text-primary" />}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Logs detection events to incident logs and audit trail. Does <strong>not</strong>{" "}
                kill processes or halt instances. Recommended for testing signatures.
              </p>
            </div>

            {/* Option 2: Kill Process */}
            <div
              onClick={() => setPolicy("kill_process")}
              className={`p-4 rounded-xl border-2 transition-all cursor-pointer space-y-2 ${
                policy === "kill_process"
                  ? "border-primary bg-primary/5 shadow-xs"
                  : "border-border/60 hover:border-border hover:bg-muted/30"
              }`}
            >
              <div className="flex items-center justify-between">
                <Badge
                  variant={policy === "kill_process" ? "default" : "outline"}
                  className="gap-1 text-xs"
                >
                  <Terminal className="size-3" /> Terminate Process
                </Badge>
                {policy === "kill_process" && <CheckCircle2 className="size-4 text-primary" />}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Immediately issues <code className="text-[11px] bg-muted px-1 py-0.5 rounded">kill -9</code>{" "}
                against the offending PID inside the LXC container while keeping the VPS running.
              </p>
            </div>

            {/* Option 3: Suspend VPS */}
            <div
              onClick={() => setPolicy("suspend_vps")}
              className={`p-4 rounded-xl border-2 transition-all cursor-pointer space-y-2 ${
                policy === "suspend_vps"
                  ? "border-destructive bg-destructive/5 shadow-xs"
                  : "border-border/60 hover:border-border hover:bg-muted/30"
              }`}
            >
              <div className="flex items-center justify-between">
                <Badge
                  variant={policy === "suspend_vps" ? "destructive" : "outline"}
                  className="gap-1 text-xs"
                >
                  <Lock className="size-3" /> Suspend & Lock VPS
                </Badge>
                {policy === "suspend_vps" && <CheckCircle2 className="size-4 text-destructive" />}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Immediately forces container stop and applies a durable{" "}
                <code className="text-[11px] bg-muted px-1 py-0.5 rounded">mining_suspended</code> lock.
                User cannot power on until resolved by admin.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Sensitivity & Timing Parameters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Sliders className="size-4 text-primary" /> Detection Sensitivity & Scheduling
            </CardTitle>
            <CardDescription>
              Configure the CPU load threshold, consecutive sustained check count, and background
              evaluation interval.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Cpu className="size-3.5 text-primary" /> CPU Load Threshold
                </Label>
                <span className="text-xs font-mono font-bold text-primary">{cpuThreshold}%</span>
              </div>
              <Input
                type="number"
                min={50}
                max={100}
                value={cpuThreshold}
                onChange={(e) => setCpuThreshold(Number(e.target.value))}
                className="text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Triggers anomaly inspection if container CPU load reaches or exceeds this level.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Activity className="size-3.5 text-primary" /> Sustained Intervals
                </Label>
                <span className="text-xs font-mono font-bold text-primary">
                  {sustainedChecks} check(s)
                </span>
              </div>
              <Input
                type="number"
                min={1}
                max={10}
                value={sustainedChecks}
                onChange={(e) => setSustainedChecks(Number(e.target.value))}
                className="text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Prevents false alarms by requiring excessive CPU to be observed over consecutive
                checks.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Clock className="size-3.5 text-primary" /> Background Scan Interval
                </Label>
                <span className="text-xs font-mono font-bold text-primary">{scanIntervalSec}s</span>
              </div>
              <Select
                value={String(scanIntervalSec)}
                onValueChange={(v) => setScanIntervalSec(Number(v))}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Select interval" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">Every 30 seconds</SelectItem>
                  <SelectItem value="60">Every 60 seconds (Recommended)</SelectItem>
                  <SelectItem value="120">Every 2 minutes</SelectItem>
                  <SelectItem value="300">Every 5 minutes</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Interval at which the server scans all active running instances across nodes.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Process & Network Signatures */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Terminal className="size-4 text-primary" /> Signatures & Mining Pool Rules
            </CardTitle>
            <CardDescription>
              Manage process binary names, command-line flags, and standard Stratum mining pool ports.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Process Signatures */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold">Known Miner Process Signatures</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Add process signature (e.g. xmrig, cpuminer, kdevtmpfsi)..."
                  value={newSigInput}
                  onChange={(e) => setNewSigInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleAddSignature()
                    }
                  }}
                  className="text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddSignature}
                  className="gap-1 shrink-0"
                >
                  <Plus className="size-3.5" /> Add Signature
                </Button>
              </div>

              <div className="flex flex-wrap gap-1.5 p-3 rounded-lg border bg-muted/20 min-h-[50px] max-h-[160px] overflow-y-auto">
                {processSignatures.map((sig) => (
                  <Badge
                    key={sig}
                    variant="secondary"
                    className="gap-1 font-mono text-[11px] py-0.5 px-2 bg-background border"
                  >
                    <span>{sig}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveSignature(sig)}
                      className="text-muted-foreground hover:text-destructive cursor-pointer"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>

            {/* Network Ports */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold">Stratum Mining Ports</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Add mining port (e.g. 3333, 4444, 5555)..."
                  type="number"
                  value={newPortInput}
                  onChange={(e) => setNewPortInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleAddPort()
                    }
                  }}
                  className="text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddPort}
                  className="gap-1 shrink-0"
                >
                  <Plus className="size-3.5" /> Add Port
                </Button>
              </div>

              <div className="flex flex-wrap gap-1.5 p-3 rounded-lg border bg-muted/20 min-h-[40px]">
                {networkPorts.map((port) => (
                  <Badge
                    key={port}
                    variant="secondary"
                    className="gap-1 font-mono text-[11px] py-0.5 px-2 bg-background border"
                  >
                    <span>:{port}</span>
                    <button
                      type="button"
                      onClick={() => handleRemovePort(port)}
                      className="text-muted-foreground hover:text-destructive cursor-pointer"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>

            {/* Whitelisted VPS Instances */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold">Whitelisted VPS Instances (Exempt)</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Add VPS UUID to whitelist (e.g. vps-018f...)..."
                  value={newWhitelistInput}
                  onChange={(e) => setNewWhitelistInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleAddWhitelist()
                    }
                  }}
                  className="text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddWhitelist}
                  className="gap-1 shrink-0"
                >
                  <Plus className="size-3.5" /> Whitelist VPS
                </Button>
              </div>

              <div className="flex flex-wrap gap-1.5 p-3 rounded-lg border bg-muted/20 min-h-[40px]">
                {whitelistVpsIds.length === 0 ? (
                  <span className="text-xs text-muted-foreground/60 italic">
                    No VPS instances currently whitelisted.
                  </span>
                ) : (
                  whitelistVpsIds.map((vpsId) => (
                    <Badge
                      key={vpsId}
                      variant="outline"
                      className="gap-1 font-mono text-[11px] py-0.5 px-2 bg-background"
                    >
                      <span>{vpsId}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveWhitelist(vpsId)}
                        className="text-muted-foreground hover:text-destructive cursor-pointer"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))
                )}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between border-t pt-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Radio className="size-3.5 text-primary" />
              <span>
                {config?.updatedAt
                  ? `Last updated: ${new Date(config.updatedAt).toLocaleString()}`
                  : "Deduplication cooldown of 10 minutes prevents alert floods on repeated matches."}
              </span>
            </div>
            <Button type="submit" disabled={isSaving} className="gap-2 cursor-pointer">
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save Configuration
            </Button>
          </CardFooter>
        </Card>
      </form>

      {/* Incidents History Table */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ShieldAlert className="size-4 text-destructive" /> Detection Incident History & Mitigations
              {incidentsTotal > 0 && (
                <Badge variant="secondary" className="text-xs font-mono ml-2">
                  {incidentsTotal} Total
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Audit record of all detected cryptomining attempts, enforcement actions, and resolutions.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="size-3.5 text-muted-foreground" />
            <Select value={incidentFilter} onValueChange={setIncidentFilter}>
              <SelectTrigger className="w-[140px] text-xs h-8">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Incidents</SelectItem>
                <SelectItem value="detected">Detected</SelectItem>
                <SelectItem value="mitigated">Mitigated</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleScanNow}
              disabled={isScanning}
              className="h-8 gap-1.5 text-xs cursor-pointer"
            >
              {isScanning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              <span>Scan All Instances</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchIncidents}
              disabled={isLoadingIncidents}
              className="h-8 px-2"
              title="Refresh incident list"
            >
              <RefreshCw className={`size-3.5 ${isLoadingIncidents ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <ShieldCheck className="size-10 text-emerald-500/60 mx-auto" />
              <p className="text-sm font-medium">No Incidents Detected</p>
              <p className="text-xs text-muted-foreground">
                All virtual servers are clear of detected cryptocurrency mining signatures.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">VPS Instance</TableHead>
                    <TableHead className="text-xs">Trigger & Target</TableHead>
                    <TableHead className="text-xs">Action Taken</TableHead>
                    <TableHead className="text-xs">Detected At</TableHead>
                    <TableHead className="text-xs text-right">Resolution</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incidents.map((inc) => {
                    const isSuspended = inc.actionTaken === "vps_suspended"
                    const isResolved = inc.status === "resolved"

                    return (
                      <TableRow key={inc.id} className="text-xs">
                        <TableCell>
                          {isResolved ? (
                            <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 gap-1">
                              <CheckCircle2 className="size-3" /> Resolved
                            </Badge>
                          ) : inc.status === "mitigated" ? (
                            <Badge variant="secondary" className="gap-1 text-blue-500 border-blue-500/30">
                              <Zap className="size-3" /> Mitigated
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="size-3" /> Detected
                            </Badge>
                          )}
                        </TableCell>

                        <TableCell>
                          <div className="font-semibold">{inc.hostname}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">
                            {inc.ownerUsername ? `@${inc.ownerUsername}` : inc.vpsId}
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-medium text-destructive">
                              {inc.matchedTarget}
                            </span>
                            {inc.pid && (
                              <Badge variant="outline" className="text-[10px] font-mono py-0 px-1">
                                PID: {inc.pid}
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-mono">
                            {inc.triggerType.replace(/_/g, " ")}
                          </div>
                        </TableCell>

                        <TableCell>
                          {inc.actionTaken === "vps_suspended" ? (
                            <Badge variant="destructive" className="gap-1 text-[11px]">
                              <Lock className="size-3" /> Suspended VPS
                            </Badge>
                          ) : inc.actionTaken === "process_killed" ? (
                            <Badge variant="secondary" className="gap-1 text-[11px]">
                              <Terminal className="size-3" /> Process Terminated
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 text-[11px]">
                              <Eye className="size-3" /> Alert Logged
                            </Badge>
                          )}
                        </TableCell>

                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {new Date(inc.detectedAt).toLocaleString()}
                        </TableCell>

                        <TableCell className="text-right">
                          {!isResolved ? (
                            <Button
                              variant={isSuspended ? "destructive" : "outline"}
                              size="sm"
                              disabled={resolvingId === inc.id}
                              onClick={() => handleResolve(inc.id)}
                              className="h-7 text-xs gap-1.5 cursor-pointer"
                            >
                              {resolvingId === inc.id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : isSuspended ? (
                                <Unlock className="size-3" />
                              ) : (
                                <CheckCircle2 className="size-3" />
                              )}
                              <span>{isSuspended ? "Resolve & Unlock" : "Mark Resolved"}</span>
                            </Button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground italic">
                              Resolved {inc.resolvedByUsername ? `by @${inc.resolvedByUsername}` : ""}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
