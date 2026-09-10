"use client"

import * as React from "react"
import {
  Shield,
  ShieldAlert,
  Search,
  RefreshCw,
  MoreVertical,
  Ban,
  UserCheck,
  Loader2,
  CircleUser,
} from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/contexts/auth-context"
import { toast } from "sonner"

interface AdminUserRecord {
  id: string
  discord_id: string
  username: string
  global_name: string | null
  email: string | null
  avatar_hash: string | null
  role: "user" | "admin"
  status: "active" | "suspended" | "banned"
  created_at: string
  last_login_at: string | null
  vps_count: number
}

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = React.useState<AdminUserRecord[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")

  const fetchUsers = React.useCallback(async (showToast = false) => {
    try {
      if (showToast) setIsRefreshing(true)
      const res = await fetch("/api/admin/users")
      if (!res.ok) throw new Error("Failed to load users.")
      const data = await res.json()
      setUsers(data.users || [])
      if (showToast) toast.success("User list updated.")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error loading users")
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleRoleChange = async (userId: string, newRole: "admin" | "user") => {
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({ role: newRole }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update role.")

      toast.success(`User role updated to ${newRole}.`)
      fetchUsers()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error updating role")
    }
  }

  const handleStatusChange = async (userId: string, newStatus: "active" | "suspended") => {
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({ status: newStatus }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update status.")

      toast.success(`User status updated to ${newStatus}.`)
      fetchUsers()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error updating status")
    }
  }

  const filteredUsers = React.useMemo(() => {
    if (!searchQuery.trim()) return users
    const q = searchQuery.toLowerCase()
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        (u.global_name && u.global_name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        u.discord_id.includes(q)
    )
  }, [users, searchQuery])

  return (
    <BaseLayout
      title="User Management"
      description="Manage registered Discord platform users, assign administrator privileges, and enforce account statuses."
    >
      <div className="@container/main px-4 lg:px-6 space-y-4">
        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {users.length} registered user(s)
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => fetchUsers(true)}
              disabled={isRefreshing}
            >
              <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9 text-xs"
            />
          </div>
        </div>

        {/* Users Table */}
        <div className="rounded-md border border-border bg-card">
          {isLoading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs">
              <Loader2 className="size-6 animate-spin text-primary" />
              Loading real database users...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-16 text-center text-xs text-muted-foreground">
              No users found matching your search.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User / Identity</TableHead>
                  <TableHead>Discord ID</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>VPS Count</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((u) => {
                  const isAdmin = u.role === "admin"
                  const isSelf = u.id === currentUser?.id
                  const avatarUrl = u.avatar_hash
                    ? `https://cdn.discordapp.com/avatars/${u.discord_id}/${u.avatar_hash}.png?size=64`
                    : null

                  return (
                    <TableRow key={u.id}>
                      {/* Identity */}
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div className="size-8 rounded-full overflow-hidden bg-zinc-800 border shrink-0 flex items-center justify-center">
                            {avatarUrl ? (
                              <img src={avatarUrl} alt={u.username} className="size-full object-cover" />
                            ) : (
                              <CircleUser className="size-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-semibold text-xs text-foreground flex items-center gap-1">
                              {u.global_name || u.username}
                              {isSelf && (
                                <Badge variant="secondary" className="text-[9px] py-0">
                                  You
                                </Badge>
                              )}
                            </span>
                            <span className="text-[11px] text-muted-foreground font-mono">
                              @{u.username} {u.email ? `• ${u.email}` : ""}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {/* Discord ID */}
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {u.discord_id}
                      </TableCell>

                      {/* Role */}
                      <TableCell>
                        {isAdmin ? (
                          <Badge variant="default" className="text-[10px] uppercase font-bold py-0">
                            Admin
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] uppercase py-0">
                            User
                          </Badge>
                        )}
                      </TableCell>

                      {/* Status */}
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`capitalize text-[10px] py-0 ${
                            u.status === "active"
                              ? "text-emerald-500 border-emerald-500/30"
                              : "text-destructive border-destructive/30"
                          }`}
                        >
                          {u.status}
                        </Badge>
                      </TableCell>

                      {/* VPS Count */}
                      <TableCell className="font-mono text-xs font-semibold">
                        {u.vps_count} instance(s)
                      </TableCell>

                      {/* Joined Date */}
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {u.created_at ? u.created_at.split("T")[0] : "—"}
                      </TableCell>

                      {/* Last Login */}
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {u.last_login_at ? u.last_login_at.split("T")[0] : "—"}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer">
                              <MoreVertical className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="text-xs">
                            {isAdmin ? (
                              <DropdownMenuItem
                                onClick={() => handleRoleChange(u.id, "user")}
                                disabled={isSelf}
                              >
                                <ShieldAlert className="size-3.5 mr-2 text-destructive" /> Demote to User
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => handleRoleChange(u.id, "admin")}>
                                <Shield className="size-3.5 mr-2 text-primary" /> Promote to Admin
                              </DropdownMenuItem>
                            )}

                            <DropdownMenuSeparator />

                            {u.status === "active" ? (
                              <DropdownMenuItem
                                onClick={() => handleStatusChange(u.id, "suspended")}
                                disabled={isSelf}
                                className="text-destructive"
                              >
                                <Ban className="size-3.5 mr-2" /> Suspend Account
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => handleStatusChange(u.id, "active")}>
                                <UserCheck className="size-3.5 mr-2 text-emerald-500" /> Reactivate Account
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </BaseLayout>
  )
}
