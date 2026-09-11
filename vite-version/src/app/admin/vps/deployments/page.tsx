"use client"

import * as React from "react"
import { useParams, Link, useNavigate } from "react-router-dom"
import {
  Server,
  Loader2,
  XCircle,
  AlertTriangle,
  ChevronLeft,
  RefreshCw,
  Clock,
  ShieldCheck,
  Check,
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
  CardFooter,
} from "@/components/ui/card"

interface ProvisioningJob {
  id: string
  vps_id?: string | null
  owner_user_id: string
  target_node_id: string
  requested_by_user_id: string
  hostname: string
  status: "queued" | "allocating" | "creating" | "configuring" | "starting" | "verifying" | "completed" | "failed"
  current_step: string
  error_code?: string | null
  error_message?: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

const ORDERED_STEPS = [
  { id: "queued", label: "Queued", desc: "Job placed in provisioning queue" },
  { id: "validating_configuration", label: "Validating Configuration", desc: "Checking node connectivity and templates" },
  { id: "allocating_vmid", label: "Allocating VMID", desc: "Acquiring unique container VMID from Proxmox" },
  { id: "reserving_network", label: "Reserving Network", desc: "Assigning IP and bridge network configuration" },
  { id: "creating_container", label: "Creating LXC Container", desc: "Submitting container create request to Proxmox VE" },
  { id: "waiting_for_proxmox_task", label: "Waiting for Hypervisor Task", desc: "Proxmox is unpacking rootfs and writing disk" },
  { id: "configuring_container", label: "Configuring Container", desc: "Applying network and resource limits" },
  { id: "starting_container", label: "Starting Container", desc: "Booting container on hypervisor" },
  { id: "verifying_container", label: "Verifying Container", desc: "Verifying live operational status" },
  { id: "persisting_record", label: "Persisting Record", desc: "Recording instance in InterDash directory" },
  { id: "completed", label: "Completed", desc: "VPS ready for production operations" },
]

export default function AdminVpsDeploymentsPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()

  const [job, setJob] = React.useState<ProvisioningJob | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const fetchJob = React.useCallback(async () => {
    if (!jobId) return
    try {
      const res = await fetch(`/api/provisioning/jobs/${jobId}`)
      if (!res.ok) {
        if (res.status === 404) throw new Error("Provisioning job not found.")
        if (res.status === 403) throw new Error("Access denied.")
        throw new Error("Failed to load provisioning job.")
      }
      const data = await res.json()
      setJob(data.job)
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error loading job")
    } finally {
      setIsLoading(false)
    }
  }, [jobId])

  // Initial load
  React.useEffect(() => {
    fetchJob()
  }, [fetchJob])

  // Polling every 1.5 seconds until terminal state (completed or failed)
  React.useEffect(() => {
    if (!jobId) return
    if (job && (job.status === "completed" || job.status === "failed")) return

    const timer = setInterval(() => {
      fetchJob()
    }, 1500)

    return () => clearInterval(timer)
  }, [jobId, job?.status, fetchJob])

  // Determine current step index
  const getCurrentStepIndex = () => {
    if (!job) return 0
    if (job.status === "completed") return ORDERED_STEPS.length - 1
    const idx = ORDERED_STEPS.findIndex((s) => s.id === job.current_step)
    return idx >= 0 ? idx : 0
  }

  const currentStepIdx = getCurrentStepIndex()

