"use client"

import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth, type DiscordUser } from "@/contexts/auth-context"
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react"

export default function AuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setUser } = useAuth()
  const [status, setStatus] = React.useState<"loading" | "success" | "error">("loading")
  const [message, setMessage] = React.useState("Connecting to Discord API...")
  const [authenticatedUser, setAuthenticatedUser] = React.useState<DiscordUser | null>(null)

  React.useEffect(() => {
    let isMounted = true

    async function processDiscordAuth() {
      try {
        // 1. Check for token in URL hash fragment (Implicit Grant: #access_token=...&token_type=Bearer)
        const hash = window.location.hash.startsWith("#")
          ? window.location.hash.substring(1)
          : window.location.hash

        const hashParams = new URLSearchParams(hash)
        const accessToken = hashParams.get("access_token")
        const tokenType = hashParams.get("token_type") || "Bearer"
        const error = hashParams.get("error") || searchParams.get("error")
        const errorDescription =
          hashParams.get("error_description") || searchParams.get("error_description")

        // Check if user rejected or Discord reported an error
        if (error) {
          if (!isMounted) return
          setStatus("error")
          setMessage(errorDescription || `Discord authorization error: ${error}`)
          return
        }

        // 2. Handle missing token
        if (!accessToken) {
          // If code is present (Authorization code grant without backend)
          const code = searchParams.get("code")
          if (code) {
            if (!isMounted) return
            setStatus("error")
            setMessage(
              "Authorization code received. InterDash uses direct Discord token authentication. Please sign in again."
            )
            setTimeout(() => navigate("/auth/sign-in"), 3000)
            return
          }

          if (!isMounted) return
          setStatus("error")
          setMessage("No active Discord authorization session detected. Please sign in.")
          setTimeout(() => navigate("/auth/sign-in"), 2000)
          return
        }

        // 3. Query Discord's LIVE REST API in real time
        if (isMounted) {
          setMessage("Fetching verified Discord profile...")
        }

        const discordRes = await fetch("https://discord.com/api/users/@me", {
          headers: {
            Authorization: `${tokenType} ${accessToken}`,
          },
        })

        if (!discordRes.ok) {
          throw new Error(`Discord API responded with HTTP ${discordRes.status}`)
        }

        const discordData = await discordRes.json()

        // 4. Verify Administrator status strictly against environment configuration
        const adminId =
          import.meta.env.VITE_DISCORD_ADMIN_USER_ID ||
          (import.meta.env as unknown as Record<string, string>)?.DISCORD_ADMIN_USER_ID

        const isAdmin = Boolean(
          adminId &&
          adminId !== "987654321098765432" &&
          adminId !== "your_discord_user_id_here" &&
          discordData.id.trim() === adminId.trim()
        )

        // Compute Discord avatar URL
        let avatarUrl = ""
        if (discordData.avatar) {
          avatarUrl = `https://cdn.discordapp.com/avatars/${discordData.id}/${discordData.avatar}.png?size=128`
        } else {
          try {
            const index = Number(BigInt(discordData.id) % 5n)
            avatarUrl = `https://cdn.discordapp.com/embed/avatars/${index}.png`
          } catch {
            avatarUrl = "https://cdn.discordapp.com/embed/avatars/0.png"
          }
        }

        const realUser: DiscordUser = {
          id: discordData.id,
          username: discordData.username,
          global_name: discordData.global_name || discordData.username,
          avatar: discordData.avatar,
          avatarUrl,
          email: discordData.email || "",
          role: isAdmin ? "admin" : "member",
          isAdmin,
          accessToken,
          authTime: Date.now(),
        }

        if (!isMounted) return
        setUser(realUser)
        setAuthenticatedUser(realUser)
        setStatus("success")
        setMessage(`Authenticated as ${realUser.global_name} (@${realUser.username})`)

        // Clean up URL hash so token isn't leaked in browser history
        window.history.replaceState(null, "", window.location.pathname)

        setTimeout(() => {
          navigate("/dashboard", { replace: true })
        }, 1000)
      } catch (err) {
        if (!isMounted) return
        setStatus("error")
        setMessage(err instanceof Error ? err.message : "Failed to verify Discord session.")
      }
    }

    processDiscordAuth()

    return () => {
      isMounted = false
    }
  }, [searchParams, navigate, setUser])

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
            <div className="relative">
              {authenticatedUser?.avatarUrl ? (
                <img
                  src={authenticatedUser.avatarUrl}
                  alt={authenticatedUser.username}
                  className="size-16 rounded-full border-2 border-white/30 object-cover shadow-lg"
                />
              ) : (
                <div className="size-16 rounded-full border border-white/20 bg-white/10 flex items-center justify-center text-white">
                  <CheckCircle2 className="size-8 text-white" />
                </div>
              )}
              {authenticatedUser?.isAdmin && (
                <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-white text-black uppercase tracking-wider">
                  ADMIN
                </span>
              )}
            </div>
          )}

          {status === "error" && (
            <div className="size-16 rounded-full border border-red-500/20 bg-red-500/10 flex items-center justify-center text-red-400">
              <AlertCircle className="size-8" />
            </div>
          )}

          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight text-white">
              {status === "loading" && "Authenticating with Discord"}
              {status === "success" && "Discord Verified"}
              {status === "error" && "Authentication Failed"}
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-xs mx-auto">
              {message}
            </p>
          </div>

          {status === "success" && authenticatedUser && (
            <div className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-left space-y-1 text-xs">
              <div className="flex justify-between text-zinc-400">
                <span>Discord ID:</span>
                <span className="font-mono text-zinc-200">{authenticatedUser.id}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Access Level:</span>
                <span className={authenticatedUser.isAdmin ? "text-white font-semibold uppercase" : "text-zinc-300"}>
                  {authenticatedUser.role}
                </span>
              </div>
            </div>
          )}

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
