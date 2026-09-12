import * as React from "react"
import { Power, RefreshCw, Loader2, ChevronDown, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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

interface PowerActionsProps {
  vps: VpsRecord
  currentStatus: string
  isBusy: boolean
  isRunning: boolean
  isStopped: boolean
  onActionComplete: () => void
}

export function PowerActions({
  vps,
  isBusy,
  isRunning,
  isStopped,
  onActionComplete,
}: PowerActionsProps) {
  const [powerLoading, setPowerLoading] = React.useState(false)
  const isExpired = vps.expires_at ? new Date(vps.expires_at).getTime() <= Date.now() : false
  const [confirmDialog, setConfirmDialog] = React.useState<{
    open: boolean
    action: "stop" | "force-stop" | "reboot"
  }>({ open: false, action: "stop" })

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

  const handlePowerAction = async (action: "start" | "stop" | "force-stop" | "reboot") => {
    setPowerLoading(true)
    try {
      const csrfHeaders = await getCsrfHeader()
      const res = await fetch(`/api/vps/${vps.id}/power`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...csrfHeaders,
        },
        body: JSON.stringify({ action }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Power action '${action}' failed.`)

      const actionLabels = {
        start: "Starting instance...",
        stop: "Initiating graceful shutdown...",
        "force-stop": "Force-stopping container...",
        reboot: "Rebooting instance...",
      }
      toast.success(actionLabels[action] || "Power signal sent.")
      setConfirmDialog({ open: false, action: "stop" })
      onActionComplete()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to execute power operation")
    } finally {
      setPowerLoading(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {isBusy ? (
          <Badge variant="outline" className="gap-1.5 text-xs py-1.5 px-3 border-amber-500/30 text-amber-500">
            <Loader2 className="size-3.5 animate-spin" />
            <span>Operation in progress...</span>
          </Badge>
        ) : isRunning ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                  disabled={powerLoading}
                >
                  <Power className="size-3.5" /> Stop / Shutdown
                  <ChevronDown className="size-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setConfirmDialog({ open: true, action: "stop" })}
                  className="text-xs"
                >
                  Graceful Shutdown (ACPI)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setConfirmDialog({ open: true, action: "force-stop" })}
                  className="text-xs text-destructive"
                >
                  Force Stop (Immediate)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setConfirmDialog({ open: true, action: "reboot" })}
              disabled={powerLoading || isExpired}
              title={isExpired ? "This VPS has expired and cannot be rebooted." : undefined}
            >
              <RefreshCw className="size-3.5" /> Reboot
            </Button>
          </>
        ) : isStopped ? (
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
            onClick={() => handlePowerAction("start")}
            disabled={powerLoading || isExpired}
            title={isExpired ? "This VPS has expired and cannot be started." : undefined}
          >
            {powerLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Power className="size-3.5" />
            )}
            Start VPS
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
              onClick={() => handlePowerAction("start")}
              disabled={powerLoading || isExpired}
              title={isExpired ? "This VPS has expired and cannot be started." : undefined}
            >
              {powerLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Power className="size-3.5" />
              )}
              Start VPS
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                  disabled={powerLoading}
                >
                  <Power className="size-3.5" /> Stop / Shutdown
                  <ChevronDown className="size-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setConfirmDialog({ open: true, action: "stop" })}
                  className="text-xs"
                >
                  Graceful Shutdown (ACPI)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setConfirmDialog({ open: true, action: "force-stop" })}
                  className="text-xs text-destructive"
                >
                  Force Stop (Immediate)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setConfirmDialog({ open: true, action: "reboot" })}
              disabled={powerLoading}
            >
              <RefreshCw className="size-3.5" /> Reboot
            </Button>
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              Confirm {confirmDialog.action === "reboot" ? "Reboot" : confirmDialog.action === "force-stop" ? "Force Stop" : "Graceful Shutdown"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {confirmDialog.action === "reboot"
                ? `Are you sure you want to reboot ${vps.name || vps.hostname}? Active services will temporarily disconnect.`
                : confirmDialog.action === "force-stop"
                ? `Force stopping ${vps.name || vps.hostname} will immediately terminate execution. Unsaved data could be lost.`
                : `Are you sure you want to shut down ${vps.name || vps.hostname}? A graceful ACPI stop signal will be sent.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDialog({ open: false, action: "stop" })}
              disabled={powerLoading}
            >
              Cancel
            </Button>
            <Button
              variant={confirmDialog.action === "force-stop" ? "destructive" : "default"}
              size="sm"
              onClick={() => handlePowerAction(confirmDialog.action)}
              disabled={powerLoading}
            >
              {powerLoading && <Loader2 className="size-3 animate-spin mr-1" />}
              Confirm {confirmDialog.action === "reboot" ? "Reboot" : "Stop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
