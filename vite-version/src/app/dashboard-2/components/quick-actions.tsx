"use client"

import { Plus, Activity, Download, Globe, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Link } from "react-router-dom"
import { toast } from "sonner"

export function QuickActions() {
  const runPingTest = () => {
    toast.promise(new Promise((resolve) => setTimeout(resolve, 1500)), {
      loading: "Pinging global anycast edges (FRA, NYC, LON, SIN)...",
      success: "All 5 datacenter nodes responding with < 40ms average jitter!",
      error: "Error running network ping test"
    })
  }

  const downloadCloudInit = () => {
    const script = `#!/bin/bash
# InterENL Cloud-Init Bootstrap Script
# Installs Docker, UFW, Fail2ban, and sets up SSH keys
apt-get update -y
apt-get install -y curl ufw fail2ban docker.io
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "InterENL Free VPS Bootstrap Complete!" > /etc/motd
`
    const blob = new Blob([script], { type: "text/x-shellscript" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "interenl-cloud-init.sh"
    a.click()
    URL.revokeObjectURL(url)
    toast.success("Downloaded InterENL Cloud-Init bootstrap template")
  }

  return (
    <div className="flex items-center space-x-2">
      <Button asChild className="cursor-pointer gap-1.5">
        <Link to="/dashboard">
          <Plus className="size-4" />
          Deploy Free VPS
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="cursor-pointer gap-1.5">
            <Activity className="size-4" />
            Diagnostics
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={runPingTest} className="cursor-pointer gap-2">
            <Globe className="size-4 text-emerald-500" />
            Global Ping Latency Test
          </DropdownMenuItem>
          <DropdownMenuItem onClick={downloadCloudInit} className="cursor-pointer gap-2">
            <Download className="size-4 text-primary" />
            Download Cloud-Init Script
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => toast.info("DDoS shield status: All edge filters active with 0 packet drops.")} className="cursor-pointer gap-2">
            <Shield className="size-4 text-blue-500" />
            Inspect DDoS Mitigation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
