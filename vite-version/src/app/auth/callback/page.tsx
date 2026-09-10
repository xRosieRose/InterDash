/**
 * InterDash — Auth Callback Page
 *
 * This page handles the return from the server-side OAuth callback.
 * The server has already:
 *   1. Exchanged the authorization code for tokens
 *   2. Created/updated the user in the database
 *   3. Created a session with an HTTP-only cookie
 *   4. Redirected to /dashboard
 *
 * This page exists as a fallback for edge cases (errors, direct navigation).
 */

import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@/contexts/auth-context"
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react"

export default function AuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { refreshUser } = useAuth()
  const [status, setStatus] = React.useState<"loading" | "success" | "error">("loading")
  const [message, setMessage] = React.useState("Verifying session...")

  React.useEffect(() => {
    let mounted = true

    async function handleCallback() {
      // Check for error parameters from the server
      const error = searchParams.get("error")

      if (error) {
        if (!mounted) return
        const errorMessages: Record<string, string> = {
          discord_denied: "Discord authorization was denied.",
          invalid_state: "Security validation failed. Please try again.",
          missing_code: "Authorization code missing. Please try again.",
          token_exchange_failed: "Failed to verify with Discord. Please try again.",
          no_access_token: "Discord did not provide an access token.",
          user_fetch_failed: "Could not retrieve your Discord profile.",
          server_error: "An unexpected server error occurred.",
        }
        setStatus("error")
        setMessage(errorMessages[error] || `Authentication error: ${error}`)
        return
      }

      // If we land here without an error, the server already set the session cookie.
      // Refresh the auth context to pick up the new session.
      try {
        await refreshUser()

        if (!mounted) return
        setStatus("success")
        setMessage("Authentication successful. Redirecting to dashboard...")

        setTimeout(() => {
          if (mounted) {
            navigate("/dashboard", { replace: true })
          }
        }, 800)
      } catch {
        if (!mounted) return
        setStatus("error")
        setMessage("Failed to verify session. Please try signing in again.")
      }
    }

    handleCallback()

    return () => {
      mounted = false
    }
  }, [searchParams, navigate, refreshUser])

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-black text-white p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/80 backdrop-blur-xl p-8 text-center shadow-2xl">
        <div className="flex flex-col items-center gap-4">
          {status === "loading" && (
            <div className="size-16 rounded-full border border-white/15 bg-white/5 flex items-center justify-center">
              <Loader2 className="size-8 animate-spin text-white" />
            </div>
          )}

          {status === "success" && (
            <div className="size-16 rounded-full border border-white/20 bg-white/10 flex items-center justify-center text-white">
              <CheckCircle2 className="size-8 text-white" />
            </div>
          )}

          {status === "error" && (
            <div className="size-16 rounded-full border border-red-500/20 bg-red-500/10 flex items-center justify-center text-red-400">
              <AlertCircle className="size-8" />
            </div>
          )}

          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight text-white">
              {status === "loading" && "Verifying Session"}
              {status === "success" && "Authenticated"}
              {status === "error" && "Authentication Failed"}
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-xs mx-auto">
              {message}
            </p>
          </div>

          {status === "error" && (
            <button
              onClick={() => navigate("/auth/sign-in")}
              className="mt-2 px-4 py-2 rounded-lg bg-white text-black font-medium text-xs hover:bg-zinc-200 transition-colors"
            >
              Return to Login
            </button>
          )}

          <div className="mt-2 text-xs text-zinc-600 font-mono">
            InterENL Free Cloud VPS Management
          </div>
        </div>
      </div>
    </div>
  )
}
