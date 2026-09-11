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
  Trash2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Upload,
  Globe,
  Pencil,
  Network,
  Eye,
  EyeOff,
  Key,
} from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
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
  auth_token_id?: string
  allow_insecure_tls: number
  default_template_storage?: string | null
  default_rootfs_storage?: string | null
  default_storage?: string
  default_bridge?: string | null
  enabled: number
  status: "healthy" | "online" | "offline" | "degraded" | "misconfigured" | "unverified" | "unknown"
  last_health_check: string | null
  last_verified_at: string | null
  health_info: string | null
  verification_info: string | null
  vps_count: number
  created_at: string
}

interface VerificationCheckItem {
  name: string
  status: "passed" | "warning" | "failed"
  message: string
  details?: Record<string, unknown>
}

interface VerificationModalData {
  nodeName: string
  status: string
  reachable: boolean
  authenticated: boolean
  identityVerified: boolean
  latencyMs?: number
  apiVersion?: string
  apiRelease?: string
  expectedNodeName: string
  actualNodeName?: string
  checks: VerificationCheckItem[]
  storages: Array<{
    storage: string
    type: string
    active: boolean
    content: string[]
    supportsTemplates: boolean
    supportsRootfs: boolean
    totalBytes?: number
    usedBytes?: number
    availBytes?: number
  }>
  templateStorages: string[]
  rootfsStorages: string[]
  templates: Array<{
    volid: string
    storage: string
    filename: string
    format: string
    sizeBytes: number
    osFamily?: string
  }>
  bridges: Array<{
    iface: string
    type: string
    active: boolean
    comments?: string
  }>
  verifiedAt?: string
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
  const [showTokenSecret, setShowTokenSecret] = React.useState(false)
  const [allowInsecureTls, setAllowInsecureTls] = React.useState(false)

  // Add node: Discovered capabilities state
  const [isTestingConnection, setIsTestingConnection] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{
    success: boolean
    message: string
    templateStorages: string[]
    rootfsStorages: string[]
    bridges: string[]
    nodes: string[]
    templatesCount: number
  } | null>(null)
  const [defaultTemplateStorage, setDefaultTemplateStorage] = React.useState("")
  const [defaultRootfsStorage, setDefaultRootfsStorage] = React.useState("")
  const [defaultBridge, setDefaultBridge] = React.useState("")
  const [isSavingNode, setIsSavingNode] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  // Edit node modal
  const [editNodeOpen, setEditNodeOpen] = React.useState(false)
  const [editingNodeId, setEditingNodeId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState("")
  const [editApiUrl, setEditApiUrl] = React.useState("")
  const [editPort, setEditPort] = React.useState(443)
  const [editHostname, setEditHostname] = React.useState("")
  const [editNodeName, setEditNodeName] = React.useState("pve")
  const [editAuthTokenId, setEditAuthTokenId] = React.useState("")
  const [editAuthTokenSecret, setEditAuthTokenSecret] = React.useState("")
  const [editShowTokenSecret, setEditShowTokenSecret] = React.useState(false)
  const [editRegion, setEditRegion] = React.useState("")
  const [editFlagUrl, setEditFlagUrl] = React.useState("")
  const [editDefaultTemplateStorage, setEditDefaultTemplateStorage] = React.useState("")
  const [editDefaultRootfsStorage, setEditDefaultRootfsStorage] = React.useState("")
  const [editDefaultBridge, setEditDefaultBridge] = React.useState("")
  const [editAllowInsecureTls, setEditAllowInsecureTls] = React.useState(false)
  const [isSavingEdit, setIsSavingEdit] = React.useState(false)
  const [isRefreshingEditCaps, setIsRefreshingEditCaps] = React.useState(false)
  const [editDiscoveredTemplateStorages, setEditDiscoveredTemplateStorages] = React.useState<string[]>([])
  const [editDiscoveredRootfsStorages, setEditDiscoveredRootfsStorages] = React.useState<string[]>([])
  const [editDiscoveredBridges, setEditDiscoveredBridges] = React.useState<string[]>([])
  const editFileInputRef = React.useRef<HTMLInputElement | null>(null)

  // Verification & Diagnostics modal
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false)
  const [diagnosticsData, setDiagnosticsData] = React.useState<VerificationModalData | null>(null)
  const [verifyingNodeId, setVerifyingNodeId] = React.useState<string | null>(null)

  // Delete Node Dialog State
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [nodeToDelete, setNodeToDelete] = React.useState<ProxmoxNode | null>(null)
  const [confirmNodeNameInput, setConfirmNodeNameInput] = React.useState("")
  const [isDeletingNode, setIsDeletingNode] = React.useState(false)
  const [deleteConflictError, setDeleteConflictError] = React.useState<{
    message: string
    dependencies?: {
      vpsCount?: number
      provisioningJobCount?: number
      activeOperationCount?: number
      ipPoolCount?: number
    }
  } | null>(null)

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

