"use client"

import { Globe, CheckCircle2, Server } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

const datacenterNodes = [
  {
    id: "FRA-01",
    name: "Frankfurt Core",
    country: "Germany",
    flag: "🇩🇪",
    uptime: "99.998%",
    ping: "14 ms",
    nodesOnline: "128 / 128",
    capacity: "78%",
    status: "healthy",
  },
  {
    id: "NYC-02",
    name: "New York East",
    country: "United States",
    flag: "🇺🇸",
    uptime: "99.995%",
    ping: "76 ms",
    nodesOnline: "96 / 96",
    capacity: "82%",
    status: "healthy",
  },
  {
    id: "LON-01",
    name: "London Metro",
    country: "United Kingdom",
    flag: "🇬🇧",
    uptime: "99.999%",
    ping: "22 ms",
    nodesOnline: "64 / 64",
    capacity: "64%",
    status: "healthy",
  },
  {
    id: "SIN-01",
    name: "Singapore Equinix",
    country: "Singapore",
    flag: "🇸🇬",
    uptime: "99.992%",
    ping: "142 ms",
    nodesOnline: "48 / 48",
    capacity: "91%",
    status: "healthy",
  },
  {
    id: "TYO-01",
    name: "Tokyo BBIX",
    country: "Japan",
    flag: "🇯🇵",
    uptime: "99.996%",
    ping: "165 ms",
    nodesOnline: "32 / 32",
    capacity: "55%",
    status: "healthy",
  },
]

export function CustomerInsights() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="size-4 text-primary" />
              Global Datacenter Node Health & Edge Connectivity
            </CardTitle>
            <CardDescription>
              Live operational telemetry across InterENL Tier 3 & Tier 4 cloud facilities
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 gap-1 text-xs">
            <span className="size-2 rounded-full bg-emerald-500 inline-block" />
            All Nodes Operational
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Datacenter Cluster</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Ping Latency</TableHead>
                <TableHead>Uptime (30d)</TableHead>
                <TableHead>Hypervisors</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead className="text-right">Health</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {datacenterNodes.map((dc) => (
                <TableRow key={dc.id} className="hover:bg-muted/40">
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm text-foreground">{dc.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{dc.id}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm">
                      <span>{dc.flag}</span>
                      <span>{dc.country}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded">
                      {dc.ping}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-foreground font-medium">
                      {dc.uptime}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Server className="size-3 text-primary" />
                      <span>{dc.nodesOnline}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">
                      {dc.capacity}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 gap-1 text-[11px]">
                      <CheckCircle2 className="size-3" />
                      Healthy
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
