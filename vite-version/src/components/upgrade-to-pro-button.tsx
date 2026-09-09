"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card"
import { Server, Sparkles, ArrowRight, ShieldCheck } from "lucide-react"
import { Link } from "react-router-dom"

export function UpgradeToProButton() {
  return (
    <div className="fixed z-50 bottom-8 right-4 md:right-6 lg:right-8 flex flex-col items-end gap-2">
      <HoverCard openDelay={100} closeDelay={100}>
        <HoverCardTrigger asChild>
          <Button
            size="lg"
            asChild
            className="px-5 py-3 shadow-xl bg-primary text-primary-foreground font-semibold hover:opacity-95 cursor-pointer rounded-full gap-2 border border-primary/20"
          >
            <Link to="/dashboard">
              <Server className="size-4" />
              <span>Deploy Free VPS</span>
              <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-400 text-[10px] px-1.5 py-0 border-0">
                $0
              </Badge>
            </Link>
          </Button>
        </HoverCardTrigger>
        <HoverCardContent className="mb-3 w-80 rounded-xl shadow-2xl bg-card border border-border p-4 animate-in fade-in slide-in-from-bottom-4 relative mr-4 md:mr-6 lg:mr-8">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold text-sm text-foreground">
                <Sparkles className="size-4 text-primary" />
                InterENL Free Cloud
              </div>
              <Badge className="bg-emerald-600 text-white text-[10px] py-0 font-semibold">
                No Card Required
              </Badge>
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Deploy up to 5 cloud VPS instances with 1 vCPU AMD EPYC, 1GB DDR5 RAM, 25GB NVMe, and full root SSH access.
            </p>
            <div className="pt-2 border-t flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1 text-emerald-500 font-medium">
                <ShieldCheck className="size-3" />
                DDoS Shield Included
              </span>
              <Link to="/dashboard" className="text-primary hover:underline font-medium flex items-center gap-0.5">
                Open Console <ArrowRight className="size-3" />
              </Link>
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>
  )
}
