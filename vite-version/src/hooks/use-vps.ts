import * as React from "react"
import { toast } from "sonner"
import type { VpsRecord } from "@/types/vps"

// Global in-memory cache for instant client-side navigation (SWR)
const vpsCache = new Map<string, { data: VpsRecord; timestamp: number }>()
const inflightRequests = new Map<string, Promise<VpsRecord | null>>()

/**
 * Seed or update the client-side instance cache
 */
export function setVpsCache(instance: VpsRecord): void {
  if (!instance?.id) return
  vpsCache.set(instance.id, { data: instance, timestamp: Date.now() })
}

/**
 * Bulk seed the cache (e.g. from the instances list view)
 */
export function setVpsCacheMany(instances: VpsRecord[]): void {
  if (!Array.isArray(instances)) return
  const now = Date.now()
  for (const inst of instances) {
    if (inst?.id) {
      vpsCache.set(inst.id, { data: inst, timestamp: now })
    }
  }
}

/**
 * Pre-fetch an instance into cache (e.g. on mouse hover)
 */
export async function prefetchVps(id: string): Promise<VpsRecord | null> {
  if (!id) return null
  const cached = vpsCache.get(id)
  // If cached within the last 15 seconds, don't refetch
  if (cached && Date.now() - cached.timestamp < 15_000) {
    return cached.data
  }

  if (inflightRequests.has(id)) {
    return inflightRequests.get(id)!
  }

  const promise = (async () => {
    try {
      const res = await fetch(`/api/vps/${id}`, { credentials: "same-origin" })
      if (res.ok) {
        const data = await res.json()
        if (data.instance) {
          setVpsCache(data.instance)
          return data.instance as VpsRecord
        }
      }
    } catch {
      // Ignore prefetch errors silently
    } finally {
      inflightRequests.delete(id)
    }
    return null
  })()

  inflightRequests.set(id, promise)
  return promise
}

export function useVps(id: string | undefined, initialData?: VpsRecord | null) {
  // Check if we have an immediate candidate from initialData or cache
  const getInitialCandidate = React.useCallback((): VpsRecord | null => {
    if (initialData && initialData.id === id) {
      setVpsCache(initialData)
      return initialData
    }
    if (id && vpsCache.has(id)) {
      return vpsCache.get(id)!.data
    }
    return null
  }, [id, initialData])

  const initialCandidate = getInitialCandidate()
  const [vps, setVps] = React.useState<VpsRecord | null>(initialCandidate)
  const [isLoading, setIsLoading] = React.useState(!initialCandidate)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [pageLoadError, setPageLoadError] = React.useState<string | null>(null)

  // Keep state in sync if id changes
  React.useEffect(() => {
    const candidate = getInitialCandidate()
    if (candidate) {
      setVps(candidate)
      setIsLoading(false)
    } else {
      setIsLoading(true)
    }
  }, [id, getInitialCandidate])

  const loadVps = React.useCallback(
    async (showToast = false) => {
      if (!id) return
      try {
        if (showToast) setIsRefreshing(true)
        const res = await fetch(`/api/vps/${id}`, { credentials: "same-origin" })
        if (!res.ok) {
          if (res.status === 403) throw new Error("Access denied. You do not own this instance.")
          if (res.status === 404) throw new Error("VPS instance not found.")
          throw new Error("Failed to load instance.")
        }
        const data = await res.json()
        setVps(data.instance)
        setVpsCache(data.instance)
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
