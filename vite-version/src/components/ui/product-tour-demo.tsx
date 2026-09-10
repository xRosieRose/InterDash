"use client";

import * as React from "react";
import { Tour, useTour, type TourStep } from "@/components/ui/product-tour";
import {
  Search,
  Plus,
  Sun,
  Moon,
  TrendingUp,
  BarChart3,
  Users,
  Settings,
  Server,
  RotateCw,
} from "lucide-react";

const STEPS: TourStep[] = [
  {
    title: "Welcome to the Control Plane",
    content:
      "Take the 30-second tour and we'll show you around. You can leave any time by pressing Esc.",
    placement: "center",
  },
  {
    target: "#tour-new",
    title: "Deploy Instances Instantly",
    content: "Launch new high-performance KVM virtual machines, containers, or cluster nodes with one click.",
    placement: "bottom",
  },
  {
    target: "#tour-search",
    title: "Global Resource Search",
    content: "Instantly locate VM IDs, IPs, users, and audit logs. Press / from anywhere to focus search.",
    placement: "bottom",
  },
  {
    target: "#tour-revenue",
    title: "Live Cloud Metrics",
    content: "Telemetry updates in real-time. Click any card to inspect IOPS, CPU load, and network throughput.",
    placement: "right",
  },
  {
    target: "#tour-nav-reports",
    title: "Deep Analytics & Graphs",
    content: "Hardware utilization charts, bandwidth consumption, and cluster health metrics live here.",
    placement: "right",
  },
  {
    target: "#tour-avatar",
    title: "Account & Settings",
    content: "Manage your SSH keys, API tokens, Discord integration, and panel settings. You are all set!",
    placement: "bottom",
  },
];

const ROWS = [
  {
    name: "Alex Rivera",
    action: "deployed Ubuntu 24.04 VPS",
    time: "2m",
    avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80",
  },
  {
    name: "Sarah Chen",
    action: "scaled RAM to 16GB",
    time: "18m",
    avatar: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=100&auto=format&fit=crop&q=80",
  },
  {
    name: "Marcus Vance",
    action: "created snapshot backup",
    time: "1h",
    avatar: "https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&auto=format&fit=crop&q=80",
  },
  {
    name: "Elena Rostova",
    action: "attached IPv6 subnet",
    time: "3h",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80",
  },
];

export default function ProductTourDemo() {
  const [dark, setDark] = React.useState(true);
  const tour = useTour("demo-product-tour-seen");

  React.useEffect(() => {
    const t = window.setTimeout(() => tour.start(), 650);
    return () => window.clearTimeout(t);
  }, [tour.start]);

  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen overflow-x-hidden bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <div className="mx-auto flex max-w-6xl gap-0 p-3 sm:p-6 md:h-[600px]">
          <aside className="hidden w-60 shrink-0 flex-col rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900 md:flex">
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                <Server className="h-4 w-4" />
              </div>
              <div>
                <span className="text-[13px] font-semibold tracking-tight">InterDash Cloud</span>
                <span className="block text-[10px] text-zinc-400">Hypervisor Cluster</span>
              </div>
            </div>

            <nav className="mt-5 flex flex-col gap-1">
              <NavItem active label="Instances" icon={<Server className="h-4 w-4" />} />
              <NavItem id="tour-nav-reports" label="Analytics" icon={<BarChart3 className="h-4 w-4" />} />
              <NavItem label="Users & Access" icon={<Users className="h-4 w-4" />} />
              <NavItem label="Cluster Settings" icon={<Settings className="h-4 w-4" />} />
            </nav>

            <button
              onClick={() => tour.start()}
              className="mt-auto flex items-center justify-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-[12.5px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60 cursor-pointer"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Replay Onboarding
            </button>
          </aside>

          <main className="min-w-0 flex-1 md:pl-6">
            <header className="flex items-center gap-2 sm:gap-3">
              <div
                id="tour-search"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <Search className="h-4 w-4 shrink-0 text-zinc-400" />
                <span className="truncate text-[13px]">Search instances, IPv4/IPv6, nodes...</span>
                <kbd className="ml-auto hidden shrink-0 rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-400 dark:border-zinc-700 sm:inline">
                  /
                </kbd>
              </div>

              <button
                id="tour-new"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white sm:px-3.5 cursor-pointer shadow-sm"
              >
                <Plus className="h-4 w-4" />
                Deploy VPS
              </button>

              <button
                id="tour-avatar"
                className="h-9 w-9 shrink-0 overflow-hidden rounded-full ring-1 ring-zinc-200 dark:ring-zinc-700 cursor-pointer"
                aria-label="Your profile"
              >
                <img
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
                  alt="Avatar"
                  className="h-full w-full object-cover"
                />
              </button>

              <button
                onClick={() => setDark((d) => !d)}
                aria-label="Toggle theme"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 transition-colors hover:bg-white dark:border-zinc-800 dark:hover:bg-zinc-900 cursor-pointer"
              >
                {dark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-zinc-600" />}
              </button>
            </header>

            <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard id="tour-revenue" label="Active KVM VPS" value="24 / 32" delta="+4 this week" spark />
              <StatCard label="Cluster CPU Load" value="18.4%" delta="-2.1% nominal" />
              <StatCard label="Total RAM Allocated" value="128 GB" delta="+12GB utilized" />
            </section>

            <section className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between">
                <h2 className="text-[13px] font-semibold">Recent Cluster Operations</h2>
                <span className="text-[12px] text-zinc-400">Last 24 hours</span>
              </div>
              <div className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
                {ROWS.map((r) => (
                  <div key={r.name} className="flex items-center gap-3 py-2.5">
                    <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <img src={r.avatar} alt={r.name} className="h-full w-full object-cover" />
                    </div>
                    <span className="text-[13px] font-medium">{r.name}</span>
                    <span className="text-[12.5px] text-zinc-400">{r.action}</span>
                    <span className="ml-auto text-[12px] tabular-nums text-zinc-400">{r.time}</span>
                  </div>
                ))}
              </div>
            </section>
          </main>
        </div>
      </div>

      <Tour
        steps={STEPS}
        open={tour.open}
        onOpenChange={tour.setOpen}
        index={tour.index}
        onIndexChange={tour.setIndex}
        onFinish={tour.markSeen}
      />
    </div>
  );
}

function NavItem({
  label,
  icon,
  active,
  id,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  id?: string;
}) {
  return (
    <button
      id={id}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors cursor-pointer ${
        active
          ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function StatCard({
  id,
  label,
  value,
  delta,
  spark,
}: {
  id?: string;
  label: string;
  value: string;
  delta: string;
  spark?: boolean;
}) {
  return (
    <div
      id={id}
      className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <p className="text-[12px] text-zinc-400">{label}</p>
      <div className="mt-1 flex items-end justify-between">
        <span className="text-[22px] font-semibold tracking-tight">{value}</span>
        <span className="text-[12px] font-medium text-emerald-500 flex items-center gap-0.5">
          <TrendingUp className="h-3 w-3" />
          {delta}
        </span>
      </div>
      {spark && (
        <svg viewBox="0 0 120 28" className="mt-3 h-7 w-full text-zinc-300 dark:text-zinc-600" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M0 22 L15 18 L30 20 L45 12 L60 15 L75 8 L90 11 L105 5 L120 7" />
        </svg>
      )}
    </div>
  );
}
