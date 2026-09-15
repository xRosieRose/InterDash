/**
 * InterDash Server — API v1 Virtual Coin Economy Control Plane
 *
 * Provides external REST endpoints for reading coin balances,
 * ledger transaction histories, and issuing administrative grants.
 * Protected by dedicated economy scopes: coins:read, coins:write.
 */

import { Router, type Request, type Response } from "express";
import { requireApiKey, requireApiScope } from "../../middleware/api-auth.js";
import { apiRateLimit } from "../../middleware/api-rate-limit.js";
import { apiSuccess, apiCollection, apiError } from "../../middleware/api-envelope.js";
import { SCOPES } from "../../services/api-scopes.js";
import { CoinService, CoinError } from "../../services/coin.js";

const router = Router();
router.use(requireApiKey);

// ============================================================================
// GET /api/v1/coins/:userId — Get User Coin Balance & Account
// ============================================================================
router.get(
  "/:userId",
  requireApiScope(SCOPES.COINS_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const { userId } = req.params;

    try {
      const account = CoinService.getOrCreateAccount(userId);
      const integrity = CoinService.verifyAccountIntegrity(userId);

      apiSuccess(res, {
        userId: account.user_id,
        balance: account.balance,
        accountId: account.id,
        createdAt: account.created_at,
        updatedAt: account.updated_at,
        integrity: {
          valid: integrity.valid,
          ledgerSum: integrity.ledgerSum,
        },
      });
    } catch (err: any) {
      if (err instanceof CoinError) {
        apiError(res, err.statusCode, err.code, err.message);
        return;
      }
      apiError(res, 500, "INTERNAL_ERROR", "Failed to retrieve coin balance.");
    }
  }
);

// ============================================================================
// GET /api/v1/coins/:userId/transactions — User Transaction Ledger
// ============================================================================
router.get(
  "/:userId/transactions",
  requireApiScope(SCOPES.COINS_READ),
  apiRateLimit("standard"),
  (req: Request, res: Response) => {
    const { userId } = req.params;
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "20", 10)));
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;

    try {
      const result = CoinService.getTransactions(userId, {
        page,
        pageSize,
        type,
        dateFrom,
        dateTo,
      });

      const formatted = result.transactions.map((tx) => ({
        id: tx.id,
        userId: tx.user_id,
        type: tx.type,
        amount: tx.amount,
        balanceBefore: tx.balance_before,
        balanceAfter: tx.balance_after,
        reason: tx.reason,
        description: tx.description,
        idempotencyKey: tx.idempotency_key,
        createdByUserId: tx.created_by_user_id,
        createdAt: tx.created_at,
      }));

      apiCollection(res, formatted, {
        page: result.pagination.page,
        pageSize: result.pagination.pageSize,
        total: result.pagination.total,
        hasNext: result.pagination.page < result.pagination.totalPages,
      });
    } catch (err: any) {
      if (err instanceof CoinError) {
        apiError(res, err.statusCode, err.code, err.message);
        return;
      }
      apiError(res, 500, "INTERNAL_ERROR", "Failed to retrieve coin transactions.");
    }
  }
);

// ============================================================================
// POST /api/v1/coins/:userId/grant — Admin Grant Coins to User
// ============================================================================
router.post(
  "/:userId/grant",
  requireApiScope(SCOPES.COINS_WRITE),
  apiRateLimit("heavy"),
  (req: Request, res: Response) => {
    const { userId } = req.params;
    const { amount, reason, description, idempotencyKey, metadata } = req.body || {};

    // Support Idempotency-Key header as fallback
    const headerIdempotencyKey = (req.headers["idempotency-key"] as string) || undefined;
    const effectiveIdempotencyKey = idempotencyKey || headerIdempotencyKey;

    try {
      const result = CoinService.grantCoins({
        userId,
        amount: Number(amount),
        reason: typeof reason === "string" ? reason : "",
        description: typeof description === "string" ? description : null,
        idempotencyKey: effectiveIdempotencyKey,
        adminUserId: (req as any).apiKeyPrincipal?.userId || null,
        metadata: metadata && typeof metadata === "object" ? metadata : null,
      });

      apiSuccess(
        res,
        {
          transaction: {
            id: result.transaction.id,
            userId: result.transaction.user_id,
            type: result.transaction.type,
            amount: result.transaction.amount,
            balanceBefore: result.transaction.balance_before,
            balanceAfter: result.transaction.balance_after,
            reason: result.transaction.reason,
            description: result.transaction.description,
            idempotencyKey: result.transaction.idempotency_key,
            createdAt: result.transaction.created_at,
          },
          balance: result.account.balance,
          isCached: Boolean(result.isCached),
        },
        undefined,
        result.isCached ? 200 : 201
      );
    } catch (err: any) {
      if (err instanceof CoinError) {
        apiError(res, err.statusCode, err.code, err.message);
        return;
      }
      apiError(res, 500, "INTERNAL_ERROR", "Failed to process coin grant.");
    }
  }
);

export default router;
