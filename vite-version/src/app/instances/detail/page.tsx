"use client"

import * as React from "react"
import { useParams, useSearchParams, useNavigate } from "react-router-dom"
import {
  LayoutDashboard,
  Terminal as TerminalIcon,
  Settings as SettingsIcon,
  AlertTriangle,
  Loader2,
  ChevronLeft,
} from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Button } from "@/components/ui/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { useAuth } from "@/contexts/auth-context"
import { useVps } from "@/hooks/use-vps"
import { useVpsRuntime } from "@/hooks/use-vps-runtime"
import { useVpsOperations } from "@/hooks/use-vps-operations"
import { InstanceHeader } from "./components/instance-header"
import { OverviewTab } from "./components/overview-tab"
import { ConsoleTab } from "./components/console-tab"
import { SettingsTab } from "./components/settings-tab"
import { PasswordDialog } from "./components/password-dialog"
import { ReinstallDialog } from "./components/reinstall-dialog"
import { DeleteDialog } from "./components/delete-dialog"
import { toast } from "sonner"

export default function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const activeTab = searchParams.get("tab") || "overview"

  // 1. VPS Metadata Hook
  const { vps, isLoading, isRefreshing, pageLoadError, loadVps } = useVps(id)

  // 2. Hypervisor Runtime Status Hook (15-second background polling)
  const { runtime, runtimeSyncError, loadRuntimeStatus } = useVpsRuntime(id)

  // 3. Operations History Hook
  const { operations, activeOperation, operationsSyncError, loadOperations } = useVpsOperations(id)

  // Dialog States
  const [passwordDialogOpen, setPasswordDialogOpen] = React.useState(false)
  const [reinstallDialogOpen, setReinstallDialogOpen] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [isDeletingVps, setIsDeletingVps] = React.useState(false)

  const handleRefreshAll = React.useCallback(async () => {
    await Promise.all([
      loadVps(true),
      loadRuntimeStatus(true),
      loadOperations(true),
    ])
  }, [loadVps, loadRuntimeStatus, loadOperations])

  const handleActionComplete = React.useCallback(async () => {
    await Promise.all([
      loadVps(),
      loadRuntimeStatus(),
      loadOperations(),
    ])
  }, [loadVps, loadRuntimeStatus, loadOperations])

  const handleStartVps = React.useCallback(async () => {
    if (!id) return
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }
      const res = await fetch(`/api/vps/${id}/power`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({ action: "start" }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to start VPS.")
      }
      toast.success("Starting instance...")
      handleActionComplete()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error starting VPS")
    }
  }, [id, handleActionComplete])

  if (isLoading && !vps) {
    return (
      <BaseLayout>
        <div className="px-4 lg:px-6 py-24 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-xs">Loading instance telemetry...</p>
        </div>
      </BaseLayout>
    )
  }

  if (pageLoadError && !vps) {
    return (
      <BaseLayout>
        <div className="px-4 lg:px-6 py-20 flex flex-col items-center justify-center gap-3 text-destructive max-w-md mx-auto text-center">
          <AlertTriangle className="size-8" />
          <h3 className="font-semibold text-base">Unable to load VPS</h3>
          <p className="text-xs text-muted-foreground">{pageLoadError}</p>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/instances")}>
              <ChevronLeft className="size-4 mr-1" /> Back to Instances
            </Button>
            <Button size="sm" onClick={() => loadVps(true)}>
              Retry
            </Button>
          </div>
        </div>
      </BaseLayout>
    )
  }

  if (!vps) {
    return null
  }

  const currentStatus = runtime.status || vps.status || "unknown"
  const isStopped = currentStatus === "stopped"
  const isBusy = Boolean(vps.lock_state)
  const canDelete = isAdmin || (Boolean(vps) && user?.id === vps?.owner_user_id)

  return (
    <BaseLayout>
      <div className="px-4 lg:px-6 space-y-6">
        <InstanceHeader
          vps={vps}
          runtime={runtime}
          runtimeSyncError={runtimeSyncError}
          activeOp={activeOperation}
          isRefreshing={isRefreshing}
          onRefreshAll={handleRefreshAll}
          onRetrySync={() => loadRuntimeStatus(true)}
          onRefreshOp={() => loadOperations(true)}
          onActionComplete={handleActionComplete}
        />

        <Tabs
          value={activeTab}
          onValueChange={(val) => setSearchParams({ tab: val })}
          className="space-y-4"
        >
          <TabsList className="w-full grid grid-cols-3 max-w-2xl h-10">
            <TabsTrigger value="overview" className="gap-2 text-xs font-medium">
              <LayoutDashboard className="size-4" /> Overview
            </TabsTrigger>
            <TabsTrigger value="console" className="gap-2 text-xs font-medium">
              <TerminalIcon className="size-4" /> Console
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2 text-xs font-medium">
              <SettingsIcon className="size-4" /> Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab
              vps={vps}
              runtime={runtime}
              operations={operations}
              operationsSyncError={operationsSyncError}
              isAdmin={isAdmin}
              loadOperations={() => loadOperations(true)}
            />
          </TabsContent>

          <TabsContent value="console">
            <ConsoleTab
              vps={vps}
              isStopped={isStopped}
              onStartVps={handleStartVps}
            />
          </TabsContent>

          <TabsContent value="settings">
            <SettingsTab
              vps={vps}
              isBusy={isBusy}
              canDelete={canDelete}
              isDeletingVps={isDeletingVps}
              onOpenPasswordDialog={() => setPasswordDialogOpen(true)}
              onOpenReinstallDialog={() => setReinstallDialogOpen(true)}
              onOpenDeleteDialog={() => setDeleteDialogOpen(true)}
              onMetadataUpdated={loadVps}
            />
          </TabsContent>
        </Tabs>
      </div>

      <PasswordDialog
        vpsId={vps.id}
        hostname={vps.hostname}
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
        onSuccess={loadOperations}
      />

      <ReinstallDialog
        vps={vps}
        open={reinstallDialogOpen}
        onOpenChange={setReinstallDialogOpen}
        onSuccess={handleActionComplete}
      />

      <DeleteDialog
        vps={vps}
        runtimeNode={runtime.runtimeNode}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        isDeleting={isDeletingVps}
        setIsDeleting={setIsDeletingVps}
      />
    </BaseLayout>
  )
}
