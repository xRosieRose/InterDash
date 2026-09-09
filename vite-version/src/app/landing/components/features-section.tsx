"use client"

import {
  BarChart3,
  Zap,
  Users,
  ArrowRight,
  Database,
  Package,
  Crown,
  Layout,
  Palette
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Image3D } from '@/components/image-3d'

const mainFeatures = [
  {
    icon: Package,
    title: 'High-Speed NVMe Storage',
    description: 'Enterprise-grade NVMe SSD arrays with blazing I/O and near-zero latency.'
  },
  {
    icon: Crown,
    title: 'Dedicated Cloud Compute',
    description: 'Guaranteed vCPU and RAM allocations with zero resource contention.'
  },
  {
    icon: Layout,
    title: 'Instant Server Provisioning',
    description: 'Deploy ready-to-use Linux or Windows instances in under 60 seconds.'
  },
  {
    icon: Zap,
    title: 'Full Root & SSH Access',
    description: 'Complete administrative control over your operating system and packages.'
  }
]

const secondaryFeatures = [
  {
    icon: BarChart3,
    title: 'Dedicated IPv4 & IPv6',
    description: 'Static IP addresses included with every cloud VPS instance.'
  },
  {
    icon: Palette,
    title: 'DDoS Shield Included',
    description: 'Real-time multi-layer DDoS mitigation keeping your servers online.'
  },
  {
    icon: Users,
    title: 'Global Data Centers',
    description: 'Strategically located low-latency network hubs worldwide.'
  },
  {
    icon: Database,
    title: '99.9% Uptime SLA',
    description: 'Enterprise-backed reliability with redundant power and uplinks.'
  }
]

export function FeaturesSection() {
  return (
    <section id="features" className="py-24 sm:py-32 bg-muted/30">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mx-auto max-w-2xl text-center mb-16">
          <Badge variant="outline" className="mb-4">InterENL Cloud Infrastructure</Badge>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
            Everything you need to host, scale, and manage VPS instances
          </h2>
          <p className="text-lg text-muted-foreground">
            High-performance cloud virtualization powered by next-generation processors, enterprise NVMe storage, and low-latency network backbones.
          </p>
        </div>

        {/* First Feature Section */}
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-8 xl:gap-16 mb-24">
          {/* Left Image */}
          <Image3D
            lightSrc="feature-1-light.png"
            darkSrc="feature-1-dark.png"
            alt="Analytics dashboard"
            direction="left"
          />
          {/* Right Content */}
          <div className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                Uncompromising hardware performance & uptime
              </h3>
              <p className="text-muted-foreground text-base text-pretty">
                Every InterENL VPS is powered by dedicated virtualized AMD EPYC™ processors and high-speed NVMe SSDs in RAID-10 configuration to ensure zero IO bottlenecks.
              </p>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2">
              {mainFeatures.map((feature, index) => (
                <li key={index} className="group hover:bg-accent/5 flex items-start gap-3 p-2 rounded-lg transition-colors">
                  <div className="mt-0.5 flex shrink-0 items-center justify-center">
                    <feature.icon className="size-5 text-primary" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-foreground font-medium">{feature.title}</h3>
                    <p className="text-muted-foreground mt-1 text-sm">{feature.description}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-col sm:flex-row gap-4 pe-4 pt-2">
              <Button size="lg" className="cursor-pointer" asChild>
                <a href="/dashboard" className='flex items-center'>
                  Launch Cloud Instance
                  <ArrowRight className="ms-2 size-4" aria-hidden="true" />
                </a>
              </Button>
              <Button size="lg" variant="outline" className="cursor-pointer" asChild>
                <a href="#faq">
                  Explore Architecture
                </a>
              </Button>
            </div>
          </div>
        </div>

        {/* Second Feature Section - Flipped Layout */}
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-8 xl:gap-16">
          {/* Left Content */}
          <div className="space-y-6 order-2 lg:order-1">
            <div className="space-y-4">
              <h3 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                Engineered for sysadmins, devs, and makers
              </h3>
              <p className="text-muted-foreground text-base text-pretty">
                From Docker containers and Redis clusters to web servers and microservices, our infrastructure gives you total root sovereignty over your virtual machines.
              </p>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2">
              {secondaryFeatures.map((feature, index) => (
                <li key={index} className="group hover:bg-accent/5 flex items-start gap-3 p-2 rounded-lg transition-colors">
                  <div className="mt-0.5 flex shrink-0 items-center justify-center">
                    <feature.icon className="size-5 text-primary" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-foreground font-medium">{feature.title}</h3>
                    <p className="text-muted-foreground mt-1 text-sm">{feature.description}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-col sm:flex-row gap-4 pe-4 pt-2">
              <Button size="lg" className="cursor-pointer" asChild>
                <a href="#about" className='flex items-center'>
                  Learn More
                  <ArrowRight className="ms-2 size-4" aria-hidden="true" />
                </a>
              </Button>
              <Button size="lg" variant="outline" className="cursor-pointer" asChild>
                <a href="/dashboard">
                  Open Console
                </a>
              </Button>
            </div>
          </div>

          {/* Right Image */}
          <Image3D
            lightSrc="feature-2-light.png"
            darkSrc="feature-2-dark.png"
            alt="Performance dashboard"
            direction="right"
            className="order-1 lg:order-2"
          />
        </div>
      </div>
    </section>
  )
}
