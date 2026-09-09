# InterDash - InterENL Free Cloud VPS Platform

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![GitHub Stars](https://img.shields.io/github/stars/xrosierose/interdash?style=social)](https://github.com/xrosierose/interdash)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)

<div align="center">

🚀 **InterDash** is a modern, high-performance cloud dashboard designed for instant **Free Cloud VPS Deployment & Management**. Built with React 19, TypeScript, Vite, Tailwind CSS v4, and shadcn/ui.

**Made With ❤️ by Rosie**

[**Deploy Free VPS**](http://localhost:5173/dashboard) • [**Explore Infrastructure**](http://localhost:5173/dashboard-2) • [**GitHub Repository**](https://github.com/xrosierose/interdash)

</div>

---

## 🌟 Overview

**InterENL** provides developers, students, and sysadmins with high-performance Linux cloud VPS instances at **$0/month** with zero credit card requirements.

**InterDash** is the central management dashboard providing:
- **1-Click Free VPS Deployment**: Provision Ubuntu 24.04, Debian 12, Alpine Linux, Fedora 40, or Arch Linux in under 30 seconds.
- **In-Browser Web SSH Terminal**: Directly access your root shell from any browser with full ANSI color output and real-time execution.
- **Real-Time Telemetry**: Monitor vCPU compute load, DDR5 memory usage, NVMe disk I/O, and ingress/egress network bandwidth.
- **Multi-Region Datacenters**: Choose between Frankfurt (eu-central-1), New York (us-east-1), Singapore (ap-southeast-1), London (uk-south-1), and Tokyo (ap-northeast-1).
- **Enterprise Power Controls**: Instant Live Start/Stop, Graceful Reboot, and Safe Instance Termination.

---

## ⚡ Hardware & Free Tier Specifications

Each InterENL Free Tier account includes up to 5 concurrent VPS instances:

| Resource | Free Tier Specs | Hardware Grade |
| :--- | :--- | :--- |
| **vCPU** | 1 vCPU Dedicated Core | AMD EPYC™ 9654 (3.7GHz Turbo) |
| **Memory** | 1 GB High-Speed RAM | DDR5 4800MHz ECC Registered |
| **Disk** | 25 GB NVMe SSD | PCIe 4.0 Sub-millisecond I/O |
| **Network** | 1 TB/Month Bandwidth | 1 Gbps Port with DDoS Defense |
| **IP** | 1x Dedicated IPv4 & IPv6 | Global Anycast Routing |
| **Pricing** | **$0 / month** | No Credit Card Required |

---

## 🖥️ Dashboard Features

### 1. VPS Management (`/dashboard`)
- Real-time instance listing with OS badge, IP address, region, uptime, and live status.
- Instant power controls (Start, Power Off, Soft/Hard Reboot, Terminate).
- Copy-to-clipboard IP address and SSH connection strings (`ssh root@<ip>`).
- Built-in interactive Web SSH terminal modal with simulated diagnostics (`neofetch`, `free -m`, `df -h`, `ip a`, `docker ps`).

### 2. Global Telemetry & Network Health (`/dashboard-2`)
- Global datacenter ping and latency matrix across 5 continents.
- Aggregate network bandwidth charts with ingress/egress metrics.
- Active node distribution by geographic region.

### 3. Modern Landing Page (`/`)
- Sleek dark/light mode with glassmorphic cards and dot patterns.
- Interactive multi-section solutions mega menu.
- Developer testimonials, FAQs, and infrastructure feature highlights.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ or 20+
- pnpm / npm / bun

### 1. Clone the repository
```bash
git clone https://github.com/xrosierose/interdash.git
cd interdash/shadcn-dashboard-landing-template/vite-version
```

### 2. Install dependencies
```bash
npm install
# or
pnpm install
```

### 3. Start development server
```bash
npm run dev
```

Visit `http://localhost:5173` to explore the landing page and `http://localhost:5173/dashboard` for the VPS management console.

### 4. Build for production
```bash
npm run build
```

---

## 🛠️ Tech Stack

- **Framework**: React 19 + TypeScript + Vite 7
- **Styling**: Tailwind CSS v4 + Vanilla CSS Variables
- **UI Components**: Radix UI Primitives + shadcn/ui
- **Charts**: Recharts
- **Icons**: Lucide React
- **Terminal**: Custom Interactive ANSI Web Console

---

## 📄 License & Credits

- Open source under the [MIT License](License.md).
- Developed with ❤️ by **Rosie**.
