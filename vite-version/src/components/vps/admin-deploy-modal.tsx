"use client"

import * as React from "react"
import {
  Server,
  Cpu,
  HardDrive,
  Check,
  Loader2,
  AlertCircle,
  Key,
  Eye,
  EyeOff,
  Copy,
  Sparkles,
  Network,
} from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
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

interface TemplateOption {
  volid: string
  format: string
  size: number
}

interface IpPoolOption {
  id: string
  name: string
  cidr: string
  available_ips: number
}

export function AdminDeployModal({ open, onOpenChange, onSuccess }: AdminDeployModalProps) {
  const [users, setUsers] = React.useState<UserOption[]>([])
  const [nodes, setNodes] = React.useState<NodeOption[]>([])
  const [isLoadingOptions, setIsLoadingOptions] = React.useState(false)

  // Dynamic capabilities for selected node
  const [nodeCapabilitiesLoading, setNodeCapabilitiesLoading] = React.useState(false)
  const [availableTemplates, setAvailableTemplates] = React.useState<TemplateOption[]>([])
  const [availableIpPools, setAvailableIpPools] = React.useState<IpPoolOption[]>([])

  // Form states
  const [ownerUserId, setOwnerUserId] = React.useState("")
  const [targetNodeId, setTargetNodeId] = React.useState("")
  const [hostname, setHostname] = React.useState("")
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [osTemplate, setOsTemplate] = React.useState("")
  const [ipv4PoolId, setIpv4PoolId] = React.useState<string>("auto")
  const [cpuCores, setCpuCores] = React.useState(1)
  const [memoryMb, setMemoryMb] = React.useState(1024)
  const [diskGb, setDiskGb] = React.useState(25)
  const [rootPassword, setRootPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [sshPublicKey, setSshPublicKey] = React.useState("")
  const [startAfterCreate, setStartAfterCreate] = React.useState(true)

  // Post-deploy credentials display
  const [deployedCredentials, setDeployedCredentials] = React.useState<{
    password?: string
    copied?: boolean
  } | null>(null)

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
      setDeployedCredentials(null)
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

        // Clean initial hostname based on timestamp
        const timeSuffix = Date.now().toString().slice(-4)
        setHostname(`vps-${timeSuffix}`)
        setName(`VPS ${timeSuffix}`)
      } catch {
        toast.error("Failed to load users or Proxmox nodes.")
      } finally {
        setIsLoadingOptions(false)
      }
    }

    loadOptions()
  }, [open])

  // Invalidate and fetch real templates & IP pools when targetNodeId changes
  React.useEffect(() => {
    if (!targetNodeId) {
      setAvailableTemplates([])
      setAvailableIpPools([])
      setOsTemplate("")
      return
    }

    let isMounted = true
    setNodeCapabilitiesLoading(true)
    setAvailableTemplates([])
    setAvailableIpPools([])
    setOsTemplate("")

    async function loadCapabilities() {
      try {
        const res = await fetch(`/api/admin/nodes/${targetNodeId}/capabilities`)
        if (!res.ok) throw new Error("Failed to query node capabilities")
        const data = await res.json()

        if (isMounted) {
          const templates: TemplateOption[] = data.templates || []
          setAvailableTemplates(templates)
          if (templates.length > 0) {
            setOsTemplate(templates[0].volid)
          }

          const pools: IpPoolOption[] = data.ipPools || []
          setAvailableIpPools(pools)
        }
      } catch {
        if (isMounted) {
          toast.error("Could not discover LXC templates on target node.")
        }
      } finally {
        if (isMounted) {
          setNodeCapabilitiesLoading(false)
        }
      }
    }

    loadCapabilities()

    return () => {
      isMounted = false
    }
  }, [targetNodeId])

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
            toast.success("VPS provisioned successfully on Proxmox VE!")
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

  const generatePassword = () => {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*"
    let pass = ""
    for (let i = 0; i < 16; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    setRootPassword(pass)
    setShowPassword(true)
  }

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
    if (!osTemplate) {
      toast.error("Please select an available OS template from the hypervisor.")
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

      const clientKey = `deploy-${Date.now()}-${crypto.randomUUID()}`

      const res = await fetch("/api/admin/vps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({
          ownerUserId,
          targetNodeId,
          hostname: hostname.trim().toLowerCase(),
          name: name.trim() || hostname.trim(),
          description: description.trim() || undefined,
          osTemplate,
          cpuCores,
          memoryMb,
          diskGb,
          ipv4PoolId: ipv4PoolId !== "auto" ? ipv4PoolId : undefined,
          rootPassword: rootPassword.trim() || undefined,
          sshPublicKey: sshPublicKey.trim() || undefined,
          startAfterCreate,
          idempotencyKey: clientKey,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to initiate provisioning.")
      }

      setJobId(data.jobId)
      setJobStatus(data.status)
      setJobStep("queued")

      if (data.generatedPassword || rootPassword) {
        setDeployedCredentials({
          password: data.generatedPassword || rootPassword,
          copied: false,
        })
      }
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
      case "validating_configuration":
        return "Checking hypervisor reachability and storage health..."
      case "allocating_vmid":
        return "Allocating next available cluster VMID from Proxmox VE..."
      case "reserving_network":
        return "Allocating dedicated network interface and IP routing..."
      case "creating_container":
        return "Creating LXC container through Proxmox REST API..."
      case "waiting_for_proxmox_task":
        return "Extracting OS rootfs volume and applying cgroup configuration..."
      case "configuring_container":
        return "Applying DNS and SSH authentication parameters..."
      case "starting_container":
        return "Starting LXC container services..."
      case "verifying_container":
        return "Verifying hypervisor runtime state and socket health..."
      case "completed":
        return "Container provisioned and active!"
      default:
        return "Processing Proxmox provisioning operation..."
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[580px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="size-5 text-primary" />
            Provision Real Proxmox VPS
          </DialogTitle>
          <DialogDescription>
            Deploy a real LXC container directly on an authenticated Proxmox VE node.
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

            {jobStatus === "completed" && deployedCredentials?.password && (
              <div className="w-full max-w-md p-3 rounded-md border border-amber-500/30 bg-amber-500/5 space-y-2 mt-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground flex items-center gap-1">
                    <Key className="size-3.5 text-amber-500" /> Root Password (Shown Once):
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] gap-1"
                    onClick={() => {
                      navigator.clipboard.writeText(deployedCredentials.password || "")
                      setDeployedCredentials({ ...deployedCredentials, copied: true })
                      toast.success("Root password copied to clipboard!")
                    }}
                  >
                    {deployedCredentials.copied ? (
                      <>
                        <Check className="size-3 text-emerald-500" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="size-3" /> Copy
                      </>
                    )}
                  </Button>
                </div>
                <code className="block font-mono bg-background p-2 rounded border text-foreground text-xs break-all select-all">
                  {deployedCredentials.password}
                </code>
                <p className="text-[10px] text-muted-foreground">
                  Save this root password now. It is never stored in plaintext on InterDash servers.
                </p>
              </div>
            )}

            {jobStatus === "completed" && (
              <Button onClick={() => onOpenChange(false)} className="mt-4">
                Close & View Fleet
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
                Back to Configuration
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
                {/* User Assignment & Target Node */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Owner User</Label>
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

                  <div className="space-y-1.5">
                    <Label>Target Node</Label>
                    <Select value={targetNodeId} onValueChange={setTargetNodeId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select node" />
                      </SelectTrigger>
                      <SelectContent>
                        {nodes.map((n) => (
                          <SelectItem key={n.id} value={n.id}>
                            <span className="flex items-center gap-1.5">
                              {n.flag_url && (
                                <img
                                  src={n.flag_url}
                                  alt=""
                                  className="w-4 h-2.5 object-cover rounded-[1px] border border-border/60 shrink-0"
                                />
                              )}
                              <span>{n.name} ({n.region})</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Hostname & Display Label */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Hostname (Linux)</Label>
                    <Input
                      placeholder="e.g. web-app-01"
                      value={hostname}
                      onChange={(e) => setHostname(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Display Name</Label>
                    <Input
                      placeholder="e.g. Production Web Service"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                </div>

                {/* Description (Optional) */}
                <div className="space-y-1.5">
                  <Label>Description / Notes (Optional)</Label>
                  <Input
                    placeholder="e.g. Primary frontend reverse proxy"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                {/* Real Dynamic OS Template Discovery */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>OS Template (Authoritative from Node)</Label>
                    {nodeCapabilitiesLoading && (
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin" /> Querying vztmpl...
                      </span>
                    )}
                  </div>
                  {availableTemplates.length > 0 ? (
                    <Select value={osTemplate} onValueChange={setOsTemplate}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select discovered template" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableTemplates.map((t) => {
                          const simpleName = t.volid.split("/").pop() || t.volid
                          return (
                            <SelectItem key={t.volid} value={t.volid}>
                              {simpleName} ({Math.round(t.size / 1024 / 1024)} MB)
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="p-3 rounded border border-dashed border-amber-500/40 bg-amber-500/5 text-xs text-amber-600 dark:text-amber-400">
                      {nodeCapabilitiesLoading
                        ? "Querying Proxmox storage for container templates..."
                        : "No container templates (.tar.zst/.tar.xz) found in node's storage pools. Upload a template to Proxmox first."}
                    </div>
                  )}
                </div>

                {/* Hardware Resources: Cores, RAM, Disk */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1">
                      <Cpu className="size-3.5 text-muted-foreground" /> Cores
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      max={32}
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

                {/* Network / IP Pool */}
                {availableIpPools.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1">
                      <Network className="size-3.5 text-muted-foreground" /> IPv4 Pool Allocation
                    </Label>
                    <Select value={ipv4PoolId} onValueChange={setIpv4PoolId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Automatic (DHCP)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automatic (Hypervisor Bridge DHCP)</SelectItem>
                        {availableIpPools.map((pool) => (
                          <SelectItem key={pool.id} value={pool.id} disabled={pool.available_ips === 0}>
                            {pool.name} ({pool.cidr}) — {pool.available_ips} available
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Authentication: Root Password */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1">
                      <Key className="size-3.5 text-muted-foreground" /> Root Password
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs gap-1 text-primary"
                      onClick={generatePassword}
                    >
                      <Sparkles className="size-3" /> Auto-Generate
                    </Button>
                  </div>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Leave empty to auto-generate securely"
                      value={rootPassword}
                      onChange={(e) => setRootPassword(e.target.value)}
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

                {/* SSH Public Key */}
                <div className="space-y-1.5">
                  <Label>SSH Public Key (Optional)</Label>
                  <Textarea
                    placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... user@host"
                    value={sshPublicKey}
                    onChange={(e) => setSshPublicKey(e.target.value)}
                    className="font-mono text-xs h-16 resize-none"
                  />
                </div>

                {/* Start Container Immediately Toggle */}
                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="space-y-0.5">
                    <Label>Start After Creation</Label>
                    <p className="text-xs text-muted-foreground">
                      Power on the container immediately after initialization.
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
            <Button
              onClick={handleDeploy}
              disabled={
                isLoadingOptions ||
                nodes.length === 0 ||
                availableTemplates.length === 0 ||
                nodeCapabilitiesLoading
              }
            >
              Deploy LXC Container
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
