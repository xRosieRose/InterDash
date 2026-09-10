"use client"

import * as React from "react"
import {
  Server,
  Activity,
  LifeBuoy,
  LayoutDashboard,
  Users,
  HardDrive,
  Settings,
} from "lucide-react"
import { Link } from "react-router-dom"
import { Logo } from "@/components/logo"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { useAuth } from "@/contexts/auth-context"
import { useSettings } from "@/contexts/settings-context"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user } = useAuth()
  const { settings } = useSettings()
  const isAdmin = user?.role === "admin"

  const liveUser = user
    ? {
        name: user.global_name || user.username,
        email: user.email || `@${user.username}`,
        avatar: user.avatar_url,
        isAdmin: user.is_admin,
        role: user.role,
      }
    : {
        name: "Connecting...",
        email: "Discord SSO",
        avatar: "",
        isAdmin: false,
        role: "guest",
      }

  // Build nav groups dynamically based on verified server role
  const navGroups = [
    {
      label: "COMPUTE",
      items: [
        {
          title: "Instances",
          url: "/instances",
          icon: Server,
        },
        {
          title: "Analytics",
          url: "/analytics",
          icon: Activity,
        },
      ],
    },
    {
      label: "OPERATIONS",
      items: [
        {
          title: "Tickets",
          url: "/tickets",
          icon: LifeBuoy,
        },
      ],
    },
  ]

  // Admin group is ONLY rendered when role === 'admin'
  if (isAdmin) {
    navGroups.push({
      label: "ADMIN",
      items: [
        {
          title: "Overview",
          url: "/admin/overview",
          icon: LayoutDashboard,
        },
        {
          title: "Users",
          url: "/admin/users",
          icon: Users,
        },
        {
          title: "Nodes",
          url: "/admin/nodes",
          icon: HardDrive,
        },
        {
          title: "Settings",
          url: "/admin/settings",
          icon: Settings,
        },
      ],
    })
  }

  const headerDestination = isAdmin ? "/admin/overview" : "/instances"

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to={headerDestination}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground overflow-hidden">
                  <Logo size={24} className="text-current" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-bold tracking-tight">{settings.brand_name || "InterDash"}</span>
                  <span className="truncate text-xs text-muted-foreground">{settings.panel_title || "Control Panel"}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <NavMain key={group.label} label={group.label} items={group.items} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={liveUser} />
      </SidebarFooter>
    </Sidebar>
  )
}
