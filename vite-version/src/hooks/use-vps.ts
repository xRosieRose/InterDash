import * as React from "react"
import { toast } from "sonner"
import type { VpsRecord } from "@/types/vps"

export function useVps(id: string | undefined) {
  const [vps, setVps] = React.useState<VpsRecord | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [pageLoadError, setPageLoadError] = React.useState<string | null>(null)

  const loadVps = React.useCallback(
    async (showToast = false) => {
      if (!id) return
      try {
        if (showToast) setIsRefreshing(true)
        const res = await fetch(`/api/vps/${id}`)
        if (!res.ok) {
          if (res.status === 403) throw new Error("Access denied. You do not own this instance.")
          if (res.status === 404) throw new Error("VPS instance not found.")
          throw new Error("Failed to load instance.")
        }
        const data = await res.json()
        setVps(data.instance)
        setPageLoadError(null)

        if (showToast) toast.success("Instance details synchronized.")
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setPageLoadError((prev) => (vps ? prev : msg))
        if (showToast) toast.error(msg)
      } finally {
        setIsLoading(false)
        if (showToast) setIsRefreshing(false)
      }
    },
    [id, vps]
  )

  React.useEffect(() => {
    loadVps()
  }, [id])

  return {
    vps,
    setVps,
    isLoading,
    isRefreshing,
    pageLoadError,
    loadVps,
  }
}
