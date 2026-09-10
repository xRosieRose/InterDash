/**
 * InterDash — Auth Context (Server-Backed)
 *
 * This context provides UI state for the authenticated user.
 * It is NOT the security boundary — the server is authoritative.
 *
 * Authentication flow:
 * 1. On mount, calls GET /api/auth/me to check server session
 * 2. login() redirects to /api/auth/discord (server-side OAuth)
 * 3. logout() calls POST /api/auth/logout (server invalidates session)
 * 4. NO localStorage. NO client-side tokens. NO fake auth.
 */

import * as React from "react"
import { useNavigate } from "react-router-dom"

export interface AuthUser {
  id: string
  discord_id: string
  username: string
  global_name: string | null
  email: string | null
  avatar_url: string
  role: "user" | "staff" | "admin" | "owner"
  status: string
  is_admin: boolean
}

interface AuthContextType {
  user: AuthUser | null
  isLoading: boolean
  login: () => void
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const navigate = useNavigate()

  /**
   * Fetch the current authenticated user from the server.
   * The server validates the HTTP-only session cookie.
   */
  const refreshUser = React.useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", {
        credentials: "same-origin", // Send cookies
      })

      if (res.ok) {
        const data = await res.json()
        setUser(data)
      } else {
        // Not authenticated — clear user state
        setUser(null)
      }
    } catch {
      // Network error — assume not authenticated
      setUser(null)
    }
  }, [])

  // Check authentication status on mount
  React.useEffect(() => {
    let mounted = true

    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "same-origin",
        })

        if (mounted) {
          if (res.ok) {
            const data = await res.json()
            setUser(data)
          } else {
            setUser(null)
          }
        }
      } catch {
        if (mounted) {
          setUser(null)
        }
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    checkAuth()

    return () => {
      mounted = false
    }
  }, [])

  /**
   * Initiate Discord login.
   * Redirects to the server-side OAuth handler, which handles the
   * entire Discord authorization code flow and sets the session cookie.
   */
  const login = React.useCallback(() => {
    window.location.href = "/api/auth/discord"
  }, [])

  /**
   * Log out by calling the server, which invalidates the session
   * and clears the HTTP-only cookie.
   */
  const logout = React.useCallback(async () => {
    try {
      // Get CSRF token
      const csrfRes = await fetch("/api/auth/csrf", {
        credentials: "same-origin",
      })
      let csrfToken = ""
      if (csrfRes.ok) {
        const csrfData = await csrfRes.json()
        csrfToken = csrfData.token
      }

      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
      })
    } catch {
      // Even if the request fails, clear local state
    }

    setUser(null)
    navigate("/auth/sign-in")
  }, [navigate])

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = React.useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
