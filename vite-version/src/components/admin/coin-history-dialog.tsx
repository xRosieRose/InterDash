"use client"

import * as React from "react"
import {
  Coins,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"

interface CoinTransactionRecord {
  id: string
  user_id: string
  type: string
  amount: number
  balance_before: number
  balance_after: number
  reason: string
  description: string | null
  idempotency_key: string | null
  created_by_user_id: string | null
  created_at: string
}

interface CoinHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetUser: {
    id: string
    username: string
  } | null
}

export function CoinHistoryDialog({
  open,
  onOpenChange,
  targetUser,
}: CoinHistoryDialogProps) {
  const [transactions, setTransactions] = React.useState<CoinTransactionRecord[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [page, setPage] = React.useState(1)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalCount, setTotalCount] = React.useState(0)
  const [integrityValid, setIntegrityValid] = React.useState<boolean | null>(null)
  const [currentBalance, setCurrentBalance] = React.useState<number>(0)

  const fetchHistory = React.useCallback(async (targetId: string, pageNum: number) => {
    setIsLoading(true)
    try {
      // 1. Fetch transactions
      const txRes = await fetch(
        `/api/admin/users/${targetId}/coins/transactions?page=${pageNum}&pageSize=10`
      )
      if (!txRes.ok) throw new Error("Failed to load coin transactions.")
      const txData = await txRes.json()

      setTransactions(txData.transactions || [])
      setPage(txData.pagination?.page || 1)
      setTotalPages(txData.pagination?.totalPages || 1)
      setTotalCount(txData.pagination?.total || 0)

      // 2. Fetch account & integrity
      const accRes = await fetch(`/api/admin/users/${targetId}/coins`)
      if (accRes.ok) {
        const accData = await accRes.json()
        setCurrentBalance(accData.account?.balance ?? 0)
        setIntegrityValid(accData.integrity?.valid ?? null)
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error loading ledger history")
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (open && targetUser) {
      setPage(1)
      fetchHistory(targetUser.id, 1)
    }
  }, [open, targetUser, fetchHistory])

  const handlePrevPage = () => {
    if (page > 1 && targetUser) {
      const newPage = page - 1
      setPage(newPage)
      fetchHistory(targetUser.id, newPage)
    }
  }

  const handleNextPage = () => {
    if (page < totalPages && targetUser) {
      const newPage = page + 1
      setPage(newPage)
      fetchHistory(targetUser.id, newPage)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] max-h-[85vh] flex flex-col bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader className="shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-500">
              <Coins className="size-5" />
              <DialogTitle className="text-lg font-bold">
                Coin Ledger History — {targetUser?.username}
              </DialogTitle>
            </div>
            {integrityValid !== null && (
              <Badge
                variant="outline"
                className={`text-[10px] uppercase font-mono ${
                  integrityValid
                    ? "text-emerald-400 border-emerald-500/30 bg-emerald-950/20"
                    : "text-rose-400 border-rose-500/30 bg-rose-950/20"
                }`}
              >
                {integrityValid ? (
                  <>
                    <ShieldCheck className="size-3 mr-1" /> Ledger Verified
                  </>
                ) : (
                  <>
                    <ShieldAlert className="size-3 mr-1" /> Ledger Discrepancy
                  </>
                )}
              </Badge>
            )}
          </div>
          <DialogDescription className="text-xs text-zinc-400">
            Immutable, append-only double-entry transaction record. Current balance:{" "}
            <span className="text-amber-400 font-mono font-semibold">
              {currentBalance.toLocaleString()} coins
            </span>{" "}
            across {totalCount} ledger entry(ies).
          </DialogDescription>
        </DialogHeader>

        {/* Content table */}
        <div className="flex-1 overflow-y-auto min-h-[250px] border border-zinc-800 rounded-lg bg-zinc-900/40 my-2">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-zinc-400 text-xs">
              <Loader2 className="size-5 animate-spin text-amber-500" />
              <span>Querying ledger transactions...</span>
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-zinc-500 text-xs">
              <Clock className="size-8 stroke-[1.5] text-zinc-600" />
              <span>No transactions recorded yet for this user.</span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent text-[11px] text-zinc-400">
                  <TableHead className="w-[140px]">Date (UTC)</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Balance Progression</TableHead>
                  <TableHead>Reason & Context</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => {
                  const isPositive = tx.amount > 0
                  return (
                    <TableRow
                      key={tx.id}
                      className="border-zinc-800/60 hover:bg-zinc-800/30 text-xs"
                    >
                      <TableCell className="font-mono text-[11px] text-zinc-400 whitespace-nowrap">
                        {tx.created_at ? tx.created_at.replace("T", " ").split(".")[0] : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-mono capitalize py-0 ${
                            tx.type === "admin_grant"
                              ? "text-amber-400 border-amber-500/30 bg-amber-950/20"
                              : "text-zinc-400 border-zinc-700"
                          }`}
                        >
                          {tx.type.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono font-bold whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-0.5 ${
                            isPositive ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {isPositive ? (
                            <ArrowUpRight className="size-3" />
                          ) : (
                            <ArrowDownRight className="size-3" />
                          )}
                          {isPositive ? `+${tx.amount.toLocaleString()}` : tx.amount.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-zinc-400 whitespace-nowrap">
                        {tx.balance_before.toLocaleString()} &rarr;{" "}
                        <span className="text-zinc-200 font-semibold">
                          {tx.balance_after.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <p className="font-medium text-zinc-200 truncate">{tx.reason}</p>
                        {tx.description && (
                          <p className="text-[11px] text-zinc-500 truncate" title={tx.description}>
                            {tx.description}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Pagination footer */}
        <div className="flex items-center justify-between pt-2 text-xs text-zinc-400 shrink-0">
          <span>
            Page <span className="text-zinc-200 font-semibold">{page}</span> of{" "}
            <span className="text-zinc-200 font-semibold">{totalPages}</span> ({totalCount} total)
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrevPage}
              disabled={page <= 1 || isLoading}
              className="h-7 text-xs bg-zinc-900 border-zinc-800"
            >
              <ChevronLeft className="size-3.5 mr-0.5" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNextPage}
              disabled={page >= totalPages || isLoading}
              className="h-7 text-xs bg-zinc-900 border-zinc-800"
            >
              Next <ChevronRight className="size-3.5 ml-0.5" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
