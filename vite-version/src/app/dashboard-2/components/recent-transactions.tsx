"use client"

import { Activity, ShieldAlert, Server, HardDrive, RefreshCw } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const cloudEvents = [
  {
    id: "EVT-8092",
    title: "New Free VPS Provisioned",
    target: "interenl-web-prod (147.185.221.45)",
    region: "🇩🇪 Frankfurt",
    icon: Server,
    status: "completed",
    date: "12 mins ago",
  },
  {
    id: "EVT-8091",
    title: "Automated NVMe Snapshot",
    target: "docker-worker-us (Volume 25GB)",
    region: "🇺🇸 New York",
    icon: HardDrive,
    status: "completed",
    date: "1 hour ago",
  },
  {
    id: "EVT-8090",
    title: "DDoS Mitigation Layer Activated",
    target: "Edge Anycast Filter (18.4 Gbps blocked)",
    region: "🌐 Global Anycast",
    icon: ShieldAlert,
    status: "mitigated",
    date: "3 hours ago",
  },
  {
    id: "EVT-8089",
    title: "Kernel ACPI Soft Reboot",
    target: "alpine-stage-db (Reboot clean)",
    region: "🇸🇬 Singapore",
    icon: RefreshCw,
    status: "completed",
    date: "8 hours ago",
  },
  {
    id: "EVT-8088",
    title: "IPv6 BGP Peering Route Update",
    target: "InterENL Core Router (AS-19924)",
    region: "🇬🇧 London",
    icon: Activity,
    status: "completed",
    date: "1 day ago",
  },
]

export function RecentTransactions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          Cloud Infrastructure Audit Events
        </CardTitle>
        <CardDescription>Live hypervisor operations, deployments, and security telemetry</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {cloudEvents.map((evt) => {
            const Icon = evt.icon
            return (
              <div key={evt.id} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-foreground">{evt.title}</div>
                    <div className="text-xs text-muted-foreground font-mono">{evt.target}</div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge
                    variant="outline"
                    className={`text-[10px] py-0 ${
                      evt.status === "mitigated"
                        ? "text-amber-500 border-amber-500/30 bg-amber-500/10"
                        : "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
                    }`}
                  >
                    {evt.status}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">{evt.date}</span>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
