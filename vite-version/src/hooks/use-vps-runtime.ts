import * as React from "react"
import { toast } from "sonner"

export interface VpsRuntimeInfo {
  status?: string
  uptime?: number
  cpus?: number
  memoryMb?: number
  maxmemMb?: number
  maxdiskGb?: number
  runtimeNode?: string
  runtimeNodeSource?: "direct" | "cluster" | "configured"
  lastVerifiedAt?: string
  fresh: boolean
  error?: string | null
}

export function useVpsRuntime(id: string | undefined) {
  const [runtime, setRuntime] = React.useState<VpsRuntimeInfo>({
    fresh: true,
    error: null,
  })
  const [runtimeSyncError, setRuntimeSyncError] = React.useState<string | null>(null)

  const loadRuntimeStatus = React.useCallback(
    async (showToast = false) => {
      if (!id) return
      try {
        const res = await fetch(`/api/vps/${id}/status`)
        if (res.ok) {
          const data = await res.json()
          setRuntime({
            status: data.status,
            uptime: data.uptime,
            cpus: data.cpus,
            memoryMb: data.memoryMb,
            maxmemMb: data.maxMemoryMb || data.maxmem,
            maxdiskGb: data.maxDiskGb || data.maxdisk,
            runtimeNode: data.runtimeNode,
            runtimeNodeSource: data.runtimeNodeSource,
            lastVerifiedAt: data.lastVerifiedAt || (data.fresh ? new Date().toISOString() : undefined),
            fresh: data.fresh !== false,
            error: data.fresh === false ? (data.error || "Hypervisor node unreachable") : null,
          })
          if (data.fresh !== false) {
            setRuntimeSyncError(null)
            if (showToast) toast.success("Hypervisor runtime status verified.")
          } else {
            setRuntimeSyncError(data.error || "Current hypervisor state could not be refreshed.")
            if (showToast) toast.error(data.error || "Hypervisor unreachable.")
          }
        } else {
          const errText = await res.text()
          let msg = "Current hypervisor state could not be refreshed."
          try {
            const parsed = JSON.parse(errText)
            if (parsed.error) msg = parsed.error
          } catch {}
          setRuntime((prev) => ({
            ...prev,
            fresh: false,
            error: msg,
          }))
          setRuntimeSyncError(msg)
          if (showToast) toast.error(msg)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Hypervisor status check failed"
        setRuntime((prev) => ({
          ...prev,
          fresh: false,
          error: msg,
        }))
        setRuntimeSyncError(msg)
        if (showToast) toast.error(msg)
      }
    },
    [id]
  )

  // 15-second polling with visibility API pause
  React.useEffect(() => {
    if (!id) return

    loadRuntimeStatus()

    let intervalId: NodeJS.Timeout | null = null

    const startPolling = () => {
      if (!intervalId) {
        intervalId = setInterval(() => {
          if (document.visibilityState === "visible") {
            loadRuntimeStatus()
          }
        }, 15000)
      }
    }

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadRuntimeStatus()
        startPolling()
      } else {
        stopPolling()
      }
    }

    startPolling()
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [id, loadRuntimeStatus])

  return {
    runtime,
    setRuntime,
    runtimeSyncError,
    loadRuntimeStatus,
  }
}
