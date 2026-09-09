"use client"

import { Server, Cpu, HardDrive, Activity, Plus, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface SectionCardsProps {
  totalInstances: number
  runningInstances: number
  maxInstances?: number
  onDeployClick?: () => void
}

export function SectionCards({
  totalInstances,
  runningInstances,
  maxInstances = 5,
  onDeployClick
}: SectionCardsProps) {
  const totalVcpu = totalInstances * 1
  const maxVcpu = maxInstances * 1
  const totalRam = totalInstances * 1
  const maxRam = maxInstances * 1
  const totalStorage = totalInstances * 25
  const maxStorage = maxInstances * 25

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {/* 1. Free VPS Instances */}
      <Card className="border-border bg-gradient-to-t from-primary/5 to-card shadow-xs">
        <CardHeader>
          <CardDescription className="flex items-center justify-between">
            <span>Free VPS Instances</span>
            <Server className="size-4 text-primary" />
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums sm:text-3xl">
            {totalInstances} <span className="text-sm font-normal text-muted-foreground">/ {maxInstances} Max</span>
          </CardTitle>
          <CardAction>
            <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
              {runningInstances} Online
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex items-center justify-between pt-0 text-xs text-muted-foreground">
          <div>{maxInstances - totalInstances} slots remaining in Free Tier</div>
          {onDeployClick && totalInstances < maxInstances && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-primary hover:text-primary hover:bg-primary/10"
              onClick={onDeployClick}
            >
              <Plus className="size-3 mr-0.5" /> Deploy
            </Button>
          )}
        </CardFooter>
      </Card>

      {/* 2. Compute Cores */}
      <Card className="border-border bg-gradient-to-t from-primary/5 to-card shadow-xs">
        <CardHeader>
          <CardDescription className="flex items-center justify-between">
            <span>vCPU Cores</span>
            <Cpu className="size-4 text-primary" />
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums sm:text-3xl">
            {totalVcpu} <span className="text-sm font-normal text-muted-foreground">/ {maxVcpu} vCPUs</span>
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              AMD EPYC™ 7763
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 pt-0 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">
            3.24 GHz High-Frequency
          </div>
          <div>Dedicated KVM virtualization threads</div>
        </CardFooter>
      </Card>

      {/* 3. DDR5 RAM Allocation */}
      <Card className="border-border bg-gradient-to-t from-primary/5 to-card shadow-xs">
        <CardHeader>
          <CardDescription className="flex items-center justify-between">
            <span>Memory Allocated</span>
            <Activity className="size-4 text-primary" />
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums sm:text-3xl">
            {totalRam}.0 <span className="text-sm font-normal text-muted-foreground">/ {maxRam}.0 GB</span>
          </CardTitle>
          <CardAction>
            <Badge variant="outline" className="text-primary border-primary/30">
              DDR5 ECC
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 pt-0 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">
            {Math.round((totalRam / maxRam) * 100)}% Free Quota Reserved
          </div>
          <div>Low-latency enterprise error-correcting memory</div>
        </CardFooter>
      </Card>

      {/* 4. NVMe Storage & Bandwidth */}
      <Card className="border-border bg-gradient-to-t from-primary/5 to-card shadow-xs">
        <CardHeader>
          <CardDescription className="flex items-center justify-between">
            <span>NVMe SSD Storage</span>
            <HardDrive className="size-4 text-primary" />
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums sm:text-3xl">
            {totalStorage} <span className="text-sm font-normal text-muted-foreground">/ {maxStorage} GB</span>
          </CardTitle>
          <CardAction>
            <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
              <ShieldCheck className="size-3 mr-1" />
              RAID-10
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 pt-0 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">
            {totalInstances} TB / {maxInstances} TB Monthly Bandwidth
          </div>
          <div>10 Gbps redundant uplink with DDoS shield</div>
        </CardFooter>
      </Card>
    </div>
  )
}
