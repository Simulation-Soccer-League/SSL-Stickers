import type { NextApiRequest, NextApiResponse } from "next";
import { apiRoute, requireUser } from "../../../../server/api.ts";
import { TradeError, acceptTrade, declineTrade, tradeDetail } from "../../../../server/services/trades.ts";

type Action = (tradeId: number, userId: number, req: NextApiRequest, res: NextApiResponse) => Promise<void>;

// Resolves the session user and trade id, and maps TradeError to its response.
function tradeAction(action: Action) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const id = String(req.query.id ?? "");
    if (!/^\d+$/.test(id)) {
      res.status(404).json({ error: "Trade not found" });
      return;
    }
    try {
      await action(Number(id), user.id, req, res);
    } catch (error) {
      if (!(error instanceof TradeError)) throw error;
      res.status(error.status).json(error.body());
    }
  };
}

// GET /api/v1/trades/:id
const show = tradeAction(async (tradeId, userId, _req, res) => {
  res.status(200).json(await tradeDetail(tradeId, userId));
});

// PATCH/PUT /api/v1/trades/:id (JSON {combinedCards}): accepts the offer; the card set must be unchanged.
const accept = tradeAction(async (tradeId, userId, req, res) => {
  res.status(200).json(await acceptTrade(tradeId, userId, (req.body ?? {}).combinedCards));
});

// DELETE /api/v1/trades/:id: declines or cancels a pending trade.
const decline = tradeAction(async (tradeId, userId, _req, res) => {
  await declineTrade(tradeId, userId);
  res.status(204).end();
});

export default apiRoute({ GET: show, PATCH: accept, PUT: accept, DELETE: decline });
