"use client"

import { CircleHelp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'

type FaqItem = {
  value: string
  question: string
  answer: string
}

const faqItems: FaqItem[] = [
  {
    value: 'item-1',
    question: 'How does the InterENL Free VPS work?',
    answer:
      'Our Free VPS tier provides you with 1 vCPU, 1 GB RAM, 25 GB NVMe SSD storage, and dedicated IPv6 networking at zero cost. It is designed to let developers test applications, host lightweight services, and experience InterENL cloud infrastructure without needing a credit card.',
  },
  {
    value: 'item-2',
    question: 'Do I get full root SSH access to my VPS?',
    answer:
      'Yes! Every single VPS on InterENL—including the Free tier—comes with full root access and an SSH terminal. You have total freedom to install any packages, Docker containers, web servers, or custom software you require.',
  },
  {
    value: 'item-3',
    question: 'Which operating systems can I install?',
    answer:
      'InterENL supports 1-click installation for all major Linux distributions including Ubuntu 22.04/24.04 LTS, Debian 11/12, AlmaLinux, Rocky Linux, and Alpine, as well as Windows Server for eligible premium tiers.',
  },
  {
    value: 'item-4',
    question: 'How is DDoS protection and network uptime handled?',
    answer:
      'All instances sit behind our enterprise-grade DDoS mitigation shield capable of filtering multi-gigabit attacks in real time. We maintain a 99.9% uptime SLA backed by redundant power and multi-homed network uplinks.',
  },
  {
    value: 'item-5',
    question: 'Can I upgrade my VPS specifications without downtime?',
    answer:
      'Seamless scaling is built into the InterENL control dashboard. You can scale your CPU, RAM, and NVMe disk space with a single click, keeping your data and IP configuration intact.',
  },
  {
    value: 'item-6',
    question: 'How do I reach customer support if I need assistance?',
    answer:
      'We offer 24/7 technical support via our support ticketing portal, live chat, and an active Discord community where engineers and sysadmins are always ready to assist.',
  },
]

const FaqSection = () => {
  return (
    <section id="faq" className="py-24 sm:py-32">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mx-auto max-w-2xl text-center mb-16">
          <Badge variant="outline" className="mb-4">FAQ</Badge>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-lg text-muted-foreground">
            Everything you need to know about InterENL Free Cloud VPS, deployment quotas, root SSH access, and network performance. Still have questions? We're here to help!
          </p>
        </div>

        {/* FAQ Content */}
        <div className="max-w-4xl mx-auto">
          <div className='bg-transparent'>
            <div className='p-0'>
              <Accordion type='single' collapsible className='space-y-5'>
                {faqItems.map(item => (
                  <AccordionItem key={item.value} value={item.value} className='rounded-md !border bg-transparent'>
                    <AccordionTrigger className='cursor-pointer items-center gap-4 rounded-none bg-transparent py-2 ps-3 pe-4 hover:no-underline data-[state=open]:border-b'>
                      <div className='flex items-center gap-4'>
                        <div className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full'>
                          <CircleHelp className='size-5' />
                        </div>
                        <span className='text-start font-semibold'>{item.question}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className='p-4 bg-transparent'>{item.answer}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>

          {/* Contact Support CTA */}
          <div className="text-center mt-12">
            <p className="text-muted-foreground mb-4">
              Still have questions? We're here to help.
            </p>
            <Button className='cursor-pointer' asChild>
              <a href="#contact">
                Contact Support
              </a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

export { FaqSection }
