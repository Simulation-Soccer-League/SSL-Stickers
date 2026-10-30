import type { NextApiRequest, NextApiResponse } from "next";
import { apiRoute, requireUser } from "../../../server/api.ts";
import { CardType, type CardTypeName } from "../../../server/enums.ts";
import { NoCardsForRarityError } from "../../../server/services/cards.ts";
import { FactoryError, exchange } from "../../../server/services/factory.ts";

// POST /api/v1/factory_pack (JSON {cards: [uuid], rarity}): exchanges the
// listed cards for one random approved card of `rarity`; responds with that original card.
async function factoryPack(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;

  const body = (req.body ?? {}) as { cards?: unknown; rarity?: unknown };
  const cards = (Array.isArray(body.cards) ? body.cards : body.cards == null ? [] : [body.cards]).map(String);
  if (CardType.toValue(body.rarity) === null) {
    res.status(400).json({ error: "Invalid factory rarity" });
    return;
  }

  try {
    res.status(200).json(await exchange(user.id, cards, body.rarity as CardTypeName));
  } catch (error) {
    if (error instanceof FactoryError) {
      res.status(400).json({ error: error.message });
    } else if (error instanceof NoCardsForRarityError) {
      // Rolled back: the selected cards are not consumed.
      res.status(503).json({ error: `${error.message}; your cards were not used` });
    } else {
      throw error;
    }
  }
}

export default apiRoute({ POST: factoryPack });
