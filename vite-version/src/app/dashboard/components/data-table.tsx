"use client"

import * as React from "react"
import {
  Terminal,
  Power,
  RotateCw,
  Trash2,
  Copy,
  Check,
  Search,
  Server,
  Plus,
  MoreVertical,
  RefreshCw,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { VpsInstance } from "@/types/vps"
import { toast } from "sonner"

interface DataTableProps {
  instances: VpsInstance[]
  onOpenTerminal: (vps: VpsInstance) => void
  onTogglePower: (vpsId: string) => void
  onReboot: (vpsId: string) => void
  onDelete: (vpsId: string) => void
  onDeployClick: () => void
}

export function DataTable({
  instances,
  onOpenTerminal,
  onTogglePower,
  onReboot,
  onDelete,
  onDeployClick,
}: DataTableProps) {
  const [activeTab, setActiveTab] = React.useState<"all" | "running" | "stopped">("all")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [copiedIp, setCopiedIp] = React.useState<string | null>(null)

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopiedIp(text)
    toast.success(`Copied ${label} to clipboard`, {
      description: text,
      duration: 2000,
    })
    setTimeout(() => setCopiedIp(null), 2000)
  }

  // Filter instances
  const filteredInstances = React.useMemo(() => {
    return instances.filter((inst) => {
      // Tab filter
      if (activeTab === "running" && inst.status !== "running") return false
      if (activeTab === "stopped" && inst.status !== "stopped") return false

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        return (
          inst.name.toLowerCase().includes(q) ||
          inst.hostname.toLowerCase().includes(q) ||
          inst.ipv4.toLowerCase().includes(q) ||
          inst.region.name.toLowerCase().includes(q) ||
          inst.os.name.toLowerCase().includes(q)
        )
      }

      return true
    })
  }, [instances, activeTab, searchQuery])

  const runningCount = instances.filter((i) => i.status === "running").length
  const stoppedCount = instances.filter((i) => i.status === "stopped").length

  return (
    <div className="space-y-4 px-4 lg:px-6">
      {/* Table Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList>
            <TabsTrigger value="all" className="gap-1.5">
              All VPS
              <Badge variant="secondary" className="px-1.5 py-0 text-xs">
                {instances.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="running" className="gap-1.5">
              Running
              <Badge variant="secondary" className="px-1.5 py-0 text-xs text-emerald-500">
                {runningCount}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="stopped" className="gap-1.5">
              Stopped
              <Badge variant="secondary" className="px-1.5 py-0 text-xs text-muted-foreground">
                {stoppedCount}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Search & Deploy CTA */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Search hostname, IP, OS..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
          <Button onClick={onDeployClick} className="gap-1.5 h-9 shrink-0">
            <Plus className="size-4" />
            Deploy Free VPS
          </Button>
        </div>
      </div>

      {/* Instances Table Container */}
      <div className="rounded-xl border bg-card shadow-xs overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[80px]">Status</TableHead>
              <TableHead>Server Hostname</TableHead>
              <TableHead>Operating System</TableHead>
              <TableHead>IP Addresses</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Specifications</TableHead>
              <TableHead>Uptime</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredInstances.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-40 text-center">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Server className="size-8 text-muted-foreground/50" />
                    <p className="text-sm font-medium text-foreground">No VPS instances found</p>
                    <p className="text-xs text-muted-foreground">
                      {searchQuery
                        ? "Try clearing your search query"
                        : "Deploy a free cloud VPS to get started with InterENL"}
                    </p>
                    {!searchQuery && (
                      <Button size="sm" onClick={onDeployClick} className="mt-2 gap-1.5">
                        <Plus className="size-3.5" />
                        Deploy Free VPS
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredInstances.map((inst) => {
                const isRunning = inst.status === "running"
                const isRestarting = inst.status === "restarting"

                return (
                  <TableRow key={inst.id} className="hover:bg-muted/40">
                    {/* Status Indicator */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {isRunning && (
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                          </span>
                        )}
                        {isRestarting && (
                          <RefreshCw className="size-3.5 animate-spin text-amber-500" />
                        )}
                        {inst.status === "stopped" && (
                          <span className="inline-flex rounded-full h-2.5 w-2.5 bg-muted-foreground/40" />
                        )}
                        <span className="text-xs font-medium capitalize text-muted-foreground">
                          {inst.status}
                        </span>
                      </div>
                    </TableCell>

                    {/* Server Hostname & Label */}
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-mono font-semibold text-sm text-foreground flex items-center gap-1.5">
                          {inst.hostname}
                        </span>
                        <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                          {inst.name}
                        </span>
                      </div>
                    </TableCell>

                    {/* Operating System */}
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-xs font-mono font-medium py-0">
                          {inst.os.name}
                        </Badge>
                        <span className="text-xs text-muted-foreground truncate">
                          {inst.os.version}
                        </span>
                      </div>
                    </TableCell>

                    {/* IPv4 & IPv6 with copy */}
                    <TableCell>
                      <div className="flex flex-col gap-1 font-mono text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-foreground">{inst.ipv4}</span>
                          <button
                            onClick={() => copyToClipboard(inst.ipv4, "IPv4")}
                            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                            title="Copy IPv4"
                          >
                            {copiedIp === inst.ipv4 ? (
                              <Check className="size-3 text-emerald-500" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
                          <span className="truncate max-w-[120px]">{inst.ipv6}</span>
                          <button
                            onClick={() => copyToClipboard(inst.ipv6, "IPv6")}
                            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                            title="Copy IPv6"
                          >
                            {copiedIp === inst.ipv6 ? (
                              <Check className="size-3 text-emerald-500" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    </TableCell>

                    {/* Region */}
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm">
                        <span>{inst.region.flag}</span>
                        <span className="font-medium text-xs">{inst.region.name}</span>
                      </div>
                    </TableCell>

                    {/* Specs */}
                    <TableCell>
                      <div className="flex flex-col text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {inst.specs.cpu} • {inst.specs.ram}
                        </span>
                        <span>{inst.specs.storage} SSD</span>
                      </div>
                    </TableCell>

                    {/* Uptime */}
                    <TableCell>
                      <span className="text-xs font-mono text-muted-foreground">
                        {inst.uptime}
                      </span>
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Web Terminal Button */}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 font-mono text-xs"
                          disabled={!isRunning}
                          onClick={() => onOpenTerminal(inst)}
                        >
                          <Terminal className="size-3.5 text-emerald-500" />
                          Console
                        </Button>

                        {/* More Actions Dropdown */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuLabel className="font-mono text-xs">
                              {inst.hostname}
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => onOpenTerminal(inst)}
                              disabled={!isRunning}
                              className="gap-2 cursor-pointer"
                            >
                              <Terminal className="size-4 text-emerald-500" />
                              Web SSH Console
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onTogglePower(inst.id)}
                              className="gap-2 cursor-pointer"
                            >
                              <Power className={`size-4 ${isRunning ? "text-amber-500" : "text-emerald-500"}`} />
                              {isRunning ? "Stop VPS" : "Start VPS"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onReboot(inst.id)}
                              disabled={!isRunning}
                              className="gap-2 cursor-pointer"
                            >
                              <RotateCw className="size-4 text-blue-500" />
                              Reboot Server
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => copyToClipboard(`ssh root@${inst.ipv4}`, "SSH Command")}
                              className="gap-2 cursor-pointer"
                            >
                              <Copy className="size-4" />
                              Copy SSH Command
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => onDelete(inst.id)}
                              className="gap-2 text-destructive cursor-pointer"
                            >
                              <Trash2 className="size-4" />
                              Destroy VPS
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
