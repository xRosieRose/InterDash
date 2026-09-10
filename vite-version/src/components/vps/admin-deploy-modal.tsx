"use client"

import * as React from "react"
import { Server, Cpu, HardDrive, Check, Loader2, AlertCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"

interface AdminDeployModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

interface UserOption {
  id: string
  username: string
  global_name: string | null
  email: string | null
}

interface NodeOption {
  id: string
  name: string
  hostname: string
  region: string
  flag_url?: string | null
  status: string
}

const DEFAULT_TEMPLATES = [
  { id: "local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst", label: "Ubuntu 24.04 LTS (Noble Numbat)" },
  { id: "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst", label: "Debian 12 (Bookworm)" },
  { id: "local:vztmpl/alpine-3.20-default_20240606_amd64.tar.xz", label: "Alpine Linux 3.20 (Minimal)" },
]

export function AdminDeployModal({ open, onOpenChange, onSuccess }: AdminDeployModalProps) {
  const [users, setUsers] = React.useState<UserOption[]>([])
  const [nodes, setNodes] = React.useState<NodeOption[]>([])
  const [isLoadingOptions, setIsLoadingOptions] = React.useState(false)

  // Form states
  const [ownerUserId, setOwnerUserId] = React.useState("")
  const [targetNodeId, setTargetNodeId] = React.useState("")
  const [hostname, setHostname] = React.useState("")
  const [name, setName] = React.useState("")
  const [osTemplate, setOsTemplate] = React.useState(DEFAULT_TEMPLATES[0].id)
  const [cpuCores, setCpuCores] = React.useState(1)
  const [memoryMb, setMemoryMb] = React.useState(1024)
  const [diskGb, setDiskGb] = React.useState(25)
  const [startAfterCreate, setStartAfterCreate] = React.useState(true)

  // Job polling states
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [jobId, setJobId] = React.useState<string | null>(null)
  const [jobStatus, setJobStatus] = React.useState<string | null>(null)
  const [jobStep, setJobStep] = React.useState<string | null>(null)
  const [jobError, setJobError] = React.useState<string | null>(null)

  // Fetch users and nodes when modal opens
  React.useEffect(() => {
    if (!open) {
      setJobId(null)
      setJobStatus(null)
      setJobStep(null)
      setJobError(null)
      setIsSubmitting(false)
      return
    }

    async function loadOptions() {
      setIsLoadingOptions(true)
      try {
        const [usersRes, nodesRes] = await Promise.all([
          fetch("/api/admin/users"),
          fetch("/api/admin/nodes"),
        ])

        if (usersRes.ok) {
          const uData = await usersRes.json()
          setUsers(uData.users || [])
          if (uData.users?.length) {
            setOwnerUserId(uData.users[0].id)
          }
        }

        if (nodesRes.ok) {
          const nData = await nodesRes.json()
          setNodes(nData.nodes || [])
          if (nData.nodes?.length) {
            setTargetNodeId(nData.nodes[0].id)
          }
        }

        // Generate clean default hostname
        const rand = Math.floor(100 + Math.random() * 900)
        setHostname(`vps-${rand}`)
        setName(`VPS ${rand}`)
      } catch (err) {
        toast.error("Failed to load users or Proxmox nodes.")
      } finally {
        setIsLoadingOptions(false)
      }
    }

    loadOptions()
  }, [open])

  // Poll active provisioning job
  React.useEffect(() => {
    if (!jobId || jobStatus === "completed" || jobStatus === "failed") return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/provisioning/jobs/${jobId}`)
        if (res.ok) {
          const data = await res.json()
          const job = data.job
          setJobStatus(job.status)
          setJobStep(job.current_step)

          if (job.status === "completed") {
            toast.success("VPS provisioned successfully on Proxmox hypervisor!")
            clearInterval(interval)
            setIsSubmitting(false)
            if (onSuccess) onSuccess()
          } else if (job.status === "failed") {
            setJobError(job.error_message || "Provisioning failed on Proxmox.")
            toast.error("Provisioning failed: " + (job.error_message || "Unknown error"))
            clearInterval(interval)
            setIsSubmitting(false)
          }
        }
      } catch {
        // Retry on network glitch
      }
    }, 1500)

    return () => clearInterval(interval)
  }, [jobId, jobStatus, onSuccess])

  const handleDeploy = async () => {
    if (!ownerUserId) {
      toast.error("Please select a target user.")
      return
    }
    if (!targetNodeId) {
      toast.error("Please select a target Proxmox node.")
      return
    }
    if (!hostname.trim()) {
      toast.error("Please enter a valid hostname.")
      return
    }

    setIsSubmitting(true)
    setJobError(null)
    setJobStep("submitting")

    try {
      // Get CSRF token
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const cData = await csrfRes.json()
        csrfToken = cData.token
      }

      const res = await fetch("/api/admin/vps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({
          ownerUserId,
          targetNodeId,
          hostname: hostname.trim(),
          name: name.trim() || hostname.trim(),
          osTemplate,
          cpuCores,
          memoryMb,
          diskGb,
          startAfterCreate,
          idempotencyKey: `deploy-${Date.now()}-${Math.random()}`,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to initiate provisioning.")
      }

      setJobId(data.jobId)
      setJobStatus(data.status)
      setJobStep("queued")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setJobError(msg)
      setIsSubmitting(false)
      toast.error(msg)
    }
  }

  const renderStepDescription = (step: string | null) => {
    switch (step) {
      case "submitting":
      case "queued":
        return "Job queued in background task manager..."
      case "allocating_vmid":
        return "Allocating next available cluster VMID from Proxmox VE..."
      case "reserving_network":
        return "Allocating dedicated network interface and IP routing..."
      case "creating_container":
        return "Creating LXC container through Proxmox REST API..."
      case "waiting_for_proxmox_task":
        return "Extracting OS rootfs volume and configuring resource limits..."
      case "starting_container":
        return "Starting LXC container services..."
      case "verifying_container":
        return "Verifying hypervisor runtime state and network ping..."
      case "completed":
        return "Container provisioned and active!"
      default:
        return "Processing Proxmox provisioning operation..."
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="size-5 text-primary" />
            Provision Proxmox VPS
          </DialogTitle>
          <DialogDescription>
            Deploy a real LXC container on an authenticated Proxmox VE hypervisor and assign it to a user.
          </DialogDescription>
        </DialogHeader>

        {isSubmitting && jobId ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-4">
            {jobStatus === "failed" ? (
              <div className="size-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
                <AlertCircle className="size-6" />
              </div>
            ) : jobStatus === "completed" ? (
              <div className="size-12 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                <Check className="size-6" />
              </div>
            ) : (
              <div className="size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Loader2 className="size-6 animate-spin" />
              </div>
            )}

            <div className="text-center space-y-1">
              <h4 className="font-semibold text-sm capitalize">
                {jobStatus === "completed"
                  ? "Provisioning Complete"
                  : jobStatus === "failed"
                  ? "Provisioning Failed"
                  : "Hypervisor Provisioning Active"}
              </h4>
              <p className="text-xs text-muted-foreground max-w-sm">
                {jobError || renderStepDescription(jobStep)}
              </p>
            </div>

            {jobStatus === "completed" && (
              <Button onClick={() => onOpenChange(false)} className="mt-4">
                Close & View Instance
              </Button>
            )}

            {jobStatus === "failed" && (
              <Button
                variant="outline"
                onClick={() => {
                  setJobId(null)
                  setIsSubmitting(false)
                }}
                className="mt-4"
              >
                Back to Form
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-2 text-sm">
            {isLoadingOptions ? (
              <div className="py-8 flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading Proxmox nodes and users...
              </div>
            ) : (
              <>
                {/* User Assignment */}
                <div className="space-y-1.5">
                  <Label>Assign to User (Mandatory)</Label>
                  <Select value={ownerUserId} onValueChange={setOwnerUserId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select user" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.global_name || u.username} {u.email ? `(${u.email})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Target Node */}
                <div className="space-y-1.5">
                  <Label>Target Proxmox Node</Label>
                  <Select value={targetNodeId} onValueChange={setTargetNodeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Proxmox node" />
                    </SelectTrigger>
                    <SelectContent>
                      {nodes.map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          <span className="flex items-center gap-1.5">
                            {n.flag_url ? (
                              <img
                                src={n.flag_url}
                                alt=""
                                className="w-4 h-2.5 object-cover rounded-[1px] border border-border/60 shrink-0"
                              />
                            ) : null}
                            <span>{n.name} ({n.region}) — {n.status}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Hostname & Name */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Hostname</Label>
                    <Input
                      placeholder="e.g. srv-01"
                      value={hostname}
                      onChange={(e) => setHostname(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Display Label</Label>
                    <Input
                      placeholder="e.g. Production Web"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                </div>

                {/* OS Template */}
                <div className="space-y-1.5">
                  <Label>OS / LXC Template</Label>
                  <Select value={osTemplate} onValueChange={setOsTemplate}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select template" />
                    </SelectTrigger>
                    <SelectContent>
                      {DEFAULT_TEMPLATES.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Specs: Cores, RAM, Disk */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1">
                      <Cpu className="size-3.5 text-muted-foreground" /> Cores
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      max={16}
                      value={cpuCores}
                      onChange={(e) => setCpuCores(parseInt(e.target.value, 10) || 1)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1">
                      <Server className="size-3.5 text-muted-foreground" /> RAM (MB)
                    </Label>
                    <Input
                      type="number"
                      min={512}
                      step={512}
                      value={memoryMb}
                      onChange={(e) => setMemoryMb(parseInt(e.target.value, 10) || 1024)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1">
                      <HardDrive className="size-3.5 text-muted-foreground" /> Disk (GB)
                    </Label>
                    <Input
                      type="number"
                      min={5}
                      max={500}
                      value={diskGb}
                      onChange={(e) => setDiskGb(parseInt(e.target.value, 10) || 25)}
                    />
                  </div>
                </div>

                {/* Start Container Immediately Toggle */}
                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="space-y-0.5">
                    <Label>Start After Creation</Label>
                    <p className="text-xs text-muted-foreground">
                      Power on the container immediately after rootfs initialization.
                    </p>
                  </div>
                  <Switch checked={startAfterCreate} onCheckedChange={setStartAfterCreate} />
                </div>
              </>
            )}
          </div>
        )}

        {!isSubmitting && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleDeploy} disabled={isLoadingOptions || nodes.length === 0}>
              Deploy LXC Container
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
