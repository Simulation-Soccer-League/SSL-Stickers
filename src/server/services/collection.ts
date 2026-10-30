// Collection queries: owned-card groups, the full catalogue with ownership,
// and tradeable card options. Port of the grouping, filtering, and sorting
// logic in the Rails UserCardsController.
import type { RowDataPacket } from "mysql2/promise";
import { query } from "../db.ts";
import { CardType, type CardTypeName } from "../enums.ts";
import { binToUuid } from "../uuid.ts";
import { lockedCardIds } from "./tradeLocks.ts";

export type GroupedCard = {
  card_name: string | null;
  api_id: string | null;
  cardtype: CardTypeName | null;
  season: number | null;
  team: string | null;
  owned_count: number;
};

export type TradeCardOption = {
  card_name: string | null;
  season: number | null;
  api_id: string | null;
  cardtype: CardTypeName | null;
  owned_count: number;
  uuids: string[];
  current_user_owns: boolean;
};

// Exact-value key, standing in for Ruby array hash keys (case-sensitive,
// unlike the MySQL collation).
const key = (...parts: unknown[]) => JSON.stringify(parts);

// --- filtering -----------------------------------------------------------

// sanitize_sql_like: escape the LIKE wildcards and the escape character.
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

// Rails `filter_by_name`: case-insensitive substring match via the column
// collation; blank names do not filter.
function nameFilter(column: string, name: string | null): { sql: string; params: unknown[] } {
  if (!name || name.trim() === "") return { sql: "", params: [] };
  return { sql: ` AND ${column} LIKE ?`, params: [`%${escapeLike(name)}%`] };
}

// --- sorting (port of sort_cards and its helpers) ------------------------

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

