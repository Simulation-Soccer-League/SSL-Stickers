import type { NextApiRequest, NextApiResponse } from "next";
import { apiRoute, requireUser } from "../../../server/api.ts";
import { ownedGroupCount } from "../../../server/services/collection.ts";

// GET /api/v1/get_user_card_count: number of distinct cards the session user owns.
async function count(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;
  res.status(200).json(await ownedGroupCount(user.id));
}

export default apiRoute({ GET: count });
