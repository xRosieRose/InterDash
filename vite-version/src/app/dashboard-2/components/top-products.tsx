"use client"

import { Cpu } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"

const distros = [
  {
    id: 1,
    name: "Ubuntu 24.04 LTS",
    share: 58,
    deployments: "8,620 nodes",
    badge: "Most Popular",
    kernel: "Linux 6.8",
  },
  {
    id: 2,
    name: "Debian 12 Bookworm",
    share: 22,
    deployments: "3,260 nodes",
    badge: "Ultra Stable",
    kernel: "Linux 6.1",
  },
  {
    id: 3,
    name: "Alpine Linux 3.19",
    share: 12,
    deployments: "1,780 nodes",
    badge: "Lightweight",
    kernel: "musl libc",
  },
  {
    id: 4,
    name: "Arch Linux (Rolling)",
    share: 8,
    deployments: "1,160 nodes",
    badge: "Bleeding Edge",
    kernel: "Linux 6.10+",
  },
]

export function TopProducts() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Cpu className="size-4 text-primary" />
          Popular Linux OS Distributions
        </CardTitle>
        <CardDescription>Most selected cloud images across the InterENL network</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {distros.map((distro) => (
          <div key={distro.id} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{distro.name}</span>
                <Badge variant="outline" className="text-[10px] py-0">
                  {distro.badge}
                </Badge>
              </div>
              <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                <span>{distro.deployments}</span>
                <span className="font-bold text-foreground">({distro.share}%)</span>
              </div>
            </div>
            <Progress value={distro.share} className="h-1.5" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
