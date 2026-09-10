import { lazy } from "react"
import { Navigate } from "react-router-dom"
import { ProtectedRoute } from "@/components/auth/protected-route"
import { RoleRedirect } from "@/components/router/role-redirect"

// Public & Landing
const Landing = lazy(() => import("@/app/landing/page"))

// Compute
const Instances = lazy(() => import("@/app/instances/page"))
const Analytics = lazy(() => import("@/app/analytics/page"))

// Operations
const Tickets = lazy(() => import("@/app/tickets/page"))

// Admin
const AdminOverview = lazy(() => import("@/app/admin/overview/page"))
const AdminUsers = lazy(() => import("@/app/admin/users/page"))
const AdminNodes = lazy(() => import("@/app/admin/nodes/page"))
const AdminSettings = lazy(() => import("@/app/admin/settings/page"))

// Auth pages
const SignIn = lazy(() => import("@/app/auth/sign-in/page"))
const AuthCallback = lazy(() => import("@/app/auth/callback/page"))

// Error pages
const Unauthorized = lazy(() => import("@/app/errors/unauthorized/page"))
const Forbidden = lazy(() => import("@/app/errors/forbidden/page"))
const NotFound = lazy(() => import("@/app/errors/not-found/page"))
const InternalServerError = lazy(() => import("@/app/errors/internal-server-error/page"))
const UnderMaintenance = lazy(() => import("@/app/errors/under-maintenance/page"))

export interface RouteConfig {
  path: string
  element: React.ReactNode
  children?: RouteConfig[]
}

export const routes: RouteConfig[] = [
  // Landing Page
  {
    path: "/",
    element: <Landing />,
  },
  {
    path: "/landing",
    element: <Landing />,
  },

  // Authentication
  {
    path: "/auth/sign-in",
    element: <SignIn />,
  },
  {
    path: "/auth/callback",
    element: <AuthCallback />,
  },

  // Compute Routes (Authenticated)
  {
    path: "/instances",
    element: (
      <ProtectedRoute>
        <Instances />
      </ProtectedRoute>
    ),
  },
  {
    path: "/analytics",
    element: (
      <ProtectedRoute>
        <Analytics />
      </ProtectedRoute>
    ),
  },

  // Operations Routes (Authenticated)
  {
    path: "/tickets",
    element: (
      <ProtectedRoute>
        <Tickets />
      </ProtectedRoute>
    ),
  },

  // Admin Routes (Authenticated + Admin Role)
  {
    path: "/admin",
    element: <Navigate to="/admin/overview" replace />,
  },
  {
    path: "/admin/overview",
    element: (
      <ProtectedRoute requireAdmin>
        <AdminOverview />
      </ProtectedRoute>
    ),
  },
  {
    path: "/admin/users",
    element: (
      <ProtectedRoute requireAdmin>
        <AdminUsers />
      </ProtectedRoute>
    ),
  },
  {
    path: "/admin/nodes",
    element: (
      <ProtectedRoute requireAdmin>
        <AdminNodes />
      </ProtectedRoute>
    ),
  },
  {
    path: "/admin/settings",
    element: (
      <ProtectedRoute requireAdmin>
        <AdminSettings />
      </ProtectedRoute>
    ),
  },

  // Role-Aware Entrypoint
  {
    path: "/dashboard",
    element: <RoleRedirect />,
  },

  // Controlled Legacy Redirects
  {
    path: "/dashboard-2",
    element: <Navigate to="/analytics" replace />,
  },
  {
    path: "/vps",
    element: <Navigate to="/instances" replace />,
  },
  {
    path: "/servers",
    element: <Navigate to="/instances" replace />,
  },
  {
    path: "/mail",
    element: <Navigate to="/tickets" replace />,
  },
  {
    path: "/users",
    element: <RoleRedirect />,
  },

  // Error Pages
  {
    path: "/errors/unauthorized",
    element: <Unauthorized />,
  },
  {
    path: "/errors/forbidden",
    element: <Forbidden />,
  },
  {
    path: "/errors/not-found",
    element: <NotFound />,
  },
  {
    path: "/errors/internal-server-error",
    element: <InternalServerError />,
  },
  {
    path: "/errors/under-maintenance",
    element: <UnderMaintenance />,
  },

  // Catch-all route for 404
  {
    path: "*",
    element: <NotFound />,
  },
]
