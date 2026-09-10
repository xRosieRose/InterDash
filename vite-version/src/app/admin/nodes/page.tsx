"use client"

import * as React from "react"
import {
  HardDrive,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Activity,
  Layers,
  Trash2,
  Loader2,
  ShieldAlert,
  Upload,
  Globe,
  Pencil,
} from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"

interface ProxmoxNode {
  id: string
  name: string
  hostname: string
  api_url: string
  port: number
  node_name: string
  region: string
  flag_url?: string | null
  allow_insecure_tls: number
  default_storage: string
  default_bridge: string
  enabled: number
  status: "online" | "offline" | "degraded" | "unknown"
  last_health_check: string | null
  health_info: string | null
  vps_count: number
  created_at: string
}

export default function AdminNodesPage() {
  const [nodes, setNodes] = React.useState<ProxmoxNode[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)

  // Add node modal
  const [addNodeOpen, setAddNodeOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [hostname, setHostname] = React.useState("")
  const [apiUrl, setApiUrl] = React.useState("https://")
  const [port, setPort] = React.useState(8006)
  const [nodeName, setNodeName] = React.useState("pve")
  const [region, setRegion] = React.useState("eu-central-1")
  const [flagUrl, setFlagUrl] = React.useState("")
  const [authTokenId, setAuthTokenId] = React.useState("")
  const [authTokenSecret, setAuthTokenSecret] = React.useState("")
  const [allowInsecureTls, setAllowInsecureTls] = React.useState(false)
  const [defaultStorage, setDefaultStorage] = React.useState("local-lvm")
  const [defaultBridge, setDefaultBridge] = React.useState("vmbr0")
  const [isTestingAndSaving, setIsTestingAndSaving] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  // Edit node modal
  const [editNodeOpen, setEditNodeOpen] = React.useState(false)
  const [editingNodeId, setEditingNodeId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState("")
  const [editRegion, setEditRegion] = React.useState("")
  const [editFlagUrl, setEditFlagUrl] = React.useState("")
  const [editDefaultStorage, setEditDefaultStorage] = React.useState("")
  const [editDefaultBridge, setEditDefaultBridge] = React.useState("")
  const [editAllowInsecureTls, setEditAllowInsecureTls] = React.useState(false)
  const [isSavingEdit, setIsSavingEdit] = React.useState(false)
  const editFileInputRef = React.useRef<HTMLInputElement | null>(null)

  // Capabilities modal
  const [capOpen, setCapOpen] = React.useState(false)
  const [selectedNodeName, setSelectedNodeName] = React.useState("")
  const [caps, setCaps] = React.useState<{ storages: any[]; bridges: any[]; templates: any[] } | null>(null)
  const [isLoadingCaps, setIsLoadingCaps] = React.useState(false)

  const [checkingHealthId, setCheckingHealthId] = React.useState<string | null>(null)

  const fetchNodes = React.useCallback(async (showToast = false) => {
    try {
      if (showToast) setIsRefreshing(true)
      const res = await fetch("/api/admin/nodes")
      if (!res.ok) throw new Error("Failed to load Proxmox nodes.")
      const data = await res.json()
      setNodes(data.nodes || [])
      if (showToast) toast.success("Nodes refreshed.")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error fetching nodes")
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    fetchNodes()
  }, [fetchNodes])

  const handleCheckHealth = async (nodeId: string) => {
    setCheckingHealthId(nodeId)
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch(`/api/admin/nodes/${nodeId}/health`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Health check failed.")

      if (data.health?.online) {
        toast.success(
          `Node Online! PVE v${data.health.version} (${data.health.latencyMs}ms)`
        )
      } else {
        toast.error(`Node Offline: ${data.health?.error || "Connection refused"}`)
      }

      fetchNodes()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error running health check")
    } finally {
      setCheckingHealthId(null)
    }
  }

  const handleInspectCapabilities = async (node: ProxmoxNode) => {
    setSelectedNodeName(node.name)
    setCapOpen(true)
    setIsLoadingCaps(true)
    setCaps(null)
    try {
      const res = await fetch(`/api/admin/nodes/${node.id}/capabilities`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to discover capabilities.")
      setCaps(data)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Capabilities discovery failed")
    } finally {
      setIsLoadingCaps(false)
    }
  }

  const handleDeleteNode = async (nodeId: string) => {
    if (!confirm("Are you sure you want to remove this Proxmox node integration?")) return
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch(`/api/admin/nodes/${nodeId}`, {
        method: "DELETE",
        headers: {
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to delete node.")

      toast.success("Node deleted.")
      fetchNodes()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error deleting node")
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith("image/")) {
      toast.error("Selected file must be an image (PNG, JPG, SVG, WEBP).")
      return
    }

    if (file.size > 1.5 * 1024 * 1024) {
      toast.error("Flag image must be under 1.5 MB.")
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const result = event.target?.result as string
      if (result) {
        setFlagUrl(result)
        toast.success("Flag image selected!")
      }
    }
    reader.onerror = () => {
      toast.error("Failed to read image file.")
    }
    reader.readAsDataURL(file)
  }

  const handleOpenEdit = (node: ProxmoxNode) => {
    setEditingNodeId(node.id)
    setEditName(node.name)
    setEditRegion(node.region)
    setEditFlagUrl(node.flag_url || "")
    setEditDefaultStorage(node.default_storage)
    setEditDefaultBridge(node.default_bridge)
    setEditAllowInsecureTls(node.allow_insecure_tls === 1)
    setEditNodeOpen(true)
  }

  const handleEditFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith("image/")) {
      toast.error("Selected file must be an image (PNG, JPG, SVG, WEBP).")
      return
    }

    if (file.size > 1.5 * 1024 * 1024) {
      toast.error("Flag image must be under 1.5 MB.")
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const result = event.target?.result as string
      if (result) {
        setEditFlagUrl(result)
        toast.success("Flag image updated!")
      }
    }
    reader.onerror = () => {
      toast.error("Failed to read image file.")
    }
    reader.readAsDataURL(file)
  }

  const handleSaveEdit = async () => {
    if (!editingNodeId) return
    if (!editName.trim() || !editRegion.trim()) {
      toast.error("Display Name and Region Code are required.")
      return
    }

    setIsSavingEdit(true)
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch(`/api/admin/nodes/${editingNodeId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({
          name: editName.trim(),
          region: editRegion.trim(),
          flagUrl: editFlagUrl.trim() || null,
          defaultStorage: editDefaultStorage.trim(),
          defaultBridge: editDefaultBridge.trim(),
          allowInsecureTls: editAllowInsecureTls,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update node.")

      toast.success("Node configuration updated successfully.")
      setEditNodeOpen(false)
      fetchNodes()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error updating node")
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleSaveNode = async () => {
    if (!name.trim() || !hostname.trim() || !apiUrl.trim() || !authTokenId.trim() || !authTokenSecret.trim()) {
      toast.error("Please fill in all required Proxmox credentials.")
      return
    }

    setIsTestingAndSaving(true)
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch("/api/admin/nodes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          hostname: hostname.trim(),
          apiUrl: apiUrl.trim(),
          port,
          nodeName: nodeName.trim(),
          region: region.trim(),
          flagUrl: flagUrl.trim() || null,
          authTokenId: authTokenId.trim(),
          authTokenSecret: authTokenSecret.trim(),
          allowInsecureTls,
          defaultStorage: defaultStorage.trim(),
          defaultBridge: defaultBridge.trim(),
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to add node.")

      toast.success(data.message || "Proxmox node connected successfully!")
      setAddNodeOpen(false)
      // Reset form
      setName("")
      setHostname("")
      setAuthTokenId("")
      setAuthTokenSecret("")
      setFlagUrl("")
      if (fileInputRef.current) fileInputRef.current.value = ""
      fetchNodes()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add node")
    } finally {
      setIsTestingAndSaving(false)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "online":
        return (
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-500 gap-1 text-[10px] py-0">
            <CheckCircle2 className="size-3" /> Online
          </Badge>
        )
      case "offline":
        return (
          <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive gap-1 text-[10px] py-0">
            <XCircle className="size-3" /> Offline
          </Badge>
        )
      case "degraded":
        return (
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-500 gap-1 text-[10px] py-0">
            <AlertTriangle className="size-3" /> Degraded
          </Badge>
        )
      default:
        return (
          <Badge variant="secondary" className="text-[10px] py-0">
            Unknown
          </Badge>
        )
    }
  }

  return (
    <BaseLayout
      title="Proxmox Hypervisor Nodes"
      description="Configure real Proxmox VE API connections, execute health checks, and discover cluster storage pools."
    >
      <div className="@container/main px-4 lg:px-6 space-y-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {nodes.length} hypervisor node(s) configured
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => fetchNodes(true)}
              disabled={isRefreshing}
            >
              <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => setAddNodeOpen(true)}
            >
              <Plus className="size-3.5" /> Add Proxmox Node
            </Button>
          </div>
        </div>

        {/* Nodes Table */}
        <div className="rounded-md border border-border bg-card">
          {isLoading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs">
              <Loader2 className="size-6 animate-spin text-primary" />
              Querying Proxmox hypervisors...
            </div>
          ) : nodes.length === 0 ? (
            <div className="py-16 text-center text-xs text-muted-foreground space-y-2">
              <HardDrive className="size-8 mx-auto text-muted-foreground/40" />
              <p>No Proxmox nodes have been integrated yet.</p>
              <Button size="sm" onClick={() => setAddNodeOpen(true)}>
                Add your first Proxmox Node
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Node Name</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Active VPS</TableHead>
                  <TableHead>Last Health Check</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((node) => (
                  <TableRow key={node.id}>
                    {/* Name */}
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                          {node.name}
                          {node.allow_insecure_tls === 1 && (
                            <Badge variant="outline" className="text-[9px] text-amber-500 border-amber-500/30 py-0">
                              TLS Warning
                            </Badge>
                          )}
                        </span>
                        <span className="text-[11px] text-muted-foreground font-mono">
                          PVE Node: {node.node_name}
                        </span>
                      </div>
                    </TableCell>

                    {/* Endpoint */}
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {node.hostname}:{node.port}
                    </TableCell>

                    {/* Region */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {node.flag_url ? (
                          <img
                            src={node.flag_url}
                            alt={node.region}
                            className="w-5 h-3.5 object-cover rounded-[2px] border border-border/60 shrink-0 shadow-xs"
                          />
                        ) : (
                          <span className="text-xs">🌐</span>
                        )}
                        <Badge variant="outline" className="text-xs font-mono py-0">
                          {node.region}
                        </Badge>
                      </div>
                    </TableCell>

                    {/* Status */}
                    <TableCell>{getStatusBadge(node.status)}</TableCell>

                    {/* VPS Count */}
                    <TableCell className="font-mono text-xs font-semibold">
                      {node.vps_count} instance(s)
                    </TableCell>

                    {/* Last Check */}
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {node.last_health_check ? node.last_health_check.replace("T", " ").substring(0, 16) : "Never"}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenEdit(node)}
                          className="h-7 text-[11px] gap-1"
                        >
                          <Pencil className="size-3" /> Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCheckHealth(node.id)}
                          disabled={checkingHealthId === node.id}
                          className="h-7 text-[11px] gap-1"
                        >
                          {checkingHealthId === node.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Activity className="size-3 text-primary" />
                          )}
                          Check Health
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleInspectCapabilities(node)}
                          className="h-7 text-[11px] gap-1"
                        >
                          <Layers className="size-3" /> Capabilities
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteNode(node.id)}
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title="Delete Node"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Add Proxmox Node Modal */}
      <Dialog open={addNodeOpen} onOpenChange={setAddNodeOpen}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HardDrive className="size-4 text-primary" /> Add Proxmox VE Hypervisor
            </DialogTitle>
            <DialogDescription>
              Connect an authenticated Proxmox VE REST API endpoint to manage LXC containers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Display Name</Label>
                <Input
                  placeholder="e.g. Frankfurt Hypervisor 01"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label>PVE Node Name</Label>
                <Input
                  placeholder="e.g. pve"
                  value={nodeName}
                  onChange={(e) => setNodeName(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>API Base URL</Label>
                <Input
                  placeholder="https://pve1.interenl.com"
                  value={apiUrl}
                  onChange={(e) => {
                    setApiUrl(e.target.value)
                    try {
                      const u = new URL(e.target.value)
                      setHostname(u.hostname)
                    } catch {}
                  }}
                  className="text-xs font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>API Port</Label>
                <Input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value, 10) || 8006)}
                  className="text-xs font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Region Code</Label>
                <Input
                  placeholder="e.g. eu-central-1"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Hostname / IP</Label>
                <Input
                  placeholder="pve1.interenl.com"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
            </div>

            {/* Regional Flag Image Option */}
            <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Globe className="size-3.5 text-primary" /> Regional Flag Image
                </Label>
                {flagUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setFlagUrl("")
                      if (fileInputRef.current) fileInputRef.current.value = ""
                    }}
                    className="text-[11px] text-destructive hover:underline cursor-pointer"
                  >
                    Remove flag
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                {/* Live Flag Preview */}
                <div className="w-12 h-8 rounded border border-border bg-background flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                  {flagUrl ? (
                    <img
                      src={flagUrl}
                      alt="Flag Preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground/50">🌐</span>
                  )}
                </div>

                {/* Upload Action */}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 shrink-0"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="size-3.5" /> Upload Flag
                </Button>

                {/* URL or Direct Source */}
                <Input
                  placeholder="or paste flag image URL..."
                  value={flagUrl.startsWith("data:") ? "Custom flag uploaded" : flagUrl}
                  onChange={(e) => setFlagUrl(e.target.value)}
                  className="text-xs h-8 flex-1 font-mono"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Upload a national or regional flag icon (PNG, SVG, WEBP, or JPG, max 1.5 MB).
              </p>
            </div>

            {/* Token Credentials */}
            <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
              <div className="space-y-1">
                <Label className="text-xs font-bold">API Token ID</Label>
                <Input
                  placeholder="root@pam!interdash"
                  value={authTokenId}
                  onChange={(e) => setAuthTokenId(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold">API Token Secret (Encrypted at Rest)</Label>
                <Input
                  type="password"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={authTokenSecret}
                  onChange={(e) => setAuthTokenSecret(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
            </div>

            {/* Defaults: Storage & Bridge */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Default Storage Pool</Label>
                <Input
                  placeholder="local-lvm"
                  value={defaultStorage}
                  onChange={(e) => setDefaultStorage(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Default Network Bridge</Label>
                <Input
                  placeholder="vmbr0"
                  value={defaultBridge}
                  onChange={(e) => setDefaultBridge(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
            </div>

            {/* Self-signed TLS Toggle */}
            <div className="flex items-center justify-between p-2.5 rounded-lg border bg-amber-500/5 border-amber-500/20">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-500">
                  <ShieldAlert className="size-3.5" /> Allow Self-Signed TLS
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Enable if this Proxmox node uses a default self-signed SSL certificate.
                </p>
              </div>
              <Switch checked={allowInsecureTls} onCheckedChange={setAllowInsecureTls} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddNodeOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveNode} disabled={isTestingAndSaving}>
              {isTestingAndSaving ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
              Verify & Connect Node
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Capabilities Inspection Modal */}
      <Dialog open={capOpen} onOpenChange={setCapOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="size-4 text-primary" /> Discovered Capabilities: {selectedNodeName}
            </DialogTitle>
            <DialogDescription>
              Hardware storage pools and network bridges confirmed available by Proxmox.
            </DialogDescription>
          </DialogHeader>

          {isLoadingCaps ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-5 animate-spin text-primary" />
              Inspecting Proxmox capabilities...
            </div>
          ) : caps ? (
            <div className="space-y-4 py-2 text-xs">
              <div>
                <h4 className="font-semibold mb-1 text-foreground">Storage Pools</h4>
                <div className="space-y-1">
                  {caps.storages?.map((s) => (
                    <div key={s.storage} className="p-2 border rounded flex justify-between font-mono">
                      <span>{s.storage} ({s.type})</span>
                      <Badge variant="outline" className="text-[10px]">{s.active ? "Active" : "Inactive"}</Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-1 text-foreground">Network Bridges</h4>
                <div className="space-y-1">
                  {caps.bridges?.map((b) => (
                    <div key={b.iface} className="p-2 border rounded flex justify-between font-mono">
                      <span>{b.iface}</span>
                      <Badge variant="outline" className="text-[10px]">{b.active ? "Active" : "Down"}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No capabilities could be retrieved from this node.
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setCapOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Proxmox Node Modal */}
      <Dialog open={editNodeOpen} onOpenChange={setEditNodeOpen}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-4 text-primary" /> Edit Proxmox Hypervisor
            </DialogTitle>
            <DialogDescription>
              Update hypervisor configuration, region designation, and regional flag badge.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Display Name</Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Region Code</Label>
                <Input
                  value={editRegion}
                  onChange={(e) => setEditRegion(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            {/* Regional Flag Image Option */}
            <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Globe className="size-3.5 text-primary" /> Regional Flag Image
                </Label>
                {editFlagUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditFlagUrl("")
                      if (editFileInputRef.current) editFileInputRef.current.value = ""
                    }}
                    className="text-[11px] text-destructive hover:underline cursor-pointer"
                  >
                    Remove flag
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                {/* Live Flag Preview */}
                <div className="w-12 h-8 rounded border border-border bg-background flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                  {editFlagUrl ? (
                    <img
                      src={editFlagUrl}
                      alt="Flag Preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground/50">🌐</span>
                  )}
                </div>

                {/* Upload Action */}
                <input
                  type="file"
                  ref={editFileInputRef}
                  accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                  className="hidden"
                  onChange={handleEditFileUpload}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 shrink-0"
                  onClick={() => editFileInputRef.current?.click()}
                >
                  <Upload className="size-3.5" /> Upload Flag
                </Button>

                {/* URL or Direct Source */}
                <Input
                  placeholder="or paste flag image URL..."
                  value={editFlagUrl.startsWith("data:") ? "Custom flag uploaded" : editFlagUrl}
                  onChange={(e) => setEditFlagUrl(e.target.value)}
                  className="text-xs h-8 flex-1 font-mono"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Upload a national or regional flag icon (PNG, SVG, WEBP, or JPG, max 1.5 MB).
              </p>
            </div>

            {/* Storage & Bridge Defaults */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Default Storage Pool</Label>
                <Input
                  value={editDefaultStorage}
                  onChange={(e) => setEditDefaultStorage(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Default Network Bridge</Label>
                <Input
                  value={editDefaultBridge}
                  onChange={(e) => setEditDefaultBridge(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
            </div>

            {/* Self-signed TLS Toggle */}
            <div className="flex items-center justify-between p-2.5 rounded-lg border bg-amber-500/5 border-amber-500/20">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-500">
                  <ShieldAlert className="size-3.5" /> Allow Self-Signed TLS
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Enable if this Proxmox node uses a default self-signed SSL certificate.
                </p>
              </div>
              <Switch checked={editAllowInsecureTls} onCheckedChange={setEditAllowInsecureTls} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditNodeOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={isSavingEdit}>
              {isSavingEdit ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BaseLayout>
  )
}
