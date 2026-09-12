/**
 * InterDash — Admin API Keys Manager Component
 *
 * Provides a high-fidelity control plane for administrators to generate, rotate,
 * revoke, and monitor scoped API keys for external applications and bots.
 * Features one-time secret reveal, scope grouping, and telemetry inspection.
 */

import * as React from "react"
import {
  Key,
  Plus,
  RefreshCw,
  Ban,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
  ExternalLink,
  Activity,
  CheckCircle2,
  Loader2,
  MoreVertical,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"

interface ScopeDefinition {
  id: string
  name: string
  category: string
  description: string
  isDangerous?: boolean
  requiresAdminRole?: boolean
}

interface ApiKeyItem {
  id: string
  name: string
  description: string | null
  prefix: string
  created_by_user_id: string
  creator_username?: string
  scopes: string[]
  metadata: Record<string, any> | null
  status: "active" | "revoked" | "expired"
  rate_limit_rpm: number
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  last_used_ip: string | null
  created_at: string
  updated_at: string
}

export function ApiKeysManager() {
  const [keys, setKeys] = React.useState<ApiKeyItem[]>([])
  const [availableScopes, setAvailableScopes] = React.useState<ScopeDefinition[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  // Create Modal State
  const [isCreateOpen, setIsCreateOpen] = React.useState(false)
  const [newKeyName, setNewKeyName] = React.useState("")
  const [newKeyDesc, setNewKeyDesc] = React.useState("")
  const [selectedScopes, setSelectedScopes] = React.useState<string[]>([
    "instances:read",
    "instances:power",
  ])
  const [expiryOption, setExpiryOption] = React.useState<string>("never")
  const [customExpiry, setCustomExpiry] = React.useState<string>("")
  const [isSubmittingCreate, setIsSubmittingCreate] = React.useState(false)

  // One-Time Secret Reveal Modal State
  const [revealedSecret, setRevealedSecret] = React.useState<{
    token: string
    name: string
    prefix: string
  } | null>(null)
  const [hasCopied, setHasCopied] = React.useState(false)

  // Action Dialogs State
  const [selectedKeyForAction, setSelectedKeyForAction] = React.useState<ApiKeyItem | null>(null)
  const [isRotateOpen, setIsRotateOpen] = React.useState(false)
  const [isRevokeOpen, setIsRevokeOpen] = React.useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = React.useState(false)
  const [isUsageOpen, setIsUsageOpen] = React.useState(false)
  const [usageData, setUsageData] = React.useState<any>(null)
  const [isLoadingUsage, setIsLoadingUsage] = React.useState(false)
  const [isProcessingAction, setIsProcessingAction] = React.useState(false)

  const fetchKeys = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const res = await fetch("/api/admin/api-keys")
      if (res.ok) {
        const data = await res.json()
        setKeys(data.keys || [])
        if (data.availableScopes) {
          setAvailableScopes(data.availableScopes)
        }
      } else {
        toast.error("Failed to load API keys.")
      }
    } catch {
      toast.error("Failed to communicate with API key service.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchKeys()
  }, [fetchKeys])

  // Get CSRF token for mutative operations
  const getCsrfToken = async (): Promise<string> => {
    try {
      const res = await fetch("/api/auth/csrf")
      const data = await res.json()
      return data.csrfToken || ""
    } catch {
      return ""
    }
  }

  // Handle Create API Key
  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKeyName.trim()) {
      toast.error("Please enter a name for the API key.")
      return
    }

    if (selectedScopes.length === 0) {
      toast.error("Please select at least one scope.")
      return
    }

    let calculatedExpiresAt: string | null = null
    if (expiryOption === "7d") {
      calculatedExpiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString()
    } else if (expiryOption === "30d") {
      calculatedExpiresAt = new Date(Date.now() + 30 * 86400 * 1000).toISOString()
    } else if (expiryOption === "90d") {
      calculatedExpiresAt = new Date(Date.now() + 90 * 86400 * 1000).toISOString()
    } else if (expiryOption === "custom" && customExpiry) {
      calculatedExpiresAt = new Date(customExpiry).toISOString()
    }

    try {
      setIsSubmittingCreate(true)
      const csrfToken = await getCsrfToken()
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          name: newKeyName.trim(),
          description: newKeyDesc.trim() || undefined,
          scopes: selectedScopes,
          expiresAt: calculatedExpiresAt,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setIsCreateOpen(false)
        setNewKeyName("")
        setNewKeyDesc("")
        setSelectedScopes(["instances:read", "instances:power"])
        setExpiryOption("never")
        setCustomExpiry("")

        // Show one-time secret modal
        setRevealedSecret({
          token: data.rawToken,
          name: data.key.name,
          prefix: data.key.prefix,
        })
        fetchKeys()
        toast.success("API key generated successfully.")
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to create API key.")
      }
    } catch {
      toast.error("An error occurred while creating the API key.")
    } finally {
      setIsSubmittingCreate(false)
    }
  }

  // Handle Rotate API Key
  const handleRotateKey = async () => {
    if (!selectedKeyForAction) return
    try {
      setIsProcessingAction(true)
      const csrfToken = await getCsrfToken()
      const res = await fetch(`/api/admin/api-keys/${selectedKeyForAction.id}/rotate`, {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      })

      if (res.ok) {
        const data = await res.json()
        setIsRotateOpen(false)
        setRevealedSecret({
          token: data.rawToken,
          name: data.key.name,
          prefix: data.key.prefix,
        })
        fetchKeys()
        toast.success("API key rotated successfully. Previous key revoked.")
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to rotate API key.")
      }
    } catch {
      toast.error("Error rotating API key.")
    } finally {
      setIsProcessingAction(false)
    }
  }

  // Handle Revoke API Key
  const handleRevokeKey = async () => {
    if (!selectedKeyForAction) return
    try {
      setIsProcessingAction(true)
      const csrfToken = await getCsrfToken()
      const res = await fetch(`/api/admin/api-keys/${selectedKeyForAction.id}/revoke`, {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      })

      if (res.ok) {
        setIsRevokeOpen(false)
        fetchKeys()
        toast.success("API key revoked immediately.")
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to revoke API key.")
      }
    } catch {
      toast.error("Error revoking API key.")
    } finally {
      setIsProcessingAction(false)
    }
  }

  // Handle Delete API Key
  const handleDeleteKey = async () => {
    if (!selectedKeyForAction) return
    try {
      setIsProcessingAction(true)
      const csrfToken = await getCsrfToken()
      const res = await fetch(`/api/admin/api-keys/${selectedKeyForAction.id}`, {
        method: "DELETE",
        headers: { "x-csrf-token": csrfToken },
      })

      if (res.ok) {
        setIsDeleteOpen(false)
        fetchKeys()
        toast.success("API key record purged.")
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to delete API key.")
      }
    } catch {
      toast.error("Error deleting API key.")
    } finally {
      setIsProcessingAction(false)
    }
  }

  // Handle View Usage
  const handleOpenUsage = async (key: ApiKeyItem) => {
    setSelectedKeyForAction(key)
    setIsUsageOpen(true)
    setIsLoadingUsage(true)
    try {
      const res = await fetch(`/api/admin/api-keys/${key.id}/usage`)
      if (res.ok) {
        const data = await res.json()
        setUsageData(data)
      }
    } catch {
      toast.error("Failed to load usage telemetry.")
    } finally {
      setIsLoadingUsage(false)
    }
  }

  const handleCopySecret = (text: string) => {
    navigator.clipboard.writeText(text)
    setHasCopied(true)
    toast.success("API key copied to clipboard!")
    setTimeout(() => setHasCopied(false), 3000)
  }

  const toggleScope = (scopeId: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scopeId) ? prev.filter((s) => s !== scopeId) : [...prev, scopeId]
    )
  }

  // Group scopes by category
  const groupedScopes = React.useMemo(() => {
    const groups: Record<string, ScopeDefinition[]> = {}
    for (const s of availableScopes) {
      if (!groups[s.category]) {
        groups[s.category] = []
      }
      groups[s.category].push(s)
    }
    return groups
  }, [availableScopes])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Key className="size-4 text-primary" /> API Keys & Automation
            </CardTitle>
            <CardDescription className="text-xs">
              Manage scoped credentials for external apps, billing systems, and deployment bots.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open("/api/v1/docs", "_blank")}
              className="gap-1.5 text-xs"
            >
              <ExternalLink className="size-3.5" /> API Documentation
            </Button>
            <Button
              size="sm"
              onClick={() => setIsCreateOpen(true)}
              className="gap-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="size-3.5" /> Create API Key
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-6 animate-spin text-primary" />
              Loading API keys...
            </div>
          ) : keys.length === 0 ? (
            <div className="py-12 border border-dashed rounded-lg text-center space-y-3">
              <div className="size-10 rounded-full bg-muted/60 mx-auto flex items-center justify-center text-muted-foreground">
                <Key className="size-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-medium">No API keys created yet</h4>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Generate your first API key to connect external services or infrastructure automation to InterDash.
                </p>
              </div>
              <Button size="sm" onClick={() => setIsCreateOpen(true)} className="text-xs gap-1.5">
                <Plus className="size-3.5" /> Generate First Key
              </Button>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Name & Prefix</TableHead>
                    <TableHead>Scopes</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Last Used</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">
                        <div className="space-y-0.5">
                          <div className="text-sm font-semibold">{k.name}</div>
                          <div className="flex items-center gap-1.5">
                            <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                              {k.prefix}...
                            </code>
                            <button
                              type="button"
                              onClick={() => handleCopySecret(k.prefix)}
                              className="text-muted-foreground hover:text-foreground transition"
                              title="Copy Prefix"
                            >
                              <Copy className="size-3" />
                            </button>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {k.scopes.includes("api:full") ? (
                            <Badge variant="destructive" className="text-[10px] uppercase font-mono">
                              api:full
                            </Badge>
                          ) : (
                            k.scopes.slice(0, 3).map((s) => (
                              <Badge key={s} variant="secondary" className="text-[10px] font-mono">
                                {s}
                              </Badge>
                            ))
                          )}
                          {k.scopes.length > 3 && !k.scopes.includes("api:full") && (
                            <Badge variant="outline" className="text-[10px]">
                              +{k.scopes.length - 3} more
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(k.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {k.expires_at ? new Date(k.expires_at).toLocaleDateString() : "Never"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : "Never"}
                      </TableCell>
                      <TableCell>
                        {k.status === "active" ? (
                          <Badge variant="outline" className="text-[11px] border-emerald-500/30 text-emerald-500 bg-emerald-500/10">
                            Active
                          </Badge>
                        ) : k.status === "revoked" ? (
                          <Badge variant="destructive" className="text-[11px]">
                            Revoked
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[11px] bg-amber-500/10 text-amber-500">
                            Expired
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8">
                              <MoreVertical className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48 text-xs">
                            <DropdownMenuItem onClick={() => handleOpenUsage(k)}>
                              <Activity className="size-3.5 mr-2 text-blue-500" /> View Usage Telemetry
                            </DropdownMenuItem>
                            {k.status === "active" && (
                              <>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedKeyForAction(k)
                                    setIsRotateOpen(true)
                                  }}
                                >
                                  <RefreshCw className="size-3.5 mr-2 text-amber-500" /> Rotate Key Secret
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedKeyForAction(k)
                                    setIsRevokeOpen(true)
                                  }}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Ban className="size-3.5 mr-2" /> Revoke Key
                                </DropdownMenuItem>
                              </>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedKeyForAction(k)
                                setIsDeleteOpen(true)
                              }}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="size-3.5 mr-2" /> Purge Key Record
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===================================================================== */}
      {/* DIALOG 1: CREATE API KEY */}
      {/* ===================================================================== */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="size-5 text-primary" /> Create New API Key
            </DialogTitle>
            <DialogDescription className="text-xs">
              Generate an application credential for automation. Scopes define the exact capabilities granted to this key.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateKey} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Key Name *</Label>
                <Input
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g. WHMCS Billing Bot"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Expiration Policy</Label>
                <select
                  className="w-full flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                  value={expiryOption}
                  onChange={(e) => setExpiryOption(e.target.value)}
                >
                  <option value="never">Never Expires</option>
                  <option value="7d">Expires in 7 days</option>
                  <option value="30d">Expires in 30 days</option>
                  <option value="90d">Expires in 90 days</option>
                  <option value="custom">Custom Date</option>
                </select>
              </div>
            </div>

            {expiryOption === "custom" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Custom Expiration Date & Time (UTC)</Label>
                <Input
                  type="datetime-local"
                  value={customExpiry}
                  onChange={(e) => setCustomExpiry(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Description (Optional)</Label>
              <Input
                value={newKeyDesc}
                onChange={(e) => setNewKeyDesc(e.target.value)}
                placeholder="e.g. Used by the automatic billing sync daemon in US-East"
              />
            </div>

            {/* Scope Selection Workspace */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between border-b pb-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Capability Scopes ({selectedScopes.length} selected)
                </Label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedScopes([
                        "instances:read",
                        "instances:write",
                        "instances:power",
                        "provisioning:read",
                        "tickets:read",
                        "tickets:write",
                      ])
                    }
                    className="text-[11px] text-primary hover:underline"
                  >
                    Preset: Standard App
                  </button>
                  <span className="text-muted-foreground text-xs">•</span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedScopes(availableScopes.map((s) => s.id).filter((s) => s !== "api:full"))
                    }
                    className="text-[11px] text-primary hover:underline"
                  >
                    Select All Safe
                  </button>
                </div>
              </div>

              {selectedScopes.includes("api:full") && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md flex items-start gap-2.5 text-xs text-destructive">
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Extreme Warning:</span> `api:full` grants total control plane privileges across instances, hypervisors, users, and platform settings.
                  </div>
                </div>
              )}

              <div className="space-y-4 max-h-60 overflow-y-auto pr-1">
                {Object.entries(groupedScopes).map(([category, catScopes]) => (
                  <div key={category} className="space-y-2">
                    <h5 className="text-[11px] font-semibold text-muted-foreground uppercase">
                      {category}
                    </h5>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {catScopes.map((scope) => {
                        const isChecked = selectedScopes.includes(scope.id)
                        return (
                          <div
                            key={scope.id}
                            onClick={() => toggleScope(scope.id)}
                            className={`p-2 rounded border cursor-pointer flex items-start gap-2 transition ${
                              isChecked
                                ? scope.isDangerous
                                  ? "bg-destructive/10 border-destructive/40"
                                  : "bg-primary/10 border-primary/40"
                                : "hover:bg-muted/50 border-muted"
                            }`}
                          >
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggleScope(scope.id)}
                              className="mt-0.5"
                            />
                            <div className="space-y-0.5">
                              <div className="text-xs font-mono font-medium flex items-center gap-1.5">
                                {scope.id}
                                {scope.isDangerous && (
                                  <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">
                                    Dangerous
                                  </Badge>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground leading-snug">
                                {scope.description}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateOpen(false)}
                disabled={isSubmittingCreate}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isSubmittingCreate} className="gap-1.5">
                {isSubmittingCreate ? <Loader2 className="size-3.5 animate-spin" /> : <Key className="size-3.5" />}
                Generate API Key
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ===================================================================== */}
      {/* DIALOG 2: ONE-TIME SECRET REVEAL */}
      {/* ===================================================================== */}
      <Dialog open={Boolean(revealedSecret)} onOpenChange={() => setRevealedSecret(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-500">
              <CheckCircle2 className="size-5" /> API Key Created Successfully
            </DialogTitle>
            <DialogDescription className="text-xs">
              This secret is shown <strong>ONCE</strong>. For security, it is never stored in plaintext and cannot be recovered after closing this window.
            </DialogDescription>
          </DialogHeader>

          {revealedSecret && (
            <div className="space-y-4 pt-2">
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-md flex items-start gap-2.5 text-xs text-amber-500">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div>
                  <strong>Copy this key immediately.</strong> Store it in a secure password manager or environment variable.
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Secret Bearer Token for '{revealedSecret.name}'</Label>
                <div className="relative">
                  <pre className="p-3 rounded-md bg-muted font-mono text-xs overflow-x-auto select-all border text-foreground">
                    {revealedSecret.token}
                  </pre>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleCopySecret(revealedSecret.token)}
                    className="absolute right-2 top-2 gap-1.5 text-xs shadow"
                  >
                    {hasCopied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                    {hasCopied ? "Copied!" : "Copy Token"}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5 pt-2">
                <Label className="text-xs text-muted-foreground">Example cURL Usage</Label>
                <pre className="p-3 rounded-md bg-black/50 font-mono text-[11px] overflow-x-auto text-emerald-400 border border-muted">
{`curl -X GET "http://localhost:5173/api/v1/instances" \\
  -H "Authorization: Bearer ${revealedSecret.token}" \\
  -H "Accept: application/json"`}
                </pre>
              </div>
            </div>
          )}

          <DialogFooter className="pt-4 border-t">
            <Button
              type="button"
              onClick={() => {
                setRevealedSecret(null)
                setHasCopied(false)
              }}
            >
              I Have Saved This Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===================================================================== */}
      {/* DIALOG 3: ROTATE KEY CONFIRMATION */}
      {/* ===================================================================== */}
      <Dialog open={isRotateOpen} onOpenChange={setIsRotateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-500">
              <RefreshCw className="size-5" /> Rotate API Key
            </DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to rotate the key <strong>'{selectedKeyForAction?.name}'</strong>?
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 text-xs space-y-2 text-muted-foreground">
            <p>
              Rotating this key will <strong>immediately revoke</strong> the existing credential (prefix: <code className="font-mono">{selectedKeyForAction?.prefix}</code>).
            </p>
            <p>
              Any automated services currently using the old token will immediately fail with <code>401 Unauthorized</code> until updated with the new token.
            </p>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsRotateOpen(false)} disabled={isProcessingAction}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleRotateKey}
              disabled={isProcessingAction}
              className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isProcessingAction ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Revoke & Rotate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===================================================================== */}
      {/* DIALOG 4: REVOKE KEY CONFIRMATION */}
      {/* ===================================================================== */}
      <Dialog open={isRevokeOpen} onOpenChange={setIsRevokeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Ban className="size-5" /> Revoke API Key Immediately
            </DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to permanently deactivate <strong>'{selectedKeyForAction?.name}'</strong>?
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 text-xs text-muted-foreground space-y-2">
            <p>
              This key will immediately be marked as <code>revoked</code>. Any external applications relying on it will instantly be rejected.
            </p>
            <p>
              This action cannot be undone. You would need to generate a new key to re-enable access.
            </p>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsRevokeOpen(false)} disabled={isProcessingAction}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRevokeKey}
              disabled={isProcessingAction}
              className="gap-1.5"
            >
              {isProcessingAction ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
              Revoke Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===================================================================== */}
      {/* DIALOG 5: DELETE KEY CONFIRMATION */}
      {/* ===================================================================== */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="size-5" /> Purge API Key Record
            </DialogTitle>
            <DialogDescription className="text-xs">
              Permanently delete key record <strong>'{selectedKeyForAction?.name}'</strong> from the database.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 text-xs text-muted-foreground">
            This will permanently remove the key metadata and its telemetry history.
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsDeleteOpen(false)} disabled={isProcessingAction}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteKey}
              disabled={isProcessingAction}
              className="gap-1.5"
            >
              {isProcessingAction ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Purge Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===================================================================== */}
      {/* DIALOG 6: USAGE TELEMETRY MODAL */}
      {/* ===================================================================== */}
      <Dialog open={isUsageOpen} onOpenChange={setIsUsageOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="size-5 text-blue-500" /> Usage Telemetry & Metadata
            </DialogTitle>
            <DialogDescription className="text-xs">
              Telemetry and recent request history for '{selectedKeyForAction?.name}' (<code className="font-mono">{selectedKeyForAction?.prefix}...</code>)
            </DialogDescription>
          </DialogHeader>

          {isLoadingUsage ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-6 animate-spin text-blue-500" />
              Loading telemetry...
            </div>
          ) : usageData ? (
            <div className="space-y-4 pt-2 text-xs">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-muted/60 rounded-md">
                  <div className="text-muted-foreground text-[11px]">Total Requests</div>
                  <div className="text-lg font-bold">{usageData.totalRequests}</div>
                </div>
                <div className="p-3 bg-muted/60 rounded-md">
                  <div className="text-muted-foreground text-[11px]">Rate Limit</div>
                  <div className="text-lg font-bold">{selectedKeyForAction?.rate_limit_rpm || 120} RPM</div>
                </div>
                <div className="p-3 bg-muted/60 rounded-md">
                  <div className="text-muted-foreground text-[11px]">Last Used IP</div>
                  <div className="text-sm font-mono truncate">{selectedKeyForAction?.last_used_ip || "N/A"}</div>
                </div>
              </div>

              {usageData.topEndpoints?.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Top Endpoints</Label>
                  <div className="border rounded-md divide-y">
                    {usageData.topEndpoints.map((ep: any, idx: number) => (
                      <div key={idx} className="p-2 flex items-center justify-between font-mono text-[11px]">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-primary">{ep.method}</span>
                          <span className="text-muted-foreground">{ep.endpoint}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-foreground font-semibold">{ep.count} reqs</span>
                          <span className="text-muted-foreground">{Math.round(ep.avg_latency_ms)}ms avg</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Recent Requests (Last 10)</Label>
                {usageData.recentRequests?.length === 0 ? (
                  <p className="text-muted-foreground py-2">No recorded requests yet.</p>
                ) : (
                  <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                    {usageData.recentRequests.slice(0, 10).map((r: any, idx: number) => (
                      <div key={idx} className="p-2 flex items-center justify-between font-mono text-[11px]">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={r.status_code < 400 ? "outline" : "destructive"}
                            className="text-[9px] px-1 py-0 h-4"
                          >
                            {r.status_code}
                          </Badge>
                          <span>{r.method} {r.endpoint}</span>
                        </div>
                        <div className="text-muted-foreground">
                          {new Date(r.created_at).toLocaleTimeString()} ({r.response_time_ms}ms)
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsUsageOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
