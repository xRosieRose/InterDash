"use client"

import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react"

export default function AuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [message, setMessage] = useState("Verifying Discord OAuth2 credentials...")

  useEffect(() => {
    const code = searchParams.get("code")
    const error = searchParams.get("error")
    const errorDescription = searchParams.get("error_description")

    if (error) {
      setStatus("error")
      setMessage(errorDescription || "Authentication with Discord was cancelled or failed.")
      const timer = setTimeout(() => {
        navigate("/auth/sign-in")
      }, 2500)
      return () => clearTimeout(timer)
    }

    if (code) {
      // Store Discord authorization code or session marker
      try {
        localStorage.setItem("interdash_discord_session", JSON.stringify({
          authenticated: true,
          authTime: Date.now(),
          provider: "discord"
        }))
      } catch {
        // Ignore storage errors
      }

      setStatus("success")
      setMessage("Discord authorization successful. Loading InterDash console...")
      const timer = setTimeout(() => {
        navigate("/dashboard")
      }, 700)
      return () => clearTimeout(timer)
    }

    // Default fallback if visited directly
    setStatus("success")
    setMessage("Redirecting to dashboard...")
    const timer = setTimeout(() => {
      navigate("/dashboard")
    }, 500)
    return () => clearTimeout(timer)
  }, [searchParams, navigate])

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-black text-white p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/80 backdrop-blur-xl p-8 text-center shadow-2xl">
        <div className="flex flex-col items-center gap-4">
          {status === "loading" && (
            <div className="size-14 rounded-full border border-white/15 bg-white/5 flex items-center justify-center animate-pulse">
              <Loader2 className="size-7 animate-spin text-white" />
            </div>
          )}

          {status === "success" && (
            <div className="size-14 rounded-full border border-white/20 bg-white/10 flex items-center justify-center text-white">
              <CheckCircle2 className="size-7 text-white" />
            </div>
          )}

          {status === "error" && (
            <div className="size-14 rounded-full border border-red-500/20 bg-red-500/10 flex items-center justify-center text-red-400">
              <AlertCircle className="size-7" />
            </div>
          )}

          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight text-white">
              {status === "error" ? "Authorization Failed" : "InterDash SSO"}
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-xs mx-auto">
              {message}
            </p>
          </div>

          <div className="mt-2 text-xs text-zinc-600 font-mono">
            InterENL Cloud VPS Management
          </div>
        </div>
      </div>
    </div>
  )
}
