export type VpsStatus = 'running' | 'stopped' | 'provisioning' | 'restarting'

export interface VpsInstance {
  id: string
  name: string
  hostname: string
  status: VpsStatus
  ipv4: string
  ipv6: string
  region: DatacenterRegion
  os: {
    name: string
    version: string
    icon: string
  }
  specs: {
    cpu: string
    ram: string
    storage: string
    bandwidth: string
  }
  uptime: string
  createdDate: string
  cpuUsage: number
  ramUsage: number
  bandwidthUsageGB: number
}

export interface DatacenterRegion {
  code: string
  name: string
  country: string
  flag: string
  datacenter: string
  latencyMs: number
  status: 'online' | 'degraded'
}

export interface OsImage {
  id: string
  name: string
  version: string
  category: string
  icon: string
  defaultUser: string
}