  return (
    <BaseLayout
      title="Provisioning Pipeline Progress"
      description="Live execution telemetry for container deployment on Proxmox VE hypervisor."
      centered
      maxWidth="max-w-4xl"
    >
      <div className="px-4 lg:px-6 space-y-6 max-w-4xl mx-auto w-full pb-20">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            to="/admin/vps/create"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="size-4" /> Back to VPS Creator
          </Link>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={fetchJob}
              disabled={isLoading}
            >
              <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        {isLoading && !job ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-xs font-mono">Loading provisioning task stream...</p>
          </div>
        ) : error && !job ? (
          <div className="p-8 text-center space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive">
            <AlertTriangle className="size-8 mx-auto" />
            <h3 className="font-semibold text-sm">Unable to Track Deployment</h3>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button size="sm" variant="outline" onClick={() => navigate("/admin/vps/create")}>
              Return to VPS Creator
            </Button>
          </div>
        ) : job ? (
          <div className="space-y-6">
            {/* Header Banner */}
            <Card
              className={`border ${
                job.status === "completed"
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : job.status === "failed"
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-border bg-card"
              }`}
            >
              <CardHeader className="pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-mono">Job ID: {job.id}</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] uppercase font-mono ${
                          job.status === "completed"
                            ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/10"
                            : job.status === "failed"
                            ? "border-destructive/40 text-destructive bg-destructive/10"
                            : "border-amber-500/40 text-amber-500 bg-amber-500/10"
                        }`}
                      >
                        {job.status}
                      </Badge>
                    </div>
                    <CardTitle className="text-xl font-bold tracking-tight">
                      Deploying <code className="font-mono text-primary">{job.hostname}</code>
                    </CardTitle>
                  </div>

                  {job.status === "completed" && job.vps_id && (
                    <Button
                      size="sm"
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                      asChild
                    >
                      <Link to={`/instances/${job.vps_id}`}>
                        <Server className="size-4" /> Open Instance Details
                      </Link>
                    </Button>
                  )}
                </div>
              </CardHeader>

              {job.status === "failed" && (
                <CardContent className="pt-0">
                  <div className="p-3 rounded bg-destructive/10 border border-destructive/20 text-xs text-destructive space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <XCircle className="size-4 shrink-0" />
                      Provisioning Failed: {job.error_code || "OPERATION_FAILED"}
                    </div>
                    <p className="text-muted-foreground leading-relaxed pl-5.5">
                      {job.error_message || "An unexpected hypervisor error occurred during container creation."}
                    </p>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Stepper Pipeline */}
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShieldCheck className="size-4 text-primary" /> Execution Pipeline
                </CardTitle>
                <CardDescription className="text-xs">
                  Real Proxmox VE task progression without simulated delays.
                </CardDescription>
              </CardHeader>
              <CardContent className="py-4">
                <div className="space-y-4">
                  {ORDERED_STEPS.map((step, idx) => {
                    const isPassed = job.status === "completed" || idx < currentStepIdx
                    const isCurrent = job.status !== "completed" && job.status !== "failed" && idx === currentStepIdx
                    const isFailed = job.status === "failed" && idx === currentStepIdx

                    return (
                      <div key={step.id} className="flex items-start gap-3">
                        {/* Step Indicator */}
                        <div className="flex flex-col items-center">
                          <div
                            className={`size-7 rounded-full border flex items-center justify-center text-xs shrink-0 transition-colors ${
                              isPassed
                                ? "border-emerald-500 bg-emerald-500/15 text-emerald-500"
                                : isCurrent
                                ? "border-primary bg-primary/20 text-primary shadow-xs"
                                : isFailed
                                ? "border-destructive bg-destructive/15 text-destructive"
                                : "border-border/60 bg-muted/30 text-muted-foreground"
                            }`}
                          >
                            {isPassed ? (
                              <Check className="size-3.5" />
                            ) : isCurrent ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : isFailed ? (
                              <XCircle className="size-3.5" />
                            ) : (
                              <span>{idx + 1}</span>
                            )}
                          </div>
                          {idx < ORDERED_STEPS.length - 1 && (
                            <div
                              className={`w-0.5 h-6 my-1 ${
                                isPassed ? "bg-emerald-500/40" : "bg-border/60"
                              }`}
                            />
                          )}
                        </div>

                        {/* Step Details */}
                        <div className="pt-0.5 min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-xs font-semibold ${
                                isCurrent
                                  ? "text-primary"
                                  : isPassed
                                  ? "text-foreground"
                                  : isFailed
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {step.label}
                            </span>
                            {isCurrent && (
                              <Badge variant="outline" className="text-[9px] py-0 text-primary border-primary/30 animate-pulse">
                                IN PROGRESS
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {step.desc}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>

              <CardFooter className="border-t p-4 flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5 font-mono text-[11px]">
                  <Clock className="size-3.5" />
                  Started: {job.started_at ? new Date(job.started_at).toLocaleTimeString() : "—"}
                </span>

                {job.completed_at && (
                  <span className="font-mono text-[11px]">
                    Completed: {new Date(job.completed_at).toLocaleTimeString()}
                  </span>
                )}
              </CardFooter>
            </Card>
          </div>
        ) : null}
      </div>
    </BaseLayout>
  )
}
