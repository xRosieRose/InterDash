"use client"

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { CardDecorator } from '@/components/ui/card-decorator'
import { Server, Terminal, HardDrive, Globe, ArrowRight } from 'lucide-react'
import { getAppUrl } from '@/lib/utils'

const values = [
  {
    icon: Server,
    title: 'Zero Cost, Forever',
    description: '100% free cloud compute for personal projects, staging environments, bot hosting, and learning Linux without credit cards.'
  },
  {
    icon: Terminal,
    title: 'Unrestricted Root Access',
    description: 'Full SSH root privileges out of the box. Install your choice of packages, Docker containers, web servers, and runtime stacks.'
  },
  {
    icon: HardDrive,
    title: 'Blazing NVMe Storage',
    description: 'Enterprise RAID-10 NVMe SSD arrays delivering thousands of IOPS with near-zero latency for fast compilation and database queries.'
  },
  {
    icon: Globe,
    title: 'Global Edge Network',
    description: 'Dedicated IPv6 and Anycast IPv4 connectivity backed by continuous volumetric DDoS protection across worldwide datacenters.'
  }
]

export function AboutSection() {
  return (
    <section id="about" className="py-24 sm:py-32">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mx-auto max-w-4xl text-center mb-16">
          <Badge variant="outline" className="mb-4">
            About InterENL Cloud
          </Badge>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6">
            Democratizing cloud compute for developers worldwide
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            We believe cost should never be a barrier to learning, building, and deploying software.
            InterENL delivers free, instant-provision virtual private servers powered by next-gen AMD EPYC processors and enterprise network backbones.
          </p>
        </div>

        {/* Modern Values Grid */}
        <div className="grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2 xl:grid-cols-4 mb-12">
          {values.map((value, index) => (
            <Card key={index} className='group shadow-xs py-2'>
              <CardContent className='p-8'>
                <div className='flex flex-col items-center text-center'>
                  <CardDecorator>
                    <value.icon className='h-6 w-6 text-primary' aria-hidden />
                  </CardDecorator>
                  <h3 className='mt-6 font-medium text-balance'>{value.title}</h3>
                  <p className='text-muted-foreground mt-3 text-sm'>{value.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Call to Action */}
        <div className="mt-16 text-center">
          <div className="flex items-center justify-center gap-2 mb-6">
            <span className="text-muted-foreground">⚡ High performance • 99.9% SLA • No hidden fees</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="cursor-pointer gap-2" asChild>
              <a href={getAppUrl("/dashboard")}>
                <Server className="size-4" />
                Launch Free VPS Now
                <ArrowRight className="size-4" />
              </a>
            </Button>
            <Button size="lg" variant="outline" className="cursor-pointer" asChild>
              <a href="https://discord.com" target="_blank" rel="noopener noreferrer">
                Join Community Discord
              </a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
