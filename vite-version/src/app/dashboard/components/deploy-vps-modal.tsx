"use client"

import * as React from "react"
import { Server, Cpu, Globe, ShieldCheck, Check, Sparkles, Loader2, KeyRound } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { availableRegions, availableOsImages } from "../data/vps-data"
import type { VpsInstance, DatacenterRegion, OsImage } from "@/types/vps"
import { toast } from "sonner"

interface DeployVpsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeploySuccess: (newInstance: VpsInstance) => void
  currentCount: number
  maxFreeCount?: number
}

export function DeployVpsModal({
  open,
  onOpenChange,
  onDeploySuccess,
  currentCount,
  maxFreeCount = 5
}: DeployVpsModalProps) {
  const [hostname, setHostname] = React.useState("")
  const [selectedRegion, setSelectedRegion] = React.useState<DatacenterRegion>(availableRegions[0])
  const [selectedOs, setSelectedOs] = React.useState<OsImage>(availableOsImages[0])
  const [authMethod, setAuthMethod] = React.useState<"password" | "ssh-key">("password")
  const [rootPassword, setRootPassword] = React.useState("")
  const [sshKey, setSshKey] = React.useState("")
  const [isDeploying, setIsDeploying] = React.useState(false)
  const [deployStep, setDeployStep] = React.useState("")

  // Generate default hostname when opening
  React.useEffect(() => {
    if (open) {
      const rand = Math.floor(100 + Math.random() * 900)
      setHostname(`interenl-node-${rand}`)
      setIsDeploying(false)
      setDeployStep("")
    }
  }, [open])

  const handleDeploy = () => {
    if (!hostname.trim()) {
      toast.error("Please enter a valid server hostname")
      return
    }

    if (currentCount >= maxFreeCount) {
      toast.error(`You have reached your Free Tier quota (${maxFreeCount}/${maxFreeCount} VPS). Delete an instance to deploy a new one.`)
      return
    }

    setIsDeploying(true)
    setDeployStep("Allocating KVM hypervisor resources...")

    setTimeout(() => {
      setDeployStep("Partitioning 25GB NVMe SSD storage...")
    }, 800)

    setTimeout(() => {
      setDeployStep(`Flashing ${selectedOs.name} ${selectedOs.version} image...`)
    }, 1600)

    setTimeout(() => {
      setDeployStep("Assigning dedicated IPv6 and Anycast IPv4 routing...")
    }, 2400)

    setTimeout(() => {
      const randIpLast = Math.floor(10 + Math.random() * 240)
      const newVps: VpsInstance = {
        id: `vps-${Date.now()}`,
        name: `${selectedOs.name} Cloud Instance`,
        hostname: hostname.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        status: "running",
        ipv4: `147.185.221.${randIpLast}`,
        ipv6: `2a01:4f8:c010:${randIpLast.toString(16)}::1`,
        region: selectedRegion,
        os: {
          name: selectedOs.name,
          version: selectedOs.version,
          icon: selectedOs.icon
        },
        specs: {
          cpu: "1 vCPU",
          ram: "1 GB DDR5",
          storage: "25 GB NVMe",
          bandwidth: "1 TB / mo"
        },
        uptime: "Just deployed",
        createdDate: new Date().toISOString().split("T")[0],
        cpuUsage: 8,
        ramUsage: 22,
        bandwidthUsageGB: 1
      }

      setIsDeploying(false)
      onOpenChange(false)
      onDeploySuccess(newVps)
      toast.success(`VPS ${newVps.hostname} deployed successfully in ${selectedRegion.name}!`, {
        description: `IP: ${newVps.ipv4} • SSH Root access ready.`
      })
    }, 3200)
  }

  return (
    <Dialog open={open} onOpenChange={(val) => !isDeploying && onOpenChange(val)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Server className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-xl">Deploy New Free VPS</DialogTitle>
              <DialogDescription>
                Provision your instant cloud server with dedicated IPv4/IPv6 and NVMe SSD.
              </DialogDescription>
            </div>
            <Badge variant="outline" className="ml-auto bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
              Free Tier: {currentCount}/{maxFreeCount}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Hostname */}
          <div className="space-y-2">
            <Label htmlFor="hostname">Server Hostname</Label>
            <div className="relative">
              <Input
                id="hostname"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="e.g. web-gateway-01"
                disabled={isDeploying}
                className="font-mono text-sm"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Unique name for your virtual machine inside the InterENL cloud network.
            </p>
          </div>

          {/* Region Selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Globe className="size-4 text-primary" />
              Datacenter Region
            </Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {availableRegions.map((region) => {
                const isSelected = selectedRegion.code === region.code
                return (
                  <button
                    key={region.code}
                    type="button"
                    disabled={isDeploying}
                    onClick={() => setSelectedRegion(region)}
                    className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary shadow-xs"
                        : "border-border hover:border-muted-foreground/30 hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="text-lg">{region.flag}</span>
                      <span className="text-[10px] font-mono text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                        {region.latencyMs}ms
                      </span>
                    </div>
                    <div className="font-semibold text-sm">{region.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate w-full">{region.country}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* OS Selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Cpu className="size-4 text-primary" />
              Operating System
            </Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {availableOsImages.map((os) => {
                const isSelected = selectedOs.id === os.id
                return (
                  <button
                    key={os.id}
                    type="button"
                    disabled={isDeploying}
                    onClick={() => setSelectedOs(os)}
                    className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary shadow-xs"
                        : "border-border hover:border-muted-foreground/30 hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <Badge variant="secondary" className="text-[10px] py-0">
                        {os.category}
                      </Badge>
                      {isSelected && <Check className="size-3.5 text-primary" />}
                    </div>
                    <div className="font-semibold text-sm">{os.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate w-full">{os.version}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Authentication */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <KeyRound className="size-4 text-primary" />
              Root Authentication
            </Label>
            <Tabs value={authMethod} onValueChange={(v) => setAuthMethod(v as any)} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="password">Root Password</TabsTrigger>
                <TabsTrigger value="ssh-key">SSH Public Key</TabsTrigger>
              </TabsList>
              <TabsContent value="password" className="space-y-2 pt-2">
                <Input
                  type="text"
                  value={rootPassword}
                  onChange={(e) => setRootPassword(e.target.value)}
                  disabled={isDeploying}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Default root password. You can reset or add SSH keys anytime from the web console.
                </p>
              </TabsContent>
              <TabsContent value="ssh-key" className="space-y-2 pt-2">
                <Input
                  type="text"
                  value={sshKey}
                  onChange={(e) => setSshKey(e.target.value)}
                  placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... user@host"
                  disabled={isDeploying}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Paste your OpenSSH public key for passwordless root SSH access.
                </p>
              </TabsContent>
            </Tabs>
          </div>

          {/* Free Tier Specifications Card */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <span className="font-semibold text-sm">InterENL Free Tier Inclusions</span>
              </div>
              <Badge className="bg-emerald-600 text-white font-bold text-xs">$0.00 / Month Free</Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="flex flex-col">
                <span className="text-muted-foreground">Compute</span>
                <span className="font-medium text-foreground">1 vCPU AMD EPYC</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">Memory</span>
                <span className="font-medium text-foreground">1 GB DDR5 ECC</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">Storage</span>
                <span className="font-medium text-foreground">25 GB NVMe SSD</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">Network</span>
                <span className="font-medium text-foreground">Dedicated IPv6 + IPv4</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-1 border-t border-primary/10">
              <ShieldCheck className="size-3.5 text-emerald-500" />
              <span>Full root access • DDoS mitigation included • No credit card required</span>
            </div>
          </div>
        </div>

        {/* Deploy Progress or Actions */}
        <DialogFooter className="sm:justify-between items-center gap-3">
          {isDeploying ? (
            <div className="flex items-center gap-2 text-sm text-primary font-medium w-full animate-pulse">
              <Loader2 className="size-4 animate-spin" />
              <span>{deployStep}</span>
            </div>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleDeploy} className="gap-2 px-6">
                <Server className="size-4" />
                Deploy Free VPS
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
