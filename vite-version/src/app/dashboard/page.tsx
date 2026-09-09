"use client"

import * as React from "react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { SectionCards } from "./components/section-cards"
import { ChartAreaInteractive } from "./components/chart-area-interactive"
import { DataTable } from "./components/data-table"
import { DeployVpsModal } from "./components/deploy-vps-modal"
import { WebTerminalModal } from "./components/web-terminal-modal"
import { initialVpsInstances } from "./data/vps-data"
import type { VpsInstance } from "@/types/vps"
import { toast } from "sonner"

export default function DashboardPage() {
  const [instances, setInstances] = React.useState<VpsInstance[]>(initialVpsInstances)
  const [deployModalOpen, setDeployModalOpen] = React.useState(false)
  const [terminalModalOpen, setTerminalModalOpen] = React.useState(false)
  const [selectedVps, setSelectedVps] = React.useState<VpsInstance | null>(null)

  const runningCount = instances.filter((i) => i.status === "running").length

  const handleDeploySuccess = (newInstance: VpsInstance) => {
    setInstances((prev) => [newInstance, ...prev])
  }

  const handleTogglePower = (vpsId: string) => {
    setInstances((prev) =>
      prev.map((inst) => {
        if (inst.id === vpsId) {
          const nextStatus = inst.status === "running" ? "stopped" : "running"
          toast.info(`VPS ${inst.hostname} is now ${nextStatus}`, {
            description: nextStatus === "running" ? "Services started successfully." : "Power shut down safely."
          })
          return {
            ...inst,
            status: nextStatus,
            uptime: nextStatus === "running" ? "Just started" : "Offline"
          }
        }
        return inst
      })
    )
  }

  const handleReboot = (vpsId: string) => {
    const target = instances.find((i) => i.id === vpsId)
    if (!target) return

    setInstances((prev) =>
      prev.map((inst) =>
        inst.id === vpsId ? { ...inst, status: "restarting" } : inst
      )
    )
    toast.info(`Rebooting ${target.hostname}...`, {
      description: "ACPI soft restart initiated."
    })

    setTimeout(() => {
      setInstances((prev) =>
        prev.map((inst) =>
          inst.id === vpsId
            ? { ...inst, status: "running", uptime: "Just rebooted" }
            : inst
        )
      )
      toast.success(`${target.hostname} has rebooted!`, {
        description: "All hypervisor services and network routes are online."
      })
    }, 2000)
  }

  const handleDelete = (vpsId: string) => {
    const target = instances.find((i) => i.id === vpsId)
    if (!target) return

    setInstances((prev) => prev.filter((inst) => inst.id !== vpsId))
    toast.success(`VPS ${target.hostname} destroyed`, {
      description: "Storage volume released and IP routes unassigned."
    })
  }

  const handleOpenTerminal = (vps: VpsInstance) => {
    setSelectedVps(vps)
    setTerminalModalOpen(true)
  }

  return (
    <BaseLayout
      title="Cloud VPS Infrastructure"
      description="Manage your free cloud VPS servers, live resource telemetry, and root SSH access."
    >
      <div className="@container/main px-4 lg:px-6 space-y-6">
        {/* Top Summary Metric Cards */}
        <SectionCards
          totalInstances={instances.length}
          runningInstances={runningCount}
          maxInstances={5}
          onDeployClick={() => setDeployModalOpen(true)}
        />

        {/* Live Resource Telemetry Charts */}
        <ChartAreaInteractive />
      </div>

      {/* VPS Instances Management Table */}
      <div className="@container/main">
        <DataTable
          instances={instances}
          onOpenTerminal={handleOpenTerminal}
          onTogglePower={handleTogglePower}
          onReboot={handleReboot}
          onDelete={handleDelete}
          onDeployClick={() => setDeployModalOpen(true)}
        />
      </div>

      {/* Deploy Free VPS Modal */}
      <DeployVpsModal
        open={deployModalOpen}
        onOpenChange={setDeployModalOpen}
        onDeploySuccess={handleDeploySuccess}
        currentCount={instances.length}
        maxFreeCount={5}
      />

      {/* Web SSH Console Terminal Modal */}
      <WebTerminalModal
        vps={selectedVps}
        open={terminalModalOpen}
        onOpenChange={setTerminalModalOpen}
      />
    </BaseLayout>
  )
}
