// Trades between two users. Port of the PR #4/#5 Rails TradesController:
// offers are immutable; the proposer's offered cards are locked while the
// trade is pending; the other participant accepts (transferring every card
// after re-checking ownership) or either participant declines.
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { execute, query, stickersPool, withTransaction } from "../db.ts";
import { CardType, TradeStatus, type CardTypeName, type TradeStatusName } from "../enums.ts";
import { binToUuid, isUuid, uuidToBin } from "../uuid.ts";
import { lockedCardIds } from "./tradeLocks.ts";

type Db = PoolConnection | ReturnType<typeof stickersPool>;

// --- errors --------------------------------------------------------------

// A request-level failure with an HTTP status and JSON body.
export class TradeError extends Error {
  readonly status: number;
  readonly cardIds: string[] | null;

  constructor(status: number, message: string, cardIds: string[] | null = null) {
    super(message);
    this.status = status;
    this.cardIds = cardIds;
  }

  body() {
    return this.cardIds ? { error: this.message, card_ids: this.cardIds } : { error: this.message };
  }
}

const notFound = () => new TradeError(404, "Trade not found");

// --- rows ----------------------------------------------------------------

type TradeRow = RowDataPacket & { id: number; created_at: Date; updated_at: Date; status: number };
type ParticipantRow = RowDataPacket & { id: number; user_id: number | null; accept: boolean | null };
type CardRow = {
  uuid: Buffer;
  created_at: Date;
  updated_at: Date;
  user_id: number | null;
  cardtype: number | null;
  season: number | null;
  api_id: string | null;
  card_name: string | null;
};
type ItemRow = RowDataPacket & {
  user_card_id: Buffer;
  offered_by_user_id: number | null;
  snapshot_cardtype: number | null;
  card: CardRow | null;
};

export type UserCardJson = {
  uuid: string;
  created_at: Date;
  updated_at: Date;
  user_id: number | null;
  cardtype: CardTypeName | null;
  season: number | null;
  api_id: string | null;
  card_name: string | null;
};

const serializeTrade = (trade: TradeRow) => ({
  id: trade.id,
  created_at: trade.created_at,
  updated_at: trade.updated_at,
  status: TradeStatus.toName(trade.status),
});

const serializeCard = (card: CardRow): UserCardJson => ({
  uuid: binToUuid(card.uuid),
  created_at: card.created_at,
  updated_at: card.updated_at,
  user_id: card.user_id,
  cardtype: CardType.toName(card.cardtype),
  season: card.season,
  api_id: card.api_id,
  card_name: card.card_name,
});

async function findTrade(tradeId: number, db: Db, forUpdate = false): Promise<TradeRow | null> {
  const rows = await query<TradeRow>(
    `SELECT id, created_at, updated_at, status FROM trades WHERE id = ?${forUpdate ? " FOR UPDATE" : ""}`,
    [tradeId],
    db,
  );
  return rows[0] ?? null;
}

async function participantsOf(tradeId: number, db: Db): Promise<ParticipantRow[]> {
  return query<ParticipantRow>("SELECT id, user_id, accept FROM trade_participants WHERE trade_id = ? ORDER BY id", [tradeId], db);
}

// Trade items in id order, each with its current card (null if the card no longer exists).
async function itemsOf(tradeIds: number[], db: Db): Promise<Map<number, ItemRow[]>> {
  const byTrade = new Map<number, ItemRow[]>();
  if (tradeIds.length === 0) return byTrade;
  type JoinedRow = RowDataPacket & {
    trade_id: number;
    user_card_id: Buffer;
    offered_by_user_id: number | null;
    snapshot_cardtype: number | null;
    card_uuid: Buffer | null;
    card_created_at: Date | null;
    card_updated_at: Date | null;
    card_user_id: number | null;
    card_cardtype: number | null;
    card_season: number | null;
    card_api_id: string | null;
    card_card_name: string | null;
  };
  const rows = await query<JoinedRow>(
    `SELECT ti.trade_id, ti.user_card_id, ti.offered_by_user_id, ti.snapshot_cardtype,
            uc.uuid AS card_uuid, uc.created_at AS card_created_at, uc.updated_at AS card_updated_at,
            uc.user_id AS card_user_id, uc.cardtype AS card_cardtype, uc.season AS card_season,
            uc.api_id AS card_api_id, uc.card_name AS card_card_name
       FROM trade_items ti
       LEFT JOIN user_cards uc ON uc.uuid = ti.user_card_id
      WHERE ti.trade_id IN (?)
      ORDER BY ti.id`,
    [tradeIds],
    db,
  );
  for (const row of rows) {
    const item = {
      user_card_id: row.user_card_id,
      offered_by_user_id: row.offered_by_user_id,
      snapshot_cardtype: row.snapshot_cardtype,
      card: row.card_uuid
        ? {
            uuid: row.card_uuid,
            created_at: row.card_created_at!,
            updated_at: row.card_updated_at!,
            user_id: row.card_user_id,
            cardtype: row.card_cardtype,
            season: row.card_season,
            api_id: row.card_api_id,
            card_name: row.card_card_name,
          }
        : null,
    } as ItemRow;
    byTrade.set(row.trade_id, [...(byTrade.get(row.trade_id) ?? []), item]);
  }
  return byTrade;
}

