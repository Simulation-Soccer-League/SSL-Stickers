// Factory exchanges: trade in a set of owned cards for one random card.
// Port of UserCardsController#factory_pack (PR #5 recipes), with rewards
// limited to approved cards.
import type { RowDataPacket } from "mysql2/promise";
import { execute, query, withTransaction } from "../db.ts";
import { CardType, type CardTypeName } from "../enums.ts";
import { isUuid, uuidToBin } from "../uuid.ts";
import { type OriginalCard, grantCard, randomApprovedCard } from "./cards.ts";
import { lockedCardIds } from "./tradeLocks.ts";

// Output rarity → accepted [input rarity, count] combinations.
export const FACTORY_RECIPES: Readonly<Record<CardTypeName, ReadonlyArray<readonly [CardTypeName, number]>>> = {
  Bronze: [["Bronze", 2]],
  Silver: [["Bronze", 5], ["Silver", 2]],
  Gold: [["Silver", 5], ["Gold", 2]],
  Diamond: [["Gold", 5], ["Diamond", 2]],
};

export function isValidRecipe(inputRarities: readonly (CardTypeName | null)[], output: CardTypeName): boolean {
  return FACTORY_RECIPES[output].some(
    ([rarity, count]) => inputRarities.length === count && inputRarities.every((r) => r === rarity),
  );
}

export class FactoryError extends Error {}

export async function exchange(userId: number, cardIds: string[], output: CardTypeName): Promise<OriginalCard> {
  if (cardIds.length === 0 || new Set(cardIds).size !== cardIds.length || !cardIds.every(isUuid)) {
    throw new FactoryError("Invalid factory card selection");
  }
  const ids = cardIds.map(uuidToBin);

  return withTransaction(async (conn) => {
    // Lock the selected cards that the user owns; others are simply not returned.
    const cards = await query<{ cardtype: number | null } & RowDataPacket>(
      "SELECT uuid, cardtype FROM user_cards WHERE user_id = ? AND uuid IN (?) ORDER BY uuid FOR UPDATE",
      [userId, ids],
      conn,
    );
    const locked = await lockedCardIds(ids, conn);
    if (
      cards.length !== ids.length ||
      locked.length > 0 ||
      !isValidRecipe(cards.map((card) => CardType.toName(card.cardtype)), output)
    ) {
      throw new FactoryError("Selected cards are unavailable, locked in a trade, or invalid for this exchange");
    }

    // Throws NoCardsForRarityError before anything is consumed.
    const reward = await randomApprovedCard(output, conn);
    await execute("DELETE FROM user_cards WHERE user_id = ? AND uuid IN (?)", [userId, ids], conn);
    await grantCard(userId, reward, conn);
    return reward;
  });
}
