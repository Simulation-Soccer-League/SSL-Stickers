// Cards offered in a pending trade by a participant who has accepted it (in
// practice the proposer's cards) are locked: they cannot be offered again,
// used in the factory, or shown as tradeable. Port of
// TradeItem.locked_in_pending_trade.
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { query, stickersPool } from "../db.ts";
import { TradeStatus } from "../enums.ts";

const LOCKED_SQL = `
  SELECT trade_items.user_card_id
    FROM trade_items
    JOIN trades ON trades.id = trade_items.trade_id
    JOIN trade_participants ON trade_participants.trade_id = trades.id
   WHERE trades.status = ${TradeStatus.toValue("pending")}
     AND trade_participants.accept = TRUE
     AND trade_items.offered_by_user_id = trade_participants.user_id`;

// Returns the locked card IDs (16-byte buffers), optionally limited to `cardIds`.
export async function lockedCardIds(
  cardIds: Buffer[] | null = null,
  db: PoolConnection | ReturnType<typeof stickersPool> = stickersPool(),
): Promise<Buffer[]> {
  if (cardIds && cardIds.length === 0) return [];
  const rows = await query<{ user_card_id: Buffer } & RowDataPacket>(
    cardIds ? `${LOCKED_SQL} AND trade_items.user_card_id IN (?)` : LOCKED_SQL,
    cardIds ? [cardIds] : [],
    db,
  );
  return rows.map((row) => row.user_card_id);
}
