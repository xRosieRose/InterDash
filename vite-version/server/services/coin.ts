/**
 * InterDash Server — Coin Economy Service
 *
 * Single authoritative mutation boundary for virtual coins.
 * Guarantees:
 * - Atomic balance updates
 * - Immutable append-only ledger (coin_transactions)
 * - Strict non-negative balance constraint
 * - Safe integer validation (no floating point)
 * - Idempotency key tracking
 * - Integrity verification against ledger history
 */

import { v4 as uuidv4 } from "uuid";
import { queryOne, queryAll, execute, transaction } from "../db/index.js";

export const MAX_SINGLE_COIN_AMOUNT = 1_000_000_000; // 1 billion max per single grant
export const MAX_REASON_LENGTH = 255;
export const MAX_DESCRIPTION_LENGTH = 1000;

export type CoinTransactionType =
  | "admin_grant"
  | "admin_adjustment"
  | "deployment_charge"
  | "refund"
  | "reward"
  | "bonus"
  | "deduction"
  | "reversal"
  | "transfer_in"
  | "transfer_out";

export interface TransferCoinsParams {
  fromUserId: string;
  toUsernameOrId: string;
  amount: number;
  reason?: string | null;
  idempotencyKey?: string | null;
}

export interface CoinAccount {
  id: string;
  user_id: string;
  balance: number;
  created_at: string;
  updated_at: string;
}

export interface CoinTransaction {
  id: string;
  user_id: string;
  type: CoinTransactionType;
  amount: number;
  balance_before: number;
  balance_after: number;
  reason: string;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  idempotency_key: string | null;
  created_by_user_id: string | null;
  metadata: string | null;
  created_at: string;
}

export interface GrantCoinsParams {
  userId: string;
  amount: number;
  reason: string;
  description?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey?: string | null;
  adminUserId?: string | null;
  metadata?: Record<string, any> | null;
}

export interface DebitCoinsParams {
  userId: string;
  amount: number;
  reason: string;
  description?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, any> | null;
}

export interface RefundCoinsParams {
  userId: string;
  amount: number;
  reason: string;
  description?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, any> | null;
}

