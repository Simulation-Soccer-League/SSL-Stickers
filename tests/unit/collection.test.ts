import { test } from "node:test";
import assert from "node:assert/strict";
import { castBoolean } from "../../src/server/forms.ts";
import { type GroupedCard, paginate, parsePagination, sortCards } from "../../src/server/services/collection.ts";

const card = (overrides: Partial<GroupedCard>): GroupedCard => ({
  card_name: "a",
  api_id: "x",
  cardtype: "Bronze",
  season: 23,
  team: "Team",
  owned_count: 1,
  ...overrides,
});
const names = (cards: GroupedCard[]) => cards.map((c) => c.card_name);

test("cards without a team sort last in both directions", () => {
  const cards = [card({ card_name: "n", team: null }), card({ card_name: "b", team: "Beta" }), card({ card_name: "a", team: "alpha" })];
  assert.deepEqual(names(sortCards(cards, "team_name_asc")), ["a", "b", "n"]);
  assert.deepEqual(names(sortCards(cards, "team_name_desc")), ["b", "a", "n"]);
});

test("player_name ties break by season (nil first) then api_id, ignoring direction", () => {
  const cards = [
    card({ card_name: "Same", season: 24, api_id: "b" }),
    card({ card_name: "same", season: 23, api_id: "z" }),
    card({ card_name: "same", season: 24, api_id: "a" }),
    card({ card_name: "Same", season: null, api_id: "m" }),
  ];
  const order = (sort: string) => sortCards(cards, sort).map((c) => `${c.season}/${c.api_id}`);
  assert.deepEqual(order("player_name_asc"), ["null/m", "23/z", "24/a", "24/b"]);
  assert.deepEqual(order("player_name_desc"), ["null/m", "23/z", "24/a", "24/b"]);
});

test("default sort is rarity descending, ties by case-insensitive name", () => {
  const cards = [card({ card_name: "b" }), card({ card_name: "Z", cardtype: "Diamond" }), card({ card_name: "A" })];
  assert.deepEqual(names(sortCards(cards, null)), ["Z", "A", "b"]);
  assert.deepEqual(names(sortCards(cards, "bogus")), ["Z", "A", "b"]);
  assert.deepEqual(names(sortCards(cards, "rarity_asc")), ["A", "b", "Z"]);
  assert.deepEqual(names(sortCards(cards, "owned_desc")), ["A", "b", "Z"]);
});

test("pagination parsing follows to_i but rejects out-of-range values", () => {
  assert.deepEqual(parsePagination("2", "12"), { page: 2, perPage: 12 });
  assert.deepEqual(parsePagination("3abc", "5x"), { page: 3, perPage: 5 });
  assert.deepEqual(parsePagination(null, null), { page: 1, perPage: 10 });
  assert.deepEqual(parsePagination("0", "0"), { page: 1, perPage: 10 });
  assert.deepEqual(parsePagination("-1", "500"), { page: 1, perPage: 100 });
  assert.deepEqual(paginate([1, 2, 3, 4, 5], { page: 2, perPage: 2 }), [3, 4]);
  assert.deepEqual(paginate([1, 2, 3], { page: 9, perPage: 2 }), []);
});

test("boolean cast matches ActiveModel::Type::Boolean", () => {
  assert.equal(castBoolean(null), null);
  assert.equal(castBoolean(""), null);
  for (const value of ["0", "f", "F", "false", "FALSE", "off", "OFF"]) assert.equal(castBoolean(value), false, value);
  for (const value of ["true", "1", "t", "yes", "False"]) assert.equal(castBoolean(value), true, value);
});
