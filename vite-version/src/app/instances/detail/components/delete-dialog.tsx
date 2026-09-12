import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Trash2, AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import type { VpsRecord } from "@/types/vps"

interface DeleteDialogProps {
  vps: VpsRecord
  runtimeNode?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  isDeleting: boolean
  setIsDeleting: (deleting: boolean) => void
}

export function DeleteDialog({
  vps,
  runtimeNode,
  open,
  onOpenChange,
  isDeleting,
  setIsDeleting,
}: DeleteDialogProps) {
  const navigate = useNavigate()
  const [deleteConfirmHostname, setDeleteConfirmHostname] = React.useState("")
  const [deleteOperation, setDeleteOperation] = React.useState<{
    id: string
    status: string
    current_step: string
    error?: string | null
  } | null>(null)

  const getCsrfHeader = async (): Promise<Record<string, string>> => {
    try {
      const res = await fetch("/api/auth/csrf")
      if (res.ok) {
        const data = await res.json()
        if (data.token) return { "x-csrf-token": String(data.token) }
      }
    } catch {}
    return {}
  }

  const pollDeleteOperation = React.useCallback(
    (operationId: string) => {
      const pollInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/vps/${vps.id}/operations/${operationId}`)
          if (!res.ok) return
          const data = await res.json()
          const op = data.operation
          if (op) {
            setDeleteOperation(op)
            if (op.status === "completed") {
              clearInterval(pollInterval)
              setIsDeleting(false)
              toast.success("VPS instance permanently deleted.")
              navigate("/instances")
            } else if (op.status === "failed") {
              clearInterval(pollInterval)
              setIsDeleting(false)
              toast.error(op.error || "VPS deletion failed on hypervisor.")
            } else if (op.status === "recovery_required") {
              clearInterval(pollInterval)
              setIsDeleting(false)
              toast.error("Proxmox container destroyed but recovery required for final database/network cleanup.")
            }
          }
        } catch (err) {
          console.error("Error polling delete operation:", err)
        }
      }, 1500)
    },
    [vps.id, navigate, setIsDeleting]
  )

  const handleDeleteVps = async () => {
    if (!vps.id) return
    if (deleteConfirmHostname.trim() !== vps.hostname.trim()) {
      toast.error(`Confirmation mismatch: Please type '${vps.hostname}'.`)
      return
    }

    setIsDeleting(true)
    try {
      const csrf = await getCsrfHeader()
      const res = await fetch(`/api/vps/${vps.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...csrf,
        },
        body: JSON.stringify({ confirmHostname: deleteConfirmHostname.trim() }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to delete VPS.")

      if (data.operationId) {
        setDeleteOperation({
          id: data.operationId,
          status: data.status || "running",
          current_step: "initiating",
        })
        toast.info("Deletion started: Stopping container and releasing IPAM...")
        pollDeleteOperation(data.operationId)
      } else {
        toast.success("VPS instance removed.")
        navigate("/instances")
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-destructive flex items-center gap-2">
            <Trash2 className="size-5" /> Permanently Delete VPS
          </DialogTitle>
          <DialogDescription className="text-xs text-foreground/90">
            This will destroy the LXC container on the hypervisor, release assigned IP addresses, and permanently remove the instance from InterDash.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs">
          {/* Instance details summary */}
          <div className="p-3 rounded-lg border bg-muted/30 font-mono text-[11px] space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground font-sans">Instance Name:</span>
              <span className="font-semibold text-foreground">{vps.name || vps.hostname}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground font-sans">Hostname:</span>
              <span className="text-foreground">{vps.hostname}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground font-sans">Container VMID:</span>
              <span className="text-foreground">{vps.proxmox_vmid}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground font-sans">Runtime Node:</span>
              <span className="text-foreground">{runtimeNode || vps.node_name || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground font-sans">Primary IPv4:</span>
              <span className="text-foreground">{vps.ipv4_address || "DHCP / Unassigned"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground font-sans">Node Region:</span>
              <span className="text-foreground">{vps.node_region || "—"}</span>
            </div>
          </div>

          {/* Warning banner */}
          <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="size-4 shrink-0" /> Irreversible Action
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              This permanently destroys the VPS filesystem and removes the VPS from InterDash. All data on this container will be lost forever.
            </p>
          </div>

          {/* Step Progression if actively deleting */}
          {isDeleting && deleteOperation ? (
            <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin text-destructive" />
                  Deletion Status: <code className="font-mono text-primary uppercase">{deleteOperation.status}</code>
                </span>
                <span className="text-[11px] font-mono text-muted-foreground">
                  Step: {deleteOperation.current_step}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground font-mono">
                {deleteOperation.current_step === "stopping"
                  ? "Gracefully stopping container..."
                  : deleteOperation.current_step === "waiting_for_stop"
                  ? "Waiting for stop task to finalize..."
                  : deleteOperation.current_step === "destroying"
                  ? "Destroying LXC filesystem on Proxmox..."
                  : deleteOperation.current_step === "waiting_for_destroy"
                  ? "Waiting for hypervisor destruction task..."
                  : deleteOperation.current_step === "verifying_absent"
                  ? "Verifying container is completely absent..."
                  : deleteOperation.current_step === "releasing_network"
                  ? "Releasing IPAM and network allocations..."
                  : deleteOperation.current_step === "finalizing"
                  ? "Purging database record..."
                  : deleteOperation.current_step}
              </div>
            </div>
          ) : (
            <div className="space-y-2 p-3 rounded-md bg-destructive/5 border border-destructive/20">
              <Label className="text-destructive font-semibold">
                Type <code className="font-mono">{vps.hostname}</code> to confirm deletion:
              </Label>
              <Input
                value={deleteConfirmHostname}
                onChange={(e) => setDeleteConfirmHostname(e.target.value)}
                placeholder={vps.hostname}
                className="font-mono text-xs border-destructive/40"
                disabled={isDeleting}
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange(false)
              setDeleteConfirmHostname("")
            }}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDeleteVps}
            disabled={
              isDeleting ||
              deleteConfirmHostname.trim() !== vps.hostname.trim()
            }
          >
            {isDeleting && <Loader2 className="size-3 animate-spin mr-1.5" />}
            Permanently Destroy VPS
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
