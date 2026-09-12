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

  const handleResetPassword = async () => {
    if (!vpsId) return
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters.")
      return
    }

    setIsResettingPassword(true)
    try {
      const csrf = await getCsrfHeader()
      const res = await fetch(`/api/vps/${vpsId}/password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...csrf,
        },
        body: JSON.stringify({ password: newPassword }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to reset password.")

      toast.success("Root password updated successfully on hypervisor.")
      onOpenChange(false)
      setNewPassword("")
      onSuccess()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    } finally {
      setIsResettingPassword(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="size-5 text-primary" /> Change Root Password
          </DialogTitle>
          <DialogDescription className="text-xs">
            Set a new root password for <code className="font-mono">{hostname}</code>.
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
                className="h-6 text-xs gap-1 text-primary hover:text-primary"
                onClick={() => {
                  const pass =
                    Math.random().toString(36).slice(-10) +
                    Math.random().toString(36).toUpperCase().slice(-4) +
                    "!9"
                  setNewPassword(pass)
                  setShowPassword(true)
                }}
              >
                <Sparkles className="size-3" /> Auto-Generate
              </Button>
            </div>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Minimum 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
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
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleResetPassword}
            disabled={isResettingPassword || newPassword.length < 8}
          >
            {isResettingPassword && <Loader2 className="size-3 animate-spin mr-1" />}
            Apply Password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
