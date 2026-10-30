import type { NextApiRequest, NextApiResponse } from "next";
import { apiRoute, requireUser } from "../../../server/api.ts";
import { NoCardsForRarityError } from "../../../server/services/cards.ts";
import { NoPacksError, openPack } from "../../../server/services/packs.ts";

// POST /api/v1/pack: opens one of the session user's packs.
async function open(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    res.status(200).json(await openPack(user.id));
  } catch (error) {
    if (error instanceof NoPacksError) {
      res.status(422).json({ error: error.message });
    } else if (error instanceof NoCardsForRarityError) {
      // Rolled back: the pack is not consumed.
      res.status(503).json({ error: `${error.message}; your pack was not used` });
    } else {
      throw error;
    }
  }
}

export default apiRoute({ POST: open });
