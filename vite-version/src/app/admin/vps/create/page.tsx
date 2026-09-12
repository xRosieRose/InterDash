"use client"

import * as React from "react"
import { useNavigate, Link } from "react-router-dom"
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
  Sparkles,
  Network,
  Layers,
  ShieldCheck,
  ArrowRight,
  User as UserIcon,
  ChevronLeft,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  Globe,
  Clock,
} from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"

interface UserOption {
  id: string
  username: string
  global_name: string | null
  email: string | null
  avatar_hash?: string | null
  role: string
}

interface NodeOption {
  id: string
  name: string
  hostname: string
  port: number
  node_name: string
  region: string
  flag_url?: string | null
  status: string
  enabled: number
  vps_count: number
  last_verified_at: string | null
  default_template_storage?: string | null
  default_rootfs_storage?: string | null
  default_bridge?: string | null
}

interface DiscoveredTemplate {
  volid: string
  storage: string
  filename: string
  format?: string
  sizeBytes?: number
  osFamily?: string
}

interface PreflightCheck {
  name: string
  status: "passed" | "failed" | "warning"
  message: string
}

export default function AdminVpsCreatePage() {
  const navigate = useNavigate()

  // Form State
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [hostname, setHostname] = React.useState("")
  const [selectedUserId, setSelectedUserId] = React.useState("")
  const [selectedNodeId, setSelectedNodeId] = React.useState("")
  const [selectedTemplate, setSelectedTemplate] = React.useState("")
  const [templateStorage, setTemplateStorage] = React.useState("")
  const [rootfsStorage, setRootfsStorage] = React.useState("")
  const [cpuCores, setCpuCores] = React.useState(2)
  const [memoryMb, setMemoryMb] = React.useState(2048)
  const [swapMb, setSwapMb] = React.useState(512)
  const [diskGb, setDiskGb] = React.useState(25)
  const [bridge, setBridge] = React.useState("")
  const [ipv4PoolId, setIpv4PoolId] = React.useState("")
  const [startAfterCreate, setStartAfterCreate] = React.useState(true)
  const [rootPassword, setRootPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [sshPublicKey, setSshPublicKey] = React.useState("")
  const [expiryPreset, setExpiryPreset] = React.useState<"never" | "7d" | "30d" | "90d" | "custom">("never")
  const [customExpiryDate, setCustomExpiryDate] = React.useState("")

  // Remote data state
  const [users, setUsers] = React.useState<UserOption[]>([])
  const [userSearchQuery, setUserSearchQuery] = React.useState("")
  const [nodes, setNodes] = React.useState<NodeOption[]>([])
  const [isLoadingInitial, setIsLoadingInitial] = React.useState(true)

  // Node capabilities
  const [isLoadingCaps, setIsLoadingCaps] = React.useState(false)
  const [discoveredTemplates, setDiscoveredTemplates] = React.useState<DiscoveredTemplate[]>([])
  const [discoveredTemplateStorages, setDiscoveredTemplateStorages] = React.useState<string[]>([])
  const [discoveredRootfsStorages, setDiscoveredRootfsStorages] = React.useState<string[]>([])
  const [discoveredBridges, setDiscoveredBridges] = React.useState<string[]>([])
  const [discoveredIpPools, setDiscoveredIpPools] = React.useState<Array<{ id: string; name: string; subnet: string }>>([])

  // Preflight & submission state
  const [isRunningPreflight, setIsRunningPreflight] = React.useState(false)
  const [preflightResults, setPreflightResults] = React.useState<{
    valid: boolean
    checks: PreflightCheck[]
    error?: string
  } | null>(null)
  const [isDeploying, setIsDeploying] = React.useState(false)
  const capRequestIdRef = React.useRef(0)

  // Helper for CSRF
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

  // Load available users and provision-ready nodes
  React.useEffect(() => {
    async function loadData() {
      setIsLoadingInitial(true)
      try {
        const [usersRes, nodesRes] = await Promise.all([
          fetch("/api/admin/users"),
          fetch("/api/admin/nodes"),
        ])

        if (usersRes.ok) {
          const uData = await usersRes.json()
          const activeUsers = (uData.users || []).filter((u: any) => u.status !== "suspended")
          setUsers(activeUsers)
          if (activeUsers.length > 0 && !selectedUserId) {
            setSelectedUserId(activeUsers[0].id)
          }
        }

        if (nodesRes.ok) {
          const nData = await nodesRes.json()
          // Only show enabled, non-draining, non-offline nodes
          const readyNodes = (nData.nodes || []).filter(
            (n: NodeOption) =>
              n.enabled !== 0 &&
              !["disabled", "draining", "deleting", "offline"].includes(n.status)
          )
          setNodes(readyNodes)
          if (readyNodes.length > 0 && !selectedNodeId) {
            setSelectedNodeId(readyNodes[0].id)
          }
        }
      } catch (err) {
        toast.error("Failed to load users or hypervisor nodes.")
      } finally {
        setIsLoadingInitial(false)
      }
    }
    loadData()
  }, [])

  // Load capabilities whenever selected node changes with request versioning
  React.useEffect(() => {
    if (!selectedNodeId) return

    const currentReqId = ++capRequestIdRef.current
    setIsLoadingCaps(true)
    setPreflightResults(null)
    setSelectedTemplate("")
    setTemplateStorage("")
    setRootfsStorage("")
    setBridge("")
    setIpv4PoolId("")

    async function loadNodeCapabilities() {
      try {
        const res = await fetch(`/api/admin/nodes/${selectedNodeId}/capabilities`)
        if (!res.ok) throw new Error("Failed to query node capabilities.")
        const data = await res.json()

        // Discard stale responses if user switched nodes
        if (currentReqId !== capRequestIdRef.current) return

        const templates: DiscoveredTemplate[] = data.templates || []
        const tStorages: string[] = data.templateStorages || []
        const rStorages: string[] = data.rootfsStorages || []
        const bridges: string[] = (data.bridges || []).map((b: any) => b.iface)
        const ipPools = data.ipPools || []

        setDiscoveredTemplates(templates)
        setDiscoveredTemplateStorages(tStorages)
        setDiscoveredRootfsStorages(rStorages)
        setDiscoveredBridges(bridges)
        setDiscoveredIpPools(ipPools)

        // Select initial template
        if (templates.length > 0) {
          setSelectedTemplate(templates[0].volid)
          setTemplateStorage(templates[0].storage || tStorages[0] || "")
        } else {
          setSelectedTemplate("")
          setTemplateStorage(tStorages[0] || "")
        }

        // Set storage defaults
        if (rStorages.length > 0) {
          const defRoot = data.defaultRootfsStorage && rStorages.includes(data.defaultRootfsStorage)
            ? data.defaultRootfsStorage
            : rStorages[0]
          setRootfsStorage(defRoot)
        } else {
          setRootfsStorage("")
        }

        // Set bridge default
        if (bridges.length > 0) {
          const defBridge = data.defaultBridge && bridges.includes(data.defaultBridge)
            ? data.defaultBridge
            : bridges[0]
          setBridge(defBridge)
        } else {
          setBridge("")
        }

        if (ipPools.length > 0) {
          setIpv4PoolId(ipPools[0].id)
        } else {
          setIpv4PoolId("")
        }
      } catch (err: unknown) {
        if (currentReqId !== capRequestIdRef.current) return
        toast.error(err instanceof Error ? err.message : "Error fetching node capabilities")
      } finally {
        if (currentReqId === capRequestIdRef.current) {
          setIsLoadingCaps(false)
        }
      }
    }

    loadNodeCapabilities()
  }, [selectedNodeId])

  // When selected template changes, update its template storage
  const handleTemplateChange = (volid: string) => {
    setSelectedTemplate(volid)
    const match = discoveredTemplates.find((t) => t.volid === volid)
    if (match && match.storage) {
      setTemplateStorage(match.storage)
    }
  }

  // Filtered users for user picker
  const filteredUsers = React.useMemo(() => {
    if (!userSearchQuery.trim()) return users
    const q = userSearchQuery.toLowerCase()
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        (u.global_name && u.global_name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q))
    )
  }, [users, userSearchQuery])

  const selectedUser = users.find((u) => u.id === selectedUserId)
  const selectedNode = nodes.find((n) => n.id === selectedNodeId)

  // Generate secure password
  const generatePassword = () => {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*"
    let pass = ""
    for (let i = 0; i < 16; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    setRootPassword(pass)
    setShowPassword(true)
    toast.success("Cryptographically random password generated.")
  }

  // Run Preflight Check
  const runPreflight = async (): Promise<boolean> => {
    if (!selectedNodeId || !selectedUserId || !hostname.trim() || !selectedTemplate) {
      toast.error("Please fill in Owner, Node, Hostname, and OS Template before running preflight.")
      return false
    }

    setIsRunningPreflight(true)
    setPreflightResults(null)
    try {
      const csrfHeaders = await getCsrfHeader()
      const res = await fetch("/api/admin/vps/preflight", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...csrfHeaders,
        },
        body: JSON.stringify({
          ownerUserId: selectedUserId,
          targetNodeId: selectedNodeId,
          hostname: hostname.trim().toLowerCase(),
          osTemplate: selectedTemplate,
          templateVolid: selectedTemplate,
          cpuCores,
          memoryMb,
          diskGb,
          rootfsStorage: rootfsStorage || undefined,
          storage: rootfsStorage || undefined,
          bridge: bridge || undefined,
          ipv4PoolId: ipv4PoolId || undefined,
        }),
      })

      const data = await res.json()
      setPreflightResults(data)

      if (data.valid) {
        toast.success("Preflight checks passed successfully.")
        return true
      } else {
        toast.error(data.error || "Preflight validation failed.")
        return false
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Preflight failed"
      toast.error(msg)
      setPreflightResults({
        valid: false,
        error: msg,
        checks: [{ name: "preflight_network", status: "failed", message: msg }],
      })
      return false
    } finally {
      setIsRunningPreflight(false)
    }
  }

  // Submit Provisioning Job
  const handleProvision = async () => {
    // Basic validation
    if (!hostname.trim()) {
      toast.error("Hostname is required.")
      return
    }
    const cleanHostname = hostname.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(cleanHostname)) {
      toast.error("Hostname must be 1-63 lowercase alphanumeric characters or hyphens.")
      return
    }
    if (!selectedUserId) {
      toast.error("Owner user is required.")
      return
    }
    if (!selectedNodeId) {
      toast.error("Proxmox target node is required.")
      return
    }
    if (!selectedTemplate) {
      toast.error("OS Template is required.")
      return
    }

    setIsDeploying(true)
    try {
      const csrfHeaders = await getCsrfHeader()
      const idempotencyKey = `prov_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

      let expiresAt: string | undefined = undefined
      if (expiryPreset === "7d") {
        expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
      } else if (expiryPreset === "30d") {
        expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
      } else if (expiryPreset === "90d") {
        expiresAt = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString()
      } else if (expiryPreset === "custom" && customExpiryDate) {
        expiresAt = new Date(customExpiryDate).toISOString()
      }

      const res = await fetch("/api/admin/vps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...csrfHeaders,
        },
        body: JSON.stringify({
          ownerUserId: selectedUserId,
          targetNodeId: selectedNodeId,
          hostname: cleanHostname,
          name: name.trim() || `${cleanHostname} Instance`,
          description: description.trim() || undefined,
          osTemplate: selectedTemplate,
          cpuCores,
          memoryMb,
          swapMb,
          diskGb,
          storage: rootfsStorage || undefined,
          bridge: bridge || undefined,
          ipv4PoolId: ipv4PoolId || undefined,
          startAfterCreate,
          rootPassword: rootPassword.trim() || undefined,
          sshPublicKey: sshPublicKey.trim() || undefined,
          expiresAt,
          idempotencyKey,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Provisioning initiation failed.")
      }

      toast.success("VPS provisioning job queued!")
      // Redirect to dedicated deployment progress page
      navigate(`/admin/vps/deployments/${data.jobId}`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Provisioning failed")
    } finally {
      setIsDeploying(false)
    }
  }

  return (
    <BaseLayout
      title="Provision Virtual Private Server"
      description="Dedicated infrastructure workspace for configuring, pre-flighting, and deploying LXC containers on Proxmox VE."
      centered
      maxWidth="max-w-6xl"
    >
      <div className="px-4 lg:px-6 space-y-6 max-w-6xl mx-auto w-full pb-20">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            to="/instances"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="size-4" /> Back to Instances
          </Link>

          <Badge variant="outline" className="text-xs border-primary/30 text-primary bg-primary/5">
            Admin Infrastructure Workspace
          </Badge>
        </div>

        {isLoadingInitial ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-xs font-mono">Loading cluster nodes and identity registry...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Columns: Configuration Form */}
            <div className="lg:col-span-2 space-y-6">
              {/* Section 1: Identity */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Server className="size-4 text-primary" /> 1. Instance Identity
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Define the system hostname and human-readable label in the InterDash directory.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">
                        System Hostname <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        placeholder="web-node-01"
                        value={hostname}
                        onChange={(e) => {
                          const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")
                          setHostname(val)
                          if (!name) setName(val)
                        }}
                        className="font-mono text-xs"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        DNS-compliant identifier (lowercase, numbers, hyphens).
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Display Name</Label>
                      <Input
                        placeholder="Production Web Server"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Description / Notes (Optional)</Label>
                    <Textarea
                      placeholder="Brief note on workload or customer assignment"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="text-xs h-16 resize-none"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Section 2: Ownership */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <UserIcon className="size-4 text-primary" /> 2. Owner Assignment
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Designate the InterDash user who owns and manages this VPS instance.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Input
                      placeholder="Filter users by username or email..."
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      className="text-xs"
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                      {filteredUsers.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-4 col-span-2 text-center">
                          No matching active users found.
                        </p>
                      ) : (
                        filteredUsers.map((u) => {
                          const isSelected = selectedUserId === u.id
                          return (
                            <div
                              key={u.id}
                              onClick={() => setSelectedUserId(u.id)}
                              className={`p-2.5 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-colors ${
                                isSelected
                                  ? "border-primary bg-primary/10 shadow-xs"
                                  : "border-border/60 hover:bg-muted/40"
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="size-7 rounded-full bg-muted border flex items-center justify-center font-semibold text-xs shrink-0">
                                  {u.username.substring(0, 2).toUpperCase()}
                                </div>
                                <div className="truncate">
                                  <div className="font-semibold text-foreground truncate">
                                    {u.global_name || u.username}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground font-mono truncate">
                                    @{u.username}
                                  </div>
                                </div>
                              </div>
                              {isSelected && <Check className="size-4 text-primary shrink-0 ml-1" />}
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Section 3: Hypervisor Node */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <HardDrive className="size-4 text-primary" /> 3. Target Proxmox Hypervisor
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Select an enabled Proxmox VE hypervisor node for deployment.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {nodes.length === 0 ? (
                    <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/5 text-xs text-destructive flex items-center gap-2">
                      <AlertTriangle className="size-4 shrink-0" />
                      <span>No enabled Proxmox nodes are currently registered. Please configure a node under Admin → Nodes.</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {nodes.map((node) => {
                        const isSelected = selectedNodeId === node.id
                        return (
                          <div
                            key={node.id}
                            onClick={() => setSelectedNodeId(node.id)}
                            className={`p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                              isSelected
                                ? "border-primary bg-primary/10 shadow-xs"
                                : "border-border/60 hover:bg-muted/40"
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                {node.flag_url ? (
                                  <img
                                    src={node.flag_url}
                                    alt={node.region}
                                    className="w-5 h-3.5 object-cover rounded-[2px] border shrink-0"
                                  />
                                ) : (
                                  <Globe className="size-4 text-muted-foreground" />
                                )}
                                <span className="font-semibold text-foreground">{node.name}</span>
                              </div>
                              <Badge
                                variant="outline"
                                className={`text-[10px] py-0 ${
                                  node.status === "healthy" || node.status === "online"
                                    ? "text-emerald-500 border-emerald-500/30"
                                    : "text-amber-500 border-amber-500/30"
                                }`}
                              >
                                {node.status}
                              </Badge>
                            </div>

                            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                              <span>PVE: {node.node_name}</span>
                              <span>{node.vps_count} instance(s)</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Section 4 & 5: OS Template & Storage */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileCode className="size-4 text-primary" /> 4. Operating System & Storage Pools
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Select a verified Linux template from the hypervisor and root filesystem storage pool.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isLoadingCaps ? (
                    <div className="py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-4 animate-spin text-primary" />
                      <span>Querying available container templates from Proxmox...</span>
                    </div>
                  ) : discoveredTemplates.length === 0 ? (
                    <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs text-amber-600 dark:text-amber-400 space-y-1">
                      <p className="font-medium flex items-center gap-1.5">
                        <AlertTriangle className="size-3.5" /> No Container Templates Found
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        This hypervisor does not have any LXC templates in its <code className="font-mono">vztmpl</code> storage pools.
                        Upload a template to Proxmox VE before provisioning.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">
                          Operating System Template <span className="text-destructive">*</span>
                        </Label>
                        <Select value={selectedTemplate} onValueChange={handleTemplateChange}>
                          <SelectTrigger className="font-mono text-xs">
                            <SelectValue placeholder="Select OS Template" />
                          </SelectTrigger>
                          <SelectContent>
                            {discoveredTemplates.map((tmpl) => (
                              <SelectItem key={tmpl.volid} value={tmpl.volid} className="text-xs font-mono">
                                {tmpl.volid.split("/").pop()} ({tmpl.storage})
                                {tmpl.sizeBytes ? ` · ${(tmpl.sizeBytes / (1024 * 1024)).toFixed(0)} MB` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium">
                            Rootfs Storage Pool <span className="text-destructive">*</span>
                          </Label>
                          {discoveredRootfsStorages.length > 0 ? (
                            <Select value={rootfsStorage} onValueChange={setRootfsStorage}>
                              <SelectTrigger className="font-mono text-xs">
                                <SelectValue placeholder="Select rootfs storage" />
                              </SelectTrigger>
                              <SelectContent>
                                {discoveredRootfsStorages.map((s) => (
                                  <SelectItem key={s} value={s} className="text-xs font-mono">
                                    {s} (rootdir)
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              value={rootfsStorage}
                              onChange={(e) => setRootfsStorage(e.target.value)}
                              placeholder="local-lvm"
                              className="font-mono text-xs"
                            />
                          )}
                          <p className="text-[11px] text-muted-foreground">
                            Storage pool dedicated to container root disks.
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium">Template Storage (vztmpl)</Label>
                          {discoveredTemplateStorages.length > 1 ? (
                            <Select value={templateStorage} onValueChange={setTemplateStorage}>
                              <SelectTrigger className="font-mono text-xs">
                                <SelectValue placeholder="Select template storage" />
                              </SelectTrigger>
                              <SelectContent>
                                {discoveredTemplateStorages.map((s) => (
                                  <SelectItem key={s} value={s} className="text-xs font-mono">
                                    {s} (vztmpl)
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              value={templateStorage || "auto-detected"}
                              disabled
                              className="font-mono text-xs bg-muted/40"
                            />
                          )}
                          <p className="text-[11px] text-muted-foreground">
                            Hypervisor pool hosting the chosen template archive.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Section 6: Compute Resources */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Cpu className="size-4 text-primary" /> 5. Compute Resources
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Allocate dedicated CPU cores, system RAM, swap memory, and storage volume.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* CPU Cores */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">vCPU Cores</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={64}
                          value={cpuCores}
                          onChange={(e) => setCpuCores(parseInt(e.target.value, 10) || 1)}
                          className="font-mono text-xs w-24"
                        />
                        <div className="flex gap-1">
                          {[1, 2, 4, 8].map((c) => (
                            <Button
                              key={c}
                              type="button"
                              variant={cpuCores === c ? "default" : "outline"}
                              size="sm"
                              className="h-8 px-2 text-xs"
                              onClick={() => setCpuCores(c)}
                            >
                              {c}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* RAM */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Memory (RAM)</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={256}
                          max={131072}
                          value={memoryMb}
                          onChange={(e) => setMemoryMb(parseInt(e.target.value, 10) || 1024)}
                          className="font-mono text-xs w-28"
                        />
                        <div className="flex gap-1">
                          {[
                            { label: "1G", val: 1024 },
                            { label: "2G", val: 2048 },
                            { label: "4G", val: 4096 },
                            { label: "8G", val: 8192 },
                          ].map((m) => (
                            <Button
                              key={m.val}
                              type="button"
                              variant={memoryMb === m.val ? "default" : "outline"}
                              size="sm"
                              className="h-8 px-2 text-xs"
                              onClick={() => setMemoryMb(m.val)}
                            >
                              {m.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Disk Size */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Disk Size (GB)</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={5}
                          max={2048}
                          value={diskGb}
                          onChange={(e) => setDiskGb(parseInt(e.target.value, 10) || 25)}
                          className="font-mono text-xs w-24"
                        />
                        <div className="flex gap-1">
                          {[25, 50, 100, 250].map((d) => (
                            <Button
                              key={d}
                              type="button"
                              variant={diskGb === d ? "default" : "outline"}
                              size="sm"
                              className="h-8 px-2 text-xs"
                              onClick={() => setDiskGb(d)}
                            >
                              {d}G
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Swap Memory */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Swap Memory (MB)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={32768}
                        value={swapMb}
                        onChange={(e) => setSwapMb(parseInt(e.target.value, 10) || 512)}
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Section 7: Network & IPAM */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Network className="size-4 text-primary" /> 6. Networking & IPAM
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Select the Linux bridge interface and manage IP address allocation.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Network Bridge</Label>
                      {discoveredBridges.length > 0 ? (
                        <Select value={bridge} onValueChange={setBridge}>
                          <SelectTrigger className="font-mono text-xs">
                            <SelectValue placeholder="Select bridge" />
                          </SelectTrigger>
                          <SelectContent>
                            {discoveredBridges.map((b) => (
                              <SelectItem key={b} value={b} className="text-xs font-mono">
                                {b}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={bridge}
                          onChange={(e) => setBridge(e.target.value)}
                          placeholder="vmbr0"
                          className="font-mono text-xs"
                        />
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">IPv4 Pool (IPAM)</Label>
                      {discoveredIpPools.length > 0 ? (
                        <Select
                          value={ipv4PoolId || "dhcp"}
                          onValueChange={(val) => setIpv4PoolId(val === "dhcp" ? "" : val)}
                        >
                          <SelectTrigger className="text-xs font-mono">
                            <SelectValue placeholder="DHCP / Auto-assign" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dhcp" className="text-xs">
                              Auto / DHCP (Default)
                            </SelectItem>
                            {discoveredIpPools.map((p) => (
                              <SelectItem key={p.id} value={p.id} className="text-xs font-mono">
                                {p.name} ({p.subnet})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value="Auto DHCP (No node IP pools registered)"
                          disabled
                          className="text-xs bg-muted/40"
                        />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Section 8: Authentication & Startup */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Key className="size-4 text-primary" /> 7. Authentication & Startup
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Set Linux root credentials and configure immediate container boot.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">Root Password</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[11px] gap-1 text-primary cursor-pointer"
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
                        className="pr-10 text-xs font-mono"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full w-9 text-muted-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Root passwords are transmitted securely to Proxmox and never stored in plaintext on InterDash servers.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">SSH Public Key (Optional)</Label>
                    <Textarea
                      placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI..."
                      value={sshPublicKey}
                      onChange={(e) => setSshPublicKey(e.target.value)}
                      className="font-mono text-[11px] h-16 resize-none"
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                    <div className="space-y-0.5">
                      <Label className="text-xs font-semibold cursor-pointer" htmlFor="start-after-create">
                        Start container after creation
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        Boot the container immediately upon successful task completion.
                      </p>
                    </div>
                    <Switch
                      id="start-after-create"
                      checked={startAfterCreate}
                      onCheckedChange={setStartAfterCreate}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Section 8: Lifetime & Expiration Policy */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="size-4 text-primary" /> 8. Lifetime & Expiration Policy
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Configure durable instance expiration. Expired VPS instances are automatically stopped and protected against execution.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Expiration Duration</Label>
                      <Select
                        value={expiryPreset}
                        onValueChange={(val) => setExpiryPreset(val as typeof expiryPreset)}
                      >
                        <SelectTrigger className="w-full text-xs">
                          <SelectValue placeholder="Select duration" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="never">Never (Permanent / Indefinite)</SelectItem>
                          <SelectItem value="7d">7 Days</SelectItem>
                          <SelectItem value="30d">30 Days</SelectItem>
                          <SelectItem value="90d">90 Days</SelectItem>
                          <SelectItem value="custom">Custom Date & Time</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {expiryPreset === "never"
                          ? "This VPS will remain active indefinitely."
                          : expiryPreset === "7d"
                          ? "Expires 7 days after creation."
                          : expiryPreset === "30d"
                          ? "Expires 30 days after creation."
                          : expiryPreset === "90d"
                          ? "Expires 90 days after creation."
                          : "Custom date & time expiration."}
                      </p>
                    </div>

                    {expiryPreset === "custom" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Custom Expiration Date & Time</Label>
                        <Input
                          type="datetime-local"
                          value={customExpiryDate}
                          onChange={(e) => setCustomExpiryDate(e.target.value)}
                          className="text-xs font-mono h-9"
                        />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Review & Preflight Verification */}
            <div className="space-y-6">
              <Card className="sticky top-6">
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Layers className="size-4 text-primary" /> Provisioning Review
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Verify configuration prior to queueing creation task.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 py-3 text-xs">
                  <div className="flex items-center justify-between py-1 border-b">
                    <span className="text-muted-foreground">Hostname</span>
                    <span className="font-mono font-semibold text-foreground">{hostname || "—"}</span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b">
                    <span className="text-muted-foreground">Owner</span>
                    <span className="font-medium text-foreground">
                      {selectedUser ? `@${selectedUser.username}` : "—"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b">
                    <span className="text-muted-foreground">Hypervisor</span>
                    <span className="font-medium text-foreground">{selectedNode?.name || "—"}</span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b">
                    <span className="text-muted-foreground">OS Template</span>
                    <span className="font-mono text-[11px] truncate max-w-[140px] text-foreground">
                      {selectedTemplate ? selectedTemplate.split("/").pop() : "—"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b">
                    <span className="text-muted-foreground">Compute</span>
                    <span className="font-mono text-foreground">
                      {cpuCores} vCPU · {(memoryMb / 1024).toFixed(1)} GB RAM
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b">
                    <span className="text-muted-foreground">Storage</span>
                    <span className="font-mono text-foreground">
                      {diskGb} GB ({rootfsStorage || "default"})
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b">
                    <span className="text-muted-foreground">Network</span>
                    <span className="font-mono text-foreground">
                      {bridge || "vmbr0"} · {ipv4PoolId ? "Static IPAM" : "DHCP"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1">
                    <span className="text-muted-foreground">Expiration</span>
                    <span className="font-mono text-foreground">
                      {expiryPreset === "never"
                        ? "Never"
                        : expiryPreset === "custom"
                        ? customExpiryDate || "Custom (unset)"
                        : `+${expiryPreset}`}
                    </span>
                  </div>

                  {/* Preflight Check Results */}
                  {preflightResults && (
                    <div className="pt-2 space-y-2 border-t mt-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground">Preflight Checks</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] py-0 ${
                            preflightResults.valid
                              ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
                              : "text-destructive border-destructive/30 bg-destructive/10"
                          }`}
                        >
                          {preflightResults.valid ? "PASSED" : "FAILED"}
                        </Badge>
                      </div>

                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {preflightResults.checks.map((chk, idx) => (
                          <div
                            key={idx}
                            className="flex items-start gap-1.5 text-[11px] p-1.5 rounded bg-muted/30"
                          >
                            {chk.status === "passed" ? (
                              <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0 mt-0.5" />
                            ) : chk.status === "warning" ? (
                              <AlertTriangle className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
                            ) : (
                              <AlertCircle className="size-3.5 text-destructive shrink-0 mt-0.5" />
                            )}
                            <span className="text-muted-foreground leading-tight">
                              {chk.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>

                <CardFooter className="flex flex-col gap-2 pt-2 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full text-xs gap-1.5"
                    onClick={() => runPreflight()}
                    disabled={isRunningPreflight || isDeploying}
                  >
                    {isRunningPreflight ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-3.5 text-primary" />
                    )}
                    Run Preflight Validation
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    className="w-full text-xs gap-1.5 bg-primary text-primary-foreground"
                    onClick={handleProvision}
                    disabled={isDeploying || isRunningPreflight || !hostname.trim()}
                  >
                    {isDeploying ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ArrowRight className="size-3.5" />
                    )}
                    Deploy VPS Container
                  </Button>
                </CardFooter>
              </Card>
            </div>
          </div>
        )}
      </div>
    </BaseLayout>
  )
}