// TradeItem#snapshot_rarity: the rarity captured when offered, else the card's current one.
const snapshotRarity = (item: ItemRow) => CardType.toName(item.snapshot_cardtype) ?? CardType.toName(item.card?.cardtype);

function rarityCounts(items: ItemRow[]): Partial<Record<CardTypeName, number>> {
  const counts: Partial<Record<CardTypeName, number>> = {};
  for (const item of items) {
    const rarity = snapshotRarity(item);
    if (rarity) counts[rarity] = (counts[rarity] ?? 0) + 1;
  }
  return counts;
}

const cardUnavailable = (item: ItemRow) => item.card === null || item.card.user_id !== item.offered_by_user_id;

async function usernames(ids: (number | null)[], db: Db): Promise<Map<number, string | null>> {
  const present = [...new Set(ids.filter((id): id is number => id != null))];
  if (present.length === 0) return new Map();
  const rows = await query<RowDataPacket & { id: number; username: string | null }>(
    "SELECT id, username FROM users WHERE id IN (?)",
    [present],
    db,
  );
  return new Map(rows.map((row) => [row.id, row.username]));
}

// --- list ----------------------------------------------------------------

export async function listTrades(userId: number) {
  const db = stickersPool();
  const pending = await query<RowDataPacket & { trade_id: number; accept: boolean | null }>(
    `SELECT tp.trade_id, tp.accept
       FROM trade_participants tp
       JOIN trades t ON t.id = tp.trade_id
      WHERE t.status = ? AND tp.user_id = ?
      ORDER BY tp.id`,
    [TradeStatus.toValue("pending"), userId],
    db,
  );
  const history = await query<RowDataPacket & { id: number; status: number; updated_at: Date }>(
    `SELECT t.id, t.status, t.updated_at
       FROM trade_participants tp
       JOIN trades t ON t.id = tp.trade_id
      WHERE tp.user_id = ? AND t.status <> ?
      ORDER BY t.updated_at DESC, tp.id`,
    [userId, TradeStatus.toValue("pending")],
    db,
  );

  const tradeIds = [...new Set([...pending.map((p) => p.trade_id), ...history.map((h) => h.id)])];
  const items = await itemsOf(tradeIds, db);
  const participants = new Map<number, ParticipantRow[]>();
  for (const tradeId of tradeIds) participants.set(tradeId, await participantsOf(tradeId, db));
  const names = await usernames([...participants.values()].flat().map((p) => p.user_id), db);

  // Rails: participants.where.not(user_id: me).pick(:user_id) (SQL <>, so NULL never matches).
  const otherUserId = (tradeId: number) =>
    participants.get(tradeId)!.find((p) => p.user_id != null && p.user_id !== userId)?.user_id ?? null;

  const list = {
    trades: [] as number[],
    current_user_accept: [] as (boolean | null)[],
    user2_name: [] as (string | null)[],
    current_user_rarities: [] as Partial<Record<CardTypeName, number>>[],
    other_user_rarities: [] as Partial<Record<CardTypeName, number>>[],
    trade_errors: [] as boolean[],
  };
  for (const participation of pending) {
    const tradeItems = items.get(participation.trade_id) ?? [];
    const other = otherUserId(participation.trade_id);
    list.trades.push(participation.trade_id);
    list.user2_name.push(other == null ? null : (names.get(other) ?? null));
    list.current_user_accept.push(participation.accept);
    list.current_user_rarities.push(rarityCounts(tradeItems.filter((item) => item.offered_by_user_id === userId)));
    list.other_user_rarities.push(rarityCounts(tradeItems.filter((item) => item.offered_by_user_id === other)));
    list.trade_errors.push(tradeItems.some(cardUnavailable));
  }

  const historyEntries = history.map((trade) => {
    const tradeItems = items.get(trade.id) ?? [];
    const offered = tradeItems.filter((item) => item.offered_by_user_id === userId);
    const received = tradeItems.filter((item) => item.offered_by_user_id !== userId);
    // Rails: trade.users.find { |u| u.id != me } (Ruby comparison, so a NULL participant does not count).
    const other = participants.get(trade.id)!.find((p) => p.user_id != null && p.user_id !== userId);
    return {
      id: trade.id,
      other_user: other ? (names.get(other.user_id!) ?? null) : null,
      status: TradeStatus.toName(trade.status) as TradeStatusName,
      offered_card_count: offered.length,
      offered_rarity_counts: rarityCounts(offered),
      received_card_count: received.length,
      received_rarity_counts: rarityCounts(received),
      completed_at: trade.updated_at,
    };
  });

  return { ...list, history: historyEntries };
}

