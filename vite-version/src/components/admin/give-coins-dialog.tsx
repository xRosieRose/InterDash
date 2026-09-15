"use client"

import * as React from "react"
import { Coins, Loader2, ArrowRight, Sparkles, Plus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"

interface GiveCoinsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetUser: {
    id: string
    username: string
    email?: string | null
    currentBalance: number
  } | null
  onSuccess: () => void
}

const REASON_PRESETS = [
  { value: "promotional", label: "Promotional Grant" },
  { value: "support", label: "Support & Customer Care" },
  { value: "compensation", label: "Incident / Downtime Compensation" },
  { value: "welcome_bonus", label: "Welcome Bonus" },
  { value: "manual_adjustment", label: "Administrative Adjustment" },
  { value: "other", label: "Other (Custom Reason)" },
]

const QUICK_AMOUNTS = [100, 500, 1000, 5000, 10000]

export function GiveCoinsDialog({
  open,
  onOpenChange,
  targetUser,
  onSuccess,
}: GiveCoinsDialogProps) {
  const [amountStr, setAmountStr] = React.useState("500")
  const [reasonCategory, setReasonCategory] = React.useState("promotional")
  const [customReason, setCustomReason] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setAmountStr("500")
      setReasonCategory("promotional")
      setCustomReason("")
      setDescription("")
      setIsSubmitting(false)
    }
  }, [open])

  const parsedAmount = Math.floor(Number(amountStr))
  const isValidAmount =
    !isNaN(parsedAmount) &&
    parsedAmount > 0 &&
    parsedAmount <= 1_000_000_000 &&
    Number.isSafeInteger(parsedAmount)

  const effectiveReason =
    reasonCategory === "other"
      ? customReason.trim()
      : REASON_PRESETS.find((r) => r.value === reasonCategory)?.label || reasonCategory

  const isValidReason = Boolean(effectiveReason && effectiveReason.length > 0)
  const currentBalance = targetUser?.currentBalance ?? 0
  const projectedBalance = isValidAmount ? currentBalance + parsedAmount : currentBalance

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!targetUser || !isValidAmount || !isValidReason || isSubmitting) return

    setIsSubmitting(true)
    try {
      // 1. Fetch CSRF token
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const csrfData = await csrfRes.json()
        csrfToken = csrfData.token
      }

      // 2. Submit grant request
      const res = await fetch(`/api/admin/users/${targetUser.id}/coins/grant`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({
          amount: parsedAmount,
          reason: effectiveReason,
          description: description.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Failed to grant coins.")
      }

      toast.success(
        `Granted ${parsedAmount.toLocaleString()} coins to ${targetUser.username}!`,
        {
          description: `New balance: ${(data.account?.balance ?? projectedBalance).toLocaleString()} coins`,
        }
      )

      onSuccess()
      onOpenChange(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error processing coin grant")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <div className="flex items-center gap-2 text-amber-500 mb-1">
            <Coins className="size-5" />
            <DialogTitle className="text-lg font-bold">Grant Virtual Coins</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-zinc-400">
            Credit virtual economy coins directly to a user account. This operation is recorded
            in the immutable ledger and cannot be reversed directly.
          </DialogDescription>
        </DialogHeader>

        {targetUser && (
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            {/* Target User Summary Card */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900/80 border border-zinc-800">
              <div>
                <p className="text-xs text-zinc-400">Target Recipient</p>
                <p className="text-sm font-semibold text-zinc-200">{targetUser.username}</p>
                {targetUser.email && (
                  <p className="text-[11px] text-zinc-500 font-mono">{targetUser.email}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs text-zinc-400">Current Balance</p>
                <div className="flex items-center gap-1 justify-end font-mono font-bold text-amber-400">
                  <Coins className="size-3.5" />
                  <span>{currentBalance.toLocaleString()} coins</span>
                </div>
              </div>
            </div>

            {/* Amount Input */}
            <div className="space-y-2">
              <Label htmlFor="coin-amount" className="text-xs font-semibold text-zinc-300">
                Grant Amount (Positive Whole Integer)
              </Label>
              <div className="relative">
                <Input
                  id="coin-amount"
                  type="number"
                  min="1"
                  max="1000000000"
                  step="1"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  placeholder="e.g. 500"
                  required
                  className="pl-8 font-mono text-sm bg-zinc-900 border-zinc-800 focus:border-amber-500/50"
                />
                <Coins className="size-4 text-amber-400 absolute left-2.5 top-2.5" />
              </div>

              {/* Quick Amount Presets */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {QUICK_AMOUNTS.map((amt) => (
                  <Button
                    key={amt}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2 bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-amber-400 hover:border-amber-500/30"
                    onClick={() => setAmountStr(amt.toString())}
                  >
                    <Plus className="size-2.5 mr-0.5" />
                    {amt.toLocaleString()}
                  </Button>
                ))}
              </div>
            </div>

            {/* Reason Selector */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-zinc-300">Grant Reason</Label>
              <Select value={reasonCategory} onValueChange={setReasonCategory}>
                <SelectTrigger className="w-full bg-zinc-900 border-zinc-800 text-xs">
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-200">
                  {REASON_PRESETS.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value} className="text-xs">
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {reasonCategory === "other" && (
                <Input
                  type="text"
                  maxLength={255}
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Enter custom grant reason..."
                  required
                  className="mt-2 text-xs bg-zinc-900 border-zinc-800 focus:border-amber-500/50"
                />
              )}
            </div>

            {/* Optional Description / Notes */}
            <div className="space-y-2">
              <Label htmlFor="grant-description" className="text-xs font-semibold text-zinc-300">
                Notes / Internal Context (Optional)
              </Label>
              <textarea
                id="grant-description"
                rows={2}
                maxLength={1000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional audit notes, ticket reference, or reason details..."
                className="w-full text-xs rounded-md bg-zinc-900 border border-zinc-800 p-2 text-zinc-200 focus:border-amber-500/50 focus:outline-none resize-none"
              />
            </div>

            {/* Projected Balance Preview Card */}
            <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/20 space-y-1">
              <p className="text-[11px] font-medium text-amber-400/90 flex items-center gap-1">
                <Sparkles className="size-3" /> Projection Preview
              </p>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-zinc-400">{currentBalance.toLocaleString()} coins</span>
                <ArrowRight className="size-3.5 text-amber-500 shrink-0" />
                <span className="text-emerald-400 font-bold">
                  +{isValidAmount ? parsedAmount.toLocaleString() : 0}
                </span>
                <ArrowRight className="size-3.5 text-amber-500 shrink-0" />
                <span className="text-amber-300 font-bold underline decoration-amber-500/40">
                  {projectedBalance.toLocaleString()} coins
                </span>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!isValidAmount || !isValidReason || isSubmitting}
                className="text-xs bg-amber-600 hover:bg-amber-500 text-white font-semibold"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin mr-1.5" /> Granting...
                  </>
                ) : (
                  <>
                    <Coins className="size-3.5 mr-1.5" /> Confirm & Grant
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
