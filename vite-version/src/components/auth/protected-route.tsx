/**
 * InterDash — Protected Route Component
 *
 * This component provides a client-side UX guard for protected pages.
 * It is NOT the security boundary — the server already enforced
 * authentication before serving the page HTML.
 *
 * This prevents:
 * - Dashboard flash before auth check completes
 * - Serving authenticated UI when /api/auth/me returns 401
 */

import * as React from "react"
import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/contexts/auth-context"
import { Loader2 } from "lucide-react"

export function ProtectedRoute({
  children,
  requireAdmin = false,
}: {
  children: React.ReactNode
  requireAdmin?: boolean
}) {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-black text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="size-12 rounded-full border border-white/20 bg-white/5 flex items-center justify-center">
            <Loader2 className="size-6 animate-spin text-white" />
          </div>
          <p className="text-xs text-zinc-500 font-mono">Authenticating session...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    // Preserve attempted destination for post-login redirect
    return <Navigate to="/auth/sign-in" state={{ from: location }} replace />
  }

  if (requireAdmin && user.role !== "admin") {
    return <Navigate to="/errors/forbidden" replace />
  }

  return <>{children}</>
}