// --- detail --------------------------------------------------------------

async function requireParticipant(tradeId: number, userId: number, db: Db, forUpdate = false) {
  const trade = await findTrade(tradeId, db, forUpdate);
  if (!trade) throw notFound();
  const participants = await participantsOf(tradeId, db);
  const me = participants.find((p) => p.user_id === userId);
  // Non-participants get the same 404 as a missing trade.
  if (!me) throw notFound();
  return { trade, participants, me };
}

export async function tradeDetail(tradeId: number, userId: number) {
  const db = stickersPool();
  const { participants, me } = await requireParticipant(tradeId, userId, db);
  const items = (await itemsOf([tradeId], db)).get(tradeId) ?? [];

  const mine: UserCardJson[] = [];
  const theirs: UserCardJson[] = [];
  const unavailable: string[] = [];
  for (const item of items) {
    if (!item.card) {
      unavailable.push(binToUuid(item.user_card_id));
      continue;
    }
    (item.offered_by_user_id === userId ? mine : theirs).push(serializeCard(item.card));
    if (item.card.user_id !== item.offered_by_user_id) unavailable.push(binToUuid(item.user_card_id));
  }

  const other = participants.find((p) => p.user_id != null && p.user_id !== userId)?.user_id ?? null;
  const names = await usernames([other], db);
  return {
    user_trade_items: mine,
    user2_trade_items: theirs,
    current_user_accept: me.accept,
    user2_name: other == null ? null : (names.get(other) ?? null),
    unavailable_card_ids: unavailable,
  };
}

// --- create --------------------------------------------------------------

// Normalizes requested card IDs (Rails: Array(params[:combinedCards]).uniq).
export function normalizeCardIds(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(list.map((id) => String(id).toLowerCase()))];
}

// Locks the cards (in uuid order, so concurrent trades and exchanges cannot deadlock).
async function lockCards(cardIds: string[], conn: PoolConnection): Promise<CardRow[]> {
  const valid = cardIds.filter(isUuid);
  const cards = valid.length
    ? await query<CardRow & RowDataPacket>(
        `SELECT uuid, created_at, updated_at, user_id, cardtype, season, api_id, card_name
           FROM user_cards WHERE uuid IN (?) ORDER BY uuid FOR UPDATE`,
        [valid.map(uuidToBin)],
        conn,
      )
    : [];
  const loaded = new Set(cards.map((card) => binToUuid(card.uuid)));
  const missing = cardIds.filter((id) => !loaded.has(id));
  if (missing.length > 0) throw new TradeError(422, "One or more selected cards no longer exist", missing);
  return cards;
}

