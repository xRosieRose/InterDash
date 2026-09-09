"use client"

import { 
  Activity, 
  ShieldCheck, 
  Server,
  Zap
} from "lucide-react"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const metrics = [
  {
    title: "Global Cluster Health",
    value: "99.99%",
    description: "System availability",
    change: "Normal",
    trend: "up",
    icon: ShieldCheck,
    footer: "All 5 datacenters online",
    subfooter: "Redundant power & dual uplinks"
  },
  {
    title: "Active Free VPS Servers",
    value: "14,820",
    description: "Global community nodes",
    change: "+8.4%", 
    trend: "up",
    icon: Server,
    footer: "Growing developer community",
    subfooter: "Over 85 countries represented"
  },
  {
    title: "Average Network Latency",
    value: "21.4 ms",
    description: "Anycast edge routing",
    change: "-3.2ms",
    trend: "up", 
    icon: Zap,
    footer: "BGP route optimization active",
    subfooter: "Direct peering with Tier 1 transit"
  },
  {
    title: "DDoS Mitigation Rate",
    value: "100%",
    description: "Automated L3/L4/L7 filter",
    change: "Clean",
    trend: "up",
    icon: Activity,
    footer: "Real-time edge packet filtering",
    subfooter: "Zero downtime during 24Tbps attacks"
  },
]

export function MetricsOverview() {
  return (
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs grid gap-4 sm:grid-cols-2 @5xl:grid-cols-4">
      {metrics.map((metric) => {
        const Icon = metric.icon
        return (
          <Card key={metric.title} className="@container/card">
            <CardHeader>
              <CardDescription className="flex items-center justify-between">
                <span>{metric.title}</span>
                <Icon className="size-4 text-primary" />
              </CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums sm:text-3xl">
                {metric.value}
              </CardTitle>
              <CardAction>
                <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10">
                  {metric.change}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1 pt-0 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">
                {metric.footer}
              </div>
              <div>{metric.subfooter}</div>
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}
