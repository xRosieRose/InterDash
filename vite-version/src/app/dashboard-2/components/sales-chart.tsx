"use client"

import { useState } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Activity } from "lucide-react"

const trafficData = [
  { month: "Jan", cleanTraffic: 420, mitigatedDdos: 85 },
  { month: "Feb", cleanTraffic: 510, mitigatedDdos: 120 },
  { month: "Mar", cleanTraffic: 480, mitigatedDdos: 95 },
  { month: "Apr", cleanTraffic: 620, mitigatedDdos: 140 },
  { month: "May", cleanTraffic: 710, mitigatedDdos: 190 },
  { month: "Jun", cleanTraffic: 830, mitigatedDdos: 220 },
  { month: "Jul", cleanTraffic: 940, mitigatedDdos: 310 },
  { month: "Aug", cleanTraffic: 890, mitigatedDdos: 270 },
  { month: "Sep", cleanTraffic: 1040, mitigatedDdos: 380 },
  { month: "Oct", cleanTraffic: 1180, mitigatedDdos: 410 },
  { month: "Nov", cleanTraffic: 1260, mitigatedDdos: 460 },
  { month: "Dec", cleanTraffic: 1420, mitigatedDdos: 530 },
]

const chartConfig = {
  cleanTraffic: {
    label: "Clean Traffic (Gbps)",
    color: "var(--color-primary, #3b82f6)",
  },
  mitigatedDdos: {
    label: "Mitigated Attacks (Gbps)",
    color: "#f43f5e",
  },
}

export function SalesChart() {
  const [timeRange, setTimeRange] = useState("12m")

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            Global Backbone Network Throughput
          </CardTitle>
          <CardDescription>Clean customer traffic vs edge mitigated volumetric attacks (Gbps)</CardDescription>
        </div>
        <div className="flex items-center space-x-2">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32 h-8 text-xs cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3m">Last 3 months</SelectItem>
              <SelectItem value="6m">Last 6 months</SelectItem>
              <SelectItem value="12m">Last 12 months</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-64 w-full">
          <AreaChart data={trafficData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="cleanTrafficGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-primary, #3b82f6)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="var(--color-primary, #3b82f6)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="ddosGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
            <Area
              type="monotone"
              dataKey="cleanTraffic"
              stroke="var(--color-primary, #3b82f6)"
              fillOpacity={1}
              fill="url(#cleanTrafficGradient)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="mitigatedDdos"
              stroke="#f43f5e"
              fillOpacity={1}
              fill="url(#ddosGradient)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
