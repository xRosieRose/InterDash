"use client"

import * as React from "react"
import { Terminal as TerminalIcon, Copy, Check, Maximize2, Minimize2, Play } from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { VpsInstance } from "@/types/vps"

interface WebTerminalModalProps {
  vps: VpsInstance | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface CommandHistoryItem {
  command: string
  output: React.ReactNode
}

export function WebTerminalModal({ vps, open, onOpenChange }: WebTerminalModalProps) {
  const [input, setInput] = React.useState("")
  const [copiedSsh, setCopiedSsh] = React.useState(false)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [history, setHistory] = React.useState<CommandHistoryItem[]>([])
  const inputRef = React.useRef<HTMLInputElement>(null)
  const terminalEndRef = React.useRef<HTMLDivElement>(null)

  const defaultUser = "root"
  const hostname = vps?.hostname || "interenl-vps"

  // Reset terminal when VPS changes
  React.useEffect(() => {
    if (vps && open) {
      setHistory([
        {
          command: "",
          output: (
            <div className="text-zinc-400 space-y-1 mb-2 font-mono text-xs">
              <div className="text-emerald-400 font-bold">
                Connected to InterENL Cloud VPS ({vps.name})
              </div>
              <div>Host: {vps.hostname} | IP: {vps.ipv4} | Region: {vps.region.name} ({vps.region.country})</div>
              <div>OS: {vps.os.name} {vps.os.version} | Kernel: 6.8.0-31-generic x86_64</div>
              <div>Type <span className="text-yellow-400 font-semibold">help</span> to view available simulated commands.</div>
            </div>
          )
        }
      ])
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [vps, open])

  // Scroll to bottom on output
  React.useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [history])

  const copySshCommand = () => {
    if (!vps) return
    const cmd = `ssh root@${vps.ipv4}`
    navigator.clipboard.writeText(cmd)
    setCopiedSsh(true)
    setTimeout(() => setCopiedSsh(false), 2000)
  }

  const handleCommand = (cmd: string) => {
    const trimmed = cmd.trim().toLowerCase()
    if (!trimmed) return

    let output: React.ReactNode = null

    switch (trimmed) {
      case "help":
        output = (
          <div className="text-zinc-300 font-mono text-xs space-y-1 py-1">
            <div className="text-yellow-400 font-semibold">Available InterENL Cloud Console Commands:</div>
            <div><span className="text-emerald-400 font-medium">neofetch</span> - Display system architecture, kernel & resource summary</div>
            <div><span className="text-emerald-400 font-medium">uname -a</span> - View Linux kernel release and system architecture</div>
            <div><span className="text-emerald-400 font-medium">free -h</span> - Check DDR5 memory usage and buffer cache</div>
            <div><span className="text-emerald-400 font-medium">df -h</span> - Inspect NVMe SSD filesystem space</div>
            <div><span className="text-emerald-400 font-medium">ip a</span> - Display assigned IPv4 and IPv6 network adapters</div>
            <div><span className="text-emerald-400 font-medium">uptime</span> - Show server operational uptime and load averages</div>
            <div><span className="text-emerald-400 font-medium">docker ps</span> - List running Docker container instances</div>
            <div><span className="text-emerald-400 font-medium">clear</span> - Clear current terminal screen buffer</div>
          </div>
        )
        break

      case "clear":
        setHistory([])
        setInput("")
        return

      case "neofetch":
        output = (
          <div className="text-xs font-mono text-zinc-300 leading-relaxed py-1 flex flex-col sm:flex-row gap-4">
            <div className="text-primary font-bold hidden sm:block whitespace-pre">
{`   _____     __             _______   _____    __ 
  /  _  \\   |__|  ____  ___ \\   _  \\  /     \\  |__|
 /  /_\\  \\  |  | /    \\/ _ \\/  /_\\  \\/  \\ /  \\ |  |
/    |    \\ |  ||   |  \\  </   |    /    Y    \\|  |
\\____|__  / |__||___|  /\\__\\___|__  \\____|__  /|__|
        \\/           \\/           \\/        \\/     `}
            </div>
            <div className="space-y-0.5">
              <div className="text-emerald-400 font-bold">{defaultUser}@{hostname}</div>
              <div className="text-zinc-500">--------------------------------</div>
              <div><span className="text-yellow-400 font-semibold">OS:</span> {vps?.os.name} {vps?.os.version} x86_64</div>
              <div><span className="text-yellow-400 font-semibold">Host:</span> InterENL KVM Virtual Machine v4.2</div>
              <div><span className="text-yellow-400 font-semibold">Kernel:</span> 6.8.0-31-generic (Linux)</div>
              <div><span className="text-yellow-400 font-semibold">Uptime:</span> {vps?.uptime}</div>
              <div><span className="text-yellow-400 font-semibold">Shell:</span> bash 5.2.21</div>
              <div><span className="text-yellow-400 font-semibold">CPU:</span> AMD EPYC 7763 (1) @ 3.24GHz</div>
              <div><span className="text-yellow-400 font-semibold">Memory:</span> 412MiB / 984MiB (1GB DDR5)</div>
              <div><span className="text-yellow-400 font-semibold">Disk (/):</span> 4.1GiB / 24.8GiB (17% NVMe)</div>
              <div><span className="text-yellow-400 font-semibold">Datacenter:</span> {vps?.region.name} ({vps?.region.flag})</div>
            </div>
          </div>
        )
        break

      case "uname -a":
      case "uname":
        output = (
          <div className="text-xs font-mono text-zinc-300">
            Linux {hostname} 6.8.0-31-generic #31-Ubuntu SMP PREEMPT_DYNAMIC Sat Feb 14 02:44:11 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux
          </div>
        )
        break

      case "free -h":
      case "free -m":
      case "free":
        output = (
          <div className="text-xs font-mono text-zinc-300 whitespace-pre">
{`               total        used        free      shared  buff/cache   available
Mem:           984Mi       412Mi       320Mi       8.0Mi       252Mi       540Mi
Swap:          2.0Gi        48Mi       1.9Gi`}
          </div>
        )
        break

      case "df -h":
      case "df":
        output = (
          <div className="text-xs font-mono text-zinc-300 whitespace-pre">
{`Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1        25G  4.2G   20G  18% /
udev            470M     0  470M   0% /dev
tmpfs            99M  1.1M   98M   2% /run
tmpfs           492M     0  492M   0% /dev/shm`}
          </div>
        )
        break

      case "ip a":
      case "ip addr":
      case "ifconfig":
        output = (
          <div className="text-xs font-mono text-zinc-300 whitespace-pre">
{`1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN
    inet 127.0.0.1/8 scope host lo
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP
    inet ${vps?.ipv4}/24 brd 147.185.221.255 scope global eth0
    inet6 ${vps?.ipv6}/64 scope global dynamic`}
          </div>
        )
        break

      case "uptime":
        output = (
          <div className="text-xs font-mono text-zinc-300">
            {new Date().toLocaleTimeString()} up {vps?.uptime}, 1 user, load average: 0.12, 0.08, 0.04
          </div>
        )
        break

      case "docker ps":
        output = (
          <div className="text-xs font-mono text-zinc-300 whitespace-pre">
{`CONTAINER ID   IMAGE          COMMAND                  CREATED        STATUS        PORTS                    NAMES
a9f4c3b2e107   nginx:alpine   "/docker-entrypoint.…"   5 days ago     Up 5 days     0.0.0.0:80->80/tcp       reverse-proxy
d8e7b6a5c432   redis:7-alpine "docker-entrypoint.s…"   2 weeks ago    Up 2 weeks    127.0.0.1:6379->6379/tcp session-cache`}
          </div>
        )
        break

      default:
        output = (
          <div className="text-xs font-mono text-rose-400">
            bash: {trimmed}: command not found. Type <span className="text-yellow-400">help</span> for simulated cloud commands.
          </div>
        )
    }

    setHistory((prev) => [...prev, { command: cmd, output }])
    setInput("")
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleCommand(input)
  }

  if (!vps) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className={`bg-zinc-950 text-zinc-100 border-zinc-800 p-0 overflow-hidden transition-all duration-200 ${
          isFullscreen ? "max-w-[98vw] h-[95vh]" : "max-w-3xl h-[600px]"
        }`}
      >
        {/* Terminal Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5 bg-zinc-900/80">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5 mr-2">
              <div className="size-3 rounded-full bg-red-500/80 hover:opacity-100 cursor-pointer" onClick={() => onOpenChange(false)} />
              <div className="size-3 rounded-full bg-yellow-500/80 hover:opacity-100 cursor-pointer" />
              <div className="size-3 rounded-full bg-green-500/80 hover:opacity-100 cursor-pointer" onClick={() => setIsFullscreen(!isFullscreen)} />
            </div>
            <TerminalIcon className="size-4 text-emerald-400" />
            <span className="font-mono text-xs font-semibold text-zinc-300">
              {defaultUser}@{hostname} — Web Console
            </span>
            <Badge variant="outline" className="text-[10px] py-0 border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
              SSH Active
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs font-mono bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
              onClick={copySshCommand}
            >
              {copiedSsh ? <Check className="size-3 text-emerald-400 mr-1" /> : <Copy className="size-3 mr-1" />}
              ssh root@{vps.ipv4}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-zinc-400 hover:text-white"
              onClick={() => setIsFullscreen(!isFullscreen)}
            >
              {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </Button>
          </div>
        </div>

        {/* Quick Command Toolbar */}
        <div className="flex items-center gap-2 px-4 py-1.5 bg-zinc-900/40 border-b border-zinc-800/80 overflow-x-auto text-[11px] font-mono text-zinc-400">
          <span className="text-zinc-500">Quick run:</span>
          {["neofetch", "free -h", "df -h", "docker ps", "uptime", "clear"].map((cmd) => (
            <button
              key={cmd}
              type="button"
              className="px-2 py-0.5 rounded bg-zinc-800/60 hover:bg-zinc-700 hover:text-zinc-200 transition-colors border border-zinc-700/40 flex items-center gap-1"
              onClick={() => handleCommand(cmd)}
            >
              <Play className="size-2.5 text-emerald-400" />
              {cmd}
            </button>
          ))}
        </div>

        {/* Terminal Body */}
        <div 
          className="flex-1 p-4 font-mono text-xs overflow-y-auto bg-zinc-950 space-y-2 select-text"
          onClick={() => inputRef.current?.focus()}
        >
          {history.map((item, index) => (
            <div key={index} className="space-y-1">
              {item.command && (
                <div className="flex items-center gap-2 text-zinc-400">
                  <span className="text-emerald-400 font-bold">{defaultUser}@{hostname}:~#</span>
                  <span className="text-zinc-100 font-semibold">{item.command}</span>
                </div>
              )}
              {item.output}
            </div>
          ))}

          {/* Active Prompt Line */}
          <form onSubmit={handleSubmit} className="flex items-center gap-2 pt-1">
            <span className="text-emerald-400 font-bold shrink-0">{defaultUser}@{hostname}:~#</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none font-mono text-xs text-zinc-100 caret-emerald-400"
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
          </form>
          <div ref={terminalEndRef} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
