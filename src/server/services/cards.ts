// Drawing random original cards and granting them to users. Shared by packs
// and the factory.
import { randomInt } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { execute, query } from "../db.ts";
import { CardType, type CardTypeName } from "../enums.ts";
import { newUuid, uuidToBin } from "../uuid.ts";

export type OriginalCard = {
  id: number;
  created_at: Date;
  updated_at: Date;
  name: string | null;
  cardtype: CardTypeName | null;
  approved: boolean;
  api_id: string | null;
  season: number | null;
  team: string | null;
};

type OriginalRow = Omit<OriginalCard, "cardtype"> & { cardtype: number | null } & RowDataPacket;

// Thrown when a rarity has no approved original cards to award.
export class NoCardsForRarityError extends Error {
  readonly rarity: CardTypeName;

  constructor(rarity: CardTypeName) {
    super(`No approved ${rarity} cards are available`);
    this.rarity = rarity;
  }
}

const toOriginalCard = (row: OriginalRow): OriginalCard => ({ ...row, cardtype: CardType.toName(row.cardtype) });

export const pick = <T>(items: readonly T[]): T => items[randomInt(items.length)];

// Approved original cards grouped by cardtype value.
export async function approvedCardsByRarity(db: PoolConnection): Promise<Map<number, OriginalCard[]>> {
  const rows = await query<OriginalRow>(
    "SELECT id, created_at, updated_at, name, cardtype, approved, api_id, season, team FROM original_cards WHERE approved = TRUE",
    [],
    db,
  );
  const byRarity = new Map<number, OriginalCard[]>();
  for (const row of rows) {
    if (row.cardtype == null) continue;
    byRarity.set(row.cardtype, [...(byRarity.get(row.cardtype) ?? []), toOriginalCard(row)]);
  }
  return byRarity;
}

// Uniformly random approved original card of one rarity.
export async function randomApprovedCard(rarity: CardTypeName, db: PoolConnection): Promise<OriginalCard> {
  const cards = (await approvedCardsByRarity(db)).get(CardType.toValue(rarity)!) ?? [];
  if (cards.length === 0) throw new NoCardsForRarityError(rarity);
  return pick(cards);
}

// Whether the user already owns a card with this season/cardtype/api_id (Rails `exists?`, so collation-insensitive).
export async function ownsCard(userId: number, card: OriginalCard, db: PoolConnection): Promise<boolean> {
  const rows = await query<RowDataPacket>(
    "SELECT 1 FROM user_cards WHERE user_id = ? AND season <=> ? AND cardtype <=> ? AND api_id <=> ? LIMIT 1",
    [userId, card.season, CardType.toValue(card.cardtype), card.api_id],
    db,
  );
  return rows.length > 0;
}

// Creates a user_cards row copying the original card's identity, like Rails' user_cards.create!.
export async function grantCard(userId: number, card: OriginalCard, db: PoolConnection): Promise<string> {
  const uuid = newUuid();
  await execute(
    `INSERT INTO user_cards (uuid, user_id, cardtype, season, api_id, card_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
    [uuidToBin(uuid), userId, CardType.toValue(card.cardtype), card.season, card.api_id, card.name],
    db,
  );
  return uuid;
}
