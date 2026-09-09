"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { Activity, Cpu, Wifi } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { ChartConfig } from "@/components/ui/chart"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"

export const description = "An interactive cloud telemetry area chart"

// Telemetry historical data
const rawData = [
  { date: "2026-02-09", ingress: 42, egress: 28, cpuSystem: 14, cpuUser: 22, ramUsed: 420 },
  { date: "2026-02-10", ingress: 68, egress: 44, cpuSystem: 18, cpuUser: 31, ramUsed: 460 },
  { date: "2026-02-11", ingress: 55, egress: 36, cpuSystem: 16, cpuUser: 28, ramUsed: 440 },
  { date: "2026-02-12", ingress: 94, egress: 62, cpuSystem: 24, cpuUser: 42, ramUsed: 520 },
  { date: "2026-02-13", ingress: 120, egress: 85, cpuSystem: 29, cpuUser: 48, ramUsed: 590 },
  { date: "2026-02-14", ingress: 88, egress: 54, cpuSystem: 20, cpuUser: 35, ramUsed: 490 },
  { date: "2026-02-15", ingress: 72, egress: 48, cpuSystem: 17, cpuUser: 30, ramUsed: 470 },
  { date: "2026-02-16", ingress: 110, egress: 76, cpuSystem: 26, cpuUser: 44, ramUsed: 560 },
  { date: "2026-02-17", ingress: 145, egress: 98, cpuSystem: 32, cpuUser: 56, ramUsed: 640 },
  { date: "2026-02-18", ingress: 130, egress: 88, cpuSystem: 28, cpuUser: 50, ramUsed: 610 },
  { date: "2026-02-19", ingress: 95, egress: 64, cpuSystem: 22, cpuUser: 38, ramUsed: 510 },
  { date: "2026-02-20", ingress: 105, egress: 72, cpuSystem: 25, cpuUser: 42, ramUsed: 530 },
  { date: "2026-02-21", ingress: 85, egress: 58, cpuSystem: 19, cpuUser: 34, ramUsed: 480 },
  { date: "2026-02-22", ingress: 78, egress: 52, cpuSystem: 18, cpuUser: 32, ramUsed: 470 },
  { date: "2026-02-23", ingress: 115, egress: 82, cpuSystem: 27, cpuUser: 46, ramUsed: 570 },
  { date: "2026-02-24", ingress: 160, egress: 112, cpuSystem: 34, cpuUser: 58, ramUsed: 660 },
  { date: "2026-02-25", ingress: 140, egress: 95, cpuSystem: 30, cpuUser: 52, ramUsed: 620 },
  { date: "2026-02-26", ingress: 125, egress: 86, cpuSystem: 27, cpuUser: 45, ramUsed: 580 },
  { date: "2026-02-27", ingress: 135, egress: 92, cpuSystem: 29, cpuUser: 49, ramUsed: 600 },
  { date: "2026-02-28", ingress: 150, egress: 104, cpuSystem: 31, cpuUser: 54, ramUsed: 630 },
  { date: "2026-03-01", ingress: 98, egress: 68, cpuSystem: 22, cpuUser: 36, ramUsed: 520 },
  { date: "2026-03-02", ingress: 112, egress: 78, cpuSystem: 25, cpuUser: 42, ramUsed: 550 },
  { date: "2026-03-03", ingress: 175, egress: 124, cpuSystem: 36, cpuUser: 62, ramUsed: 690 },
  { date: "2026-03-04", ingress: 190, egress: 138, cpuSystem: 38, cpuUser: 65, ramUsed: 710 },
  { date: "2026-03-05", ingress: 165, egress: 118, cpuSystem: 33, cpuUser: 56, ramUsed: 650 },
  { date: "2026-03-06", ingress: 145, egress: 102, cpuSystem: 29, cpuUser: 51, ramUsed: 620 },
  { date: "2026-03-07", ingress: 130, egress: 90, cpuSystem: 26, cpuUser: 46, ramUsed: 590 },
  { date: "2026-03-08", ingress: 122, egress: 84, cpuSystem: 24, cpuUser: 43, ramUsed: 570 },
  { date: "2026-03-09", ingress: 155, egress: 108, cpuSystem: 32, cpuUser: 55, ramUsed: 640 },
]

type MetricType = "bandwidth" | "cpu" | "memory"

