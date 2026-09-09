"use client"

import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

type Testimonial = {
  name: string
  role: string
  image: string
  quote: string
}

const testimonials: Testimonial[] = [
  {
    name: 'Alexandra Mitchell',
    role: 'Full Stack Engineer',
    image: 'https://notion-avatars.netlify.app/api/avatar?preset=female-1',
    quote:
      'InterENL gives me reliable Linux nodes for hosting my Discord bots and PostgreSQL staging databases at zero cost. The NVMe speeds and low latency are unbelievable.',
  },
  {
    name: 'James Thompson',
    role: 'DevOps Architect',
    image: 'https://notion-avatars.netlify.app/api/avatar?preset=male-1',
    quote: 'After trying countless VPS hosts, InterENL is the only one that delivered real root SSH access and dedicated IPv6 without demanding a credit card up front.',
  },
  {
    name: 'Priya Sharma',
    role: 'CS Student & Open Source Contributor',
    image: 'https://notion-avatars.netlify.app/api/avatar?preset=female-2',
    quote:
      'Having a free cloud server in Frankfurt to practice Linux system administration, setup Nginx reverse proxies, and compile Rust packages has been life-changing for my studies.',
  },
  {
    name: 'Robert Kim',
    role: 'Backend Infrastructure Lead',
    image: 'https://notion-avatars.netlify.app/api/avatar?preset=male-2',
    quote:
      'We spun up 3 free Debian 12 instances for our hackathon project. Deployment took under 40 seconds and the multi-gigabit uplinks handled all our test traffic effortlessly.',
  },
  {
    name: 'Maria Santos',
    role: 'Cloud Security Researcher',
    image: 'https://notion-avatars.netlify.app/api/avatar?preset=female-3',
    quote:
      'The built-in DDoS shield and clean routing are enterprise-grade. Even during large volumetric network spikes, our web services in New York stayed 100% online.',
  },
  {
    name: 'Thomas Anderson',
    role: 'Systems Engineer',
    image: 'https://notion-avatars.netlify.app/api/avatar?preset=male-3',
    quote: 'The web console and instant OS rebuild tools save so much time. InterENL is the best free cloud platform I have ever used.',
  },
  {
    name: 'Lisa Chang',
    role: 'Independent App Developer',
    image: 'https://notion-avatars.netlify.app/api/avatar?preset=female-4',
    quote:
      'I deploy all my side project APIs and cron jobs here. 1GB DDR5 RAM with 25GB NVMe is more than enough for Dockerized Node.js and Redis workloads.',
  },
  {
    name: 'Michael Foster',
    role: 'Site Reliability Engineer',
    image: 'https://notion-avatars.netlify.app/api/avatar?preset=male-4',
    quote: 'Automated snapshots and zero billing surprises. InterENL truly delivers the cloud hosting of your dreams.',
  },
  {
    name: 'Daniel Wilson',
    role: 'Go & Microservices Developer',
    image: 'https://notion-avatars.netlify.app/api/avatar?preset=male-5',
    quote: 'Alpine Linux runs like a dream on InterENL KVM hypervisors. Cold boot in 4 seconds and minimal memory footprint.',
  },
]

export function TestimonialsSection() {
  return (
    <section id="testimonials" className="py-24 sm:py-32">
      <div className="container mx-auto px-8 sm:px-6">
        {/* Section Header */}
        <div className="mx-auto max-w-2xl text-center mb-16">
          <Badge variant="outline" className="mb-4">Developer Stories</Badge>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
            Loved by sysadmins, developers, and makers
          </h2>
          <p className="text-lg text-muted-foreground">
            Discover how developers across the globe rely on InterENL free cloud VPS instances for microservices, bots, databases, and learning.
          </p>
        </div>

        {/* Testimonials Masonry Grid */}
        <div className="columns-1 gap-4 md:columns-2 md:gap-6 lg:columns-3 lg:gap-4">
          {testimonials.map((testimonial, index) => (
            <Card key={index} className="mb-6 break-inside-avoid shadow-none lg:mb-4">
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                  "{testimonial.quote}"
                </p>
                <div className="flex items-center gap-3">
                  <Avatar className="size-10">
                    <AvatarImage src={testimonial.image} alt={testimonial.name} />
                    <AvatarFallback>{testimonial.name.slice(0, 2)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <h4 className="font-semibold text-sm text-foreground">{testimonial.name}</h4>
                    <p className="text-xs text-muted-foreground">{testimonial.role}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
