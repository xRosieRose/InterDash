import type { VpsInstance, DatacenterRegion, OsImage } from "@/types/vps"

export const availableRegions: DatacenterRegion[] = [
  { code: 'fra-1', name: 'Frankfurt', country: 'Germany', flag: '🇩🇪', datacenter: 'InterENL Central Europe (FRA-01)', latencyMs: 14, status: 'online' },
  { code: 'nyc-1', name: 'New York', country: 'United States', flag: '🇺🇸', datacenter: 'InterENL US East (NYC-02)', latencyMs: 78, status: 'online' },
  { code: 'lon-1', name: 'London', country: 'United Kingdom', flag: '🇬🇧', datacenter: 'InterENL UK West (LON-01)', latencyMs: 22, status: 'online' },
  { code: 'sin-1', name: 'Singapore', country: 'Singapore', flag: '🇸🇬', datacenter: 'InterENL Asia Pacific (SIN-01)', latencyMs: 142, status: 'online' },
  { code: 'tyo-1', name: 'Tokyo', country: 'Japan', flag: '🇯🇵', datacenter: 'InterENL Japan East (TYO-01)', latencyMs: 165, status: 'online' },
]

export const availableOsImages: OsImage[] = [
  { id: 'ubuntu-24', name: 'Ubuntu', version: '24.04 LTS (Noble Numbat)', category: 'Linux', icon: 'ubuntu', defaultUser: 'root' },
  { id: 'ubuntu-22', name: 'Ubuntu', version: '22.04 LTS (Jammy Jellyfish)', category: 'Linux', icon: 'ubuntu', defaultUser: 'root' },
  { id: 'debian-12', name: 'Debian', version: '12 (Bookworm)', category: 'Linux', icon: 'debian', defaultUser: 'root' },
  { id: 'alpine-319', name: 'Alpine Linux', version: '3.19 (Minimal)', category: 'Linux', icon: 'alpine', defaultUser: 'root' },
  { id: 'arch-latest', name: 'Arch Linux', version: 'Rolling (Latest Kernel)', category: 'Linux', icon: 'arch', defaultUser: 'root' },
  { id: 'fedora-40', name: 'Fedora Server', version: '40', category: 'Linux', icon: 'fedora', defaultUser: 'root' },
  { id: 'rocky-9', name: 'Rocky Linux', version: '9.3 Enterprise', category: 'Linux', icon: 'rocky', defaultUser: 'root' },
]

export const initialVpsInstances: VpsInstance[] = [
  {
    id: 'vps-1',
    name: 'Production Web Gateway',
    hostname: 'interenl-web-prod',
    status: 'running',
    ipv4: '147.185.221.45',
    ipv6: '2a01:4f8:c010:d::1',
    region: availableRegions[0],
    os: {
      name: 'Ubuntu',
      version: '24.04 LTS',
      icon: 'ubuntu'
    },
    specs: {
      cpu: '1 vCPU',
      ram: '1 GB DDR5',
      storage: '25 GB NVMe',
      bandwidth: '1 TB / mo'
    },
    uptime: '28d 14h 22m',
    createdDate: '2026-02-10',
    cpuUsage: 28,
    ramUsage: 54,
    bandwidthUsageGB: 412
  },
  {
    id: 'vps-2',
    name: 'Docker Microservices',
    hostname: 'docker-worker-us',
    status: 'running',
    ipv4: '198.51.100.82',
    ipv6: '2600:1f18:634b:4e00::1',
    region: availableRegions[1],
    os: {
      name: 'Debian',
      version: '12 Bookworm',
      icon: 'debian'
    },
    specs: {
      cpu: '1 vCPU',
      ram: '1 GB DDR5',
      storage: '25 GB NVMe',
      bandwidth: '1 TB / mo'
    },
    uptime: '14d 06h 41m',
    createdDate: '2026-02-24',
    cpuUsage: 45,
    ramUsage: 72,
    bandwidthUsageGB: 290
  },
  {
    id: 'vps-3',
    name: 'Staging PostgreSQL DB',
    hostname: 'alpine-stage-db',
    status: 'stopped',
    ipv4: '103.253.144.19',
    ipv6: '2400:cb00:2048:1::c629',
    region: availableRegions[3],
    os: {
      name: 'Alpine Linux',
      version: '3.19',
      icon: 'alpine'
    },
    specs: {
      cpu: '1 vCPU',
      ram: '1 GB DDR5',
      storage: '25 GB NVMe',
      bandwidth: '1 TB / mo'
    },
    uptime: 'Offline',
    createdDate: '2026-03-01',
    cpuUsage: 0,
    ramUsage: 0,
    bandwidthUsageGB: 48
  }
]