export interface CoinTransactionQuery {
  page?: number;
  pageSize?: number;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CoinTransactionsResult {
  transactions: CoinTransaction[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface AccountIntegrityResult {
  valid: boolean;
  accountBalance: number;
  ledgerSum: number;
  discrepancy: number;
}

export class CoinError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode: number = 400) {
    super(message);
    this.name = "CoinError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class CoinService {
  /**
   * Ensure a coin account exists for the given user, creating one with balance 0 if missing.
   */
  static getOrCreateAccount(userId: string): CoinAccount {
    if (!userId || typeof userId !== "string") {
      throw new CoinError("Invalid user ID", "COIN_USER_NOT_FOUND", 400);
    }

    // Verify user exists in the users table
    const user = queryOne<{ id: string }>("SELECT id FROM users WHERE id = ?", [userId]);
    if (!user) {
      throw new CoinError("User not found", "COIN_USER_NOT_FOUND", 404);
    }

    const existing = queryOne<CoinAccount>(
      "SELECT id, user_id, balance, created_at, updated_at FROM coin_accounts WHERE user_id = ?",
      [userId]
    );

    if (existing) {
      return existing;
    }

    // Create a new account with 0 balance
    const accountId = uuidv4();
    execute(
      `INSERT OR IGNORE INTO coin_accounts (id, user_id, balance, created_at, updated_at)
       VALUES (?, ?, 0, datetime('now'), datetime('now'))`,
      [accountId, userId]
    );

    const created = queryOne<CoinAccount>(
      "SELECT id, user_id, balance, created_at, updated_at FROM coin_accounts WHERE user_id = ?",
      [userId]
    );

    if (!created) {
      throw new CoinError("Failed to initialize coin account", "COIN_ACCOUNT_CREATION_FAILED", 500);
    }

    return created;
  }

  /**
   * Get the current coin balance for a user. Returns 0 if account was just created.
   */
  static getBalance(userId: string): number {
    const account = this.getOrCreateAccount(userId);
    return account.balance;
  }

  /**
   * Grant virtual coins to a user balance by an administrator.
   * Atomic, ledger-backed, and idempotent.
   */
  static grantCoins(params: GrantCoinsParams): {
    transaction: CoinTransaction;
    account: CoinAccount;
    isCached?: boolean;
  } {
    const {
      userId,
      amount,
      reason,
      description,
      referenceType,
      referenceId,
      idempotencyKey,
      adminUserId,
      metadata,
    } = params;

    // 1. Validate userId & ensure user exists
    if (!userId || typeof userId !== "string") {
      throw new CoinError("Target user ID is required", "COIN_USER_NOT_FOUND", 400);
    }

    const user = queryOne<{ id: string; username: string }>(
      "SELECT id, username FROM users WHERE id = ?",
      [userId]
    );
    if (!user) {
      throw new CoinError("Target user does not exist", "COIN_USER_NOT_FOUND", 404);
    }

    // 2. Validate amount: positive integer, within limits
    if (
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      amount <= 0
    ) {
      throw new CoinError(
        "Coin grant amount must be a positive whole integer",
        "INVALID_COIN_AMOUNT",
        400
      );
    }

    if (amount > MAX_SINGLE_COIN_AMOUNT) {
      throw new CoinError(
        `Coin amount exceeds the maximum allowable single grant of ${MAX_SINGLE_COIN_AMOUNT.toLocaleString()} coins`,
        "COIN_AMOUNT_TOO_LARGE",
        400
      );
    }

    // 3. Validate reason
    const trimmedReason = (reason || "").trim();
    if (!trimmedReason) {
      throw new CoinError("A grant reason is required", "INVALID_COIN_REASON", 400);
    }
    if (trimmedReason.length > MAX_REASON_LENGTH) {
      throw new CoinError(
        `Reason cannot exceed ${MAX_REASON_LENGTH} characters`,
        "INVALID_COIN_REASON",
        400
      );
    }

    const trimmedDescription = description ? description.trim().substring(0, MAX_DESCRIPTION_LENGTH) : null;

    // 4. Validate admin user if provided
    if (adminUserId) {
      const admin = queryOne<{ id: string }>("SELECT id FROM users WHERE id = ?", [adminUserId]);
      if (!admin) {
        throw new CoinError("Admin user not found", "ADMIN_USER_NOT_FOUND", 404);
      }
    }

    // 5. Check idempotency key if supplied
    const cleanIdempotencyKey = idempotencyKey ? idempotencyKey.trim() : null;
    if (cleanIdempotencyKey) {
      const existingTx = queryOne<CoinTransaction>(
        "SELECT * FROM coin_transactions WHERE idempotency_key = ?",
        [cleanIdempotencyKey]
      );

      if (existingTx) {
        // If parameters match, return existing transaction safely (idempotent replay)
        if (
          existingTx.user_id === userId &&
          existingTx.amount === amount &&
          existingTx.reason === trimmedReason
        ) {
          const currentAccount = this.getOrCreateAccount(userId);
          return {
            transaction: existingTx,
            account: currentAccount,
            isCached: true,
          };
        }

        // Conflict: same idempotency key used with mismatched payload
        throw new CoinError(
          "Idempotency key has already been used for a different transaction request",
          "COIN_IDEMPOTENCY_CONFLICT",
          409
        );
      }
    }

    // 6. Atomic Mutation inside DB transaction
    return transaction(() => {
      // Ensure account exists
      const currentAccount = this.getOrCreateAccount(userId);
      const balanceBefore = currentAccount.balance;
      const balanceAfter = balanceBefore + amount;

      // Update account balance atomically with guard
      execute(
        `UPDATE coin_accounts
         SET balance = balance + ?, updated_at = datetime('now')
         WHERE user_id = ? AND (balance + ?) >= 0`,
        [amount, userId, amount]
      );

      // Verify account update succeeded
      const updatedAccount = queryOne<CoinAccount>(
        "SELECT id, user_id, balance, created_at, updated_at FROM coin_accounts WHERE user_id = ?",
        [userId]
      );

      if (!updatedAccount || updatedAccount.balance !== balanceAfter) {
        throw new CoinError("Failed to update account balance atomically", "COIN_INTEGRITY_ERROR", 500);
      }

      // Create ledger transaction
      const txId = uuidv4();
      const metadataStr = metadata ? JSON.stringify(metadata) : null;

      execute(
        `INSERT INTO coin_transactions (
           id, user_id, type, amount, balance_before, balance_after,
           reason, description, reference_type, reference_id,
           idempotency_key, created_by_user_id, metadata, created_at
         ) VALUES (?, ?, 'admin_grant', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          txId,
          userId,
          amount,
          balanceBefore,
          balanceAfter,
          trimmedReason,
          trimmedDescription,
          referenceType || null,
          referenceId || null,
          cleanIdempotencyKey,
          adminUserId || null,
          metadataStr,
        ]
      );

      const createdTx = queryOne<CoinTransaction>(
        "SELECT * FROM coin_transactions WHERE id = ?",
        [txId]
      );

      if (!createdTx) {
        throw new CoinError("Failed to write ledger transaction", "COIN_LEDGER_WRITE_FAILED", 500);
      }

      // Record in system audit logs
      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata, created_at)
         VALUES (?, 'coin_grant', ?, datetime('now'))`,
        [
          adminUserId || null,
          JSON.stringify({
            target_user_id: userId,
            target_username: user.username,
            amount,
            reason: trimmedReason,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            transaction_id: txId,
            idempotency_key: cleanIdempotencyKey,
          }),
        ]
      );

      return {
        transaction: createdTx,
        account: updatedAccount,
        isCached: false,
      };
    });
  }

  /**
   * Query paginated transaction history for a user.
   */
  static getTransactions(userId: string, query: CoinTransactionQuery = {}): CoinTransactionsResult {
    // Ensure account exists
    this.getOrCreateAccount(userId);

    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(query.pageSize) || 20)));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ["user_id = ?"];
    const params: any[] = [userId];

