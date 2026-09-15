"use client"

import * as React from "react"
import {
  Rocket,
  Cpu,
  MemoryStick,
  HardDrive,
  Coins,
  Network,
  Check,
  Loader2,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Server,
  Monitor,
  Sparkles,
  Shield,
  Zap,
  RefreshCw,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

// Types
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

// OS family icon/color mapping
const OS_FAMILIES: Record<string, { label: string; color: string; emoji: string }> = {
  ubuntu: { label: "Ubuntu", color: "#E95420", emoji: "🟠" },
  debian: { label: "Debian", color: "#A80030", emoji: "🔴" },
  centos: { label: "CentOS", color: "#932178", emoji: "🟣" },
  rocky: { label: "Rocky Linux", color: "#10B981", emoji: "🟢" },
  alma: { label: "AlmaLinux", color: "#0F4880", emoji: "🔵" },
  alpine: { label: "Alpine", color: "#0D597F", emoji: "🏔️" },
  fedora: { label: "Fedora", color: "#51A2DA", emoji: "🔵" },
  arch: { label: "Arch Linux", color: "#1793D1", emoji: "🔷" },
  opensuse: { label: "openSUSE", color: "#73BA25", emoji: "🟢" },
  unknown: { label: "Linux", color: "#6B7280", emoji: "🐧" },
}

function getOsInfo(template: OsTemplate) {
  const family = (template.osFamily || "unknown").toLowerCase()
  return OS_FAMILIES[family] || OS_FAMILIES.unknown
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B"
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`
}

function formatRam(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`
}

// Step enum
type DeployStep = "plan" | "configure" | "confirm"

export default function DeployPage() {
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()

  // Data state
  const [plans, setPlans] = React.useState<VpsPlan[]>([])
  const [templates, setTemplates] = React.useState<OsTemplate[]>([])
  const [coinBalance, setCoinBalance] = React.useState(0)
  const [recentDeployments, setRecentDeployments] = React.useState<DeploymentOrder[]>([])

  // Loading
  const [loadingPlans, setLoadingPlans] = React.useState(true)
  const [loadingTemplates, setLoadingTemplates] = React.useState(true)
  const [deploying, setDeploying] = React.useState(false)

  // Wizard state
  const [step, setStep] = React.useState<DeployStep>("plan")
  const [selectedPlan, setSelectedPlan] = React.useState<VpsPlan | null>(null)
  const [vpsName, setVpsName] = React.useState("")
  const [vpsDescription, setVpsDescription] = React.useState("")
  const [selectedTemplate, setSelectedTemplate] = React.useState("")

  // Confirmation dialog
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  // Deployment result
  const [deployResult, setDeployResult] = React.useState<any>(null)

  // Fetch plans and balance
  React.useEffect(() => {
    async function fetchPlans() {
      try {
        const res = await fetch("/api/vps/plans", { credentials: "same-origin" })
        if (res.ok) {
          const data = await res.json()
          setPlans(data.plans || [])
          setCoinBalance(data.coinBalance || 0)
        }
      } catch (err) {
        toast.error("Failed to load deployment plans.")
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
        // Template loading is non-critical on plan selection step
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

  // Select plan handler
  const handleSelectPlan = (plan: VpsPlan) => {
    setSelectedPlan(plan)
    setStep("configure")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // Back handler
  const handleBack = () => {
    if (step === "configure") {
      setStep("plan")
    } else if (step === "confirm") {
      setStep("configure")
    }
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // Proceed to confirm
  const handleProceedToConfirm = () => {
    if (!vpsName.trim() || vpsName.trim().length < 2) {
      toast.error("VPS name must be at least 2 characters.")
      return
    }
    if (!selectedTemplate) {
      toast.error("Please select an operating system.")
      return
    }
    setStep("confirm")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // Deploy!
  const handleDeploy = async () => {
    if (!selectedPlan || !selectedTemplate || !vpsName.trim()) return
    setConfirmOpen(false)
    setDeploying(true)

    try {
      const res = await fetch("/api/vps/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          planId: selectedPlan.id,
          name: vpsName.trim(),
          description: vpsDescription.trim() || undefined,
          osTemplate: selectedTemplate,
        }),
      })

      const data = await res.json()

      if (res.ok && data.success) {
        setDeployResult(data.deployment)
        setCoinBalance((prev) => prev - (data.deployment?.chargedCoins || 0))
        toast.success(data.message || "Deployment initiated!")
        refreshUser()
      } else {
        toast.error(data.error || "Deployment failed.")
        if (data.code === "INSUFFICIENT_COINS") {
          setCoinBalance(data.currentBalance ?? coinBalance)
        }
      }
    } catch (err) {
      toast.error("Network error — please try again.")
    } finally {
      setDeploying(false)
    }
  }

  // Reset wizard
  const handleNewDeploy = () => {
    setSelectedPlan(null)
    setVpsName("")
    setVpsDescription("")
    setSelectedTemplate("")
    setDeployResult(null)
    setStep("plan")
  }

  // Deployment result screen
  if (deployResult) {
    return (
      <BaseLayout title="Deployment Initiated" description="Your VPS is being provisioned.">
        <div className="px-4 lg:px-6 max-w-2xl mx-auto w-full">
          <Card className="border-green-500/30 bg-gradient-to-br from-green-500/5 to-emerald-500/5">
            <CardHeader className="text-center pb-2">
              <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
                <Rocket className="h-8 w-8 text-green-500 animate-pulse" />
              </div>
              <CardTitle className="text-xl">Deployment Submitted!</CardTitle>
              <CardDescription>
                Your VPS <span className="font-semibold text-foreground">"{deployResult.vpsName}"</span> is being provisioned using plan <span className="font-semibold text-foreground">{deployResult.planName}</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border p-3">
                  <div className="text-muted-foreground text-xs mb-1">Order ID</div>
                  <div className="font-mono text-xs break-all">{deployResult.deploymentId}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-muted-foreground text-xs mb-1">Status</div>
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    {deployResult.status}
                  </Badge>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-muted-foreground text-xs mb-1">Coins Charged</div>
                  <div className="font-semibold flex items-center gap-1">
                    <Coins className="h-3.5 w-3.5 text-amber-500" />
                    {deployResult.chargedCoins.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-muted-foreground text-xs mb-1">Remaining Balance</div>
                  <div className="font-semibold flex items-center gap-1">
                    <Coins className="h-3.5 w-3.5 text-muted-foreground" />
                    {coinBalance.toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                <p className="text-sm text-blue-400">
                  <Sparkles className="h-4 w-4 inline mr-1" />
                  Provisioning typically takes 30–90 seconds. Your VPS will appear in <Link to="/instances" className="underline font-medium">Instances</Link> when ready.
                  If provisioning fails, your coins are automatically refunded.
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex gap-3 justify-center">
              <Button variant="outline" onClick={handleNewDeploy}>
                <Rocket className="h-4 w-4 mr-2" />
                Deploy Another
              </Button>
              <Button asChild>
                <Link to="/instances">
                  <Server className="h-4 w-4 mr-2" />
                  View Instances
                </Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </BaseLayout>
    )
  }

  // Step indicator
  const steps = [
    { key: "plan", label: "Select Plan", icon: Sparkles },
    { key: "configure", label: "Configure", icon: Monitor },
    { key: "confirm", label: "Deploy", icon: Rocket },
  ] as const

  return (
    <BaseLayout title="Deploy VPS" description="Select a plan, configure your server, and deploy with coins.">
      <div className="px-4 lg:px-6">
        {/* Step Progress Bar */}
        <div className="max-w-3xl mx-auto mb-8">
          <div className="flex items-center justify-between relative">
            {/* Background line */}
            <div className="absolute top-5 left-0 right-0 h-0.5 bg-muted" />
            <div
              className="absolute top-5 left-0 h-0.5 bg-primary transition-all duration-500"
              style={{
                width: step === "plan" ? "0%" : step === "configure" ? "50%" : "100%",
              }}
            />

            {steps.map((s, i) => {
              const isCurrent = s.key === step
              const isPast =
                (s.key === "plan" && step !== "plan") ||
                (s.key === "configure" && step === "confirm")
              const Icon = s.icon

              return (
                <div key={s.key} className="relative flex flex-col items-center z-10">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                      isPast
                        ? "bg-primary text-primary-foreground"
                        : isCurrent
                        ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isPast ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  </div>
                  <span
                    className={`mt-2 text-xs font-medium ${
                      isCurrent ? "text-primary" : isPast ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Coin Balance Bar */}
        <div className="max-w-5xl mx-auto mb-6">
          <div className="flex items-center justify-between rounded-lg border bg-card/50 backdrop-blur px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium">Your Balance</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tabular-nums">{coinBalance.toLocaleString()}</span>
              <span className="text-sm text-muted-foreground">coins</span>
            </div>
          </div>
        </div>

        {/* ==================== STEP 1: PLAN SELECTION ==================== */}
        {step === "plan" && (
          <div className="max-w-5xl mx-auto">
            {loadingPlans ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-muted-foreground">Loading deployment plans...</p>
              </div>
            ) : plans.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <AlertCircle className="h-12 w-12 text-muted-foreground" />
                <h3 className="text-lg font-semibold">No Plans Available</h3>
                <p className="text-muted-foreground text-center max-w-md">
                  There are no deployment plans available at this time. Please contact an administrator to create plans.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {plans.map((plan, index) => {
                  const canAfford = coinBalance >= plan.coinPrice
                  const isPopular = index === 1 && plans.length > 2

                  return (
                    <Card
                      key={plan.id}
                      className={`relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-1 cursor-pointer group ${
                        isPopular ? "border-primary/50 ring-1 ring-primary/20" : "hover:border-primary/30"
                      }`}
                      onClick={() => canAfford && handleSelectPlan(plan)}
                    >
                      {isPopular && (
                        <div className="absolute top-0 right-0">
                          <div className="bg-primary text-primary-foreground text-[10px] font-bold px-3 py-1 rounded-bl-lg uppercase tracking-wider">
                            Popular
                          </div>
                        </div>
                      )}

                      {/* Gradient accent bar */}
                      <div className="h-1 w-full bg-gradient-to-r from-primary/60 via-primary to-primary/60" />

                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Server className="h-5 w-5 text-primary" />
                          {plan.name}
                        </CardTitle>
                        {plan.description && (
                          <CardDescription className="text-xs line-clamp-2">
                            {plan.description}
                          </CardDescription>
                        )}
                      </CardHeader>

                      <CardContent className="pb-3">
                        {/* Resource Specs Grid */}
                        <div className="grid grid-cols-2 gap-2.5 mb-4">
                          <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                            <Cpu className="h-4 w-4 text-blue-500 shrink-0" />
                            <div>
                              <div className="text-xs text-muted-foreground">CPU</div>
                              <div className="text-sm font-semibold">{plan.cpuCores} {plan.cpuCores === 1 ? "Core" : "Cores"}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                            <MemoryStick className="h-4 w-4 text-purple-500 shrink-0" />
                            <div>
                              <div className="text-xs text-muted-foreground">RAM</div>
                              <div className="text-sm font-semibold">{formatRam(plan.memoryMb)}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                            <HardDrive className="h-4 w-4 text-emerald-500 shrink-0" />
                            <div>
                              <div className="text-xs text-muted-foreground">Disk</div>
                              <div className="text-sm font-semibold">{plan.diskGb} GB</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                            <Network className="h-4 w-4 text-orange-500 shrink-0" />
                            <div>
                              <div className="text-xs text-muted-foreground">Network</div>
                              <div className="text-sm font-semibold">{plan.networkBridge}</div>
                            </div>
                          </div>
                        </div>

                        {/* Features */}
                        <div className="space-y-1.5">
                          {[
                            { icon: Shield, text: "DDoS Protection" },
                            { icon: Zap, text: "Instant Provisioning" },
                            { icon: RefreshCw, text: "Auto Failure Refund" },
                          ].map(({ icon: FIcon, text }) => (
                            <div key={text} className="flex items-center gap-2 text-xs text-muted-foreground">
                              <FIcon className="h-3 w-3 text-green-500" />
                              <span>{text}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>

                      <CardFooter className="pt-0">
                        <div className="w-full">
                          {/* Price */}
                          <div className="flex items-center justify-center gap-1.5 mb-3">
                            <Coins className="h-5 w-5 text-amber-500" />
                            <span className="text-2xl font-bold">{plan.coinPrice.toLocaleString()}</span>
                            <span className="text-sm text-muted-foreground">coins</span>
                          </div>

                          <Button
                            className="w-full group-hover:bg-primary/90 transition-colors"
                            disabled={!canAfford}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleSelectPlan(plan)
                            }}
                          >
                            {canAfford ? (
                              <>
                                Select Plan
                                <ChevronRight className="h-4 w-4 ml-1" />
                              </>
                            ) : (
                              <>
                                <AlertCircle className="h-4 w-4 mr-1" />
                                Insufficient Coins
                              </>
                            )}
                          </Button>
                        </div>
                      </CardFooter>
                    </Card>
                  )
                })}
              </div>
            )}

            {/* Recent Deployments */}
            {recentDeployments.length > 0 && (
              <div className="mt-10">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Recent Deployments
                </h3>
                <div className="space-y-2">
                  {recentDeployments.slice(0, 5).map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <StatusIcon status={d.status} />
                        <div>
                          <span className="font-medium">{d.vpsName}</span>
                          <span className="text-muted-foreground ml-2">
                            {d.plan?.planName || "—"}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-xs">
                          {d.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(d.createdAt).toLocaleDateString()}
                        </span>
                        {d.vpsId && (
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/instances/${d.vpsId}`}>
                              <ChevronRight className="h-4 w-4" />
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

        {/* ==================== STEP 2: CONFIGURE VPS ==================== */}
        {step === "configure" && selectedPlan && (
          <div className="max-w-3xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Configuration Form */}
              <div className="lg:col-span-2 space-y-5">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Monitor className="h-5 w-5 text-primary" />
                      Server Configuration
                    </CardTitle>
                    <CardDescription>
                      Customize your VPS name, description, and operating system.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {/* VPS Name */}
                    <div className="space-y-2">
                      <Label htmlFor="vps-name">Server Name *</Label>
                      <Input
                        id="vps-name"
                        placeholder="e.g. my-web-server"
                        value={vpsName}
                        onChange={(e) => setVpsName(e.target.value)}
                        maxLength={64}
                        className="font-mono"
                      />
                      <p className="text-xs text-muted-foreground">
                        2–64 characters. Used as hostname (auto-sanitized).
                      </p>
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                      <Label htmlFor="vps-desc">Description (optional)</Label>
                      <Textarea
                        id="vps-desc"
                        placeholder="What will this server be used for?"
                        value={vpsDescription}
                        onChange={(e) => setVpsDescription(e.target.value)}
                        maxLength={500}
                        rows={3}
                      />
                    </div>

                    {/* OS Template */}
                    <div className="space-y-2">
                      <Label htmlFor="os-template">Operating System *</Label>
                      {loadingTemplates ? (
                        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Discovering available templates...
                        </div>
                      ) : templates.length === 0 ? (
                        <div className="flex items-center gap-2 py-3 text-sm text-amber-500">
                          <AlertCircle className="h-4 w-4" />
                          No OS templates available. Please contact an administrator.
                        </div>
                      ) : (
                        <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                          <SelectTrigger id="os-template" className="w-full">
                            <SelectValue placeholder="Choose an operating system..." />
                          </SelectTrigger>
                          <SelectContent>
                            {templates.map((t) => {
                              const osInfo = getOsInfo(t)
                              return (
                                <SelectItem key={t.volid} value={t.volid}>
                                  <span className="flex items-center gap-2">
                                    <span>{osInfo.emoji}</span>
                                    <span className="font-medium">{osInfo.label}</span>
                                    {t.version && (
                                      <span className="text-muted-foreground">{t.version}</span>
                                    )}
                                    <span className="text-muted-foreground text-xs">
                                      ({t.architecture}, {formatBytes(t.sizeBytes)})
                                    </span>
                                  </span>
                                </SelectItem>
                              )
                            })}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Navigation */}
                <div className="flex justify-between">
                  <Button variant="outline" onClick={handleBack}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Plans
                  </Button>
                  <Button
                    onClick={handleProceedToConfirm}
                    disabled={!vpsName.trim() || vpsName.trim().length < 2 || !selectedTemplate}
                  >
                    Review & Deploy
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>

              {/* Plan Summary Sidebar */}
              <div>
                <Card className="sticky top-6 border-primary/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold text-primary">
                      Selected Plan
                    </CardTitle>
                    <CardDescription className="text-lg font-bold text-foreground">
                      {selectedPlan.name}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">CPU</span>
                      <span className="font-medium">{selectedPlan.cpuCores} Cores</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">RAM</span>
                      <span className="font-medium">{formatRam(selectedPlan.memoryMb)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Disk</span>
                      <span className="font-medium">{selectedPlan.diskGb} GB</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Swap</span>
                      <span className="font-medium">{formatRam(selectedPlan.swapMb)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Network</span>
                      <span className="font-medium">{selectedPlan.networkBridge}</span>
                    </div>

                    <div className="border-t pt-3 mt-3">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Price</span>
                        <span className="text-xl font-bold flex items-center gap-1.5">
                          <Coins className="h-5 w-5 text-amber-500" />
                          {selectedPlan.coinPrice.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-muted-foreground">After deploy</span>
                        <span className="text-xs text-muted-foreground">
                          {(coinBalance - selectedPlan.coinPrice).toLocaleString()} coins left
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* ==================== STEP 3: CONFIRM & DEPLOY ==================== */}
        {step === "confirm" && selectedPlan && (
          <div className="max-w-2xl mx-auto">
            <Card className="border-primary/20">
              <CardHeader className="text-center">
                <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <Rocket className="h-7 w-7 text-primary" />
                </div>
                <CardTitle className="text-xl">Confirm Deployment</CardTitle>
                <CardDescription>
                  Review your configuration before deploying. Coins will be charged immediately.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Summary Table */}
                <div className="rounded-lg border divide-y">
                  <div className="flex justify-between px-4 py-2.5">
                    <span className="text-sm text-muted-foreground">Plan</span>
                    <span className="text-sm font-semibold">{selectedPlan.name}</span>
                  </div>
                  <div className="flex justify-between px-4 py-2.5">
                    <span className="text-sm text-muted-foreground">Server Name</span>
                    <span className="text-sm font-mono font-semibold">{vpsName}</span>
                  </div>
                  {vpsDescription && (
                    <div className="flex justify-between px-4 py-2.5">
                      <span className="text-sm text-muted-foreground">Description</span>
                      <span className="text-sm max-w-[200px] truncate">{vpsDescription}</span>
                    </div>
                  )}
                  <div className="flex justify-between px-4 py-2.5">
                    <span className="text-sm text-muted-foreground">OS Template</span>
                    <span className="text-sm font-medium">
                      {(() => {
                        const t = templates.find((t) => t.volid === selectedTemplate)
                        if (!t) return selectedTemplate
                        const info = getOsInfo(t)
                        return `${info.emoji} ${info.label} ${t.version || ""}`
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between px-4 py-2.5">
                    <span className="text-sm text-muted-foreground">Resources</span>
                    <span className="text-sm font-medium">
                      {selectedPlan.cpuCores} CPU · {formatRam(selectedPlan.memoryMb)} RAM · {selectedPlan.diskGb} GB Disk
                    </span>
                  </div>
                  <div className="flex justify-between px-4 py-2.5 bg-primary/5">
                    <span className="text-sm font-medium">Total Cost</span>
                    <span className="text-lg font-bold flex items-center gap-1.5">
                      <Coins className="h-5 w-5 text-amber-500" />
                      {selectedPlan.coinPrice.toLocaleString()} coins
                    </span>
                  </div>
                </div>

                {/* Balance Warning */}
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <Coins className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-amber-500">Coin Charge Notice</p>
                      <p className="text-muted-foreground mt-0.5">
                        <strong>{selectedPlan.coinPrice.toLocaleString()}</strong> coins will be debited from your balance of <strong>{coinBalance.toLocaleString()}</strong> coins. If provisioning fails, coins are automatically refunded.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex gap-3">
                <Button variant="outline" onClick={handleBack} className="flex-1" disabled={deploying}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => setConfirmOpen(true)}
                  disabled={deploying}
                >
                  {deploying ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Deploying...
                    </>
                  ) : (
                    <>
                      <Rocket className="h-4 w-4 mr-2" />
                      Deploy Now
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          </div>
        )}
      </div>

      {/* Final Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-amber-500" />
              Confirm Coin Charge
            </DialogTitle>
            <DialogDescription>
              This will immediately debit <strong>{selectedPlan?.coinPrice.toLocaleString()} coins</strong> from your account and start provisioning your VPS.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleDeploy} disabled={deploying}>
              {deploying ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4 mr-2" />
              )}
              Confirm & Deploy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BaseLayout>
  )
}

// Helper component for deployment status icons
function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    case "provisioning":
    case "charged":
    case "pending":
      return <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />
    case "failed":
    case "recovery_required":
      return <XCircle className="h-4 w-4 text-red-500" />
    case "refunded":
      return <RefreshCw className="h-4 w-4 text-blue-500" />
    case "cancelled":
      return <XCircle className="h-4 w-4 text-muted-foreground" />
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />
  }
}
