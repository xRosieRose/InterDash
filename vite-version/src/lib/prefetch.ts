/**
 * Route prefetching utility to load dynamic route chunks on link hover.
 */

const prefetchMap: Record<string, () => Promise<unknown>> = {
  "/instances": () => import("@/app/instances/page"),
  "/analytics": () => import("@/app/analytics/page"),
  "/tickets": () => import("@/app/tickets/page"),
  "/admin/overview": () => import("@/app/admin/overview/page"),
  "/admin/users": () => import("@/app/admin/users/page"),
  "/admin/nodes": () => import("@/app/admin/nodes/page"),
  "/admin/settings": () => import("@/app/admin/settings/page"),
  "/admin/vps/create": () => import("@/app/admin/vps/create/page"),
}

const prefetchedUrls = new Set<string>()

export function prefetchRoute(url: string): void {
  const cleanUrl = url.split("?")[0]
  if (prefetchedUrls.has(cleanUrl)) return

  const loader = prefetchMap[cleanUrl]
  if (loader) {
    prefetchedUrls.add(cleanUrl)
    loader().catch(() => {
      prefetchedUrls.delete(cleanUrl)
    })
  }
}
