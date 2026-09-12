import * as React from "react"
import { toast } from "sonner"

export interface VpsOperationItem {
  id: string
  vps_id: string
  requested_by_user_id: string
  operation_type: string
  status: "queued" | "running" | "waiting_for_proxmox_task" | "completed" | "failed" | "cancelled" | "recovery_required"
  current_step: string
  result_json?: string | null
  error_code?: string | null
  error_message?: string | null
  heartbeat_at?: string | null
  lease_expires_at?: string | null
  started_at: string
  completed_at?: string | null
  created_at: string
}

export function useVpsOperations(id: string | undefined) {
  const [operations, setOperations] = React.useState<VpsOperationItem[]>([])
  const [operationsSyncError, setOperationsSyncError] = React.useState<string | null>(null)
  const [isLoadingOps, setIsLoadingOps] = React.useState(false)

  const loadOperations = React.useCallback(
    async (showToast = false) => {
      if (!id) return
      try {
        setIsLoadingOps(true)
        const res = await fetch(`/api/vps/${id}/operations`)
        if (res.ok) {
          const data = await res.json()
          setOperations(data.operations || [])
          setOperationsSyncError(null)
          if (showToast) toast.success("Operation history updated.")
        } else {
          setOperationsSyncError("Failed to fetch operation logs.")
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error loading operations"
        setOperationsSyncError(msg)
      } finally {
        setIsLoadingOps(false)
      }
    },
    [id]
  )

  React.useEffect(() => {
    loadOperations()
  }, [id, loadOperations])

  const activeOperation = React.useMemo(() => {
    return operations.find((op) =>
      ["queued", "running", "waiting_for_proxmox_task"].includes(op.status)
    ) || null
  }, [operations])

  return {
    operations,
    activeOperation,
    operationsSyncError,
    isLoadingOps,
    loadOperations,
  }
}