export async function createTrade(senderId: number, receiverUsername: string | null, cardIdsInput: unknown) {
  const [receiver] = receiverUsername
    ? await query<RowDataPacket & { id: number }>("SELECT id FROM users WHERE username = ? LIMIT 1", [receiverUsername])
    : [];
  if (!receiver) throw new TradeError(422, "Trade user not found");
  if (receiver.id === senderId) throw new TradeError(422, "You cannot trade with yourself");

  const cardIds = normalizeCardIds(cardIdsInput);
  if (cardIds.length === 0) throw new TradeError(422, "A trade must include at least one card");

  return withTransaction(async (conn) => {
    const cards = await lockCards(cardIds, conn);

    const foreign = cards.filter((card) => card.user_id !== senderId && card.user_id !== receiver.id);
    if (foreign.length > 0) {
      throw new TradeError(
        422,
        "One or more selected cards are no longer owned by a trade participant",
        foreign.map((card) => binToUuid(card.uuid)),
      );
    }

    // Runs after the card locks are held, so it sees trades committed by competing requests.
    const senderCards = cards.filter((card) => card.user_id === senderId).map((card) => card.uuid);
    const locked = await lockedCardIds(senderCards, conn);
    if (locked.length > 0) {
      throw new TradeError(
        422,
        "One or more selected cards are already locked in another pending trade",
        [...new Set(locked.map(binToUuid))],
      );
    }

    const { insertId: tradeId } = await execute(
      "INSERT INTO trades (status, created_at, updated_at) VALUES (?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
      [TradeStatus.toValue("pending")],
      conn,
    );
    for (const [userId, accept] of [
      [senderId, true],
      [receiver.id, false],
    ] as const) {
      await execute(
        "INSERT INTO trade_participants (trade_id, user_id, accept, created_at, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
        [tradeId, userId, accept],
        conn,
      );
    }
    for (const card of cards) {
      await execute(
        `INSERT INTO trade_items (trade_id, user_card_id, offered_by_user_id, snapshot_card_name, snapshot_cardtype,
                                  snapshot_season, snapshot_api_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
        [tradeId, card.uuid, card.user_id, card.card_name, card.cardtype, card.season, card.api_id],
        conn,
      );
    }
    return serializeTrade((await findTrade(tradeId, conn))!);
  });
}

// --- accept --------------------------------------------------------------

export async function acceptTrade(tradeId: number, userId: number, cardIdsInput: unknown) {
  return withTransaction(async (conn) => {
    // Lock the trade first, then re-check its state, so concurrent accepts serialize.
    const { trade, participants, me } = await requireParticipant(tradeId, userId, conn, true);
    if (trade.status !== TradeStatus.toValue("pending")) throw notFound();

    const items = (await itemsOf([tradeId], conn)).get(tradeId) ?? [];
    const existing = items.map((item) => binToUuid(item.user_card_id)).sort();
    const requested = normalizeCardIds(cardIdsInput).sort();
    if (JSON.stringify(requested) !== JSON.stringify(existing)) {
      throw new TradeError(422, "Offered trades are locked and cannot be edited");
    }
    if (me.accept) throw new TradeError(422, "You have already accepted this offer");

    const cards = await lockCards(existing, conn);
    const byId = new Map(cards.map((card) => [binToUuid(card.uuid), card]));
    const unavailable = items.filter((item) => byId.get(binToUuid(item.user_card_id))?.user_id !== item.offered_by_user_id);
    if (unavailable.length > 0) {
      const names = [...new Set(unavailable.map((item) => byId.get(binToUuid(item.user_card_id))?.card_name).filter(Boolean))];
      throw new TradeError(
        422,
        `Trade cannot be accepted because cards are no longer available from their original owner${names.length ? `: ${names.join(", ")}` : ""}`,
        unavailable.map((item) => binToUuid(item.user_card_id)),
      );
    }

    const participantIds = participants.slice(0, 2).map((p) => p.user_id);
    for (const item of items) {
      const receiving = participantIds.find((id) => id !== item.offered_by_user_id) ?? null;
      await execute("UPDATE user_cards SET user_id = ?, updated_at = UTC_TIMESTAMP(6) WHERE uuid = ?", [receiving, item.user_card_id], conn);
    }
    await execute(
      "UPDATE trade_participants SET accept = TRUE, updated_at = UTC_TIMESTAMP(6) WHERE trade_id = ? AND NOT (accept <=> TRUE)",
      [tradeId],
      conn,
    );
    await execute("UPDATE trades SET status = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?", [TradeStatus.toValue("accepted"), tradeId], conn);
    return serializeTrade((await findTrade(tradeId, conn))!);
  });
}

// --- decline -------------------------------------------------------------

export async function declineTrade(tradeId: number, userId: number) {
  await withTransaction(async (conn) => {
    const { trade } = await requireParticipant(tradeId, userId, conn, true);
    if (trade.status === TradeStatus.toValue("pending")) {
      await execute("UPDATE trades SET status = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?", [TradeStatus.toValue("declined"), tradeId], conn);
    }
  });
}
