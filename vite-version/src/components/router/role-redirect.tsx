import { Navigate } from "react-router-dom"
import { useAuth } from "@/contexts/auth-context"
import { Loader2 } from "lucide-react"

export function RoleRedirect() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-black text-white">
        <Loader2 className="size-6 animate-spin text-white" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/auth/sign-in" replace />
  }

  if (user.role === "admin") {
    return <Navigate to="/admin/overview" replace />
  }

  return <Navigate to="/instances" replace />
}
