import * as React from "react"
import { ShieldAlert, Loader2 } from "lucide-react"
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

interface ReinstallDialogProps {
  vps: VpsRecord
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function ReinstallDialog({
  vps,
  open,
  onOpenChange,
  onSuccess,
}: ReinstallDialogProps) {
  const [reinstallTemplate, setReinstallTemplate] = React.useState("")
  const [reinstallPassword, setReinstallPassword] = React.useState("")
  const [reinstallSshKey, setReinstallSshKey] = React.useState("")
  const [confirmHostnameInput, setConfirmHostnameInput] = React.useState("")
  const [isReinstalling, setIsReinstalling] = React.useState(false)
  const [availableTemplates, setAvailableTemplates] = React.useState<
    Array<{ volid: string; sizeBytes?: number; osFamily?: string; version?: string }>
  >([])

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

  React.useEffect(() => {
    if (!open || !vps.id) return

    async function loadTemplates() {
      try {
        const res = await fetch(`/api/vps/${vps.id}/templates`)
        if (res.ok) {
          const data = await res.json()
          setAvailableTemplates(data.templates || [])
          if (data.templates?.length > 0 && !reinstallTemplate) {
            setReinstallTemplate(data.templates[0].volid)
          }
        }
      } catch {}
    }
    loadTemplates()
  }, [open, vps.id, reinstallTemplate])

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  const handleReinstall = async () => {
    if (!vps.id) return
    if (confirmHostnameInput.trim() !== vps.hostname.trim()) {
      toast.error(`Confirmation mismatch: Please type '${vps.hostname}'.`)
      return
    }

    if (!reinstallTemplate) {
      toast.error("Please select a target OS template.")
      return
    }

    setIsReinstalling(true)
    try {
      const csrf = await getCsrfHeader()
      const res = await fetch(`/api/vps/${vps.id}/reinstall`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...csrf,
        },
        body: JSON.stringify({
          osTemplate: reinstallTemplate,
          confirmHostname: confirmHostnameInput.trim(),
          password: reinstallPassword.trim() || undefined,
          sshPublicKey: reinstallSshKey.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to reinstall VPS.")

      toast.success("VPS reinstalled and restored successfully.")
      onOpenChange(false)
      setConfirmHostnameInput("")
      onSuccess()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    } finally {
      setIsReinstalling(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-destructive flex items-center gap-2">
            <ShieldAlert className="size-5" /> Confirm Destructive Reinstall
          </DialogTitle>
          <DialogDescription className="text-xs text-foreground/90">
            Reinstalling this VPS will erase the existing filesystem and applications. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-xs">
          <div className="space-y-1.5">
            <Label>Target OS Template</Label>
            <Select value={reinstallTemplate} onValueChange={setReinstallTemplate}>
              <SelectTrigger>
                <SelectValue placeholder="Select OS template" />
              </SelectTrigger>
              <SelectContent>
                {availableTemplates.map((t) => (
                  <SelectItem key={t.volid} value={t.volid}>
                    {t.volid.split("/").pop()} {t.sizeBytes ? `(${formatBytes(t.sizeBytes)})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>New Root Password (Optional)</Label>
            <Input
              type="password"
              placeholder="Leave blank to generate securely"
              value={reinstallPassword}
              onChange={(e) => setReinstallPassword(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>New SSH Public Key (Optional)</Label>
            <Textarea
              placeholder="ssh-ed25519 AAAAC3... key"
              value={reinstallSshKey}
              onChange={(e) => setReinstallSshKey(e.target.value)}
              className="font-mono text-[11px] h-14 resize-none"
            />
          </div>

          <div className="space-y-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
            <Label className="text-destructive font-semibold">
              Type "{vps.hostname}" to confirm destructive reinstall:
            </Label>
            <Input
              value={confirmHostnameInput}
              onChange={(e) => setConfirmHostnameInput(e.target.value)}
              placeholder={vps.hostname}
              className="font-mono text-xs border-destructive/40"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange(false)
              setConfirmHostnameInput("")
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleReinstall}
            disabled={
              isReinstalling ||
              confirmHostnameInput.trim() !== vps.hostname.trim() ||
              !reinstallTemplate
            }
          >
            {isReinstalling && <Loader2 className="size-3 animate-spin mr-1" />}
            Erase & Reinstall
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
