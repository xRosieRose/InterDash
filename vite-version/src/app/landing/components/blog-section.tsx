"use client"

import { ArrowRight, Terminal, Shield, Cpu } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const blogs = [
  {
    id: 1,
    category: 'Architecture',
    icon: Cpu,
    title: 'Optimizing Linux on 1GB RAM Cloud VPS Instances',
    description:
      'Learn how to configure zram compressed swap, disable unnecessary systemd units, and run lean Node/Python microservices on free tier nodes.',
    date: 'Mar 4, 2026',
    readTime: '5 min read',
  },
  {
    id: 2,
    category: 'DevOps',
    icon: Terminal,
    title: 'Deploying Docker & Nginx Reverse Proxy with Free SSL',
    description:
      'Step-by-step guide to installing Docker Engine on Ubuntu 24.04, setting up automated Let’s Encrypt certificates, and exposing services securely.',
    date: 'Feb 28, 2026',
    readTime: '7 min read',
  },
  {
    id: 3,
    category: 'Security',
    icon: Shield,
    title: 'Hardening Your Cloud VPS with SSH Keys and UFW Firewall',
    description:
      'Essential security practices for production nodes: disabling password authentication, enabling Fail2ban, and setting up automated kernel patch updates.',
    date: 'Feb 19, 2026',
    readTime: '4 min read',
  },
]

export function BlogSection() {
  return (
    <section id="blog" className="py-24 sm:py-32 bg-muted/30">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mx-auto max-w-2xl text-center mb-16">
          <Badge variant="outline" className="mb-4">Cloud Tutorials</Badge>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
            Guides & Sysadmin Tutorials
          </h2>
          <p className="text-lg text-muted-foreground">
            Get the most out of your free InterENL VPS with practical guides written by experienced cloud engineers.
          </p>
        </div>

        {/* Blog Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {blogs.map(blog => {
            const Icon = blog.icon
            return (
              <Card key={blog.id} className="overflow-hidden p-6 flex flex-col justify-between hover:border-primary/50 transition-all">
                <CardContent className="p-0 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </div>
                    <Badge variant="secondary" className="text-[11px]">
                      {blog.category}
                    </Badge>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground leading-snug mb-2">
                      {blog.title}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {blog.description}
                    </p>
                  </div>
                </CardContent>
                <div className="pt-6 border-t mt-6 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{blog.date} • {blog.readTime}</span>
                  <span className="flex items-center gap-1 text-primary font-medium group-hover:translate-x-0.5 transition-transform">
                    Read Guide <ArrowRight className="size-3" />
                  </span>
                </div>
              </Card>
            )
          })}
        </div>
      </div>
    </section>
  )
}