    if (query.type && typeof query.type === "string") {
      conditions.push("type = ?");
      params.push(query.type);
    }

    if (query.dateFrom && typeof query.dateFrom === "string") {
      conditions.push("created_at >= ?");
      params.push(query.dateFrom);
    }

    if (query.dateTo && typeof query.dateTo === "string") {
      conditions.push("created_at <= ?");
      params.push(query.dateTo);
    }

    const whereClause = conditions.join(" AND ");

    // Count total matching transactions
    const countRow = queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM coin_transactions WHERE ${whereClause}`,
      params
    );
    const total = countRow?.count || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // Fetch transactions
    const transactions = queryAll<CoinTransaction>(
      `SELECT * FROM coin_transactions
       WHERE ${whereClause}
       ORDER BY created_at DESC, rowid DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return {
      transactions,
      pagination: {
        total,
        page,
        pageSize,
        totalPages,
      },
    };
  }

  /**
   * Verify that a user's account balance matches the net sum of all immutable ledger entries.
   */
  static verifyAccountIntegrity(userId: string): AccountIntegrityResult {
    const account = this.getOrCreateAccount(userId);

    const sumRow = queryOne<{ net_sum: number | null }>(
      "SELECT SUM(amount) as net_sum FROM coin_transactions WHERE user_id = ?",
      [userId]
    );

    const ledgerSum = sumRow?.net_sum != null ? Number(sumRow.net_sum) : 0;
    const discrepancy = account.balance - ledgerSum;

    return {
      valid: discrepancy === 0,
      accountBalance: account.balance,
      ledgerSum,
      discrepancy,
    };
  }

  /**
   * Atomically debit coins from a user account for deployment charges or authorized deductions.
   * Enforces strictly positive amount, non-negative balance, immutable ledger write, and idempotency.
   */
  static debitCoins(params: DebitCoinsParams): {
    transaction: CoinTransaction;
    account: CoinAccount;
    isCached?: boolean;
  } {
    const {
      userId,
      amount,
      reason,
      description,
      referenceType,
      referenceId,
      idempotencyKey,
      metadata,
    } = params;

    // 1. Validate userId
    if (!userId || typeof userId !== "string") {
      throw new CoinError("User ID is required", "COIN_USER_NOT_FOUND", 400);
    }

    const user = queryOne<{ id: string; username: string }>(
      "SELECT id, username FROM users WHERE id = ?",
      [userId]
    );
    if (!user) {
      throw new CoinError("Target user does not exist", "COIN_USER_NOT_FOUND", 404);
    }

    // 2. Validate amount: positive safe integer
    if (
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      amount <= 0
    ) {
      throw new CoinError(
        "Coin debit amount must be a positive whole integer",
        "INVALID_COIN_AMOUNT",
        400
      );
    }

    if (amount > MAX_SINGLE_COIN_AMOUNT) {
      throw new CoinError(
        `Coin amount exceeds the maximum allowable single transaction of ${MAX_SINGLE_COIN_AMOUNT.toLocaleString()} coins`,
        "COIN_AMOUNT_TOO_LARGE",
        400
      );
    }

    // 3. Validate reason
    const trimmedReason = (reason || "").trim();
    if (!trimmedReason) {
      throw new CoinError("A debit reason is required", "INVALID_COIN_REASON", 400);
    }
    const trimmedDescription = description ? description.trim().substring(0, MAX_DESCRIPTION_LENGTH) : null;

    // 4. Idempotency check
    const cleanIdempotencyKey = idempotencyKey ? idempotencyKey.trim() : null;
    if (cleanIdempotencyKey) {
      const existingTx = queryOne<CoinTransaction>(
        "SELECT * FROM coin_transactions WHERE idempotency_key = ?",
        [cleanIdempotencyKey]
      );

      if (existingTx) {
        if (
          existingTx.user_id === userId &&
          Math.abs(existingTx.amount) === amount &&
          existingTx.type === "deployment_charge"
        ) {
          const currentAccount = this.getOrCreateAccount(userId);
          return {
            transaction: existingTx,
            account: currentAccount,
            isCached: true,
          };
        }

        throw new CoinError(
          "Idempotency key has already been used for a different transaction request",
          "COIN_IDEMPOTENCY_CONFLICT",
          409
        );
      }
    }

    // Also check if reference already charged
    if (referenceType && referenceId) {
      const existingRefTx = queryOne<CoinTransaction>(
        "SELECT * FROM coin_transactions WHERE reference_type = ? AND reference_id = ? AND type = 'deployment_charge' LIMIT 1",
        [referenceType, referenceId]
      );
      if (existingRefTx) {
        const currentAccount = this.getOrCreateAccount(userId);
        return {
          transaction: existingRefTx,
          account: currentAccount,
          isCached: true,
        };
      }
    }

    // 5. Atomic debit mutation
    return transaction(() => {
      const currentAccount = this.getOrCreateAccount(userId);
      const balanceBefore = currentAccount.balance;

      if (balanceBefore < amount) {
        const err = new CoinError(
          `Insufficient coins. Required: ${amount}, Available: ${balanceBefore}.`,
          "INSUFFICIENT_COINS",
          400
        );
        (err as any).currentBalance = balanceBefore;
        (err as any).requiredCoins = amount;
        throw err;
      }

      const balanceAfter = balanceBefore - amount;

      // Atomic update with strict guard: balance >= amount
      execute(
        `UPDATE coin_accounts
         SET balance = balance - ?, updated_at = datetime('now')
         WHERE user_id = ? AND balance >= ?`,
        [amount, userId, amount]
      );

      const updatedAccount = queryOne<CoinAccount>(
        "SELECT id, user_id, balance, created_at, updated_at FROM coin_accounts WHERE user_id = ?",
        [userId]
      );

      if (!updatedAccount || updatedAccount.balance !== balanceAfter) {
        throw new CoinError("Failed to debit coin account atomically", "COIN_INTEGRITY_ERROR", 500);
      }

      const txId = uuidv4();
      const metadataStr = metadata ? JSON.stringify(metadata) : null;

      // Negative amount for debit in ledger
      execute(
        `INSERT INTO coin_transactions (
           id, user_id, type, amount, balance_before, balance_after,
           reason, description, reference_type, reference_id,
           idempotency_key, created_by_user_id, metadata, created_at
         ) VALUES (?, ?, 'deployment_charge', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, datetime('now'))`,
        [
          txId,
          userId,
          -amount,
          balanceBefore,
          balanceAfter,
          trimmedReason,
          trimmedDescription,
          referenceType || null,
          referenceId || null,
          cleanIdempotencyKey,
          metadataStr,
        ]
      );

      const createdTx = queryOne<CoinTransaction>(
        "SELECT * FROM coin_transactions WHERE id = ?",
        [txId]
      );

      if (!createdTx) {
        throw new CoinError("Failed to record debit transaction in ledger", "COIN_LEDGER_WRITE_FAILED", 500);
      }

      // Audit log
      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata, created_at)
         VALUES (?, 'coin_debit', ?, datetime('now'))`,
        [
          userId,
          JSON.stringify({
            target_user_id: userId,
            target_username: user.username,
            amount: -amount,
            reason: trimmedReason,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            transaction_id: txId,
            reference_type: referenceType || null,
            reference_id: referenceId || null,
            idempotency_key: cleanIdempotencyKey,
          }),
        ]
      );

      return {
        transaction: createdTx,
        account: updatedAccount,
        isCached: false,
      };
    });
  }

  /**
   * Compensating refund for failed deployments or reversed debits.
   * Atomically credits coins back, records immutable 'refund' transaction, and enforces refund idempotency.
   */
  static refundCoins(params: RefundCoinsParams): {
    transaction: CoinTransaction;
    account: CoinAccount;
    isCached?: boolean;
  } {
    const {
      userId,
      amount,
      reason,
      description,
      referenceType,
      referenceId,
      idempotencyKey,
      metadata,
    } = params;

    // 1. Validate userId
    if (!userId || typeof userId !== "string") {
      throw new CoinError("User ID is required", "COIN_USER_NOT_FOUND", 400);
    }

    const user = queryOne<{ id: string; username: string }>(
      "SELECT id, username FROM users WHERE id = ?",
      [userId]
    );
    if (!user) {
      throw new CoinError("Target user does not exist", "COIN_USER_NOT_FOUND", 404);
    }

    // 2. Validate amount: positive safe integer
    if (
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      amount <= 0
    ) {
      throw new CoinError(
        "Refund amount must be a positive whole integer",
        "INVALID_COIN_AMOUNT",
        400
      );
    }

    // 3. Idempotency check: key or reference check
    const cleanIdempotencyKey = idempotencyKey ? idempotencyKey.trim() : null;
    if (cleanIdempotencyKey) {
      const existingTx = queryOne<CoinTransaction>(
        "SELECT * FROM coin_transactions WHERE idempotency_key = ?",
        [cleanIdempotencyKey]
      );

      if (existingTx) {
        const currentAccount = this.getOrCreateAccount(userId);
        return {
          transaction: existingTx,
          account: currentAccount,
          isCached: true,
        };
      }
    }

    // Check if reference already refunded!
    if (referenceType && referenceId) {
      const existingRefund = queryOne<CoinTransaction>(
        "SELECT * FROM coin_transactions WHERE reference_type = ? AND reference_id = ? AND type = 'refund' LIMIT 1",
        [referenceType, referenceId]
      );
      if (existingRefund) {
        const currentAccount = this.getOrCreateAccount(userId);
        return {
          transaction: existingRefund,
          account: currentAccount,
          isCached: true,
        };
      }
    }

    const trimmedReason = (reason || "Deployment failure refund").trim();
    const trimmedDescription = description ? description.trim().substring(0, MAX_DESCRIPTION_LENGTH) : null;

    // 4. Atomic refund mutation
    return transaction(() => {
      const currentAccount = this.getOrCreateAccount(userId);
      const balanceBefore = currentAccount.balance;
      const balanceAfter = balanceBefore + amount;

      execute(
        `UPDATE coin_accounts
         SET balance = balance + ?, updated_at = datetime('now')
         WHERE user_id = ?`,
        [amount, userId]
      );

      const updatedAccount = queryOne<CoinAccount>(
        "SELECT id, user_id, balance, created_at, updated_at FROM coin_accounts WHERE user_id = ?",
        [userId]
      );

      if (!updatedAccount || updatedAccount.balance !== balanceAfter) {
        throw new CoinError("Failed to update account balance for refund", "COIN_INTEGRITY_ERROR", 500);
      }

      const txId = uuidv4();
      const metadataStr = metadata ? JSON.stringify(metadata) : null;

      // Positive amount for refund in ledger
      execute(
        `INSERT INTO coin_transactions (
           id, user_id, type, amount, balance_before, balance_after,
           reason, description, reference_type, reference_id,
           idempotency_key, created_by_user_id, metadata, created_at
         ) VALUES (?, ?, 'refund', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, datetime('now'))`,
        [
          txId,
          userId,
          amount,
          balanceBefore,
          balanceAfter,
          trimmedReason,
          trimmedDescription,
          referenceType || null,
          referenceId || null,
          cleanIdempotencyKey,
          metadataStr,
        ]
      );

      const createdTx = queryOne<CoinTransaction>(
        "SELECT * FROM coin_transactions WHERE id = ?",
        [txId]
      );

      if (!createdTx) {
        throw new CoinError("Failed to write refund transaction into ledger", "COIN_LEDGER_WRITE_FAILED", 500);
      }

      // Audit log
      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata, created_at)
         VALUES (?, 'coin_refund', ?, datetime('now'))`,
        [
          userId,
          JSON.stringify({
            target_user_id: userId,
            target_username: user.username,
            amount: amount,
            reason: trimmedReason,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            transaction_id: txId,
            reference_type: referenceType || null,
            reference_id: referenceId || null,
            idempotency_key: cleanIdempotencyKey,
          }),
        ]
      );

      return {
        transaction: createdTx,
        account: updatedAccount,
        isCached: false,
      };
    });
  }

  /**
   * Transfer coins atomically between two users.
   * Decrements sender, increments recipient, writes linked ledger records, and saves immediately.
   */
  static transferCoins(params: TransferCoinsParams): {
    success: boolean;
    transferId: string;
    amount: number;
    sender: { id: string; username: string; newBalance: number };
    recipient: { id: string; username: string; newBalance: number };
    senderTransaction: CoinTransaction;
    recipientTransaction: CoinTransaction;
  } {
    const { fromUserId, toUsernameOrId, amount, reason, idempotencyKey } = params;

    // 1. Validate sender
    if (!fromUserId || typeof fromUserId !== "string") {
      throw new CoinError("Sender user ID is required", "COIN_USER_NOT_FOUND", 400);
    }
    const fromUser = queryOne<{ id: string; username: string }>(
      "SELECT id, username FROM users WHERE id = ?",
      [fromUserId]
    );
    if (!fromUser) {
      throw new CoinError("Sender account not found", "COIN_USER_NOT_FOUND", 404);
    }

    // 2. Validate amount
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
      throw new CoinError("Transfer amount must be a positive whole number", "INVALID_COIN_AMOUNT", 400);
    }
    if (amount > MAX_SINGLE_COIN_AMOUNT) {
      throw new CoinError(
        `Transfer amount cannot exceed ${MAX_SINGLE_COIN_AMOUNT.toLocaleString()} coins`,
        "COIN_AMOUNT_TOO_LARGE",
        400
      );
    }

    // 3. Validate recipient
    const cleanRecipient = (toUsernameOrId || "").trim();
    if (!cleanRecipient) {
      throw new CoinError("Recipient username or ID is required", "RECIPIENT_REQUIRED", 400);
    }

    const toUser = queryOne<{ id: string; username: string }>(
      "SELECT id, username FROM users WHERE id = ? OR LOWER(username) = LOWER(?) LIMIT 1",
      [cleanRecipient, cleanRecipient]
    );
    if (!toUser) {
      throw new CoinError(`Recipient '${cleanRecipient}' was not found.`, "RECIPIENT_NOT_FOUND", 404);
    }

    if (fromUser.id === toUser.id) {
      throw new CoinError("Cannot transfer coins to your own account", "SELF_TRANSFER_PROHIBITED", 400);
    }

    // Ensure accounts exist
    const senderAccount = this.getOrCreateAccount(fromUser.id);
    const recipientAccount = this.getOrCreateAccount(toUser.id);

    if (senderAccount.balance < amount) {
      const err = new CoinError(
        `Insufficient coins. You have ${senderAccount.balance.toLocaleString()} coins, but tried to transfer ${amount.toLocaleString()} coins.`,
        "INSUFFICIENT_COINS",
        400
      );
      (err as any).currentBalance = senderAccount.balance;
      (err as any).requiredCoins = amount;
      throw err;
    }

    const cleanReason = (reason || "").trim().substring(0, MAX_REASON_LENGTH) || `Coin transfer to @${toUser.username}`;
    const cleanIdempotencyKey = idempotencyKey ? idempotencyKey.trim().substring(0, 128) : null;

    return transaction(() => {
      // Re-read sender in transaction for strict concurrency
      const freshSender = this.getOrCreateAccount(fromUser.id);
      if (freshSender.balance < amount) {
        throw new CoinError(
          `Insufficient coins. Available: ${freshSender.balance}, required: ${amount}.`,
          "INSUFFICIENT_COINS",
          400
        );
      }

      const senderBefore = freshSender.balance;
      const senderAfter = senderBefore - amount;
      const recipientBefore = recipientAccount.balance;
      const recipientAfter = recipientBefore + amount;

      // 1. Debit sender
      execute(
        `UPDATE coin_accounts
         SET balance = balance - ?, updated_at = datetime('now')
         WHERE user_id = ? AND balance >= ?`,
        [amount, fromUser.id, amount]
      );

      // 2. Credit recipient
      execute(
        `UPDATE coin_accounts
         SET balance = balance + ?, updated_at = datetime('now')
         WHERE user_id = ?`,
        [amount, toUser.id]
      );

      const transferId = uuidv4();
      const senderTxId = uuidv4();
      const recipientTxId = uuidv4();

      // 3. Sender transaction ledger entry (transfer_out)
      execute(
        `INSERT INTO coin_transactions (
           id, user_id, type, amount, balance_before, balance_after,
           reason, description, reference_type, reference_id,
           idempotency_key, created_by_user_id, metadata, created_at
         ) VALUES (?, ?, 'transfer_out', ?, ?, ?, ?, ?, 'coin_transfer', ?, ?, ?, ?, datetime('now'))`,
        [
          senderTxId,
          fromUser.id,
          -amount,
          senderBefore,
          senderAfter,
          cleanReason,
          `Transferred ${amount} coins to @${toUser.username}`,
          transferId,
          cleanIdempotencyKey ? `${cleanIdempotencyKey}_out` : null,
          fromUser.id,
          JSON.stringify({ recipient_id: toUser.id, recipient_username: toUser.username }),
        ]
      );

      // 4. Recipient transaction ledger entry (transfer_in)
      execute(
        `INSERT INTO coin_transactions (
           id, user_id, type, amount, balance_before, balance_after,
           reason, description, reference_type, reference_id,
           idempotency_key, created_by_user_id, metadata, created_at
         ) VALUES (?, ?, 'transfer_in', ?, ?, ?, ?, ?, 'coin_transfer', ?, ?, ?, ?, datetime('now'))`,
        [
          recipientTxId,
          toUser.id,
          amount,
          recipientBefore,
          recipientAfter,
          `Received from @${fromUser.username}: ${cleanReason}`,
          `Received ${amount} coins from @${fromUser.username}`,
          transferId,
          cleanIdempotencyKey ? `${cleanIdempotencyKey}_in` : null,
          fromUser.id,
          JSON.stringify({ sender_id: fromUser.id, sender_username: fromUser.username }),
        ]
      );

      const senderTx = queryOne<CoinTransaction>("SELECT * FROM coin_transactions WHERE id = ?", [senderTxId])!;
      const recipientTx = queryOne<CoinTransaction>("SELECT * FROM coin_transactions WHERE id = ?", [recipientTxId])!;

      // Audit log
      execute(
        `INSERT INTO audit_logs (user_id, event_type, metadata, created_at)
         VALUES (?, 'coin_transfer', ?, datetime('now'))`,
        [
          fromUser.id,
          JSON.stringify({
            transfer_id: transferId,
            from_user_id: fromUser.id,
            from_username: fromUser.username,
            to_user_id: toUser.id,
            to_username: toUser.username,
            amount,
            reason: cleanReason,
          }),
        ]
      );

      return {
        success: true,
        transferId,
        amount,
        sender: {
          id: fromUser.id,
          username: fromUser.username,
          newBalance: senderAfter,
        },
        recipient: {
          id: toUser.id,
          username: toUser.username,
          newBalance: recipientAfter,
        },
        senderTransaction: senderTx,
        recipientTransaction: recipientTx,
      };
    });
  }

  /**
   * Stub for generic credit operations (reserved for non-admin promotional systems).
   */
  static creditCoins(_params: { userId: string; amount: number; reason: string }): never {
    throw new CoinError(
      "Generic coin crediting is not enabled. Use admin grants or deployment refunds.",
      "COIN_OPERATION_FORBIDDEN",
      403
    );
  }
}
