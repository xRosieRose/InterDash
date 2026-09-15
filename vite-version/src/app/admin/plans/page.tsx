"use client"

import * as React from "react"
import {
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Cpu,
  MemoryStick,
  HardDrive,
  Coins,
  Network,
  Server,
  AlertCircle,
  Check,
} from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"

interface VpsPlan {
  id: string
  name: string
  description: string | null
  cpu_cores: number
  memory_mb: number
  disk_gb: number
  swap_mb: number
  coin_price: number
  network_bridge: string
  enabled: number
  display_order: number
  created_by_user_id: string | null
  created_at: string
  updated_at: string
  deployments_count?: number
}

function formatRam(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`
}

export default function AdminPlansPage() {
  const [plans, setPlans] = React.useState<VpsPlan[]>([])
  const [loading, setLoading] = React.useState(true)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingPlan, setEditingPlan] = React.useState<VpsPlan | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [deletingPlan, setDeletingPlan] = React.useState<VpsPlan | null>(null)

  // Form state
  const [formName, setFormName] = React.useState("")
  const [formDescription, setFormDescription] = React.useState("")
  const [formCpu, setFormCpu] = React.useState("1")
  const [formRam, setFormRam] = React.useState("1024")
  const [formDisk, setFormDisk] = React.useState("20")
  const [formSwap, setFormSwap] = React.useState("512")
  const [formPrice, setFormPrice] = React.useState("100")
  const [formBridge, setFormBridge] = React.useState("vmbr0")
  const [formOrder, setFormOrder] = React.useState("0")
  const [formEnabled, setFormEnabled] = React.useState(true)

  const fetchPlans = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/plans", { credentials: "same-origin" })
      if (res.ok) {
        const data = await res.json()
        setPlans(data.plans || [])
      }
    } catch {
      toast.error("Failed to load plans.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchPlans()
  }, [fetchPlans])

  const openCreateDialog = () => {
    setEditingPlan(null)
    setFormName("")
    setFormDescription("")
    setFormCpu("1")
    setFormRam("1024")
    setFormDisk("20")
    setFormSwap("512")
    setFormPrice("100")
    setFormBridge("vmbr0")
    setFormOrder("0")
    setFormEnabled(true)
    setDialogOpen(true)
  }

  const openEditDialog = (plan: VpsPlan) => {
    setEditingPlan(plan)
    setFormName(plan.name)
    setFormDescription(plan.description || "")
    setFormCpu(String(plan.cpu_cores))
    setFormRam(String(plan.memory_mb))
    setFormDisk(String(plan.disk_gb))
    setFormSwap(String(plan.swap_mb))
    setFormPrice(String(plan.coin_price))
    setFormBridge(plan.network_bridge)
    setFormOrder(String(plan.display_order))
    setFormEnabled(plan.enabled === 1)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const body = {
        name: formName,
        description: formDescription || null,
        cpuCores: parseInt(formCpu),
        memoryMb: parseInt(formRam),
        diskGb: parseInt(formDisk),
        swapMb: parseInt(formSwap),
        coinPrice: parseInt(formPrice),
        networkBridge: formBridge,
        displayOrder: parseInt(formOrder),
        enabled: formEnabled,
      }

      const url = editingPlan
        ? `/api/admin/plans/${editingPlan.id}`
        : "/api/admin/plans"
      const method = editingPlan ? "PATCH" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (res.ok) {
        toast.success(data.message || (editingPlan ? "Plan updated." : "Plan created."))
        setDialogOpen(false)
        fetchPlans()
      } else {
        toast.error(data.error || "Failed to save plan.")
      }
    } catch {
      toast.error("Network error.")
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (plan: VpsPlan) => {
    try {
      const endpoint = plan.enabled === 1 ? "disable" : "enable"
      const res = await fetch(`/api/admin/plans/${plan.id}/${endpoint}`, {
        method: "POST",
        credentials: "same-origin",
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(data.message)
        fetchPlans()
      } else {
        toast.error(data.error)
      }
    } catch {
      toast.error("Failed to toggle plan.")
    }
  }

  const handleDelete = async () => {
    if (!deletingPlan) return
    try {
      const res = await fetch(`/api/admin/plans/${deletingPlan.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(data.message)
        setDeleteDialogOpen(false)
        setDeletingPlan(null)
        fetchPlans()
      } else {
        toast.error(data.error)
      }
    } catch {
      toast.error("Failed to delete plan.")
    }
  }

  return (
    <BaseLayout
      title="VPS Plans"
      description="Manage deployment plans that users can purchase with coins."
    >
      <div className="px-4 lg:px-6">
        <div className="max-w-5xl mx-auto">
          {/* Header actions */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {plans.length} Plan{plans.length !== 1 ? "s" : ""}
              </Badge>
            </div>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Create Plan
            </Button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Loading plans...</p>
            </div>
          ) : plans.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Plans Yet</h3>
                <p className="text-muted-foreground mb-4">
                  Create your first deployment plan to allow users to deploy VPS instances with coins.
                </p>
                <Button onClick={openCreateDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Plan
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plan</TableHead>
                      <TableHead className="text-center">CPU</TableHead>
                      <TableHead className="text-center">RAM</TableHead>
                      <TableHead className="text-center">Disk</TableHead>
                      <TableHead className="text-center">Price</TableHead>
                      <TableHead className="text-center">Bridge</TableHead>
                      <TableHead className="text-center">Deploys</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plans.map((plan) => (
                      <TableRow key={plan.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              <Server className="h-4 w-4 text-primary" />
                              {plan.name}
                            </div>
                            {plan.description && (
                              <div className="text-xs text-muted-foreground mt-0.5 max-w-[200px] truncate">
                                {plan.description}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-sm font-medium">{plan.cpu_cores}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-sm">{formatRam(plan.memory_mb)}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-sm">{plan.disk_gb} GB</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-sm font-semibold flex items-center justify-center gap-1">
                            <Coins className="h-3.5 w-3.5 text-amber-500" />
                            {plan.coin_price.toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-xs font-mono">{plan.network_bridge}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-sm">{plan.deployments_count || 0}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant="outline"
                            className={
                              plan.enabled === 1
                                ? "bg-green-500/10 text-green-500 border-green-500/30"
                                : "bg-red-500/10 text-red-500 border-red-500/30"
                            }
                          >
                            {plan.enabled === 1 ? "Active" : "Disabled"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggle(plan)}
                              title={plan.enabled ? "Disable" : "Enable"}
                            >
                              {plan.enabled === 1 ? (
                                <ToggleRight className="h-4 w-4 text-green-500" />
                              ) : (
                                <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                              )}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => openEditDialog(plan)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setDeletingPlan(plan)
                                setDeleteDialogOpen(true)
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPlan ? "Edit Plan" : "Create Plan"}</DialogTitle>
            <DialogDescription>
              {editingPlan
                ? "Changes apply only to future deployments. Existing VPSs preserve their snapshot."
                : "Define resource allocations and coin pricing for a new deployment plan."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Plan Name *</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Starter, Pro, Enterprise"
                maxLength={64}
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Optional plan description..."
                maxLength={500}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>CPU Cores</Label>
                <Input type="number" value={formCpu} onChange={(e) => setFormCpu(e.target.value)} min={1} max={64} />
              </div>
              <div className="space-y-2">
                <Label>RAM (MB)</Label>
                <Input type="number" value={formRam} onChange={(e) => setFormRam(e.target.value)} min={256} max={131072} />
              </div>
              <div className="space-y-2">
                <Label>Disk (GB)</Label>
                <Input type="number" value={formDisk} onChange={(e) => setFormDisk(e.target.value)} min={5} max={2048} />
              </div>
              <div className="space-y-2">
                <Label>Swap (MB)</Label>
                <Input type="number" value={formSwap} onChange={(e) => setFormSwap(e.target.value)} min={0} max={65536} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  <Coins className="h-3.5 w-3.5 text-amber-500" />
                  Coin Price *
                </Label>
                <Input type="number" value={formPrice} onChange={(e) => setFormPrice(e.target.value)} min={1} />
              </div>
              <div className="space-y-2">
                <Label>Network Bridge</Label>
                <Input value={formBridge} onChange={(e) => setFormBridge(e.target.value)} placeholder="vmbr0" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Display Order</Label>
                <Input type="number" value={formOrder} onChange={(e) => setFormOrder(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Enabled</Label>
                <div className="pt-1">
                  <Switch checked={formEnabled} onCheckedChange={setFormEnabled} />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !formName.trim()}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              {editingPlan ? "Update Plan" : "Create Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Plan</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deletingPlan?.name}</strong>?
              {(deletingPlan?.deployments_count ?? 0) > 0 && (
                <span className="block mt-2 text-amber-500">
                  This plan has {deletingPlan?.deployments_count} deployment(s). It will be disabled/archived instead of deleted to preserve ledger integrity.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BaseLayout>
  )
}
