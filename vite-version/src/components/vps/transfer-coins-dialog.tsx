"use client"

import * as React from "react"
import { Coins, Loader2, ArrowRight, Send } from "lucide-react"
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
import { toast } from "sonner"

interface TransferCoinsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentBalance: number
  onSuccess?: () => void
}

const PRESET_AMOUNTS = [100, 500, 1000, 2500, 5000]

export function TransferCoinsDialog({
  open,
  onOpenChange,
  currentBalance,
  onSuccess,
}: TransferCoinsDialogProps) {
  const [recipient, setRecipient] = React.useState("")
  const [amount, setAmount] = React.useState("100")
  const [reason, setReason] = React.useState("")
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setRecipient("")
      setAmount("100")
      setReason("")
      setIsSubmitting(false)
    }
  }, [open])

  const parsedAmount = Math.floor(Number(amount))
  const isValidAmount =
    !isNaN(parsedAmount) &&
    parsedAmount > 0 &&
    parsedAmount <= currentBalance

  const remainingBalance = isValidAmount ? currentBalance - parsedAmount : currentBalance

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!recipient.trim() || !isValidAmount || isSubmitting) return

    setIsSubmitting(true)
    try {
      // 1. Fetch CSRF token
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const csrfData = await csrfRes.json()
        csrfToken = csrfData.token
      }

      // 2. Submit transfer
      const res = await fetch("/api/vps/coins/transfer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        credentials: "same-origin",
        body: JSON.stringify({
          recipient: recipient.trim(),
          amount: parsedAmount,
          reason: reason.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Failed to transfer coins.")
      }

      toast.success(
        `Transferred ${parsedAmount.toLocaleString()} coins to @${data.recipient?.username || recipient}!`,
        {
          description: `Your remaining balance: ${remainingBalance.toLocaleString()} coins`,
        }
      )

      onSuccess?.()
      onOpenChange(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error processing coin transfer")
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
            <DialogTitle className="text-lg font-bold">Transfer Coins</DialogTitle>
          </div>
          <DialogDescription className="text-zinc-400 text-xs">
            Send coins instantly to another account using their Discord username or account ID.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Current Balance Bar */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-zinc-800">
            <span className="text-xs text-zinc-400">Available Balance:</span>
            <div className="flex items-center gap-1.5 font-mono text-sm font-semibold text-amber-400">
              <Coins className="size-4" />
              <span>{currentBalance.toLocaleString()} coins</span>
            </div>
          </div>

          {/* Recipient Field */}
          <div className="space-y-1.5">
            <Label htmlFor="transfer-recipient" className="text-xs text-zinc-300 font-medium">
              Recipient Username or ID <span className="text-red-400">*</span>
            </Label>
            <Input
              id="transfer-recipient"
              placeholder="e.g. voidflamer or user ID"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="bg-zinc-900 border-zinc-700 font-mono text-sm"
              disabled={isSubmitting}
              required
            />
          </div>

          {/* Amount Field */}
          <div className="space-y-1.5">
            <Label htmlFor="transfer-amount" className="text-xs text-zinc-300 font-medium">
              Amount to Transfer <span className="text-red-400">*</span>
            </Label>
            <div className="relative">
              <Coins className="size-4 text-amber-400 absolute left-2.5 top-2.5" />
              <Input
                id="transfer-amount"
                type="number"
                min="1"
                max={currentBalance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-8 bg-zinc-900 border-zinc-700 font-mono text-sm"
                disabled={isSubmitting}
                required
              />
            </div>

            {/* Quick Amount Pills */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              {PRESET_AMOUNTS.filter((p) => p <= currentBalance).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmount(String(preset))}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                    amount === String(preset)
                      ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  +{preset.toLocaleString()}
                </button>
              ))}
              {currentBalance > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(String(currentBalance))}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                    amount === String(currentBalance)
                      ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Max ({currentBalance.toLocaleString()})
                </button>
              )}
            </div>
          </div>

          {/* Optional Reason */}
          <div className="space-y-1.5">
            <Label htmlFor="transfer-reason" className="text-xs text-zinc-300 font-medium">
              Note / Reason (Optional)
            </Label>
            <Input
              id="transfer-reason"
              placeholder="e.g. VPS sharing, hosting split"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="bg-zinc-900 border-zinc-700 text-sm"
              disabled={isSubmitting}
              maxLength={100}
            />
          </div>

          {/* Balance Preview */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-xs font-mono">
            <div className="flex flex-col gap-0.5">
              <span className="text-zinc-500">Remaining</span>
              <span className="text-zinc-300 font-semibold">
                {remainingBalance.toLocaleString()} coins
              </span>
            </div>
            <ArrowRight className="size-4 text-zinc-600" />
            <div className="flex flex-col gap-0.5 text-right">
              <span className="text-zinc-500">Sending</span>
              <span className="text-amber-400 font-semibold">
                -{isValidAmount ? parsedAmount.toLocaleString() : 0} coins
              </span>
            </div>
          </div>

          <DialogFooter className="pt-2 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="border-zinc-700 bg-zinc-900 text-zinc-300"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!recipient.trim() || !isValidAmount || isSubmitting}
              className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin mr-1.5" /> Sending...
                </>
              ) : (
                <>
                  <Send className="size-3.5 mr-1.5" /> Transfer Now
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
