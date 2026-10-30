import type { NextApiRequest, NextApiResponse } from "next";
import { apiRoute, bodyString, requireUser } from "../../../../server/api.ts";
import { TradeError, createTrade, listTrades } from "../../../../server/services/trades.ts";

// GET /api/v1/trades: the session user's pending trades (parallel arrays) and trade history.
async function index(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;
  res.status(200).json(await listTrades(user.id));
}

// POST /api/v1/trades (JSON {combinedCards: [uuid], receiver: username}).
async function create(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const trade = await createTrade(user.id, bodyString(req, "receiver"), (req.body ?? {}).combinedCards);
    res.status(201).json(trade);
  } catch (error) {
    if (!(error instanceof TradeError)) throw error;
    res.status(error.status).json(error.body());
  }
}

export default apiRoute({ GET: index, POST: create });