// compare_text: String#<=> on downcased values; nil becomes "".
function compareText(left: unknown, right: unknown) {
  const a = left == null ? "" : String(left).toLowerCase();
  const b = right == null ? "" : String(right).toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

// compare_values: nil on the left sorts first, then nil on the right.
function compareValues(left: number | null, right: number | null) {
  if (left == null) return -1;
  if (right == null) return 1;
  return sign(left - right);
}

// compare_teams: equal → 0; nil teams sort last in either direction.
function compareTeams(left: string | null, right: string | null, direction: number) {
  if (left === right) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return compareText(left, right) * direction;
}

const rarityValue = (card: GroupedCard) => CardType.toValue(card.cardtype) ?? -1;

export function sortCards(cards: GroupedCard[], sort: string | null): GroupedCard[] {
  const raw = sort ?? "";
  const direction = raw.endsWith("_desc") ? -1 : 1;
  const field = raw.replace(/_asc$/, "").replace(/_desc$/, "");

  return [...cards].sort((left, right) => {
    let comparison: number;
    switch (field) {
      case "player_name":
        comparison = compareText(left.card_name, right.card_name) * direction;
        break;
      case "team_name":
        comparison = compareTeams(left.team, right.team, direction);
        break;
      case "owned":
        comparison = sign(left.owned_count - right.owned_count) * direction;
        break;
      case "rarity":
        comparison = sign(rarityValue(left) - rarityValue(right)) * direction;
        break;
      default:
        comparison = sign(rarityValue(left) - rarityValue(right)) * -1;
    }
    if (comparison !== 0) return comparison;

    if (field === "player_name") {
      return compareValues(left.season, right.season) || compareText(left.api_id, right.api_id);
    }
    return compareText(left.card_name, right.card_name);
  });
}

// --- pagination ----------------------------------------------------------

export const DEFAULT_PER_PAGE = 10;
const MAX_PER_PAGE = 100;

// Ruby to_i-style parsing, but out-of-range values fall back to defaults
// (Rails let page 0 wrap to the end of the list and negative sizes return nothing).
export function parsePagination(page: string | null, perPage: string | null) {
  const pageNumber = Number.parseInt(page ?? "", 10);
  const size = Number.parseInt(perPage ?? "", 10);
  return {
    page: Number.isFinite(pageNumber) && pageNumber >= 1 ? pageNumber : 1,
    perPage: Number.isFinite(size) && size >= 1 ? Math.min(size, MAX_PER_PAGE) : DEFAULT_PER_PAGE,
  };
}

export function paginate<T>(items: T[], { page, perPage }: { page: number; perPage: number }): T[] {
  return items.slice((page - 1) * perPage, page * perPage);
}

// --- owned cards ---------------------------------------------------------

type GroupRow = RowDataPacket & {
  card_name: string | null;
  api_id: string | null;
  cardtype: number | null;
  season: number | null;
  owned_count: number;
};

async function ownedGroups(userId: number, name: string | null = null): Promise<GroupRow[]> {
  const filter = nameFilter("card_name", name);
  return query<GroupRow>(
    `SELECT card_name, api_id, cardtype, season, COUNT(*) AS owned_count
       FROM user_cards
      WHERE user_id = ?${filter.sql}
      GROUP BY card_name, api_id, cardtype, season`,
    [userId, ...filter.params],
  );
}

// SQL membership test that, like ActiveRecord's where(col: [..., nil]), also matches NULL.
function inList(column: string, values: unknown[]): { sql: string; params: unknown[] } {
  const present = [...new Set(values.filter((v) => v != null))];
  const parts: string[] = [];
  if (present.length) parts.push(`${column} IN (?)`);
  if (values.some((v) => v == null)) parts.push(`${column} IS NULL`);
  return { sql: parts.length ? `(${parts.join(" OR ")})` : "1 = 0", params: present.length ? [present] : [] };
}

// teams_by_card: the lexicographically greatest original_cards.team for each (api_id, season).
async function teamsByCard(groups: GroupRow[]): Promise<Map<string, string>> {
  const teams = new Map<string, string>();
  if (groups.length === 0) return teams;
  const apiIds = inList("api_id", groups.map((g) => g.api_id));
  const seasons = inList("season", groups.map((g) => g.season));
  const rows = await query<RowDataPacket & { api_id: string | null; season: number | null; team: string | null }>(
    `SELECT api_id, season, team FROM original_cards WHERE ${apiIds.sql} AND ${seasons.sql}`,
    [...apiIds.params, ...seasons.params],
  );
  for (const row of rows) {
    if (row.team == null) continue;
    const k = key(row.api_id, row.season);
    const current = teams.get(k);
    if (current === undefined || row.team > current) teams.set(k, row.team);
  }
  return teams;
}

async function groupedOwnedCards(userId: number, name: string | null, sort: string | null) {
  const groups = await ownedGroups(userId, name);
  const teams = await teamsByCard(groups);
  const cards = groups.map((group) => ({
    card_name: group.card_name,
    api_id: group.api_id,
    cardtype: CardType.toName(group.cardtype),
    season: group.season,
    team: teams.get(key(group.api_id, group.season)) ?? null,
    owned_count: Number(group.owned_count),
  }));
  return { cards: sortCards(cards, sort), count: groups.length };
}

// GET /user_cards
export async function ownedCardsPage(userId: number, sort: string | null, pagination: { page: number; perPage: number }) {
  return paginate((await groupedOwnedCards(userId, null, sort)).cards, pagination);
}

// GET /get_user_card_count: number of distinct owned groups.
export async function ownedGroupCount(userId: number): Promise<number> {
  return (await ownedGroups(userId)).length;
}

// --- full catalogue ------------------------------------------------------

async function catalogueWithOwnership(userId: number, name: string | null, sort: string | null) {
  // Latest approved original card per (name, cardtype, season).
  const latest = await query<RowDataPacket & { id: number }>(
    "SELECT MAX(id) AS id FROM original_cards WHERE approved = TRUE GROUP BY name, cardtype, season",
  );
  if (latest.length === 0) return { cards: [] as GroupedCard[], count: 0 };

  const filter = nameFilter("name", name);
  const originals = await query<
    RowDataPacket & { name: string | null; api_id: string | null; cardtype: number | null; season: number | null; team: string | null }
  >(`SELECT name, api_id, cardtype, season, team FROM original_cards WHERE id IN (?)${filter.sql} ORDER BY id`, [
    latest.map((row) => row.id),
    ...filter.params,
  ]);

  const owned = await query<RowDataPacket & { card_name: string | null; season: number | null; cardtype: number | null; n: number }>(
    "SELECT card_name, season, cardtype, COUNT(*) AS n FROM user_cards WHERE user_id = ? GROUP BY card_name, season, cardtype",
    [userId],
  );
  const ownedCounts = new Map(owned.map((row) => [key(row.card_name, row.season, row.cardtype), Number(row.n)]));

  const cards = originals.map((card) => ({
    card_name: card.name,
    api_id: card.api_id,
    cardtype: CardType.toName(card.cardtype),
    season: card.season,
    team: card.team,
    owned_count: ownedCounts.get(key(card.name, card.season, card.cardtype)) ?? 0,
  }));
  return { cards: sortCards(cards, sort), count: cards.length };
}

// POST /cards_with_params
export async function cardsWithParams(
  userId: number,
  options: { name: string | null; sort: string | null; includeUnowned: boolean; page: number; perPage: number },
) {
  const result = options.includeUnowned
    ? await catalogueWithOwnership(userId, options.name, options.sort)
    : await groupedOwnedCards(userId, options.name, options.sort);
  return { cards: paginate(result.cards, options), count: result.count };
}

// --- tradeable options (cards_by_rarity with visual=true) ----------------

export async function tradeCardOptions(targetUserId: number, currentUserId: number): Promise<TradeCardOption[]> {
  const locked = await lockedCardIds();
  const currentKeys = new Set(
    (
      await query<RowDataPacket & { card_name: string | null; season: number | null; api_id: string | null; cardtype: number | null }>(
        "SELECT card_name, season, api_id, cardtype FROM user_cards WHERE user_id = ?",
        [currentUserId],
      )
    ).map((card) => key(card.card_name, card.season, card.api_id, card.cardtype)),
  );

  const cards = await query<
    RowDataPacket & { uuid: Buffer; card_name: string | null; season: number | null; api_id: string | null; cardtype: number | null }
  >(
    `SELECT uuid, card_name, season, api_id, cardtype FROM user_cards
      WHERE user_id = ?${locked.length ? " AND uuid NOT IN (?)" : ""}
      ORDER BY cardtype DESC, card_name ASC`,
    locked.length ? [targetUserId, locked] : [targetUserId],
  );

  const groups = new Map<string, TradeCardOption>();
  for (const card of cards) {
    const k = key(card.card_name, card.season, card.api_id, card.cardtype);
    let group = groups.get(k);
    if (!group) {
      group = {
        card_name: card.card_name,
        season: card.season,
        api_id: card.api_id,
        cardtype: CardType.toName(card.cardtype),
        owned_count: 0,
        uuids: [],
        current_user_owns: currentKeys.has(k),
      };
      groups.set(k, group);
    }
    group.owned_count += 1;
    group.uuids.push(binToUuid(card.uuid));
  }
  return [...groups.values()];
}
