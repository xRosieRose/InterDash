import * as React from "react"
import { Key, ShieldAlert, Trash2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { toast } from "sonner"
import type { VpsRecord } from "@/types/vps"

interface SettingsTabProps {
  vps: VpsRecord
  isBusy: boolean
  canDelete: boolean
  isDeletingVps: boolean
  onOpenPasswordDialog: () => void
  onOpenReinstallDialog: () => void
  onOpenDeleteDialog: () => void
  onMetadataUpdated: () => void
}

export function SettingsTab({
  vps,
  isBusy,
  canDelete,
  isDeletingVps,
  onOpenPasswordDialog,
  onOpenReinstallDialog,
  onOpenDeleteDialog,
  onMetadataUpdated,
}: SettingsTabProps) {
  const [editName, setEditName] = React.useState(vps.name || "")
  const [editDescription, setEditDescription] = React.useState(vps.description || "")
  const [isSavingMetadata, setIsSavingMetadata] = React.useState(false)

  React.useEffect(() => {
    setEditName(vps.name || "")
    setEditDescription(vps.description || "")
  }, [vps.name, vps.description])

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

  const handleSaveMetadata = async () => {
    setIsSavingMetadata(true)
    try {
      const csrfHeaders = await getCsrfHeader()
      const res = await fetch(`/api/vps/${vps.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...csrfHeaders,
        },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim(),
        }),
      })

      if (!res.ok) throw new Error("Failed to update instance metadata.")
      toast.success("Instance metadata saved.")
      onMetadataUpdated()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error saving changes")
    } finally {
      setIsSavingMetadata(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* General Metadata Editor */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">General Metadata</CardTitle>
          <CardDescription className="text-xs">
            Update control plane display labels. Changing display metadata does not modify the internal Linux hostname.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Display Name</Label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="e.g. Production Web Frontend"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description / Notes</Label>
            <Textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Describe purpose or services hosted on this VPS"
              className="h-20 resize-none text-xs"
            />
          </div>
        </CardContent>
        <CardFooter className="border-t p-4 flex justify-end">
          <Button size="sm" onClick={handleSaveMetadata} disabled={isSavingMetadata}>
            {isSavingMetadata && <Loader2 className="size-3.5 animate-spin mr-1" />}
            Save Changes
          </Button>
        </CardFooter>
      </Card>

      {/* Authentication & Root Password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Access & Security</CardTitle>
          <CardDescription className="text-xs">
            Configure root password directly on the Proxmox hypervisor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Reset the Linux root password. The password is submitted securely to the hypervisor and is never stored on InterDash servers.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onOpenPasswordDialog}
          >
            <Key className="size-3.5" /> Change Root Password
          </Button>
        </CardContent>
      </Card>

      {/* Danger Zone: Destructive OS Reinstall */}
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-base text-destructive flex items-center gap-2">
            <ShieldAlert className="size-5" /> Danger Zone: Destructive OS Reinstall
          </CardTitle>
          <CardDescription className="text-xs text-destructive/80">
            Reinstalling will wipe all existing filesystem data and rebuild the container with a clean OS template.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            This action destroys all applications, databases, and local files on the container. The VMID, IP address, and hardware specs will be preserved.
          </p>
          <Button
            variant="destructive"
            size="sm"
            onClick={onOpenReinstallDialog}
            disabled={isBusy}
          >
            Reinstall Operating System
          </Button>
        </CardContent>
      </Card>

      {/* Danger Zone: Permanently Delete VPS */}
      {canDelete && (
        <Card className="border-destructive/60 bg-destructive/10">
          <CardHeader>
            <CardTitle className="text-base text-destructive flex items-center gap-2">
              <Trash2 className="size-5" /> Danger Zone: Permanently Delete VPS
            </CardTitle>
            <CardDescription className="text-xs text-destructive/80">
              Irreversibly stop and destroy the LXC container on Proxmox VE, release reserved network allocations, and purge instance records.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              This permanently destroys the VPS filesystem and removes the VPS from InterDash. All data on this container will be lost forever.
            </p>
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={onOpenDeleteDialog}
              disabled={isBusy || isDeletingVps}
            >
              <Trash2 className="size-3.5" /> Delete VPS Instance
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
