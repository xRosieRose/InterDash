import * as React from "react"
import { Key, Eye, EyeOff, Sparkles, Loader2 } from "lucide-react"
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

interface PasswordDialogProps {
  vpsId: string
  hostname: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function PasswordDialog({
  vpsId,
  hostname,
  open,
  onOpenChange,
  onSuccess,
}: PasswordDialogProps) {
  const [newPassword, setNewPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [isResettingPassword, setIsResettingPassword] = React.useState(false)
  const [pollStatus, setPollStatus] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setPollStatus(null)
      setIsResettingPassword(false)
    }
  }, [open])

  const getCsrfHeader = async (): Promise<Record<string, string>> => {
    const match = typeof document !== "undefined" ? document.cookie.match(/(?:^|;\s*)interdash_csrf=([^;]*)/) : null
    if (match && match[1]) return { "x-csrf-token": decodeURIComponent(match[1]) }
    try {
      const res = await fetch("/api/auth/csrf", { credentials: "same-origin" })
      if (res.ok) {
        const data = await res.json()
        if (data.token) return { "x-csrf-token": String(data.token) }
      }
    } catch {}
    return {}
  }

  const generateSecurePassword = () => {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%_-"
    const arr = crypto.getRandomValues(new Uint32Array(16))
    let p = ""
    for (let i = 0; i < 16; i++) p += chars[arr[i] % chars.length]
    setNewPassword(p)
    setShowPassword(true)
  }

  const pollOperation = async (operationId: string): Promise<void> => {
    const maxAttempts = 30
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 1200))
      try {
        const res = await fetch(`/api/vps/${vpsId}/operations/${operationId}`, {
          credentials: "same-origin",
        })
        if (!res.ok) continue
        const data = await res.json()
        const op = (data.operation || data) as any
        if (!op || !op.status) continue
        setPollStatus(op.status)
        if (op.status === "completed") return
        if (op.status === "failed" || op.status === "recovery_required") {
          const msg = op.error || op.error_message || op.errorMessage || "Password reset failed on hypervisor."
          throw new Error(msg)
        }
      } catch (e) {
        if (e instanceof Error && (e.message.includes("Password reset failed") || e.message.includes("hypervisor") || e.message.includes("Permission") || e.message.includes("locked"))) throw e
        // ignore transient poll errors
      }
    }
    throw new Error("Password reset timed out waiting for hypervisor confirmation.")
  }

  const handleResetPassword = async () => {
    if (!vpsId) return
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters.")
      return
    }
    if (newPassword.length > 128) {
      toast.error("Password must not exceed 128 characters.")
      return
    }

    setIsResettingPassword(true)
    setPollStatus("queued")
    try {
      const csrf = await getCsrfHeader()
      const res = await fetch(`/api/vps/${vpsId}/password`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...csrf,
        },
        body: JSON.stringify({ password: newPassword }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to reset password.")

      // 202 Accepted with async operation — poll until hypervisor confirms
      if (data.operationId) {
        setPollStatus(data.status || "running")
        // Optimistically show initiating toast then wait for completion
        await pollOperation(data.operationId)
      }

      toast.success("Root password updated successfully on hypervisor.")
      onOpenChange(false)
      setNewPassword("")
      setPollStatus(null)
      onSuccess()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
      setPollStatus(null)
    } finally {
      setIsResettingPassword(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="size-5" /> Change Root Password
          </DialogTitle>
          <DialogDescription className="text-xs">
            Set a new root password for <code className="font-mono">{hostname}</code>. The password is sent securely to Proxmox and never stored.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>New Root Password</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1"
                onClick={generateSecurePassword}
                disabled={isResettingPassword}
              >
                <Sparkles className="size-3" /> Generate
              </Button>
            </div>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Minimum 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="pr-10 font-mono text-sm"
                disabled={isResettingPassword}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full w-9 text-muted-foreground"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isResettingPassword}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
            {isResettingPassword && pollStatus && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                <Loader2 className="size-3 animate-spin" />
                <span>
                  {pollStatus === "queued" && "Queued on hypervisor…"}
                  {pollStatus === "running" && "Applying to Proxmox…"}
                  {pollStatus === "waiting_for_proxmox_task" && "Waiting for Proxmox task…"}
                  {!["queued", "running", "waiting_for_proxmox_task"].includes(pollStatus) && `Status: ${pollStatus}`}
                </span>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Password must be 8–128 characters. It is transmitted once to the hypervisor and never logged.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isResettingPassword}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleResetPassword}
            disabled={isResettingPassword || newPassword.length < 8}
          >
            {isResettingPassword && <Loader2 className="size-3 animate-spin mr-1" />}
            {isResettingPassword ? "Applying…" : "Apply Password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
