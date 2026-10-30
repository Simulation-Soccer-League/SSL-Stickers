import type { NextApiRequest, NextApiResponse } from "next";
import { ADMINS, apiRoute, requireRole } from "../../../server/api.ts";
import { unapprovedCards } from "../../../server/services/originalCards.ts";

// GET /api/v1/unapproved: the review queue.
async function list(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireRole(req, res, ADMINS))) return;
  res.status(200).json({ all_cards: await unapprovedCards() });
}

export default apiRoute({ GET: list });
