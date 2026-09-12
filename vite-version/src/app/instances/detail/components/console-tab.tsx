import * as React from "react"
import {
  Terminal as TerminalIcon,
  RefreshCw,
  Power,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import type { VpsRecord } from "@/types/vps"
import type {
  ConsoleState,
  ConsoleControlMessage,
  ConsoleError,
  ConsoleDiagnostic,
} from "@/types/console"

interface ConsoleTabProps {
  vps: VpsRecord
  isStopped: boolean
  onStartVps: () => void
}

export function ConsoleTab({ vps, isStopped, onStartVps }: ConsoleTabProps) {
  const [consoleState, setConsoleState] = React.useState<ConsoleState>("idle")
  const [consoleStatusMessage, setConsoleStatusMessage] = React.useState<string>("Ready to connect")
  const [consoleError, setConsoleError] = React.useState<ConsoleError | null>(null)
  const [consoleDiagnostic, setConsoleDiagnostic] = React.useState<ConsoleDiagnostic | null>(null)
  const [showDiagnosticsPanel, setShowDiagnosticsPanel] = React.useState(false)
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = React.useState(false)

  const terminalRef = React.useRef<HTMLDivElement>(null)
  const xtermInstance = React.useRef<Terminal | null>(null)
  const fitAddonInstance = React.useRef<FitAddon | null>(null)
  const wsInstance = React.useRef<WebSocket | null>(null)

  const consoleErrorRef = React.useRef<ConsoleError | null>(null)

  const sendResize = React.useCallback((cols: number, rows: number) => {
    if (wsInstance.current && wsInstance.current.readyState === WebSocket.OPEN) {
      wsInstance.current.send(JSON.stringify({ type: "resize", cols, rows }))
    }
  }, [])

  const fetchConsoleDiagnostic = React.useCallback(async () => {
    setIsLoadingDiagnostics(true)
    try {
      const res = await fetch(`/api/vps/${vps.id}/console/diagnostic`)
      if (res.ok) {
        const data = await res.json()
        setConsoleDiagnostic(data.diagnostic || data)
      }
    } catch {} finally {
      setIsLoadingDiagnostics(false)
    }
  }, [vps.id])

  const connectConsole = React.useCallback(() => {
    // Tear down any existing WebSocket connection
    if (wsInstance.current) {
      wsInstance.current.close()
      wsInstance.current = null
    }

    setConsoleState("connecting")
    setConsoleStatusMessage("Connecting to InterDash console gateway...")
    setConsoleError(null)
    consoleErrorRef.current = null

    if (!terminalRef.current) return

    // Clean up previous xterm terminal instance if any
    if (xtermInstance.current) {
      xtermInstance.current.dispose()
      xtermInstance.current = null
      fitAddonInstance.current = null
    }

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: {
        background: "#09090b",
        foreground: "#f4f4f5",
        cursor: "#3b82f6",
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    try {
      fitAddon.fit()
    } catch {}

    xtermInstance.current = term
    fitAddonInstance.current = fitAddon

    // Initial neutral connection banner
    term.writeln("\x1b[38;5;244m[Connecting to InterDash console gateway...]\x1b[0m")

    // Forward keystrokes directly to WebSocket once connected
    term.onData((data) => {
      if (wsInstance.current && wsInstance.current.readyState === WebSocket.OPEN) {
        wsInstance.current.send(data)
      }
    })

    // Listen for terminal resize and notify backend
    term.onResize(({ cols, rows }) => {
      sendResize(cols, rows)
    })

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const wsUrl = `${protocol}//${window.location.host}/api/vps/${vps.id}/console/ws`
    const ws = new WebSocket(wsUrl)
    wsInstance.current = ws

    ws.onopen = () => {
      setConsoleState("gateway_connected")
      setConsoleStatusMessage("Checking VPS runtime state...")
      term.writeln("\x1b[38;5;244m[InterDash gateway established. Checking VPS runtime state...]\x1b[0m")
    }

    ws.onmessage = (event) => {
      const dataStr = typeof event.data === "string" ? event.data : ""

      if (dataStr.startsWith("{")) {
        try {
          const ctrl: ConsoleControlMessage = JSON.parse(dataStr)

          if (ctrl.type === "status" && ctrl.state) {
            setConsoleState(ctrl.state)
            if (ctrl.message) {
              setConsoleStatusMessage(ctrl.message)
            }

            if (ctrl.state === "connected") {
              setConsoleStatusMessage("Terminal connected.")
              term.writeln("\x1b[32m✔ Connected to LXC terminal.\x1b[0m\r\n")
              term.focus()
              if (fitAddonInstance.current && xtermInstance.current) {
                fitAddonInstance.current.fit()
                sendResize(xtermInstance.current.cols, xtermInstance.current.rows)
              }
            } else {
              term.writeln(`\x1b[38;5;244m[${ctrl.message || ctrl.state}]\x1b[0m`)
            }
            return
          }

          if (ctrl.type === "error") {
            const errObj: ConsoleError = {
              code: ctrl.code || "CONSOLE_ERROR",
              message: ctrl.message || "Console error occurred.",
              stage: ctrl.stage,
              httpStatus: ctrl.httpStatus,
              websocketCode: ctrl.websocketCode,
              retryable: ctrl.retryable,
              details: ctrl.details,
              diagnosticId: ctrl.diagnosticId,
            }
            consoleErrorRef.current = errObj
            setConsoleState(ctrl.state || "failed")
            setConsoleStatusMessage(ctrl.message || "Console connection failed.")
            setConsoleError(errObj)
            term.writeln(`\x1b[31m[Error (${ctrl.stage || "console"}): ${ctrl.message}]\x1b[0m`)
            fetchConsoleDiagnostic()
            return
          }
        } catch {
          // Not a JSON control message; proceed to write terminal raw data
        }
      }

      // Raw terminal output from Proxmox VE
      term.write(event.data)
    }

    ws.onerror = () => {
      if (!consoleErrorRef.current) {
        const errObj: ConsoleError = {
          code: "WEBSOCKET_ERROR",
          stage: "gateway",
          message: "Failed to connect to the InterDash console WebSocket gateway.",
          retryable: true,
        }
        consoleErrorRef.current = errObj
        setConsoleState("failed")
        setConsoleStatusMessage("WebSocket stream connection error.")
        setConsoleError(errObj)
        fetchConsoleDiagnostic()
      }
    }

    ws.onclose = (e) => {
      setConsoleState((prev) => {
        if (prev !== "failed" && prev !== "stopped") {
          if (!consoleErrorRef.current) {
            const isAbnormal = e.code === 1006
            const errObj: ConsoleError = {
              code: isAbnormal ? "UPSTREAM_CONNECTION_CLOSED" : "DISCONNECTED",
              stage: isAbnormal ? "upstream_upgrade" : "stream",
              websocketCode: e.code,
              message: isAbnormal
                ? "Terminal session disconnected abnormally (code 1006). Inspect diagnostic stages below."
                : `Session disconnected (code ${e.code}).`,
              retryable: isAbnormal,
            }
            consoleErrorRef.current = errObj
            setConsoleError(errObj)
            fetchConsoleDiagnostic()
          }
          setConsoleStatusMessage(`Session disconnected (code ${e.code}).`)
          return "disconnected"
        }
        return prev
      })
    }
  }, [vps.id, sendResize, fetchConsoleDiagnostic])

  // Mount effect
  React.useEffect(() => {
    const timer = setTimeout(() => {
      connectConsole()
    }, 100)

    return () => {
      clearTimeout(timer)
      if (wsInstance.current) {
        wsInstance.current.close()
        wsInstance.current = null
      }
      if (xtermInstance.current) {
        xtermInstance.current.dispose()
        xtermInstance.current = null
      }
      fitAddonInstance.current = null
    }
  }, [connectConsole])

  // Window resize handler
  React.useEffect(() => {
    const handleResize = () => {
      if (fitAddonInstance.current && xtermInstance.current) {
        try {
          fitAddonInstance.current.fit()
          sendResize(xtermInstance.current.cols, xtermInstance.current.rows)
        } catch {}
      }
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [sendResize])

  return (
    <div className="space-y-4">
      <Card className="border-border overflow-hidden">
        <CardHeader className="bg-zinc-950 p-4 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <TerminalIcon className="size-4 text-zinc-400" />
            <span className="text-xs font-mono text-zinc-200">
              root@{vps.hostname}:~#
            </span>

            {/* Status Badge */}
            <Badge
              variant="outline"
              className={`text-[10px] px-2 py-0.5 border-zinc-700 font-mono gap-1.5 ${
                consoleState === "connected"
                  ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                  : consoleState === "failed"
                  ? "text-red-400 border-red-500/30 bg-red-500/10"
                  : consoleState === "stopped"
                  ? "text-zinc-500 border-zinc-700"
                  : consoleState === "idle" || consoleState === "disconnected"
                  ? "text-zinc-400 border-zinc-800 bg-zinc-900/60"
                  : "text-amber-400 border-amber-500/30 bg-amber-500/10"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  consoleState === "connected"
                    ? "bg-emerald-400"
                    : consoleState === "failed"
                    ? "bg-red-400"
                    : consoleState === "stopped" || consoleState === "idle" || consoleState === "disconnected"
                    ? "bg-zinc-500"
                    : "bg-amber-400 animate-pulse"
                }`}
              />
              {consoleState === "connected"
                ? "CONNECTED"
                : consoleState === "failed"
                ? "UNAVAILABLE"
                : consoleState === "stopped"
                ? "VPS STOPPED"
                : consoleState === "idle" || consoleState === "disconnected"
                ? "DISCONNECTED"
                : "CONNECTING..."}
            </Badge>

            {consoleState !== "connected" && (
              <span className="text-[11px] text-zinc-400 italic">
                {consoleStatusMessage}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              onClick={() => {
                if (xtermInstance.current) {
                  xtermInstance.current.clear()
                }
              }}
            >
              Clear
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              onClick={connectConsole}
              disabled={
                consoleState === "connecting" ||
                consoleState === "requesting_termproxy" ||
                consoleState === "connecting_upstream"
              }
            >
              <RefreshCw className={`size-3 mr-1 ${consoleState === "connecting" ? "animate-spin" : ""}`} />
              Reconnect
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0 bg-zinc-950 min-h-[560px] relative">
          {isStopped ? (
            <div className="py-32 flex flex-col items-center justify-center space-y-3 text-center px-4">
              <Power className="size-8 text-zinc-600" />
              <h4 className="font-semibold text-sm text-zinc-300">VPS is Stopped</h4>
              <p className="text-xs text-zinc-500 max-w-sm">
                Start the container to establish a live interactive terminal session.
              </p>
              <div className="flex items-center gap-2 mt-2">
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={onStartVps}
                >
                  Start Container
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs"
                  onClick={connectConsole}
                >
                  Connect Anyway
                </Button>
              </div>
            </div>
          ) : consoleError || consoleState === "failed" ? (
            <div className="p-6 max-w-2xl mx-auto my-12 rounded-lg border border-red-500/20 bg-red-950/20 text-zinc-200 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="size-6 text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-semibold text-base text-red-200">
                    Console Connection Failed
                  </h4>
                  <p className="text-xs text-zinc-300">
                    {consoleError?.message || "Proxmox terminal connection could not be established."}
                  </p>
                </div>
              </div>

              {/* Status & Diagnostics Badges */}
              <div className="flex flex-wrap items-center gap-2">
                {consoleError?.stage && (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-400 font-mono text-[11px]">
                    Stage: {consoleError.stage}
                  </Badge>
                )}
                {consoleError?.code && (
                  <Badge variant="outline" className="border-red-500/40 text-red-400 font-mono text-[11px]">
                    Code: {consoleError.code}
                  </Badge>
                )}
                {consoleError?.httpStatus && (
                  <Badge variant="outline" className="border-purple-500/40 text-purple-400 font-mono text-[11px]">
                    HTTP: {consoleError.httpStatus}
                  </Badge>
                )}
                {consoleError?.websocketCode && (
                  <Badge variant="outline" className="border-zinc-700 text-zinc-400 font-mono text-[11px]">
                    WS Close: {consoleError.websocketCode}
                  </Badge>
                )}
              </div>

              {/* Contextual Actionable Guidance */}
              <div className="rounded-md bg-zinc-900/80 p-3.5 border border-zinc-800 text-xs space-y-2">
                <div className="flex items-center gap-2 font-medium text-zinc-200">
                  <Info className="size-4 text-blue-400" />
                  <span>Potential Cause & Resolution</span>
                </div>
                {consoleError?.code === "CONSOLE_LXC_LOCKED" ? (
                  <p className="text-zinc-400 leading-relaxed">
                    A Proxmox VE background operation (such as snapshot, backup, disk resize, or configuration task)
                    is currently holding an active lock on this container. The terminal will become accessible
                    automatically once the hypervisor task finishes.
                  </p>
                ) : consoleError?.code === "CONSOLE_LXC_STOPPED" ? (
                  <p className="text-zinc-400 leading-relaxed">
                    The container is currently powered off. Start the VPS container to open an interactive terminal.
                  </p>
                ) : consoleError?.code === "TERMPROXY_HANDSHAKE_REJECTED" ? (
                  <p className="text-zinc-400 leading-relaxed">
                    Proxmox termproxy rejected the console authentication handshake. Verify that the configured API Token has
                    the <code className="font-mono text-zinc-300">VM.Console</code> privilege on path <code className="font-mono text-zinc-300">/vms/{vps.proxmox_vmid}</code> or datacenter root,
                    and verify that <strong>Privilege Separation</strong> is unchecked in Proxmox Datacenter API token settings.
                  </p>
                ) : consoleError?.code === "PROXMOX_CONSOLE_UPGRADE_DENIED" ? (
                  <p className="text-zinc-400 leading-relaxed">
                    Proxmox rejected the console WebSocket HTTP 101 upgrade request with HTTP 403 Forbidden.
                    Ensure the API token has the required permissions and Privilege Separation is disabled in Proxmox.
                  </p>
                ) : consoleDiagnostic?.classification === "CLOUDFLARE_501" ||
                  consoleDiagnostic?.classification === "REVERSE_PROXY_501" ||
                  consoleError?.code === "PROXMOX_501_TERM_PROXY" ? (
                  <>
                    <p className="text-zinc-400 leading-relaxed">
                      Proxmox VE <code className="font-mono text-zinc-300">pveproxy</code> historically rejects
                      requests formatted with chunked transfer encoding with <code className="font-mono text-amber-400">HTTP 501 Not Implemented</code>.
                    </p>
                    {consoleDiagnostic?.recommendedFix && (
                      <div className="p-2.5 rounded bg-zinc-950 border border-zinc-700/60 font-mono text-[11px] text-amber-300 space-y-1">
                        <p className="font-sans font-medium text-zinc-300">Cloudflare Tunnel Origin Recommendation:</p>
                        <pre className="text-zinc-300 whitespace-pre-wrap">{consoleDiagnostic.recommendedFix}</pre>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-zinc-400 leading-relaxed">
                    {consoleDiagnostic?.recommendedFix ||
                      consoleError?.message ||
                      "Unable to establish terminal connection to Proxmox VE hypervisor. Check node reachability and API permissions."}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 border-zinc-700 text-zinc-200 hover:bg-zinc-800 text-xs"
                    onClick={connectConsole}
                  >
                    <RefreshCw className="size-3.5 mr-1" /> Retry Connection
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-zinc-400 hover:text-zinc-200"
                    onClick={() => {
                      setShowDiagnosticsPanel(!showDiagnosticsPanel)
                      if (!consoleDiagnostic) fetchConsoleDiagnostic()
                    }}
                  >
                    {showDiagnosticsPanel ? (
                      <>
                        <ChevronUp className="size-3.5 mr-1" /> Hide Diagnostics
                      </>
                    ) : (
                      <>
                        <ChevronDown className="size-3.5 mr-1" /> View Diagnostics
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Expandable Diagnostic Panel */}
              {showDiagnosticsPanel && (
                <div className="p-3 rounded border border-zinc-800 bg-zinc-900 font-mono text-[11px] space-y-2 mt-2">
                  <div className="flex items-center justify-between text-zinc-400 border-b border-zinc-800 pb-1">
                    <span className="font-sans font-semibold text-zinc-200">Hypervisor Diagnostic Details</span>
                    {isLoadingDiagnostics && <Loader2 className="size-3 animate-spin text-primary" />}
                  </div>

                  {consoleDiagnostic ? (
                    <div className="space-y-2 text-zinc-300">
                      {consoleDiagnostic.endpoint && (
                        <p><span className="text-zinc-500">Endpoint:</span> {consoleDiagnostic.endpoint}</p>
                      )}
                      <p><span className="text-zinc-500">Classification:</span> {consoleDiagnostic.classification || "UNKNOWN"}</p>
                      <p><span className="text-zinc-500">Proxy Detected:</span> {consoleDiagnostic.proxied ? `Yes (${consoleDiagnostic.proxyType})` : "Direct / None"}</p>
                      {consoleDiagnostic.latencyMs !== undefined && (
                        <p><span className="text-zinc-500">Total Latency:</span> {consoleDiagnostic.latencyMs}ms</p>
                      )}

                      {/* Multi-stage verification results */}
                      {consoleDiagnostic.stages && (
                        <div className="border border-zinc-800 rounded p-2 bg-zinc-950 space-y-1 mt-2">
                          <p className="font-sans font-medium text-zinc-400 text-[10px] uppercase tracking-wider pb-1 border-b border-zinc-800">
                            Protocol Lifecycle Stages
                          </p>
                          {Object.entries(consoleDiagnostic.stages).map(([stageName, stageData]) => (
                            <div key={stageName} className="flex items-center justify-between py-0.5 text-[10px]">
                              <span className="text-zinc-400">{stageName}:</span>
                              <div className="flex items-center gap-1.5">
                                {stageData.latencyMs !== undefined && (
                                  <span className="text-zinc-600">{stageData.latencyMs}ms</span>
                                )}
                                <span
                                  className={
                                    stageData.status === "ok"
                                      ? "text-emerald-400 font-semibold"
                                      : stageData.status === "failed"
                                      ? "text-red-400 font-semibold"
                                      : "text-zinc-600"
                                  }
                                >
                                  {stageData.status.toUpperCase()}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {consoleDiagnostic.responseSnippet && (
                        <div>
                          <span className="text-zinc-500">Response Snippet:</span>
                          <pre className="p-2 rounded bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-400 mt-1 overflow-x-auto whitespace-pre-wrap">
                            {consoleDiagnostic.responseSnippet}
                          </pre>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-zinc-500 italic">No diagnostic report available.</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div ref={terminalRef} className="p-4 h-[560px] w-full" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
