"use client"

import * as React from "react"
import {
  Server,
  Activity,
  Mail,
  CheckSquare,
  Shield,
  AlertTriangle,
  Settings,
  HelpCircle,
  LayoutTemplate,
  Users,
} from "lucide-react"
import { Link } from "react-router-dom"
import { Logo } from "@/components/logo"
import { SidebarNotification } from "@/components/sidebar-notification"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { useAuth } from "@/contexts/auth-context"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const data = {
  user: {
    name: "InterENL Admin",
    email: "admin@interenl.com",
    avatar: "",
  },
  navGroups: [
    {
      label: "Cloud Compute",
      items: [
        {
          title: "VPS Instances",
          url: "/dashboard",
          icon: Server,
        },
        {
          title: "Global Telemetry",
          url: "/dashboard-2",
          icon: Activity,
        },
      ],
    },
    {
      label: "Operations",
      items: [
        {
          title: "Deployment Tasks",
          url: "/tasks",
          icon: CheckSquare,
        },
        {
          title: "Support Tickets",
          url: "/mail",
          icon: Mail,
        },
        {
          title: "Team & API Keys",
          url: "/users",
          icon: Users,
        },
      ],
    },
    {
      label: "Pages",
      items: [
        {
          title: "Landing",
          url: "/landing",
          target: "_blank",
          icon: LayoutTemplate,
        },
        {
          title: "Auth Pages",
          url: "#",
          icon: Shield,
          items: [
            {
              title: "Sign In 1",
              url: "/auth/sign-in",
            },
            {
              title: "Sign In 2",
              url: "/auth/sign-in-2",
            },
            {
              title: "Sign In 3",
              url: "/auth/sign-in-3",
            },
            {
              title: "Sign Up 1",
              url: "/auth/sign-up",
            },
            {
              title: "Sign Up 2",
              url: "/auth/sign-up-2",
            },
            {
              title: "Sign Up 3",
              url: "/auth/sign-up-3",
            },
            {
              title: "Forgot Password 1",
              url: "/auth/forgot-password",
            },
            {
              title: "Forgot Password 2",
              url: "/auth/forgot-password-2",
            },
            {
              title: "Forgot Password 3",
              url: "/auth/forgot-password-3",
            }
          ],
        },
        {
          title: "Errors",
          url: "#",
          icon: AlertTriangle,
          items: [
            {
              title: "Unauthorized",
              url: "/errors/unauthorized",
            },
            {
              title: "Forbidden",
              url: "/errors/forbidden",
            },
            {
              title: "Not Found",
              url: "/errors/not-found",
            },
            {
              title: "Internal Server Error",
              url: "/errors/internal-server-error",
            },
            {
              title: "Under Maintenance",
              url: "/errors/under-maintenance",
            },
          ],
        },
        {
          title: "Settings",
          url: "#",
          icon: Settings,
          items: [
            {
              title: "User Settings",
              url: "/settings/user",
            },
            {
              title: "Account Settings",
              url: "/settings/account",
            },
            {
              title: "Plans & Billing",
              url: "/settings/billing",
            },
            {
              title: "Appearance",
              url: "/settings/appearance",
            },
            {
              title: "Notifications",
              url: "/settings/notifications",
            },
            {
              title: "Connections",
              url: "/settings/connections",
            },
          ],
        },
        {
          title: "VPS FAQs",
          url: "/faqs",
          icon: HelpCircle,
        },
      ],
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user } = useAuth()

  const liveUser = user
    ? {
        name: user.global_name || user.username,
        email: user.email || `@${user.username}`,
        avatar: user.avatarUrl,
        isAdmin: user.isAdmin,
        role: user.role,
      }
    : {
        name: "Connecting...",
        email: "Discord SSO",
        avatar: "",
        isAdmin: false,
        role: "guest",
      }

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/dashboard">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Logo size={24} className="text-current" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-bold tracking-tight">InterENL</span>
                  <span className="truncate text-xs text-muted-foreground">Cloud VPS Hosting</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {data.navGroups.map((group) => (
          <NavMain key={group.label} label={group.label} items={group.items} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarNotification />
        <NavUser user={liveUser} />
      </SidebarFooter>
    </Sidebar>
  )
}
