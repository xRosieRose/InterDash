"use client"

import * as React from "react"
import {
  LifeBuoy,
  Plus,
  Send,
  Shield,
  User as UserIcon,
  RefreshCw,
  Loader2,
} from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/contexts/auth-context"
import { useSettings } from "@/contexts/settings-context"
import { toast } from "sonner"

interface TicketItem {
  id: string
  user_id: string
  subject: string
  category: string
  status: "open" | "waiting" | "resolved" | "closed"
  priority: "low" | "medium" | "high" | "urgent"
  created_at: string
  updated_at: string
  username?: string
  global_name?: string
  message_count?: number
}

interface TicketMessage {
  id: string
  ticket_id: string
  user_id: string
  message: string
  is_admin_reply: number
  created_at: string
  username?: string
  global_name?: string
  avatar_hash?: string
  role?: string
}

export default function TicketsPage() {
  const { user } = useAuth()
  const { settings } = useSettings()
  const isAdmin = user?.role === "admin"

  const [tickets, setTickets] = React.useState<TicketItem[]>([])
  const [selectedTicketId, setSelectedTicketId] = React.useState<string | null>(null)
  const [messages, setMessages] = React.useState<TicketMessage[]>([])
  const [selectedTicket, setSelectedTicket] = React.useState<TicketItem | null>(null)

  const [isLoading, setIsLoading] = React.useState(true)
  const [isLoadingMessages, setIsLoadingMessages] = React.useState(false)
  const [isSendingReply, setIsSendingReply] = React.useState(false)
  const [replyText, setReplyText] = React.useState("")

  // New ticket modal
  const [newTicketOpen, setNewTicketOpen] = React.useState(false)
  const [newSubject, setNewSubject] = React.useState("")
  const [newCategory, setNewCategory] = React.useState("technical")
  const [newPriority, setNewPriority] = React.useState("medium")
  const [newMessage, setNewMessage] = React.useState("")
  const [isCreating, setIsCreating] = React.useState(false)

  const fetchTickets = React.useCallback(async () => {
    try {
      const res = await fetch("/api/tickets")
      if (!res.ok) throw new Error("Failed to load tickets.")
      const data = await res.json()
      setTickets(data.tickets || [])
      if (!selectedTicketId && data.tickets?.length > 0) {
        setSelectedTicketId(data.tickets[0].id)
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error fetching tickets")
    } finally {
      setIsLoading(false)
    }
  }, [selectedTicketId])

  React.useEffect(() => {
    fetchTickets()
  }, [fetchTickets])

  // Load active ticket messages
  React.useEffect(() => {
    if (!selectedTicketId) {
      setSelectedTicket(null)
      setMessages([])
      return
    }

    async function loadTicketDetails() {
      setIsLoadingMessages(true)
      try {
        const res = await fetch(`/api/tickets/${selectedTicketId}`)
        if (res.ok) {
          const data = await res.json()
          setSelectedTicket(data.ticket)
          setMessages(data.messages || [])
        }
      } catch {
        toast.error("Failed to load conversation thread.")
      } finally {
        setIsLoadingMessages(false)
      }
    }

    loadTicketDetails()
  }, [selectedTicketId])

  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedTicketId) return

    setIsSendingReply(true)
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch(`/api/tickets/${selectedTicketId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({ message: replyText.trim() }),
      })

      if (!res.ok) throw new Error("Failed to send message.")

      setReplyText("")
      // Refresh messages
      const updatedRes = await fetch(`/api/tickets/${selectedTicketId}`)
      if (updatedRes.ok) {
        const data = await updatedRes.json()
        setSelectedTicket(data.ticket)
        setMessages(data.messages || [])
      }
      fetchTickets()
      toast.success("Reply sent.")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error sending reply")
    } finally {
      setIsSendingReply(false)
    }
  }

  const handleCreateTicket = async () => {
    if (!newSubject.trim() || !newMessage.trim()) {
      toast.error("Subject and message are required.")
      return
    }

    setIsCreating(true)
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({
          subject: newSubject.trim(),
          category: newCategory,
          priority: newPriority,
          message: newMessage.trim(),
        }),
      })

      if (!res.ok) throw new Error("Failed to create ticket.")

      const data = await res.json()
      setNewTicketOpen(false)
      setNewSubject("")
      setNewMessage("")
      toast.success("Support ticket created successfully!")
      await fetchTickets()
      if (data.ticketId) {
        setSelectedTicketId(data.ticketId)
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error creating ticket")
    } finally {
      setIsCreating(false)
    }
  }

  const handleUpdateStatus = async (newStatus: string) => {
    if (!selectedTicketId) return
    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch(`/api/tickets/${selectedTicketId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({ status: newStatus }),
      })

      if (!res.ok) throw new Error("Failed to update status.")

      setSelectedTicket((prev) => (prev ? { ...prev, status: newStatus as any } : null))
      fetchTickets()
      toast.success(`Ticket marked as ${newStatus}.`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error updating status")
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">Open</Badge>
      case "waiting":
        return <Badge variant="outline" className="text-amber-500 border-amber-500/30">Waiting</Badge>
      case "resolved":
        return <Badge variant="outline" className="text-blue-500 border-blue-500/30">Resolved</Badge>
      case "closed":
        return <Badge variant="secondary">Closed</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <BaseLayout
      title="Support Tickets"
      description={`Official ${settings.brand_name || "Platform"} support channel for hypervisor questions, network routing, and platform assistance.`}
    >
      <div className="@container/main px-4 lg:px-6 space-y-4">
        {/* Action Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {tickets.length} ticket(s) found
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchTickets()}
              className="h-8 gap-1.5 text-xs"
            >
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setNewTicketOpen(true)}
              className="h-8 gap-1.5 text-xs"
            >
              <Plus className="size-3.5" /> New Ticket
            </Button>
          </div>
        </div>

        {/* Main Split-Pane View */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[560px] border rounded-lg bg-card overflow-hidden">
          {/* Left Column: Tickets List */}
          <div className="lg:col-span-5 border-r divide-y overflow-y-auto max-h-[640px]">
            {isLoading ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                <Loader2 className="size-5 animate-spin mx-auto mb-2 text-primary" />
                Loading support tickets...
              </div>
            ) : tickets.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground space-y-2">
                <LifeBuoy className="size-6 mx-auto text-muted-foreground/40" />
                <p>No support tickets yet.</p>
                <Button size="sm" variant="outline" onClick={() => setNewTicketOpen(true)} className="text-xs">
                  Create your first ticket
                </Button>
              </div>
            ) : (
              tickets.map((t) => {
                const isSelected = t.id === selectedTicketId
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTicketId(t.id)}
                    className={`w-full text-left p-3.5 transition-colors cursor-pointer flex flex-col gap-1.5 ${
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs truncate max-w-[200px]">
                        {t.subject}
                      </span>
                      {getStatusBadge(t.status)}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="capitalize">{t.category}</span>
                      <span>•</span>
                      <span className="capitalize">{t.priority} priority</span>
                      {isAdmin && t.username && (
                        <>
                          <span>•</span>
                          <span className="text-foreground font-mono">@{t.username}</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono mt-0.5">
                      <span>{t.message_count || 1} msg(s)</span>
                      <span>{t.updated_at ? t.updated_at.split("T")[0] : ""}</span>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* Right Column: Conversation Thread */}
          <div className="lg:col-span-7 flex flex-col justify-between p-4 min-h-[500px]">
            {selectedTicket ? (
              <>
                {/* Thread Header */}
                <div className="pb-3 border-b space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-base">{selectedTicket.subject}</h3>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span className="capitalize">Category: {selectedTicket.category}</span>
                        <span>•</span>
                        <span className="capitalize">Priority: {selectedTicket.priority}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(selectedTicket.status)}
                      {selectedTicket.status !== "closed" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUpdateStatus("closed")}
                          className="h-7 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Close Ticket
                        </Button>
                      )}
                      {isAdmin && selectedTicket.status === "closed" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUpdateStatus("open")}
                          className="h-7 text-xs"
                        >
                          Reopen
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Messages List */}
                <div className="flex-1 overflow-y-auto py-4 space-y-4 max-h-[380px]">
                  {isLoadingMessages ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                      <Loader2 className="size-4 animate-spin mx-auto mb-2 text-primary" />
                      Loading messages...
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isStaff = m.is_admin_reply === 1
                      return (
                        <div
                          key={m.id}
                          className={`p-3.5 rounded-lg border text-xs space-y-1.5 ${
                            isStaff
                              ? "bg-primary/5 border-primary/20 ml-4"
                              : "bg-muted/40 border-border mr-4"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px]">
                            <div className="flex items-center gap-1.5 font-medium">
                              {isStaff ? (
                                <>
                                  <Shield className="size-3.5 text-primary" />
                                  <span className="text-primary font-bold">{settings.brand_name || "Platform"} Staff</span>
                                </>
                              ) : (
                                <>
                                  <UserIcon className="size-3.5 text-muted-foreground" />
                                  <span>{m.global_name || m.username || "Client"}</span>
                                </>
                              )}
                            </div>
                            <span className="text-muted-foreground font-mono text-[10px]">
                              {m.created_at ? m.created_at.replace("T", " ").substring(0, 16) : ""}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap leading-relaxed text-foreground">
                            {m.message}
                          </p>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Reply Box */}
                {selectedTicket.status !== "closed" ? (
                  <div className="pt-3 border-t space-y-2">
                    <Textarea
                      placeholder="Type your reply..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={3}
                      className="text-xs resize-none"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={handleSendReply}
                        disabled={isSendingReply || !replyText.trim()}
                        className="gap-1.5 text-xs h-8"
                      >
                        {isSendingReply ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                        Send Reply
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="pt-3 border-t text-center text-xs text-muted-foreground">
                    This ticket is closed. Reopen it or create a new ticket to continue.
                  </div>
                )}
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                Select a ticket on the left to view the conversation.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New Ticket Modal */}
      <Dialog open={newTicketOpen} onOpenChange={setNewTicketOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LifeBuoy className="size-4 text-primary" /> Create Support Ticket
            </DialogTitle>
            <DialogDescription>
              Submit a support inquiry regarding your cloud VPS instances or infrastructure.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2 text-sm">
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input
                placeholder="e.g. Network latency issue on eu-central-1"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="technical">Technical Support</SelectItem>
                    <SelectItem value="network">Network / Routing</SelectItem>
                    <SelectItem value="billing">Plans & Limits</SelectItem>
                    <SelectItem value="abuse">Security / Abuse</SelectItem>
                    <SelectItem value="general">General Inquiry</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={newPriority} onValueChange={setNewPriority}>
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                placeholder="Please describe the issue or inquiry in detail..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                rows={4}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTicketOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateTicket} disabled={isCreating}>
              {isCreating ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
              Submit Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BaseLayout>
  )
}
