"use client"

import {
  EllipsisVertical,
  LogOut,
  CircleUser,
  Server,
  LifeBuoy,
  Settings,
  Coins,
} from "lucide-react"
import { Link } from "react-router-dom"
import { useAuth } from "@/contexts/auth-context"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    avatar: string
    isAdmin?: boolean
    role?: string
    coins?: number
  }
}) {
  const { isMobile } = useSidebar()
  const { logout } = useAuth()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground cursor-pointer"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg overflow-hidden shrink-0 border border-white/10 bg-zinc-900">
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <CircleUser className="size-5 text-white" />
                )}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{user.name}</span>
                  {user.isAdmin && (
                    <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-white text-black tracking-wider uppercase">
                      ADMIN
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-muted-foreground truncate text-xs">
                    {user.email}
                  </span>
                  {user.coins !== undefined && (
                    <span className="text-[11px] font-medium text-amber-400/90 flex items-center gap-0.5 shrink-0 font-mono">
                      <Coins className="size-3 text-amber-400" />
                      {user.coins.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
              <EllipsisVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <div className="h-8 w-8 rounded-lg overflow-hidden shrink-0 border border-white/10 bg-zinc-900">
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt={user.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <CircleUser className="size-5 text-white" />
                  )}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{user.name}</span>
                    {user.isAdmin && (
                      <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-white text-black tracking-wider uppercase">
                        ADMIN
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground truncate text-xs">
                    {user.email}
                  </span>
                  {user.coins !== undefined && (
                    <div className="flex items-center gap-1 text-xs font-semibold text-amber-400 mt-1 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 w-fit">
                      <Coins className="size-3.5" />
                      <span>{user.coins.toLocaleString()} coins</span>
                    </div>
                  )}
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link to="/instances">
                  <Server className="size-4" />
                  My Instances
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link to="/tickets">
                  <LifeBuoy className="size-4" />
                  Support Tickets
                </Link>
              </DropdownMenuItem>
              {user.isAdmin && (
                <DropdownMenuItem asChild className="cursor-pointer">
                  <Link to="/admin/settings">
                    <Settings className="size-4" />
                    Panel Settings
                  </Link>
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={logout}
              className="cursor-pointer text-red-400 focus:text-red-300 focus:bg-red-500/10"
            >
              <LogOut className="size-4" />
              Sign out of Discord
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
