import type { NextApiRequest, NextApiResponse } from "next";
import { apiRoute, requireUser } from "../../../server/api.ts";
import { ownedCardsPage, parsePagination } from "../../../server/services/collection.ts";

const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

// GET /api/v1/user_cards?page&per_page&sort: the session user's grouped cards.
async function index(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;
  const pagination = parsePagination(param(req.query.page), param(req.query.per_page));
  res.status(200).json(await ownedCardsPage(user.id, param(req.query.sort), pagination));
}

export default apiRoute({ GET: index });