  // Verify connection (comprehensive 14-layer check)
  const handleVerifyNode = async (node: ProxmoxNode) => {
    setVerifyingNodeId(node.id)
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch(`/api/admin/nodes/${node.id}/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Verification failed.")

      const v = data.verification
      setDiagnosticsData({
        nodeName: node.name,
        status: v.status,
        reachable: v.reachable,
        authenticated: v.authenticated,
        identityVerified: v.identityVerified,
        latencyMs: v.latencyMs,
        apiVersion: v.apiVersion,
        apiRelease: v.apiRelease,
        expectedNodeName: v.expectedNodeName,
        actualNodeName: v.actualNodeName,
        checks: v.checks || [],
        storages: v.storages || [],
        templateStorages: v.templateStorages || [],
        rootfsStorages: v.rootfsStorages || [],
        templates: v.templates || [],
        bridges: v.bridges || [],
        verifiedAt: v.verifiedAt,
      })
      setDiagnosticsOpen(true)

      if (v.status === "healthy") {
        toast.success(`Node Verified: Healthy (${v.latencyMs ?? 0}ms latency, ${v.templates?.length || 0} templates found)`)
      } else if (v.status === "degraded") {
        toast.warning("Node reachable with warnings. See diagnostics for details.")
      } else if (v.status === "misconfigured") {
        toast.error("Node misconfigured. Target node name or authentication mismatch.")
      } else {
        toast.error(`Node verification failed: ${v.status}`)
      }

      fetchNodes()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error verifying node")
    } finally {
      setVerifyingNodeId(null)
    }
  }

  // Open diagnostics modal from cached or existing verification info
  const handleViewDiagnostics = (node: ProxmoxNode) => {
    if (node.verification_info) {
      try {
        const v = JSON.parse(node.verification_info)
        setDiagnosticsData({
          nodeName: node.name,
          status: v.status || node.status,
          reachable: v.reachable ?? true,
          authenticated: v.authenticated ?? true,
          identityVerified: v.identityVerified ?? true,
          latencyMs: v.latencyMs,
          apiVersion: v.apiVersion,
          apiRelease: v.apiRelease,
          expectedNodeName: node.node_name,
          actualNodeName: v.actualNodeName || node.node_name,
          checks: v.checks || [],
          storages: v.storages || [],
          templateStorages: v.templateStorages || [],
          rootfsStorages: v.rootfsStorages || [],
          templates: v.templates || [],
          bridges: v.bridges || [],
          verifiedAt: v.verifiedAt || node.last_verified_at || undefined,
        })
        setDiagnosticsOpen(true)
        return
      } catch {}
    }
    // If no parsed verification info is stored, run a live verification
    handleVerifyNode(node)
  }

  // Add Node: Test & Discover credentials without saving
  const handleTestConnection = async () => {
    if (!apiUrl.trim() || !authTokenId.trim() || !authTokenSecret.trim()) {
      toast.error("API Base URL, Token ID, and Token Secret are required to test connection.")
      return
    }

    setIsTestingConnection(true)
    setTestResult(null)
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch("/api/admin/nodes/test-connection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({
          apiUrl: apiUrl.trim(),
          port,
          hostname: hostname.trim(),
          nodeName: nodeName.trim(),
          authTokenId: authTokenId.trim(),
          authTokenSecret: authTokenSecret.trim(),
          allowInsecureTls,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Connection test failed.")

      const tStorages = data.templateStorages || []
      const rStorages = data.rootfsStorages || []
      const discoveredBridges = (data.bridges || []).map((b: { iface: string }) => b.iface)
      const clusterNodes = data.discoveredNodes || []

      setTestResult({
        success: data.success,
        message: data.message,
        templateStorages: tStorages,
        rootfsStorages: rStorages,
        bridges: discoveredBridges,
        nodes: clusterNodes,
        templatesCount: data.templates?.length || 0,
      })

      // Auto-populate defaults from discovered pools if not set
      if (tStorages.length > 0 && !defaultTemplateStorage) {
        setDefaultTemplateStorage(tStorages[0])
      }
      if (rStorages.length > 0 && !defaultRootfsStorage) {
        setDefaultRootfsStorage(rStorages[0])
      }
      if (discoveredBridges.length > 0 && !defaultBridge) {
        setDefaultBridge(discoveredBridges[0])
      }
      if (clusterNodes.length > 0 && (!nodeName || !clusterNodes.includes(nodeName))) {
        setNodeName(clusterNodes[0])
      }

      toast.success(
        `Discovered ${tStorages.length} template pool(s), ${rStorages.length} rootfs pool(s), ${discoveredBridges.length} bridge(s)`
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Connection test failed."
      setTestResult({
        success: false,
        message: msg,
        templateStorages: [],
        rootfsStorages: [],
        bridges: [],
        nodes: [],
        templatesCount: 0,
      })
      toast.error(msg)
    } finally {
      setIsTestingConnection(false)
    }
  }

  // Save Node
  const handleSaveNode = async () => {
    if (!name.trim() || !hostname.trim() || !apiUrl.trim() || !authTokenId.trim() || !authTokenSecret.trim()) {
      toast.error("Please fill in all required Proxmox credentials.")
      return
    }

    setIsSavingNode(true)
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
          defaultTemplateStorage: defaultTemplateStorage.trim() || undefined,
          defaultRootfsStorage: defaultRootfsStorage.trim() || undefined,
          defaultBridge: defaultBridge.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to add node.")

      toast.success(data.message || "Proxmox node saved successfully!")
      setAddNodeOpen(false)
      // Reset form
      setName("")
      setHostname("")
      setAuthTokenId("")
      setAuthTokenSecret("")
      setFlagUrl("")
      setTestResult(null)
      setDefaultTemplateStorage("")
      setDefaultRootfsStorage("")
      setDefaultBridge("")
      if (fileInputRef.current) fileInputRef.current.value = ""
      fetchNodes()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add node")
    } finally {
      setIsSavingNode(false)
    }
  }

  // Edit Node
  const handleOpenEdit = async (node: ProxmoxNode) => {
    setEditingNodeId(node.id)
    setEditName(node.name)
    setEditApiUrl(node.api_url || "")
    setEditPort(node.port || 443)
    setEditHostname(node.hostname || "")
    setEditNodeName(node.node_name || "pve")
    setEditAuthTokenId(node.auth_token_id || "")
    setEditAuthTokenSecret("")
    setEditShowTokenSecret(false)
    setEditRegion(node.region)
    setEditFlagUrl(node.flag_url || "")
    setEditDefaultTemplateStorage(node.default_template_storage || "")
    setEditDefaultRootfsStorage(node.default_rootfs_storage || node.default_storage || "")
    setEditDefaultBridge(node.default_bridge || "")
    setEditAllowInsecureTls(node.allow_insecure_tls === 1)
    setEditDiscoveredTemplateStorages([])
    setEditDiscoveredRootfsStorages([])
    setEditDiscoveredBridges([])
    setEditNodeOpen(true)

    // Load available storage and bridge options
    try {
      const res = await fetch(`/api/admin/nodes/${node.id}/capabilities`)
      if (res.ok) {
        const data = await res.json()
        setEditDiscoveredTemplateStorages(data.templateStorages || [])
        setEditDiscoveredRootfsStorages(data.rootfsStorages || [])
        setEditDiscoveredBridges((data.bridges || []).map((b: { iface: string }) => b.iface))
      }
    } catch {}
  }

  const handleRefreshEditCapabilities = async () => {
    if (!editingNodeId) return
    setIsRefreshingEditCaps(true)
    try {
      if (editAuthTokenSecret.trim()) {
        const csrfRes = await fetch("/api/auth/csrf")
        let csrfToken = ""
        if (csrfRes.ok) {
          const c = await csrfRes.json()
          csrfToken = c.token
        }
        const testRes = await fetch("/api/admin/nodes/test-connection", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
          },
          body: JSON.stringify({
            apiUrl: editApiUrl.trim(),
            port: editPort,
            hostname: editHostname.trim(),
            nodeName: editNodeName.trim(),
            authTokenId: editAuthTokenId.trim(),
            authTokenSecret: editAuthTokenSecret.trim(),
            allowInsecureTls: editAllowInsecureTls,
          }),
        })
        const testData = await testRes.json()
        if (!testRes.ok || !testData.success) {
          throw new Error(testData.error || testData.message || "Credential authentication failed.")
        }
        setEditDiscoveredTemplateStorages(testData.templateStorages || [])
        setEditDiscoveredRootfsStorages(testData.rootfsStorages || [])
        setEditDiscoveredBridges((testData.bridges || []).map((b: { iface: string }) => b.iface))
        toast.success("New credentials verified! Discovered storage pools and bridges updated.")
        return
      }

      const res = await fetch(`/api/admin/nodes/${editingNodeId}/capabilities?refresh=true`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to refresh capabilities.")
      setEditDiscoveredTemplateStorages(data.templateStorages || [])
      setEditDiscoveredRootfsStorages(data.rootfsStorages || [])
      setEditDiscoveredBridges((data.bridges || []).map((b: { iface: string }) => b.iface))
      toast.success("Discovered infrastructure refreshed from Proxmox!")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to query Proxmox.")
    } finally {
      setIsRefreshingEditCaps(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!editingNodeId) return
    if (!editName.trim() || !editRegion.trim() || !editApiUrl.trim()) {
      toast.error("Display Name, API URL, and Region Code are required.")
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
          apiUrl: editApiUrl.trim(),
          port: editPort,
          hostname: editHostname.trim(),
          nodeName: editNodeName.trim(),
          authTokenId: editAuthTokenId.trim() || undefined,
          authTokenSecret: editAuthTokenSecret.trim() || undefined,
          region: editRegion.trim(),
          flagUrl: editFlagUrl.trim() || null,
          defaultTemplateStorage: editDefaultTemplateStorage.trim() || null,
          defaultRootfsStorage: editDefaultRootfsStorage.trim() || null,
          defaultBridge: editDefaultBridge.trim() || null,
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

  const handleToggleEnabled = async (node: ProxmoxNode) => {
    const nextEnabled = node.enabled === 1 ? 0 : 1
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }
      const res = await fetch(`/api/admin/nodes/${node.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({ enabled: nextEnabled }),
      })
      if (!res.ok) throw new Error("Failed to update node status.")
      toast.success(nextEnabled === 1 ? `Node '${node.name}' enabled for deployments.` : `Node '${node.name}' disabled / draining.`)
      fetchNodes()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error updating node status")
    }
  }

  const handleOpenDelete = (node: ProxmoxNode) => {
    setNodeToDelete(node)
    setConfirmNodeNameInput("")
    setDeleteConflictError(null)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDeleteNode = async () => {
    if (!nodeToDelete) return
    if (confirmNodeNameInput.trim() !== nodeToDelete.name.trim()) {
      toast.error("Please type the exact node name to confirm deletion.")
      return
    }

    setIsDeletingNode(true)
    setDeleteConflictError(null)
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch(`/api/admin/nodes/${nodeToDelete.id}`, {
        method: "DELETE",
        headers: {
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
      })

      if (res.status === 204) {
        toast.success(`Node '${nodeToDelete.name}' removed successfully.`)
        setDeleteDialogOpen(false)
        setNodeToDelete(null)
        fetchNodes()
        return
      }

      const data = await res.json()
      if (res.status === 409) {
        setDeleteConflictError({
          message: data.error || "Cannot delete node with active dependencies.",
          dependencies: data.dependencies,
        })
        toast.error(data.error || "Node deletion blocked by active dependencies.")
      } else {
        throw new Error(data.error || "Failed to delete node.")
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error deleting node")
    } finally {
      setIsDeletingNode(false)
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

  const getStatusBadge = (status: string, enabled?: number) => {
    if (enabled === 0) {
      return (
        <Badge variant="outline" className="border-zinc-500/30 bg-zinc-500/10 text-zinc-400 gap-1 text-[10px] py-0">
          Disabled / Drain
        </Badge>
      )
    }
    switch (status) {
      case "healthy":
        return (
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-500 gap-1 text-[10px] py-0">
            <CheckCircle2 className="size-3" /> Healthy
          </Badge>
        )
      case "online":
        return (
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-500 gap-1 text-[10px] py-0">
            <CheckCircle2 className="size-3" /> Online
          </Badge>
        )
      case "degraded":
        return (
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-500 gap-1 text-[10px] py-0">
            <AlertTriangle className="size-3" /> Degraded
          </Badge>
        )
      case "misconfigured":
        return (
          <Badge variant="outline" className="border-orange-500/30 bg-orange-500/10 text-orange-500 gap-1 text-[10px] py-0">
            <AlertTriangle className="size-3" /> Misconfigured
          </Badge>
        )
      case "unverified":
        return (
          <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-400 gap-1 text-[10px] py-0">
            <ShieldAlert className="size-3" /> Unverified
          </Badge>
        )
      case "offline":
        return (
          <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive gap-1 text-[10px] py-0">
            <XCircle className="size-3" /> Offline
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

  const formatVerificationAge = (timestamp: string | null) => {
    if (!timestamp) return { text: "Unverified", stale: true }
    const diffMs = Date.now() - new Date(timestamp).getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return { text: "Just now", stale: false }
    if (diffMins === 1) return { text: "1 min ago", stale: false }
    if (diffMins < 60) return { text: `${diffMins} mins ago`, stale: diffMins > 15 }
    const diffHours = Math.floor(diffMins / 60)
    return { text: `${diffHours} hr${diffHours > 1 ? "s" : ""} ago`, stale: true }
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
              onClick={() => {
                setTestResult(null)
                setAddNodeOpen(true)
              }}
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
                  <TableHead>Verification</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((node) => {
                  const verAge = formatVerificationAge(node.last_verified_at)
                  return (
                    <TableRow key={node.id}>
                      {/* Name */}
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                            {node.name}
                            {node.allow_insecure_tls === 1 && (
                              <Badge variant="outline" className="text-[9px] text-amber-500 border-amber-500/30 py-0">
                                TLS Opt-In
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
                      <TableCell>{getStatusBadge(node.status, node.enabled)}</TableCell>

                      {/* VPS Count */}
                      <TableCell className="font-mono text-xs font-semibold">
                        {node.vps_count} instance(s)
                      </TableCell>

                      {/* Last Verification */}
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                            {verAge.text}
                            {verAge.stale && node.last_verified_at && (
                              <Badge variant="outline" className="text-[9px] text-amber-500 border-amber-500/30 py-0">
                                Stale
                              </Badge>
                            )}
                          </span>
                        </div>
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleVerifyNode(node)}
                            disabled={verifyingNodeId === node.id}
                            className="h-7 text-[11px] gap-1"
                            title="Perform full 14-layer verification against Proxmox"
                          >
                            {verifyingNodeId === node.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <ShieldCheck className="size-3 text-primary" />
                            )}
                            Verify
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewDiagnostics(node)}
                            className="h-7 text-[11px] gap-1"
                            title="View detailed verification diagnostics and storage capabilities"
                          >
                            <Activity className="size-3" /> Diagnostics
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenEdit(node)}
                            className="h-7 text-[11px] gap-1"
                          >
                            <Pencil className="size-3" /> Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleEnabled(node)}
                            className={`h-7 text-[11px] gap-1 ${
                              node.enabled === 1 ? "text-muted-foreground" : "text-amber-500 font-medium"
                            }`}
                            title={node.enabled === 1 ? "Disable node (prevent new deployments / drain)" : "Enable node"}
                          >
                            {node.enabled === 1 ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenDelete(node)}
                            className="h-7 w-7 text-muted-foreground hover:text-destructive cursor-pointer"
                            title={node.vps_count > 0 ? "Node has active instances (remove instances first)" : "Delete Node"}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Verification Diagnostics Modal */}
      <Dialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" />
              Node Diagnostics: {diagnosticsData?.nodeName}
            </DialogTitle>
            <DialogDescription>
              Comprehensive 14-layer verification and discovered infrastructure capabilities.
            </DialogDescription>
          </DialogHeader>

          {diagnosticsData ? (
            <div className="space-y-4 py-2 text-xs">
              {/* Summary Bar */}
              <div className="p-3 rounded-lg border bg-muted/20 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">Status:</span>
                  {getStatusBadge(diagnosticsData.status)}
                </div>
                {diagnosticsData.latencyMs !== undefined && (
                  <div className="text-muted-foreground">
                    Latency: <span className="font-mono font-semibold text-foreground">{diagnosticsData.latencyMs}ms</span>
                  </div>
                )}
                {diagnosticsData.apiVersion && (
                  <div className="text-muted-foreground">
                    PVE Version: <span className="font-mono font-semibold text-foreground">v{diagnosticsData.apiVersion}</span>
                  </div>
                )}
                <div className="text-muted-foreground">
                  Node Identity:{" "}
                  <span className="font-mono font-semibold text-foreground">
                    {diagnosticsData.actualNodeName || diagnosticsData.expectedNodeName}
                  </span>
                  {diagnosticsData.expectedNodeName !== diagnosticsData.actualNodeName && diagnosticsData.actualNodeName && (
                    <span className="text-destructive font-mono ml-1">(expected: {diagnosticsData.expectedNodeName})</span>
                  )}
                </div>
              </div>

              {/* 14-Layer Verification Checks */}
              <div>
                <h4 className="font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <Activity className="size-3.5 text-primary" /> Layered Verification Checks
                </h4>
                <div className="space-y-1.5">
                  {diagnosticsData.checks.map((c, i) => (
                    <div
                      key={i}
                      className={`p-2 rounded border flex items-start justify-between gap-2 ${
                        c.status === "passed"
                          ? "bg-emerald-500/5 border-emerald-500/20"
                          : c.status === "warning"
                          ? "bg-amber-500/5 border-amber-500/20"
                          : "bg-destructive/5 border-destructive/20"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {c.status === "passed" ? (
                          <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        ) : c.status === "warning" ? (
                          <AlertTriangle className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="size-3.5 text-destructive shrink-0 mt-0.5" />
                        )}
                        <div>
                          <span className="font-semibold text-foreground">{c.name}</span>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{c.message}</p>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[9px] uppercase py-0 shrink-0 ${
                          c.status === "passed"
                            ? "text-emerald-500 border-emerald-500/30"
                            : c.status === "warning"
                            ? "text-amber-500 border-amber-500/30"
                            : "text-destructive border-destructive/30"
                        }`}
                      >
                        {c.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>

              {/* Storage Pools & Contained Templates Breakdown */}
              <div>
                <h4 className="font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <HardDrive className="size-3.5 text-primary" /> Storage Pools & Template Content
                </h4>
                <div className="space-y-2">
                  {diagnosticsData.storages.map((s) => {
                    const storageTemplates = diagnosticsData.templates.filter((t) => t.storage === s.storage)
                    return (
                      <div key={s.storage} className="p-3 border rounded-lg bg-card space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-foreground">{s.storage}</span>
                            <Badge variant="outline" className="text-[10px] font-mono">{s.type}</Badge>
                            <Badge
                              variant="outline"
                              className={`text-[9px] py-0 ${s.active ? "text-emerald-500 border-emerald-500/30" : "text-destructive border-destructive/30"}`}
                            >
                              {s.active ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {s.supportsTemplates && (
                              <Badge variant="outline" className="text-[9px] text-blue-500 border-blue-500/30 py-0">
                                vztmpl (Templates)
                              </Badge>
                            )}
                            {s.supportsRootfs && (
                              <Badge variant="outline" className="text-[9px] text-purple-500 border-purple-500/30 py-0">
                                rootdir (Rootfs)
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="text-[11px] text-muted-foreground">
                          Content capabilities: <span className="font-mono text-foreground">{s.content.join(", ") || "none"}</span>
                        </div>

                        {/* Templates in this specific storage */}
                        {s.supportsTemplates && (
                          <div className="pt-1.5 border-t border-border/40">
                            <span className="text-[11px] font-semibold text-muted-foreground block mb-1">
                              Container Templates ({storageTemplates.length}):
                            </span>
                            {storageTemplates.length > 0 ? (
                              <div className="space-y-1">
                                {storageTemplates.map((t) => (
                                  <div
                                    key={t.volid}
                                    className="p-1.5 bg-muted/40 rounded border font-mono text-[11px] flex items-center justify-between"
                                  >
                                    <span className="truncate max-w-[400px] text-foreground font-medium">
                                      {t.filename}
                                    </span>
                                    <span className="text-muted-foreground text-[10px]">
                                      {(t.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] text-muted-foreground italic">
                                Storage supports templates, but no container templates were found in vztmpl.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Network Bridges */}
              <div>
                <h4 className="font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <Network className="size-3.5 text-primary" /> Discovered Network Bridges
                </h4>
                {diagnosticsData.bridges.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {diagnosticsData.bridges.map((b) => (
                      <div key={b.iface} className="p-2 border rounded font-mono flex items-center justify-between">
                        <span className="font-semibold text-foreground">{b.iface}</span>
                        <Badge variant="outline" className={`text-[9px] py-0 ${b.active ? "text-emerald-500 border-emerald-500/30" : "text-muted-foreground"}`}>
                          {b.active ? "Active" : "Down"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs italic">No network bridges discovered.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-5 animate-spin text-primary" />
              Loading diagnostics...
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setDiagnosticsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Proxmox VE Node Modal (Test & Discover Pattern) */}
      <Dialog open={addNodeOpen} onOpenChange={setAddNodeOpen}>
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HardDrive className="size-4 text-primary" /> Add Proxmox VE Hypervisor
            </DialogTitle>
            <DialogDescription>
              Connect an authenticated Proxmox VE REST API endpoint and automatically discover its storage pools and bridges.
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
                  className="text-xs font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>API Base URL</Label>
                <Input
                  placeholder="https://pve-pe.kinetichost.pro"
                  value={apiUrl}
                  onChange={(e) => {
                    const val = e.target.value
                    setApiUrl(val)
                    try {
                      const raw = /^https?:\/\//i.test(val) ? val : `https://${val}`
                      const u = new URL(raw)
                      setHostname(u.hostname)
                      if (u.port) {
                        setPort(parseInt(u.port, 10))
                      } else {
                        setPort(u.protocol === "http:" ? 80 : 443)
                      }
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
                  onChange={(e) => setPort(parseInt(e.target.value, 10) || 443)}
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
                <div className="w-12 h-8 rounded border border-border bg-background flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                  {flagUrl ? (
                    <img src={flagUrl} alt="Flag Preview" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs text-muted-foreground/50">🌐</span>
                  )}
                </div>

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

                <Input
                  placeholder="or paste flag image URL..."
                  value={flagUrl.startsWith("data:") ? "Custom flag uploaded" : flagUrl}
                  onChange={(e) => setFlagUrl(e.target.value)}
                  className="text-xs h-8 flex-1 font-mono"
                />
              </div>
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
                <div className="relative">
                  <Input
                    type={showTokenSecret ? "text" : "password"}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={authTokenSecret}
                    onChange={(e) => setAuthTokenSecret(e.target.value)}
                    className="text-xs font-mono pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full w-9 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowTokenSecret(!showTokenSecret)}
                  >
                    {showTokenSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </Button>
                </div>
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

            {/* Test & Discover Action */}
            <div className="pt-1">
              <Button
                type="button"
                variant="outline"
                className="w-full h-9 text-xs gap-2 border-primary/40 text-primary hover:bg-primary/5"
                onClick={handleTestConnection}
                disabled={isTestingConnection}
              >
                {isTestingConnection ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Activity className="size-3.5" />
                )}
                Test & Discover Infrastructure
              </Button>
            </div>

            {/* Discovered Infrastructure Section */}
            {testResult && (
              <div className={`p-3 rounded-lg border text-xs space-y-3 ${testResult.success ? "bg-emerald-500/5 border-emerald-500/20" : "bg-destructive/5 border-destructive/20"}`}>
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <CheckCircle2 className="size-4 text-emerald-500" />
                  ) : (
                    <XCircle className="size-4 text-destructive" />
                  )}
                  <span className="font-semibold text-foreground">{testResult.message}</span>
                </div>

                {testResult.success && (
                  <div className="space-y-2.5 pt-1">
                    {/* Discovered Nodes if multiple */}
                    {testResult.nodes.length > 1 && (
                      <div className="space-y-1">
                        <Label className="text-[11px]">Select Cluster Target Node</Label>
                        <Select value={nodeName} onValueChange={setNodeName}>
                          <SelectTrigger className="h-8 text-xs font-mono">
                            <SelectValue placeholder="Select node" />
                          </SelectTrigger>
                          <SelectContent>
                            {testResult.nodes.map((n) => (
                              <SelectItem key={n} value={n} className="font-mono text-xs">{n}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Discovered Default Template Storage */}
                    <div className="space-y-1">
                      <Label className="text-[11px]">Default Template Storage (vztmpl)</Label>
                      {testResult.templateStorages.length > 0 ? (
                        <Select value={defaultTemplateStorage} onValueChange={setDefaultTemplateStorage}>
                          <SelectTrigger className="h-8 text-xs font-mono">
                            <SelectValue placeholder="Select template storage" />
                          </SelectTrigger>
                          <SelectContent>
                            {testResult.templateStorages.map((s) => (
                              <SelectItem key={s} value={s} className="font-mono text-xs">
                                {s} (supports vztmpl)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-[11px] text-amber-500">No storage supporting container templates was discovered.</p>
                      )}
                    </div>

                    {/* Discovered Default Rootfs Storage */}
                    <div className="space-y-1">
                      <Label className="text-[11px]">Default Rootfs Storage (rootdir)</Label>
                      {testResult.rootfsStorages.length > 0 ? (
                        <Select value={defaultRootfsStorage} onValueChange={setDefaultRootfsStorage}>
                          <SelectTrigger className="h-8 text-xs font-mono">
                            <SelectValue placeholder="Select rootfs storage" />
                          </SelectTrigger>
                          <SelectContent>
                            {testResult.rootfsStorages.map((s) => (
                              <SelectItem key={s} value={s} className="font-mono text-xs">
                                {s} (supports rootdir)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-[11px] text-destructive">No storage supporting rootdir was discovered.</p>
                      )}
                    </div>

                    {/* Discovered Default Bridge */}
                    <div className="space-y-1">
                      <Label className="text-[11px]">Default Network Bridge</Label>
                      {testResult.bridges.length > 0 ? (
                        <Select value={defaultBridge} onValueChange={setDefaultBridge}>
                          <SelectTrigger className="h-8 text-xs font-mono">
                            <SelectValue placeholder="Select network bridge" />
                          </SelectTrigger>
                          <SelectContent>
                            {testResult.bridges.map((b) => (
                              <SelectItem key={b} value={b} className="font-mono text-xs">
                                {b}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-[11px] text-amber-500">No active network bridges discovered.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddNodeOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveNode} disabled={isSavingNode}>
              {isSavingNode ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
              Save Hypervisor Node
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Proxmox Node Modal */}
      <Dialog open={editNodeOpen} onOpenChange={setEditNodeOpen}>
        <DialogContent className="sm:max-w-[540px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-4 text-primary" /> Edit Proxmox Hypervisor
            </DialogTitle>
            <DialogDescription>
              Update hypervisor configuration, region designation, and storage defaults.
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

            {/* API Connection & Port */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>API Base URL</Label>
                <Input
                  placeholder="https://pve-pe.kinetichost.pro"
                  value={editApiUrl}
                  onChange={(e) => {
                    const val = e.target.value
                    setEditApiUrl(val)
                    try {
                      const raw = /^https?:\/\//i.test(val) ? val : `https://${val}`
                      const u = new URL(raw)
                      setEditHostname(u.hostname)
                      if (u.port) {
                        setEditPort(parseInt(u.port, 10))
                      } else {
                        setEditPort(u.protocol === "http:" ? 80 : 443)
                      }
                    } catch {}
                  }}
                  className="text-xs font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>API Port</Label>
                <Input
                  type="number"
                  value={editPort}
                  onChange={(e) => setEditPort(parseInt(e.target.value, 10) || 443)}
                  className="text-xs font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Hostname / IP</Label>
                <Input
                  placeholder="pve-pe.kinetichost.pro"
                  value={editHostname}
                  onChange={(e) => setEditHostname(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>PVE Node Name</Label>
                <Input
                  placeholder="pve"
                  value={editNodeName}
                  onChange={(e) => setEditNodeName(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
            </div>

            {/* API Token Credentials */}
            <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Key className="size-3.5 text-primary" /> API Token Authentication
                </span>
                <span className="text-[10px] text-muted-foreground">Encrypted at rest</span>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">API Token ID</Label>
                <Input
                  placeholder="root@pam!interdash"
                  value={editAuthTokenId}
                  onChange={(e) => setEditAuthTokenId(e.target.value)}
                  className="text-xs font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  Proxmox PVE API User and Token identifier (e.g. root@pam!tokenid).
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">API Token Secret</Label>
                </div>
                <div className="relative">
                  <Input
                    type={editShowTokenSecret ? "text" : "password"}
                    placeholder="Leave blank to keep existing encrypted secret"
                    value={editAuthTokenSecret}
                    onChange={(e) => setEditAuthTokenSecret(e.target.value)}
                    className="text-xs font-mono pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full w-9 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditShowTokenSecret(!editShowTokenSecret)}
                  >
                    {editShowTokenSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {editAuthTokenSecret
                    ? "A new secret is entered and will overwrite the stored secret upon saving."
                    : "Existing secret is retained securely. Enter a new secret only if you want to replace it."}
                </p>
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
                <div className="w-12 h-8 rounded border border-border bg-background flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                  {editFlagUrl ? (
                    <img src={editFlagUrl} alt="Flag Preview" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs text-muted-foreground/50">🌐</span>
                  )}
                </div>

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

                <Input
                  placeholder="or paste flag image URL..."
                  value={editFlagUrl.startsWith("data:") ? "Custom flag uploaded" : editFlagUrl}
                  onChange={(e) => setEditFlagUrl(e.target.value)}
                  className="text-xs h-8 flex-1 font-mono"
                />
              </div>
            </div>

            {/* Discover Capabilities Action */}
            <div className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/30">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-foreground">Discovered Options</span>
                <p className="text-[11px] text-muted-foreground">Refresh valid storage pools and bridges from Proxmox.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleRefreshEditCapabilities}
                disabled={isRefreshingEditCaps}
              >
                <RefreshCw className={`size-3 ${isRefreshingEditCaps ? "animate-spin" : ""}`} />
                Query Hypervisor
              </Button>
            </div>

            {/* Default Template Storage (vztmpl) */}
            <div className="space-y-1.5">
              <Label>Default Template Storage (vztmpl)</Label>
              {editDiscoveredTemplateStorages.length > 0 ? (
                <Select value={editDefaultTemplateStorage} onValueChange={setEditDefaultTemplateStorage}>
                  <SelectTrigger className="text-xs font-mono">
                    <SelectValue placeholder="Select template storage pool" />
                  </SelectTrigger>
                  <SelectContent>
                    {editDiscoveredTemplateStorages.map((s) => (
                      <SelectItem key={s} value={s} className="font-mono text-xs">{s} (vztmpl)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={editDefaultTemplateStorage}
                  onChange={(e) => setEditDefaultTemplateStorage(e.target.value)}
                  placeholder="e.g. local"
                  className="text-xs font-mono"
                />
              )}
            </div>

            {/* Default Rootfs Storage (rootdir) */}
            <div className="space-y-1.5">
              <Label>Default Rootfs Storage (rootdir)</Label>
              {editDiscoveredRootfsStorages.length > 0 ? (
                <Select value={editDefaultRootfsStorage} onValueChange={setEditDefaultRootfsStorage}>
                  <SelectTrigger className="text-xs font-mono">
                    <SelectValue placeholder="Select rootfs storage pool" />
                  </SelectTrigger>
                  <SelectContent>
                    {editDiscoveredRootfsStorages.map((s) => (
                      <SelectItem key={s} value={s} className="font-mono text-xs">{s} (rootdir)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={editDefaultRootfsStorage}
                  onChange={(e) => setEditDefaultRootfsStorage(e.target.value)}
                  placeholder="e.g. local-lvm"
                  className="text-xs font-mono"
                />
              )}
            </div>

            {/* Default Network Bridge */}
            <div className="space-y-1.5">
              <Label>Default Network Bridge</Label>
              {editDiscoveredBridges.length > 0 ? (
                <Select value={editDefaultBridge} onValueChange={setEditDefaultBridge}>
                  <SelectTrigger className="text-xs font-mono">
                    <SelectValue placeholder="Select network bridge" />
                  </SelectTrigger>
                  <SelectContent>
                    {editDiscoveredBridges.map((b) => (
                      <SelectItem key={b} value={b} className="font-mono text-xs">{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={editDefaultBridge}
                  onChange={(e) => setEditDefaultBridge(e.target.value)}
                  placeholder="e.g. vmbr0"
                  className="text-xs font-mono"
                />
              )}
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

      {/* Delete Hypervisor Node Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="size-5" /> Remove Proxmox Hypervisor
            </DialogTitle>
            <DialogDescription className="text-xs">
              Permanently remove hypervisor integration <strong className="text-foreground">{nodeToDelete?.name}</strong> from InterDash.
            </DialogDescription>
          </DialogHeader>

          {nodeToDelete && (
            <div className="space-y-3 py-2 text-xs">
              {/* Node Summary */}
              <div className="p-3 rounded-lg border bg-muted/30 space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-sans">Node Name:</span>
                  <span className="font-semibold text-foreground">{nodeToDelete.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-sans">PVE Node:</span>
                  <span className="text-foreground">{nodeToDelete.node_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-sans">Endpoint:</span>
                  <span className="text-foreground">{nodeToDelete.hostname}:{nodeToDelete.port}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-sans">Region:</span>
                  <span className="text-foreground">{nodeToDelete.region}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-sans">Active VPS Instances:</span>
                  <span className={`font-semibold ${nodeToDelete.vps_count > 0 ? "text-destructive" : "text-emerald-500"}`}>
                    {nodeToDelete.vps_count} instance(s)
                  </span>
                </div>
              </div>

              {/* Dependency Warning if node has VPS */}
              {nodeToDelete.vps_count > 0 ? (
                <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="size-4 shrink-0" />
                    Deletion Blocked by Active Instances
                  </p>
                  <p className="text-muted-foreground text-[11px] leading-relaxed">
                    This hypervisor node currently has {nodeToDelete.vps_count} assigned VPS instance(s).
                    All instances must be migrated or deleted before this integration can be safely removed.
                  </p>
                </div>
              ) : (
                <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="size-4 shrink-0" />
                    Warning: Irreversible Action
                  </p>
                  <p className="text-muted-foreground text-[11px] leading-relaxed">
                    This action will remove API credentials, cached storage records, and network assignments for this node.
                  </p>
                </div>
              )}

              {/* Conflict Error from backend */}
              {deleteConflictError && (
                <div className="p-3 rounded bg-destructive/10 border border-destructive/30 text-destructive space-y-1.5">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="size-4 shrink-0" /> {deleteConflictError.message}
                  </p>
                  {deleteConflictError.dependencies && (
                    <ul className="text-[11px] list-disc list-inside space-y-0.5 text-muted-foreground">
                      {deleteConflictError.dependencies.vpsCount !== undefined && deleteConflictError.dependencies.vpsCount > 0 && (
                        <li>Active VPS: {deleteConflictError.dependencies.vpsCount}</li>
                      )}
                      {deleteConflictError.dependencies.provisioningJobCount !== undefined && deleteConflictError.dependencies.provisioningJobCount > 0 && (
                        <li>Pending Provisioning Jobs: {deleteConflictError.dependencies.provisioningJobCount}</li>
                      )}
                      {deleteConflictError.dependencies.activeOperationCount !== undefined && deleteConflictError.dependencies.activeOperationCount > 0 && (
                        <li>Running Operations: {deleteConflictError.dependencies.activeOperationCount}</li>
                      )}
                      {deleteConflictError.dependencies.ipPoolCount !== undefined && deleteConflictError.dependencies.ipPoolCount > 0 && (
                        <li>Configured IP Pools: {deleteConflictError.dependencies.ipPoolCount}</li>
                      )}
                    </ul>
                  )}
                </div>
              )}

              {/* Exact Name Confirmation Input */}
              {nodeToDelete.vps_count === 0 && (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-xs">
                    Type <code className="font-mono text-destructive font-semibold">{nodeToDelete.name}</code> to confirm:
                  </Label>
                  <Input
                    value={confirmNodeNameInput}
                    onChange={(e) => setConfirmNodeNameInput(e.target.value)}
                    placeholder={nodeToDelete.name}
                    className="font-mono text-xs border-destructive/40"
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDeleteDialogOpen(false)
                setNodeToDelete(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmDeleteNode}
              disabled={
                isDeletingNode ||
                !nodeToDelete ||
                nodeToDelete.vps_count > 0 ||
                confirmNodeNameInput.trim() !== nodeToDelete.name.trim()
              }
            >
              {isDeletingNode && <Loader2 className="size-3 animate-spin mr-1.5" />}
              Permanently Remove Node
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BaseLayout>
  )
}
