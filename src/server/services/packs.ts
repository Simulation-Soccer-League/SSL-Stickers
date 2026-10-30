// Pack opening. Port of UserCardsController#pack and PackCreation.
import { randomInt } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { execute, query, withTransaction } from "../db.ts";
import { CardType, type CardTypeName } from "../enums.ts";
import { NoCardsForRarityError, approvedCardsByRarity, grantCard, ownsCard, pick } from "./cards.ts";

export const CARDS_PER_PACK = 5;

// PackCreation#pack_rarities (PR #5 odds): roll in [0, 100):
// Diamond < 0.5 (0.5%), Gold < 3 (2.5%), Silver < 20 (17%), otherwise Bronze (80%).
export function rarityForRoll(roll: number): CardTypeName {
  if (roll < 0.5) return "Diamond";
  if (roll < 3.0) return "Gold";
  if (roll < 20.0) return "Silver";
  return "Bronze";
}

// Cryptographically random roll in [0, 100) with 0.0001 resolution (the thresholds are exact).
export const randomRoll = () => randomInt(1_000_000) / 10_000;

export type PackCard = { public_id: string; rarity: CardTypeName; new_card: boolean };

export class NoPacksError extends Error {}

export async function openPack(userId: number): Promise<{ cards: PackCard[]; packs_available: number }> {
  return withTransaction(async (conn) => {
    // Lock the user row so concurrent requests cannot spend the same pack.
    const [user] = await query<{ packs_available: number } & RowDataPacket>(
      "SELECT packs_available FROM users WHERE id = ? FOR UPDATE",
      [userId],
      conn,
    );
    if (!user || user.packs_available <= 0) throw new NoPacksError("No packs available");

    const approved = await approvedCardsByRarity(conn);
    const cards: PackCard[] = [];
    for (let i = 0; i < CARDS_PER_PACK; i++) {
      const rarity = rarityForRoll(randomRoll());
      const candidates = approved.get(CardType.toValue(rarity)!) ?? [];
      // Rolls back the whole pack; the user keeps it.
      if (candidates.length === 0) throw new NoCardsForRarityError(rarity);
      const card = pick(candidates);

      const newCard = !(await ownsCard(userId, card, conn));
      await grantCard(userId, card, conn);
      cards.push({ public_id: `${card.season}/${card.cardtype}/${card.api_id}`, rarity, new_card: newCard });
    }

    // Like Rails' decrement! (update_counters): adjusts the counter without touching updated_at.
    await execute("UPDATE users SET packs_available = packs_available - 1 WHERE id = ?", [userId], conn);
    return { cards, packs_available: user.packs_available - 1 };
  });
}