const chartConfigs: Record<MetricType, ChartConfig> = {
  bandwidth: {
    ingress: {
      label: "Ingress (Download)",
      color: "var(--color-primary, #3b82f6)",
    },
    egress: {
      label: "Egress (Upload)",
      color: "#10b981",
    },
  },
  cpu: {
    cpuUser: {
      label: "User Space CPU",
      color: "var(--color-primary, #3b82f6)",
    },
    cpuSystem: {
      label: "Kernel / System",
      color: "#f59e0b",
    },
  },
  memory: {
    ramUsed: {
      label: "Active DDR5 RAM",
      color: "#8b5cf6",
    },
  },
}

export function ChartAreaInteractive() {
  const [metric, setMetric] = React.useState<MetricType>("bandwidth")
  const [timeRange, setTimeRange] = React.useState("30d")

  const filteredData = React.useMemo(() => {
    if (timeRange === "7d") {
      return rawData.slice(-7)
    }
    if (timeRange === "14d") {
      return rawData.slice(-14)
    }
    return rawData
  }, [timeRange])

  return (
    <Card className="@container/chart">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="size-5 text-primary" />
            Live Cloud Infrastructure Telemetry
          </CardTitle>
          <CardDescription>
            Real-time I/O, bandwidth, and resource utilization across your active VPS instances.
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Metric Selector */}
          <ToggleGroup
            type="single"
            value={metric}
            onValueChange={(val) => val && setMetric(val as MetricType)}
            className="hidden sm:flex border rounded-lg p-0.5"
          >
            <ToggleGroupItem value="bandwidth" size="sm" className="text-xs h-7 gap-1">
              <Wifi className="size-3.5" />
              Bandwidth
            </ToggleGroupItem>
            <ToggleGroupItem value="cpu" size="sm" className="text-xs h-7 gap-1">
              <Cpu className="size-3.5" />
              CPU Load
            </ToggleGroupItem>
            <ToggleGroupItem value="memory" size="sm" className="text-xs h-7 gap-1">
              <Activity className="size-3.5" />
              RAM
            </ToggleGroupItem>
          </ToggleGroup>

          {/* Time range selector */}
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue placeholder="Select range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="14d">Last 14 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfigs[metric]}
          className="aspect-auto h-[260px] w-full"
        >
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="fillMetricPrimary" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-primary, #3b82f6)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="var(--color-primary, #3b82f6)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="fillMetricSecondary" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="fillMetricMemory" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(value)
                return date.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value: any) => {
                    return new Date(value).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  }}
                  indicator="dot"
                />
              }
            />

            {metric === "bandwidth" && (
              <>
                <Area
                  dataKey="ingress"
                  type="natural"
                  fill="url(#fillMetricPrimary)"
                  stroke="var(--color-primary, #3b82f6)"
                  strokeWidth={2}
                  name="Ingress Mbps"
                />
                <Area
                  dataKey="egress"
                  type="natural"
                  fill="url(#fillMetricSecondary)"
                  stroke="#10b981"
                  strokeWidth={2}
                  name="Egress Mbps"
                />
              </>
            )}

            {metric === "cpu" && (
              <>
                <Area
                  dataKey="cpuUser"
                  type="natural"
                  fill="url(#fillMetricPrimary)"
                  stroke="var(--color-primary, #3b82f6)"
                  strokeWidth={2}
                  name="User Load %"
                />
                <Area
                  dataKey="cpuSystem"
                  type="natural"
                  fill="url(#fillMetricSecondary)"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  name="System Load %"
                />
              </>
            )}

            {metric === "memory" && (
              <Area
                dataKey="ramUsed"
                type="natural"
                fill="url(#fillMetricMemory)"
                stroke="#8b5cf6"
                strokeWidth={2}
                name="RAM in Use (MB)"
              />
            )}
          </AreaChart>
        </ChartContainer>

        {/* Telemetry Footer Legend */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t mt-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            {metric === "bandwidth" && (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="size-2.5 rounded-full bg-primary" />
                  <span>Ingress: ~155 Mbps (Peak)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="size-2.5 rounded-full bg-emerald-500" />
                  <span>Egress: ~108 Mbps (Peak)</span>
                </div>
              </>
            )}
            {metric === "cpu" && (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="size-2.5 rounded-full bg-primary" />
                  <span>User space: 32% avg</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="size-2.5 rounded-full bg-amber-500" />
                  <span>Kernel space: 16% avg</span>
                </div>
              </>
            )}
            {metric === "memory" && (
              <div className="flex items-center gap-1.5">
                <div className="size-2.5 rounded-full bg-purple-500" />
                <span>Average memory utilization: 640 MB / 1024 MB</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 text-emerald-500 font-medium">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>Hypervisors 100% Operational</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
