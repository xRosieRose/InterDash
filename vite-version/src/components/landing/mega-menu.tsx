"use client"

import {
  Server,
  Cpu,
  HardDrive,
  Globe,
  Terminal,
  Layers,
  Zap,
  Sparkles,
  Activity,
  ShieldCheck,
  GitBranch
} from 'lucide-react'

const menuSections = [
  {
    title: 'Cloud Instances',
    items: [
      {
        title: 'Free KVM VPS',
        description: '1 vCPU, 1 GB RAM, 25 GB NVMe at $0/mo',
        icon: Server,
        href: '/dashboard'
      },
      {
        title: 'Dedicated Compute',
        description: 'AMD EPYC™ 9654 high-frequency cores',
        icon: Cpu,
        href: '#features'
      },
      {
        title: 'NVMe Storage',
        description: 'Ultra-fast PCIe 4.0 SSD block storage',
        icon: HardDrive,
        href: '#features'
      },
      {
        title: 'Global Network',
        description: 'DDoS-protected dedicated IPv4 & IPv6',
        icon: Globe,
        href: '/dashboard-2'
      }
    ]
  },
  {
    title: 'Linux Distributions',
    items: [
      {
        title: 'Ubuntu 24.04 LTS',
        description: 'Optimized cloud kernel & Docker engine',
        icon: Terminal,
        href: '/dashboard'
      },
      {
        title: 'Debian 12 Bookworm',
        description: 'Rock-solid enterprise server stability',
        icon: Layers,
        href: '/dashboard'
      },
      {
        title: 'Alpine Linux 3.20',
        description: '5MB base footprint for micro-services',
        icon: Zap,
        href: '/dashboard'
      },
      {
        title: 'Arch & Fedora',
        description: 'Bleeding-edge environments for developers',
        icon: Sparkles,
        href: '/dashboard'
      }
    ]
  },
  {
    title: 'Developer Platform',
    items: [
      {
        title: 'Web SSH Terminal',
        description: 'Instant browser shell with full root access',
        icon: Terminal,
        href: '/dashboard'
      },
      {
        title: 'Real-Time Telemetry',
        description: 'Live vCPU, memory & bandwidth telemetry',
        icon: Activity,
        href: '/dashboard-2'
      },
      {
        title: '1-Click Provisioning',
        description: 'Spin up a live Linux VPS in under 30s',
        icon: ShieldCheck,
        href: '/dashboard'
      },
      {
        title: 'GitHub Repository',
        description: 'Open source cloud dashboard & templates',
        icon: GitBranch,
        href: 'https://github.com/xrosierose/interdash'
      }
    ]
  }
]

export function MegaMenu() {
  return (
    <div className="w-[700px] max-w-[95vw] p-4 sm:p-6 lg:p-8 bg-background">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 lg:gap-12">
        {menuSections.map((section) => (
          <div key={section.title} className="space-y-4 lg:space-y-6">
            {/* Section Header */}
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              {section.title}
            </h3>

            {/* Section Links */}
            <div className="space-y-3 lg:space-y-4">
              {section.items.map((item) => (
                <a
                  key={item.title}
                  href={item.href}
                  className="group block space-y-1 lg:space-y-2 hover:bg-accent rounded-md p-2 lg:p-3 -mx-2 lg:-mx-3 transition-colors my-0"
                >
                  <div className="flex items-center gap-2 lg:gap-3">
                    <item.icon className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                      {item.title}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed ml-6 lg:ml-7">
                    {item.description}
                  </p>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
