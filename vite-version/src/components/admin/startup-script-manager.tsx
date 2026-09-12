/**
 * InterDash — Admin Startup Script Manager Component
 *
 * Provides an administrative control plane to write, upload, manage,
 * and test bash startup scripts that execute automatically when a VPS
 * is installed for the first time or reinstalled.
 */

import * as React from "react"
import {
  FileCode,
  Upload,
  Download,
  Save,
  RotateCcw,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Terminal,
  Sparkles,
  Info,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { toast } from "sonner"

interface StartupScriptConfig {
  enabled: boolean
  content: string
  updatedAt: string | null
  updatedBy: string | null
}

const TEMPLATES: Record<string, { label: string; description: string; script: string }> = {
  basic: {
    label: "Basic Package Update",
    description: "Updates apt repositories, upgrades packages, and installs essential tools.",
    script: `#!/usr/bin/env bash
# ==============================================================================
# InterDash — Basic First-Install Setup
# ==============================================================================
set -euo pipefail

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting basic system preparation for $INTERDASH_HOSTNAME..."

export DEBIAN_FRONTEND=noninteractive
apt-get update -q -y
apt-get install -q -y curl wget git htop net-tools ca-certificates sudo

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Essential packages installed successfully."
exit 0
`,
  },
  docker: {
    label: "Docker Engine & Compose",
    description: "Installs official Docker CE, containerd, and docker-compose plugin.",
    script: `#!/usr/bin/env bash
# ==============================================================================
# InterDash — Docker CE Automated Installation
# ==============================================================================
set -euo pipefail

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Installing Docker on $INTERDASH_HOSTNAME..."

export DEBIAN_FRONTEND=noninteractive
apt-get update -q -y
apt-get install -q -y ca-certificates curl gnupg lsb-release

# Install Docker via official convenience script
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sh /tmp/get-docker.sh
rm -f /tmp/get-docker.sh

systemctl enable --now docker

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Docker service is active and ready."
docker --version
exit 0
`,
  },
  hardening: {
    label: "Security Hardening",
    description: "Configures UFW firewall, enables automatic security updates, and secures SSH.",
    script: `#!/usr/bin/env bash
# ==============================================================================
# InterDash — Security Hardening
# ==============================================================================
set -euo pipefail

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Applying baseline security hardening..."

export DEBIAN_FRONTEND=noninteractive
apt-get update -q -y
apt-get install -q -y ufw fail2ban unattended-upgrades

# Configure basic firewall rules
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
echo "y" | ufw enable

# Enable fail2ban
systemctl enable --now fail2ban

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Security hardening applied successfully."
exit 0
`,
  },
  nodejs: {
    label: "Node.js & Python Tools",
    description: "Installs Node.js 20 LTS, npm, build tools, and Python 3 pip.",
    script: `#!/usr/bin/env bash
# ==============================================================================
# InterDash — Node.js & Python Environment
# ==============================================================================
set -euo pipefail

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Installing Node.js LTS and Python 3..."

export DEBIAN_FRONTEND=noninteractive
apt-get update -q -y
apt-get install -q -y curl python3 python3-pip build-essential

# Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -q -y nodejs

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Node $(node -v) & npm $(npm -v) ready."
exit 0
`,
  },
}

export function StartupScriptManager() {
  const [config, setConfig] = React.useState<StartupScriptConfig | null>(null)
  const [enabled, setEnabled] = React.useState(false)
  const [scriptContent, setScriptContent] = React.useState("")
  const [initialContent, setInitialContent] = React.useState("")
  const [initialEnabled, setInitialEnabled] = React.useState(false)

  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [hasCopied, setHasCopied] = React.useState(false)

  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  const isDirty = enabled !== initialEnabled || scriptContent !== initialContent

  // Fetch current startup script config
  const fetchConfig = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/admin/settings/startup-script")
      if (!res.ok) throw new Error("Failed to load startup script settings.")
      const data: StartupScriptConfig = await res.json()
      setConfig(data)
      setEnabled(data.enabled)
      setScriptContent(data.content || "")
      setInitialEnabled(data.enabled)
      setInitialContent(data.content || "")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error loading startup script")
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  // Save changes
  const handleSave = async () => {
    setIsSaving(true)
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch("/api/admin/settings/startup-script", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({
          enabled,
          content: scriptContent,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update startup script.")

      setInitialEnabled(enabled)
      setInitialContent(scriptContent)
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              enabled,
              content: scriptContent,
              updatedAt: new Date().toISOString(),
            }
          : null
      )

      toast.success(
        enabled
          ? "Startup script saved and active for new installations!"
          : "Startup script saved (currently disabled)."
      )
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save startup script")
    } finally {
      setIsSaving(false)
    }
  }

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 256 * 1024) {
      toast.error("Script file must be under 256 KB.")
      return
    }

    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target?.result as string
      if (typeof text === "string") {
        setScriptContent(text)
        toast.success(`Loaded script from "${file.name}" (${file.size} bytes)`)
      }
    }
    reader.onerror = () => {
      toast.error("Failed to read script file.")
    }
    reader.readAsText(file)

    // Reset input so same file can be chosen again
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  // Handle download
  const handleDownload = () => {
    const blob = new Blob([scriptContent], { type: "text/x-shellscript;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "interdash-startup.sh"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast.success("Downloaded interdash-startup.sh")
  }

  // Handle copy
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(scriptContent)
      setHasCopied(true)
      toast.success("Script copied to clipboard!")
      setTimeout(() => setHasCopied(false), 2000)
    } catch {
      toast.error("Failed to copy script to clipboard.")
    }
  }

  // Handle template selection
  const handleSelectTemplate = (templateKey: string) => {
    const tpl = TEMPLATES[templateKey]
    if (!tpl) return

    if (
      scriptContent.trim() &&
      !window.confirm(
        `Replace current script content with the "${tpl.label}" template? Existing unsaved text will be replaced.`
      )
    ) {
      return
    }

    setScriptContent(tpl.script)
    toast.info(`Inserted template: ${tpl.label}`)
  }

  // Keyboard tab support in textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault()
      const textarea = textareaRef.current
      if (!textarea) return

      const start = textarea.selectionStart
      const end = textarea.selectionEnd

      const newContent =
        scriptContent.substring(0, start) + "  " + scriptContent.substring(end)
      setScriptContent(newContent)

      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2
      }, 0)
    }
  }

  const lineCount = scriptContent ? scriptContent.split("\n").length : 0
  const charCount = scriptContent.length
  const hasShebang = scriptContent.trim().startsWith("#!")

  if (isLoading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center gap-3 text-xs text-muted-foreground">
        <Loader2 className="size-6 animate-spin text-primary" />
        Loading startup script configuration...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 1. Header & Enable Switch Card */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Terminal className="size-4 text-primary" />
                  First-Install Startup Script
                </CardTitle>
                <Badge
                  variant={enabled ? "default" : "secondary"}
                  className={`text-[10px] font-mono px-2 py-0.5 ${
                    enabled
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      : "bg-zinc-800 text-zinc-400 border-zinc-700"
                  }`}
                >
                  {enabled ? "Active on New Installs" : "Disabled"}
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Executes automatically inside every VPS container when provisioned for the first
                time or reinstalled with a fresh OS.
              </CardDescription>
            </div>

            {/* Enable/Disable Master Switch */}
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20 shrink-0">
              <div className="space-y-0.5 text-right sm:text-left">
                <Label htmlFor="startup-script-toggle" className="text-xs font-semibold cursor-pointer">
                  {enabled ? "Script Enabled" : "Script Disabled"}
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  {enabled ? "Runs on first boot" : "Bypassed on first boot"}
                </p>
              </div>
              <Switch
                id="startup-script-toggle"
                checked={enabled}
                onCheckedChange={setEnabled}
                className="data-[state=checked]:bg-emerald-600"
              />
            </div>
          </div>
        </CardHeader>

        {config?.updatedAt && (
          <CardContent className="pt-0 pb-3 text-[11px] text-muted-foreground flex items-center gap-1.5 border-t border-border/40 mt-1">
            <Info className="size-3 text-muted-foreground/80" />
            Last modified:{" "}
            <span className="font-mono text-foreground/80">
              {new Date(config.updatedAt).toLocaleString()}
            </span>
          </CardContent>
        )}
      </Card>

      {/* 2. Editor Card */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-sm overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/40 bg-muted/10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileCode className="size-4 text-primary" />
              <span className="text-xs font-semibold">Bash Script Code</span>
              <Badge variant="outline" className="text-[10px] font-mono border-zinc-700">
                {lineCount} lines
              </Badge>
              <Badge variant="outline" className="text-[10px] font-mono border-zinc-700">
                {charCount} chars
              </Badge>
              {!hasShebang && scriptContent.trim().length > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/10 flex items-center gap-1"
                >
                  <AlertTriangle className="size-2.5" /> Missing #!/usr/bin/env bash
                </Badge>
              )}
            </div>

            {/* Quick Actions & Templates */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".sh,.bash,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs border-border/60 hover:bg-muted/40"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-3 mr-1.5" />
                Upload .sh
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs border-border/60 hover:bg-muted/40"
                onClick={handleDownload}
                disabled={!scriptContent.trim()}
              >
                <Download className="size-3 mr-1.5" />
                Export
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs border-border/60 hover:bg-muted/40"
                onClick={handleCopy}
                disabled={!scriptContent.trim()}
              >
                {hasCopied ? (
                  <>
                    <Check className="size-3 mr-1.5 text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-3 mr-1.5" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Quick Starter Templates */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1 mr-1">
              <Sparkles className="size-3 text-primary" /> Starters:
            </span>
            {Object.entries(TEMPLATES).map(([key, tpl]) => (
              <button
                key={key}
                type="button"
                onClick={() => handleSelectTemplate(key)}
                className="text-[11px] px-2 py-0.5 rounded border border-border/50 bg-background/50 hover:bg-primary/10 hover:border-primary/40 transition-colors text-muted-foreground hover:text-foreground"
                title={tpl.description}
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </CardHeader>

        {/* Textarea Editor */}
        <CardContent className="p-0">
          <textarea
            ref={textareaRef}
            value={scriptContent}
            onChange={(e) => setScriptContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="#!/usr/bin/env bash&#10;# Write your first-install initialization commands here...&#10;set -euo pipefail&#10;&#10;echo &quot;Hello from InterDash VPS initial setup!&quot;"
            rows={18}
            spellCheck={false}
            className="w-full resize-y bg-zinc-950 text-zinc-200 font-mono text-xs p-4 focus:outline-none border-0 leading-relaxed selection:bg-primary/30 selection:text-white"
          />
        </CardContent>

        <CardFooter className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-border/40 bg-muted/5">
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-primary" />
            Script will be deployed to{" "}
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">
              /root/.interdash-startup.sh
            </code>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setEnabled(initialEnabled)
                setScriptContent(initialContent)
                toast.info("Unsaved changes discarded.")
              }}
              disabled={!isDirty || isSaving}
            >
              <RotateCcw className="size-3 mr-1.5" />
              Discard
            </Button>

            <Button
              type="button"
              size="sm"
              className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleSave}
              disabled={isSaving || !isDirty}
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="size-3.5 mr-1.5" />
                  Save Startup Script
                </>
              )}
            </Button>
          </div>
        </CardFooter>
      </Card>

      {/* 3. Execution Environment & Injected Variables Reference Card */}
      <Card className="border-border/60 bg-muted/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-semibold flex items-center gap-2">
            <Info className="size-3.5 text-primary" />
            Runtime Environment & Execution Guarantees
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs text-muted-foreground leading-relaxed">
          <p>
            When a container is newly created or reinstalled, InterDash boots the virtual server and
            executes this script under the root user environment.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="p-3 rounded-lg border border-border/40 bg-background/50 space-y-1.5">
              <span className="font-semibold text-foreground text-[11px] flex items-center gap-1.5">
                <Terminal className="size-3 text-primary" />
                Injected Environment Variables
              </span>
              <ul className="space-y-1 text-[11px] font-mono">
                <li>
                  <span className="text-primary">$INTERDASH_VPS_ID</span> — Instance identifier
                </li>
                <li>
                  <span className="text-primary">$INTERDASH_HOSTNAME</span> — Assigned server hostname
                </li>
                <li>
                  <span className="text-primary">$INTERDASH_IPV4</span> — Assigned primary IP address
                </li>
                <li>
                  <span className="text-primary">$INTERDASH_EXEC_TIME</span> — ISO execution timestamp
                </li>
              </ul>
            </div>

            <div className="p-3 rounded-lg border border-border/40 bg-background/50 space-y-1.5">
              <span className="font-semibold text-foreground text-[11px] flex items-center gap-1.5">
                <CheckCircle2 className="size-3 text-emerald-400" />
                Non-Blocking Failure Isolation
              </span>
              <p className="text-[11px]">
                Script stdout and stderr are automatically saved to{" "}
                <code className="text-primary font-mono text-[10px]">
                  /var/log/interdash-startup.log
                </code>{" "}
                inside the container. If the script exits with an error code, the instance is still
                kept active so users are never blocked by transient network/mirror glitches.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
