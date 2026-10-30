import type { NextApiRequest, NextApiResponse } from "next";
import { apiRoute, requireUser } from "../../../server/api.ts";

// GET /api/v1/pack_count
async function packCount(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;
  res.status(200).json({ packs_available: user.packs_available });
}

export default apiRoute({ GET: packCount });
