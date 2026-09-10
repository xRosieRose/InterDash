"use client"

import * as React from "react"
import { useNavigate } from "react-router-dom"

export interface DiscordUser {
  id: string
  username: string
  global_name?: string
  avatar?: string
  avatarUrl: string
  email?: string
  role: "admin" | "member"
  isAdmin: boolean
  accessToken: string
  authTime: number
}

interface AuthContextType {
  user: DiscordUser | null
  isLoading: boolean
  login: () => void
  logout: () => void
  setUser: (user: DiscordUser | null) => void
}

const AuthContext = React.createContext<AuthContextType | undefined>(undefined)

const STORAGE_KEY = "interdash_auth_session"

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = React.useState<DiscordUser | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const navigate = useNavigate()

  // Load authenticated Discord session from localStorage on mount
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as DiscordUser
        // Validate user object integrity
        if (parsed?.id && parsed?.accessToken) {
          // Re-evaluate admin status against current env config in case env changed
          const adminId =
            import.meta.env.VITE_DISCORD_ADMIN_USER_ID ||
            (import.meta.env as unknown as Record<string, string>)?.DISCORD_ADMIN_USER_ID

          const isAdmin = Boolean(adminId && parsed.id === adminId)
          parsed.isAdmin = isAdmin
          parsed.role = isAdmin ? "admin" : "member"

          setUserState(parsed)
        } else {
          localStorage.removeItem(STORAGE_KEY)
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const setUser = React.useCallback((newUser: DiscordUser | null) => {
    setUserState(newUser)
    if (newUser) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newUser))
      } catch {
        // Ignore storage errors
      }
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  const login = React.useCallback(() => {
    const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID
    const redirectUri =
      import.meta.env.VITE_DISCORD_REDIRECT_URI ||
      `${window.location.origin}/auth/callback`
    const scopes = import.meta.env.VITE_DISCORD_SCOPES || "identify email"

    if (
      !clientId ||
      clientId === "123456789012345678" ||
      clientId === "your_discord_client_id_here"
    ) {
      throw new Error(
        "Discord OAuth2 is not configured. Please set VITE_DISCORD_CLIENT_ID in your .env file."
      )
    }

    // Direct redirect to Discord's official OAuth2 consent screen
    // response_type=token provides immediate real-time token grant
    const authUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=token&scope=${encodeURIComponent(scopes)}`

    window.location.href = authUrl
  }, [])

  const logout = React.useCallback(() => {
    setUserState(null)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore
    }
    navigate("/auth/sign-in")
  }, [navigate])

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        setUser,
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
