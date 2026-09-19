"use client"

import * as React from "react"
import {
  Rocket,
  Cpu,
  HardDrive,
  Coins,
  Check,
  Loader2,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Server,
  KeyRound,
  Eye,
  EyeOff,
  Copy,
  RefreshCw,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
} from "lucide-react"
import { Link } from "react-router-dom"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TransferCoinsDialog } from "@/components/vps/transfer-coins-dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useAuth } from "@/contexts/auth-context"
import { toast } from "sonner"

interface VpsPlan {
  id: string
  name: string
  description: string | null
  cpuCores: number
  memoryMb: number
  diskGb: number
  swapMb: number
  coinPrice: number
  networkBridge: string
  displayOrder: number
}

interface OsTemplate {
  volid: string
  filename: string
  osFamily: string
  version: string
  architecture: string
  sizeBytes: number
}

interface DeploymentOrder {
  id: string
  status: string
  chargedCoins: number
  vpsName: string
  vpsDescription: string | null
  osTemplate: string
  plan: any
  vpsId: string | null
  provisioningJobId: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

const OS_LABELS: Record<string, string> = {
  ubuntu: "Ubuntu",
  debian: "Debian",
  centos: "CentOS",
  rocky: "Rocky Linux",
  alma: "AlmaLinux",
  almalinux: "AlmaLinux",
  alpine: "Alpine",
  fedora: "Fedora",
  arch: "Arch Linux",
  archlinux: "Arch Linux",
  opensuse: "openSUSE",
  unknown: "Linux",
}

function getOsLabel(t: OsTemplate) {
  const f = (t.osFamily || "unknown").toLowerCase()
  return OS_LABELS[f] || OS_LABELS.unknown
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—"
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`
}

function formatRam(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`
}

type DeployStep = "plan" | "configure" | "confirm"

export default function DeployPage() {
  const { user, refreshUser } = useAuth()

  const [plans, setPlans] = React.useState<VpsPlan[]>([])
  const [templates, setTemplates] = React.useState<OsTemplate[]>([])
  const [coinBalance, setCoinBalance] = React.useState(0)
  const [recentDeployments, setRecentDeployments] = React.useState<DeploymentOrder[]>([])
  const [transferOpen, setTransferOpen] = React.useState(false)

  React.useEffect(() => {
    if (user?.coin_balance !== undefined) setCoinBalance(user.coin_balance)
  }, [user?.coin_balance])

  const [loadingPlans, setLoadingPlans] = React.useState(true)
  const [loadingTemplates, setLoadingTemplates] = React.useState(true)
  const [deploying, setDeploying] = React.useState(false)

  const [step, setStep] = React.useState<DeployStep>("plan")
  const [selectedPlan, setSelectedPlan] = React.useState<VpsPlan | null>(null)
  const [vpsName, setVpsName] = React.useState("")
  const [vpsDescription, setVpsDescription] = React.useState("")
  const [selectedTemplate, setSelectedTemplate] = React.useState("")
  const [rootPassword, setRootPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)

  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [deployResult, setDeployResult] = React.useState<any>(null)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    async function fetchPlans() {
      try {
        const res = await fetch("/api/vps/plans", { credentials: "same-origin" })
        if (res.ok) {
          const data = await res.json()
          setPlans(data.plans || [])
          setCoinBalance(data.coinBalance || 0)
        }
      } catch {
        toast.error("Failed to load plans.")
      } finally {
        setLoadingPlans(false)
      }
    }
    async function fetchTemplates() {
      try {
        const res = await fetch("/api/vps/plans/templates", { credentials: "same-origin" })
        if (res.ok) {
          const data = await res.json()
          setTemplates(data.templates || [])
        }
      } catch {
        // non-critical
      } finally {
        setLoadingTemplates(false)
      }
    }
    async function fetchDeployments() {
      try {
        const res = await fetch("/api/vps/deployments", { credentials: "same-origin" })
        if (res.ok) {
          const data = await res.json()
          setRecentDeployments(data.deployments || [])
        }
      } catch {}
    }
    fetchPlans()
    fetchTemplates()
    fetchDeployments()
  }, [])

  const handleSelectPlan = (plan: VpsPlan) => {
    setSelectedPlan(plan)
    setStep("configure")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const handleBack = () => {
    if (step === "configure") setStep("plan")
    else if (step === "confirm") setStep("configure")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const generatePassword = () => {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%_-"
    let p = ""
    const arr = crypto.getRandomValues(new Uint32Array(16))
    for (let i = 0; i < 16; i++) p += chars[arr[i] % chars.length]
    setRootPassword(p)
    setShowPassword(true)
  }

  const passwordError =
    rootPassword.length > 0 && rootPassword.length < 8 ? "Minimum 8 characters." : null

  const handleProceedToConfirm = () => {
    if (!vpsName.trim() || vpsName.trim().length < 2) {
      toast.error("Server name must be at least 2 characters.")
      return
    }
    if (vpsName.trim().length > 64) {
      toast.error("Server name must not exceed 64 characters.")
      return
    }
    if (!selectedTemplate) {
      toast.error("Please select an operating system.")
      return
    }
    if (passwordError) {
      toast.error(passwordError)
      return
    }
    setStep("confirm")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const handleDeploy = async () => {
    if (!selectedPlan || !selectedTemplate || !vpsName.trim()) return
    setConfirmOpen(false)
    setDeploying(true)
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const d = await csrfRes.json()
        csrfToken = d.token
      }
      const res = await fetch("/api/vps/deploy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        credentials: "same-origin",
        body: JSON.stringify({
          planId: selectedPlan.id,
          name: vpsName.trim(),
          description: vpsDescription.trim() || undefined,
          osTemplate: selectedTemplate,
          rootPassword: rootPassword.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setDeployResult(data.deployment)
        if (data.deployment?.chargedCoins) {
          setCoinBalance((prev) => prev - (data.deployment.chargedCoins || 0))
        }
        toast.success(data.message || "Deployment initiated.")
        refreshUser()
      } else {
        toast.error(data.error || "Deployment failed.")
        if (data.code === "INSUFFICIENT_COINS") setCoinBalance(data.currentBalance ?? coinBalance)
      }
    } catch {
      toast.error("Network error — please try again.")
    } finally {
      setDeploying(false)
    }
  }

  const handleNewDeploy = () => {
    setSelectedPlan(null)
    setVpsName("")
    setVpsDescription("")
    setSelectedTemplate("")
    setRootPassword("")
    setShowPassword(false)
    setDeployResult(null)
    setCopied(false)
    setStep("plan")
  }

  // Success state
  if (deployResult) {
    const isGenerated = Boolean(deployResult.generatedPassword)
    const shownPassword = deployResult.generatedPassword as string | undefined
    return (
      <BaseLayout title="Deployment" description="Provisioning started.">
        <div className="px-4 lg:px-6 max-w-2xl mx-auto w-full">
          <Card className="border">
            <CardHeader className="text-center pb-3">
              <div className="mx-auto w-11 h-11 rounded-md border flex items-center justify-center mb-3">
                <Check className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg">Deployment queued</CardTitle>
              <CardDescription className="text-sm">
                VPS <span className="font-medium text-foreground">"{deployResult.vpsName}"</span> is being created with plan{" "}
                <span className="font-medium text-foreground">{deployResult.planName}</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border px-3 py-2.5">
                  <div className="text-xs text-muted-foreground mb-1">Order ID</div>
                  <div className="font-mono text-xs break-all leading-tight">{deployResult.deploymentId}</div>
                </div>
                <div className="rounded-md border px-3 py-2.5">
                  <div className="text-xs text-muted-foreground mb-1">Status</div>
                  <Badge variant="outline" className="text-xs font-normal">
                    {deployResult.status}
                  </Badge>
                </div>
                <div className="rounded-md border px-3 py-2.5">
                  <div className="text-xs text-muted-foreground mb-1">Charged</div>
                  <div className="font-medium flex items-center gap-1.5">
                    <Coins className="h-3.5 w-3.5" />
                    {deployResult.chargedCoins.toLocaleString()} coins
                  </div>
                </div>
                <div className="rounded-md border px-3 py-2.5">
                  <div className="text-xs text-muted-foreground mb-1">Balance</div>
                  <div className="font-medium">{coinBalance.toLocaleString()} coins</div>
                </div>
              </div>

              {isGenerated && shownPassword && (
                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium flex items-center gap-1.5">
                      <KeyRound className="h-3.5 w-3.5" /> Root password — copy now (shown once)
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText(shownPassword)
                        setCopied(true)
                        toast.success("Password copied.")
                        setTimeout(() => setCopied(false), 2000)
                      }}
                    >
                      {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <code className="block font-mono text-xs bg-muted px-3 py-2 rounded border break-all select-all">
                    {shownPassword}
                  </code>
                  <p className="text-xs text-muted-foreground">
                    This password was auto-generated because the field was left empty. It will not be shown again.
                  </p>
                </div>
              )}

              {!isGenerated && rootPassword && (
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">
                    Root password was set as provided. Use it to log in via console or SSH once the VPS is running.
                  </p>
                </div>
              )}

              <div className="rounded-md border bg-muted/30 px-3 py-2.5">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Provisioning usually takes 30–90 seconds. Track progress in{" "}
                  <Link to="/instances" className="underline underline-offset-2 font-medium text-foreground">
                    Instances
                  </Link>
                  . Coins are refunded automatically if provisioning fails.
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex gap-2 justify-center">
              <Button variant="outline" onClick={handleNewDeploy} className="text-xs">
                Deploy another
              </Button>
              <Button asChild className="text-xs">
                <Link to="/instances">
                  <Server className="h-3.5 w-3.5 mr-1.5" />
                  View instances
                </Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </BaseLayout>
    )
  }

  const steps: { key: DeployStep; label: string; num: number }[] = [
    { key: "plan", label: "Select plan", num: 1 },
    { key: "configure", label: "Configure", num: 2 },
    { key: "confirm", label: "Review & deploy", num: 3 },
  ]
  const activeIndex = steps.findIndex((s) => s.key === step)

  return (
    <BaseLayout title="Deploy VPS" description="Choose a plan, configure, and deploy.">
      <div className="px-4 lg:px-6 max-w-6xl mx-auto">
        {/* Top bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            {steps.map((s, idx) => {
              const isActive = idx === activeIndex
              const isDone = idx < activeIndex
              return (
                <React.Fragment key={s.key}>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-7 h-7 rounded-md border flex items-center justify-center text-xs font-medium ${
                        isDone
                          ? "bg-foreground text-background border-foreground"
                          : isActive
                            ? "bg-foreground text-background border-foreground"
                            : "bg-background text-muted-foreground"
                      }`}
                    >
                      {isDone ? <Check className="h-3.5 w-3.5" /> : s.num}
                    </div>
                    <span className={`text-xs font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                      {s.label}
                    </span>
                  </div>
                  {idx < steps.length - 1 && <div className="w-6 h-px bg-border mx-1 hidden sm:block" />}
                </React.Fragment>
              )
            })}
          </div>

          <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 bg-card">
            <Coins className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Balance</span>
            <span className="text-sm font-mono font-medium">{coinBalance.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground">coins</span>
            <span className="mx-1 h-4 w-px bg-border" />
            <Button variant="ghost" size="sm" onClick={() => setTransferOpen(true)} className="h-7 px-2 text-xs">
              <Send className="h-3 w-3 mr-1" /> Transfer
            </Button>
          </div>
        </div>

        {/* Step 1: Plans */}
        {step === "plan" && (
          <div>
            {loadingPlans ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <p className="text-sm text-muted-foreground">Loading plans…</p>
              </div>
            ) : plans.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                <AlertCircle className="h-8 w-8 text-muted-foreground" />
                <h3 className="text-sm font-medium">No plans available</h3>
                <p className="text-xs text-muted-foreground max-w-sm">
                  No deployment plans have been created. Contact an administrator.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {plans.map((plan) => {
                  const canAfford = coinBalance >= plan.coinPrice
                  return (
                    <Card
                      key={plan.id}
                      className={`flex flex-col ${!canAfford ? "opacity-60" : "hover:border-foreground/30"} transition-colors`}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <CardTitle className="text-sm font-medium truncate pr-2">{plan.name}</CardTitle>
                            {plan.description && (
                              <CardDescription className="text-xs mt-1 line-clamp-2 leading-relaxed">
                                {plan.description}
                              </CardDescription>
                            )}
                          </div>
                          <Badge variant="outline" className="text-xs font-mono shrink-0">
                            {plan.coinPrice.toLocaleString()} c
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pb-3 flex-1">
                        <div className="rounded-md border bg-muted/20 px-3 py-2.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground flex items-center gap-1.5">
                              <Cpu className="h-3 w-3" /> {plan.cpuCores} vCPU
                            </span>
                            <span className="text-muted-foreground">{formatRam(plan.memoryMb)}</span>
                          </div>
                          <div className="h-px bg-border my-2" />
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground flex items-center gap-1.5">
                              <HardDrive className="h-3 w-3" /> {plan.diskGb} GB Disk
                            </span>
                            <span className="text-muted-foreground">{plan.networkBridge}</span>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                          <Check className="h-3 w-3" /> Instant provisioning
                          <span className="mx-1">·</span> Auto-refund on failure
                        </div>
                      </CardContent>
                      <CardFooter className="pt-0">
                        <Button
                          className="w-full text-xs h-8"
                          variant={canAfford ? "default" : "outline"}
                          disabled={!canAfford}
                          onClick={() => handleSelectPlan(plan)}
                        >
                          {canAfford ? (
                            <>
                              Select
                              <ChevronRight className="h-3.5 w-3.5 ml-1" />
                            </>
                          ) : (
                            "Insufficient coins"
                          )}
                        </Button>
                      </CardFooter>
                    </Card>
                  )
                })}
              </div>
            )}

            {recentDeployments.length > 0 && (
              <div className="mt-8">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">Recent deployments</h3>
                <div className="rounded-md border divide-y">
                  {recentDeployments.slice(0, 5).map((d) => (
                    <div key={d.id} className="flex items-center justify-between px-3 py-2.5 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <StatusIcon status={d.status} />
                        <span className="font-medium truncate">{d.vpsName}</span>
                        <span className="text-muted-foreground hidden sm:inline truncate">— {d.plan?.planName || d.osTemplate}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <Badge variant="outline" className="text-xs font-normal">
                          {d.status}
                        </Badge>
                        <span className="text-muted-foreground hidden md:inline">
                          {new Date(d.createdAt).toLocaleDateString()}
                        </span>
                        {d.vpsId && (
                          <Button variant="ghost" size="sm" asChild className="h-7 w-7 p-0">
                            <Link to={`/instances/${d.vpsId}`}>
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Configure */}
        {step === "configure" && selectedPlan && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Server className="h-4 w-4" /> Server configuration
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Hostname, operating system, and root credentials.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="vps-name" className="text-xs">
                        Server name <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="vps-name"
                        placeholder="my-web-server"
                        value={vpsName}
                        onChange={(e) => setVpsName(e.target.value)}
                        maxLength={64}
                        className="font-mono text-sm h-9"
                      />
                      <p className="text-xs text-muted-foreground">2–64 chars. Sanitized as hostname.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="os-template" className="text-xs">
                        Operating system <span className="text-destructive">*</span>
                      </Label>
                      {loadingTemplates ? (
                        <div className="flex items-center gap-2 h-9 px-3 rounded-md border text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading templates…
                        </div>
                      ) : templates.length === 0 ? (
                        <div className="h-9 px-3 rounded-md border flex items-center gap-2 text-xs text-muted-foreground">
                          <AlertCircle className="h-3.5 w-3.5" /> No templates available
                        </div>
                      ) : (
                        <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                          <SelectTrigger id="os-template" className="h-9 text-xs">
                            <SelectValue placeholder="Choose OS…" />
                          </SelectTrigger>
                          <SelectContent>
                            {templates.map((t) => (
                              <SelectItem key={t.volid} value={t.volid} className="text-xs">
                                <span className="font-medium">{getOsLabel(t)}</span>
                                {t.version && <span className="text-muted-foreground ml-1">{t.version}</span>}
                                <span className="text-muted-foreground ml-1">
                                  {t.architecture} · {formatBytes(t.sizeBytes)}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="vps-desc" className="text-xs">
                      Description <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Textarea
                      id="vps-desc"
                      placeholder="Purpose of this server"
                      value={vpsDescription}
                      onChange={(e) => setVpsDescription(e.target.value)}
                      maxLength={500}
                      rows={2}
                      className="text-sm resize-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="root-password" className="text-xs flex items-center gap-1.5">
                        <KeyRound className="h-3.5 w-3.5" /> Root password
                        <span className="text-muted-foreground font-normal">(optional)</span>
                      </Label>
                      <Button type="button" variant="ghost" size="sm" onClick={generatePassword} className="h-7 text-xs px-2">
                        <RefreshCw className="h-3 w-3 mr-1" /> Generate
                      </Button>
                    </div>
                    <div className="relative">
                      <Input
                        id="root-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Leave empty to auto-generate"
                        value={rootPassword}
                        onChange={(e) => setRootPassword(e.target.value)}
                        className="pr-9 h-9 text-sm font-mono"
                        aria-invalid={Boolean(passwordError)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-0 top-0 h-9 w-9 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        {passwordError ? (
                          <span className="text-destructive">{passwordError}</span>
                        ) : rootPassword.length === 0 ? (
                          "Auto-generates a secure password if left empty (shown once)."
                        ) : (
                          "Min 8 characters. Stored only for provisioning."
                        )}
                      </p>
                      {rootPassword.length > 0 && (
                        <span className={`text-xs ${rootPassword.length >= 12 ? "text-foreground" : "text-muted-foreground"}`}>
                          {rootPassword.length} chars
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between mt-4">
                <Button variant="outline" onClick={handleBack} className="text-xs h-8">
                  <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back
                </Button>
                <Button
                  onClick={handleProceedToConfirm}
                  disabled={!vpsName.trim() || vpsName.trim().length < 2 || !selectedTemplate || Boolean(passwordError)}
                  className="text-xs h-8"
                >
                  Continue <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                </Button>
              </div>
            </div>

            <div>
              <Card className="lg:sticky lg:top-6">
                <CardHeader className="pb-3">
                  <CardDescription className="text-xs">Selected plan</CardDescription>
                  <CardTitle className="text-sm">{selectedPlan.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">CPU</span>
                    <span className="font-medium">{selectedPlan.cpuCores} vCPU</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Memory</span>
                    <span className="font-medium">{formatRam(selectedPlan.memoryMb)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Disk</span>
                    <span className="font-medium">{selectedPlan.diskGb} GB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bridge</span>
                    <span className="font-mono">{selectedPlan.networkBridge}</span>
                  </div>
                  <div className="h-px bg-border my-2" />
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Price</span>
                    <span className="font-medium flex items-center gap-1">
                      <Coins className="h-3.5 w-3.5" />
                      {selectedPlan.coinPrice.toLocaleString()} coins
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>After deployment</span>
                    <span className="font-mono">{(coinBalance - selectedPlan.coinPrice).toLocaleString()} coins</span>
                  </div>
                  {coinBalance < selectedPlan.coinPrice && (
                    <p className="text-xs text-destructive pt-2">Insufficient balance.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === "confirm" && selectedPlan && (
          <div className="max-w-xl mx-auto">
            <Card>
              <CardHeader className="pb-3 text-center">
                <CardTitle className="text-sm">Review deployment</CardTitle>
                <CardDescription className="text-xs">Check details before charging coins.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border divide-y text-xs">
                  <div className="flex justify-between px-3 py-2.5">
                    <span className="text-muted-foreground">Plan</span>
                    <span className="font-medium">{selectedPlan.name}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2.5">
                    <span className="text-muted-foreground">Server name</span>
                    <span className="font-mono font-medium">{vpsName}</span>
                  </div>
                  {vpsDescription && (
                    <div className="flex justify-between px-3 py-2.5 gap-4">
                      <span className="text-muted-foreground shrink-0">Description</span>
                      <span className="truncate text-right max-w-[220px]">{vpsDescription}</span>
                    </div>
                  )}
                  <div className="flex justify-between px-3 py-2.5">
                    <span className="text-muted-foreground">OS</span>
                    <span className="font-medium">
                      {(() => {
                        const t = templates.find((x) => x.volid === selectedTemplate)
                        if (!t) return selectedTemplate
                        return `${getOsLabel(t)} ${t.version || ""}`.trim()
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between px-3 py-2.5">
                    <span className="text-muted-foreground">Resources</span>
                    <span>
                      {selectedPlan.cpuCores} vCPU · {formatRam(selectedPlan.memoryMb)} · {selectedPlan.diskGb} GB
                    </span>
                  </div>
                  <div className="flex justify-between px-3 py-2.5">
                    <span className="text-muted-foreground">Root password</span>
                    <span className="font-medium">{rootPassword ? "Custom (provided)" : "Auto-generate"}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2.5 bg-muted/30">
                    <span className="font-medium">Total</span>
                    <span className="font-medium flex items-center gap-1">
                      <Coins className="h-3.5 w-3.5" />
                      {selectedPlan.coinPrice.toLocaleString()} coins
                    </span>
                  </div>
                </div>
                <div className="rounded-md border px-3 py-2.5">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <span className="font-medium text-foreground">{selectedPlan.coinPrice.toLocaleString()} coins</span> will be
                    deducted from your balance ({coinBalance.toLocaleString()} coins). Refunded automatically if provisioning fails.
                  </p>
                </div>
              </CardContent>
              <CardFooter className="flex gap-2">
                <Button variant="outline" onClick={handleBack} className="flex-1 text-xs h-8" disabled={deploying}>
                  <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back
                </Button>
                <Button className="flex-1 text-xs h-8" onClick={() => setConfirmOpen(true)} disabled={deploying}>
                  {deploying ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Deploying…
                    </>
                  ) : (
                    <>
                      <Rocket className="h-3.5 w-3.5 mr-1.5" /> Deploy now
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          </div>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Coins className="h-4 w-4" /> Confirm charge
            </DialogTitle>
            <DialogDescription className="text-xs">
              Debit <span className="font-medium text-foreground">{selectedPlan?.coinPrice.toLocaleString()} coins</span> and start
              provisioning? {rootPassword ? "Your custom root password will be used." : "A secure password will be generated and shown once."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button onClick={handleDeploy} disabled={deploying} className="text-xs">
              {deploying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5 mr-1.5" />}
              Confirm & deploy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TransferCoinsDialog open={transferOpen} onOpenChange={setTransferOpen} currentBalance={coinBalance} onSuccess={() => refreshUser()} />
    </BaseLayout>
  )
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-foreground" />
    case "provisioning":
    case "charged":
    case "pending":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
    case "failed":
    case "recovery_required":
      return <XCircle className="h-3.5 w-3.5 text-destructive" />
    case "refunded":
      return <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
    case "cancelled":
      return <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
    default:
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />
  }
}
