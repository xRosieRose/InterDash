"use client"

import * as React from "react"
import { Label, Pie, PieChart, Sector } from "recharts"
import type { PieSectorDataItem } from "recharts/types/polar/Pie"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartStyle, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Globe } from "lucide-react"

const regionData = [
  { category: "frankfurt", value: 40, servers: 5928, fill: "var(--color-frankfurt)" },
  { category: "newyork", value: 30, servers: 4446, fill: "var(--color-newyork)" },
  { category: "london", value: 18, servers: 2667, fill: "var(--color-london)" },
  { category: "singapore", value: 12, servers: 1779, fill: "var(--color-singapore)" },
]

const chartConfig = {
  region: {
    label: "Region",
  },
  servers: {
    label: "Active VPS",
  },
  frankfurt: {
    label: "Frankfurt (FRA-01)",
    color: "var(--chart-1, #3b82f6)",
  },
  newyork: {
    label: "New York (NYC-02)",
    color: "var(--chart-2, #10b981)",
  },
  london: {
    label: "London (LON-01)",
    color: "var(--chart-3, #8b5cf6)",
  },
  singapore: {
    label: "Singapore (SIN-01)",
    color: "var(--chart-4, #f59e0b)",
  },
}

export function RevenueBreakdown() {
  const id = "region-breakdown"
  const [activeCategory, setActiveCategory] = React.useState("frankfurt")

  const activeIndex = React.useMemo(
    () => regionData.findIndex((item) => item.category === activeCategory),
    [activeCategory]
  )

  const categories = React.useMemo(() => regionData.map((item) => item.category), [])

  return (
    <Card data-chart={id} className="flex flex-col">
      <ChartStyle id={id} config={chartConfig} />
      <CardHeader className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 pb-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="size-4 text-primary" />
            Global VPS Datacenter Distribution
          </CardTitle>
          <CardDescription>Free instances spread across 4 primary low-latency regions</CardDescription>
        </div>
        <Select value={activeCategory} onValueChange={setActiveCategory}>
          <SelectTrigger
            className="h-8 w-[160px] rounded-lg text-xs"
            aria-label="Select a region"
          >
            <SelectValue placeholder="Select region" />
          </SelectTrigger>
          <SelectContent align="end" className="rounded-xl">
            {categories.map((key) => {
              const config = chartConfig[key as keyof typeof chartConfig]
              if (!config) return null
              return (
                <SelectItem
                  key={key}
                  value={key}
                  className="rounded-lg text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: `var(--color-${key})`,
                      }}
                    />
                    {config?.label}
                  </div>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="flex flex-1 justify-center pb-0">
        <ChartContainer
          id={id}
          config={chartConfig}
          className="mx-auto aspect-square w-full max-w-[280px]"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Pie
              data={regionData}
              dataKey="value"
              nameKey="category"
              innerRadius={70}
              {...({ activeIndex } as any)}
              activeShape={({
                outerRadius = 0,
                ...props
              }: PieSectorDataItem) => (
                <g>
                  <Sector {...props} outerRadius={outerRadius + 8} />
                  <Sector
                    {...props}
                    outerRadius={outerRadius + 22}
                    innerRadius={outerRadius + 12}
                  />
                </g>
              )}
            >
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-2xl font-bold font-mono"
                        >
                          {regionData[activeIndex].servers.toLocaleString()}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 20}
                          className="fill-muted-foreground text-xs"
                        >
                          Active Nodes
                        </tspan>
                      </text>
                    )
                  }
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
