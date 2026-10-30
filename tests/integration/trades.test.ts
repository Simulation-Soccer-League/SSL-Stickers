import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import {
  type BaselineEntry,
  Client,
  clientFor,
  db,
  giveCards,
  loadBaseline,
  loadFixture,
  resetDatabase,
  startServer,
  stopServer,
} from "./harness.ts";

const USERS = {
  Test1: { id: 1, forumUid: 9001 },
  Test2: { id: 2, forumUid: 9002 },
  Test3: { id: 3, forumUid: 9003 },
  Test4: { id: 4, forumUid: 9004 },
};

const hex = (uuid: string) => Buffer.from(uuid.replace(/-/g, ""), "hex");
const ownerOf = async (uuid: string) =>
  (await db.query<RowDataPacket>("SELECT user_id FROM user_cards WHERE uuid = ?", [hex(uuid)]))[0]?.user_id ?? null;
const tradeRow = async (id: number) => (await db.query<RowDataPacket>("SELECT * FROM trades WHERE id = ?", [id]))[0];

// Card IDs of the proposer's cards locked in pending trades, per the fixture.
async function lockedCards(userId: number): Promise<string[]> {
  const rows = await db.query<RowDataPacket>(
    `SELECT DISTINCT LOWER(HEX(ti.user_card_id)) AS h FROM trade_items ti
       JOIN trades t ON t.id = ti.trade_id AND t.status = 0
       JOIN trade_participants p ON p.trade_id = t.id AND p.accept = TRUE AND p.user_id = ti.offered_by_user_id
      WHERE ti.offered_by_user_id = ?`,
    [userId],
  );
  return rows.map((r) => String(r.h).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"));
}

before(async () => {
  await startServer();
});

beforeEach(async () => {
  await resetDatabase(Object.entries(USERS).map(([username, u]) => ({ uid: u.forumUid, username, password: "unused" })));
  await loadFixture();
});

after(stopServer);

// --- baseline ------------------------------------------------------------

test("trade list and trade details match the Rails baseline", async () => {
  const entries = (await loadBaseline()).filter(
    (e: BaselineEntry) => e.user in USERS && (e.path === "/api/v1/trades" || /^\/api\/v1\/trades\/\d+$/.test(e.path)),
  );
  assert.equal(entries.length, 21);
  const mismatches: string[] = [];
  for (const entry of entries) {
    const res = await (await clientFor(USERS[entry.user as keyof typeof USERS])).get(entry.path);
    try {
      assert.equal(res.status, entry.status);
      assert.deepEqual(res.body, entry.body);
    } catch (error) {
      mismatches.push(`${entry.user} ${entry.path}\n${(error as Error).message.slice(0, 2000)}`);
    }
  }
  assert.equal(mismatches.length, 0, mismatches.join("\n\n"));
});

test("trades require login; non-participants cannot see a trade", async () => {
  const anonymous = new Client();
  assert.equal((await anonymous.get("/api/v1/trades")).status, 401);
  assert.equal((await anonymous.get("/api/v1/trades/2")).status, 401, "Rails returned trade 2's cards to anyone");
  assert.equal((await anonymous.post("/api/v1/trades", { combinedCards: [], receiver: "Test2" })).status, 401);

  const outsider = await clientFor(USERS.Test4);
  assert.deepEqual(await outsider.get("/api/v1/trades/3").then((r) => [r.status, r.body]), [404, { error: "Trade not found" }]);
  assert.equal((await outsider.get("/api/v1/trades/999999")).status, 404);
  assert.equal((await outsider.get("/api/v1/trades/abc")).status, 404);
});

// --- create --------------------------------------------------------------

test("creating a trade records participants, offers, and snapshots, and locks the proposer's cards", async () => {
  const [mine] = await giveCards(1, "Silver", 1);
  const [theirs] = await giveCards(2, "Gold", 1);
  const client = await clientFor(USERS.Test1);

  const res = await client.post("/api/v1/trades", { combinedCards: [mine, theirs.toUpperCase()], receiver: "test2" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body).sort(), ["created_at", "id", "status", "updated_at"]);
  assert.equal(res.body.status, "pending");

  const participants = await db.query<RowDataPacket>("SELECT user_id, accept FROM trade_participants WHERE trade_id = ? ORDER BY id", [res.body.id]);
  assert.deepEqual(participants.map((p) => [p.user_id, p.accept]), [[1, true], [2, false]]);
  const items = await db.query<RowDataPacket>(
    "SELECT LOWER(HEX(user_card_id)) AS h, offered_by_user_id, snapshot_cardtype FROM trade_items WHERE trade_id = ? ORDER BY id",
    [res.body.id],
  );
  assert.deepEqual(
    items.map((i) => [i.h, i.offered_by_user_id, i.snapshot_cardtype]).sort(),
    [[hex(mine).toString("hex"), 1, 1], [hex(theirs).toString("hex"), 2, 2]].sort(),
  );

  // The proposer's card is now locked: not offered again, hidden from trade options, unusable in the factory.
  const again = await client.post("/api/v1/trades", { combinedCards: [mine], receiver: "Test3" });
  assert.deepEqual([again.status, again.body.card_ids], [422, [mine]]);
  assert.equal(again.body.error, "One or more selected cards are already locked in another pending trade");
  const form = new FormData();
  form.append("visual", "true");
  const options = (await client.post("/api/v1/cards_by_rarity", form)).body as { uuids: string[] }[];
  assert.equal(options.some((o) => o.uuids.includes(mine)), false);

  // The receiver's requested card is not locked.
  const receiverOptions = (await (await clientFor(USERS.Test2)).post("/api/v1/cards_by_rarity", form)).body as { uuids: string[] }[];
  assert.equal(receiverOptions.some((o) => o.uuids.includes(theirs)), true);

  const list = (await client.get("/api/v1/trades")).body;
  const index = list.trades.indexOf(res.body.id);
  assert.notEqual(index, -1);
  assert.deepEqual(
    [list.current_user_accept[index], list.user2_name[index], list.current_user_rarities[index], list.other_user_rarities[index], list.trade_errors[index]],
    [true, "Test2", { Silver: 1 }, { Gold: 1 }, false],
  );
});

test("invalid trade offers are rejected without creating anything", async () => {
  const [mine] = await giveCards(1, "Bronze", 1);
  const [outsiders] = await giveCards(3, "Bronze", 1);
  const [lockedCard] = await lockedCards(1);
  assert.ok(lockedCard, "fixture: Test1 has a card locked in a pending trade");
  const missing = randomUUID();
  const client = await clientFor(USERS.Test1);
  const trades = Number((await db.query<RowDataPacket>("SELECT COUNT(*) AS n FROM trades"))[0].n);

  const cases: [unknown, number, unknown][] = [
    [{ combinedCards: [mine], receiver: "Nobody" }, 422, { error: "Trade user not found" }],
    [{ combinedCards: [mine] }, 422, { error: "Trade user not found" }],
    [{ combinedCards: [mine], receiver: "Test1" }, 422, { error: "You cannot trade with yourself" }],
    [{ combinedCards: [], receiver: "Test2" }, 422, { error: "A trade must include at least one card" }],
    [{ receiver: "Test2" }, 422, { error: "A trade must include at least one card" }],
    [{ combinedCards: [mine, missing], receiver: "Test2" }, 422, { error: "One or more selected cards no longer exist", card_ids: [missing] }],
    [{ combinedCards: ["junk"], receiver: "Test2" }, 422, { error: "One or more selected cards no longer exist", card_ids: ["junk"] }],
    [
      { combinedCards: [mine, outsiders], receiver: "Test2" },
      422,
      { error: "One or more selected cards are no longer owned by a trade participant", card_ids: [outsiders] },
    ],
    [
      { combinedCards: [lockedCard], receiver: "Test3" },
      422,
      { error: "One or more selected cards are already locked in another pending trade", card_ids: [lockedCard] },
    ],
  ];
  for (const [body, status, expected] of cases) {
    const res = await client.post("/api/v1/trades", body);
    assert.deepEqual([res.status, res.body], [status, expected], JSON.stringify(body));
  }
  assert.equal(Number((await db.query<RowDataPacket>("SELECT COUNT(*) AS n FROM trades"))[0].n), trades);

  const evil = await clientFor(USERS.Test1, "https://evil.example");
  assert.equal((await evil.post("/api/v1/trades", { combinedCards: [mine], receiver: "Test2" })).status, 403);
});

test("the same card cannot be offered in two trades created concurrently", async () => {
  const [card] = await giveCards(1, "Bronze", 1);
  const client = await clientFor(USERS.Test1);
  const results = await Promise.all(
    ["Test2", "Test3", "Test4", "Test2", "Test3"].map((receiver) => client.post("/api/v1/trades", { combinedCards: [card], receiver })),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 422).length, 4);
});

// --- accept --------------------------------------------------------------

async function proposal(fromId: number, toName: string, offered: string[], requested: string[]) {
  const user = Object.values(USERS).find((u) => u.id === fromId)!;
  const res = await (await clientFor(user)).post("/api/v1/trades", { combinedCards: [...offered, ...requested], receiver: toName });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id as number;
}

test("accepting swaps every card, closes the trade, and moves it to history", async () => {
  const offered = await giveCards(1, "Silver", 2);
  const requested = await giveCards(2, "Gold", 1);
  const tradeId = await proposal(1, "Test2", offered, requested);
  const receiver = await clientFor(USERS.Test2);

  const res = await receiver.request("PATCH", `/api/v1/trades/${tradeId}`, { combinedCards: [...requested, ...offered] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, "accepted");
  for (const uuid of offered) assert.equal(await ownerOf(uuid), 2);
  for (const uuid of requested) assert.equal(await ownerOf(uuid), 1);
  assert.equal((await tradeRow(tradeId)).status, 1);
  const accepts = await db.query<RowDataPacket>("SELECT accept FROM trade_participants WHERE trade_id = ?", [tradeId]);
  assert.ok(accepts.every((p) => p.accept === true));

  const list = (await receiver.get("/api/v1/trades")).body;
  assert.equal(list.trades.includes(tradeId), false);
  const entry = list.history.find((h: { id: number }) => h.id === tradeId);
  assert.deepEqual(
    { ...entry, completed_at: undefined },
    {
      id: tradeId,
      other_user: "Test1",
      status: "accepted",
      offered_card_count: 1,
      offered_rarity_counts: { Gold: 1 },
      received_card_count: 2,
      received_rarity_counts: { Silver: 2 },
      completed_at: undefined,
    },
  );
  assert.equal(list.history[0].id, tradeId, "newest first");

  // Transferred cards can be offered again by their new owner.
  assert.equal((await receiver.post("/api/v1/trades", { combinedCards: [offered[0]], receiver: "Test3" })).status, 201);
});

test("acceptance rules", async () => {
  const offered = await giveCards(1, "Bronze", 1);
  const requested = await giveCards(2, "Bronze", 1);
  const tradeId = await proposal(1, "Test2", offered, requested);
  const all = [...offered, ...requested];
  const patch = async (user: (typeof USERS)[keyof typeof USERS], cards: string[]) =>
    (await clientFor(user)).request("PATCH", `/api/v1/trades/${tradeId}`, { combinedCards: cards });

  assert.deepEqual(await patch(USERS.Test1, all).then((r) => [r.status, r.body]), [422, { error: "You have already accepted this offer" }]);
  assert.deepEqual(await patch(USERS.Test2, offered).then((r) => [r.status, r.body]), [
    422,
    { error: "Offered trades are locked and cannot be edited" },
  ]);
  assert.equal((await patch(USERS.Test3, all)).status, 404, "non-participants cannot accept");
  assert.equal((await new Client().request("PATCH", `/api/v1/trades/${tradeId}`, { combinedCards: all })).status, 401);
  assert.equal((await tradeRow(tradeId)).status, 0, "still pending");
  assert.equal(await ownerOf(offered[0]), 1);

  assert.equal((await patch(USERS.Test2, all)).status, 200);
  assert.equal((await patch(USERS.Test2, all)).status, 404, "an accepted trade cannot be accepted again");
});

test("acceptance fails, transferring nothing, when an offered card changed hands", async () => {
  const offered = await giveCards(1, "Bronze", 2);
  const requested = await giveCards(2, "Silver", 1);
  const tradeId = await proposal(1, "Test2", offered, requested);
  // The receiver's requested card leaves their collection (e.g. traded elsewhere).
  await db.execute("UPDATE user_cards SET user_id = 3 WHERE uuid = ?", [hex(requested[0])]);

  const list = (await (await clientFor(USERS.Test1)).get("/api/v1/trades")).body;
  assert.equal(list.trade_errors[list.trades.indexOf(tradeId)], true);
  const detail = (await (await clientFor(USERS.Test2)).get(`/api/v1/trades/${tradeId}`)).body;
  assert.deepEqual(detail.unavailable_card_ids, requested);

  const res = await (await clientFor(USERS.Test2)).request("PATCH", `/api/v1/trades/${tradeId}`, {
    combinedCards: [...offered, ...requested],
  });
  assert.equal(res.status, 422);
  assert.match(res.body.error, /^Trade cannot be accepted because cards are no longer available from their original owner: /);
  assert.deepEqual(res.body.card_ids, requested);
  for (const uuid of offered) assert.equal(await ownerOf(uuid), 1);
  assert.equal(await ownerOf(requested[0]), 3);
  assert.equal((await tradeRow(tradeId)).status, 0);

  // A deleted card is reported as missing.
  await db.execute("DELETE FROM user_cards WHERE uuid = ?", [hex(requested[0])]);
  const gone = await (await clientFor(USERS.Test2)).request("PATCH", `/api/v1/trades/${tradeId}`, {
    combinedCards: [...offered, ...requested],
  });
  assert.deepEqual([gone.status, gone.body], [422, { error: "One or more selected cards no longer exist", card_ids: requested }]);
});

test("concurrent acceptance of one trade transfers the cards exactly once", async () => {
  const offered = await giveCards(1, "Bronze", 1);
  const requested = await giveCards(2, "Bronze", 1);
  const tradeId = await proposal(1, "Test2", offered, requested);
  const receiver = await clientFor(USERS.Test2);
  const results = await Promise.all(
    Array.from({ length: 6 }, () => receiver.request("PATCH", `/api/v1/trades/${tradeId}`, { combinedCards: [...offered, ...requested] })),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.ok(results.every((r) => [200, 404].includes(r.status)));
  assert.equal(await ownerOf(offered[0]), 2);
  assert.equal(await ownerOf(requested[0]), 1);
});

test("two trades competing for the same card: only one can be accepted", async () => {
  const [contested] = await giveCards(2, "Gold", 1);
  const fromTest1 = await proposal(1, "Test2", await giveCards(1, "Bronze", 1), [contested]);
  const fromTest3 = await proposal(3, "Test2", await giveCards(3, "Bronze", 1), [contested]);
  const receiver = await clientFor(USERS.Test2);

  const accept = async (tradeId: number) => {
    const detail = (await receiver.get(`/api/v1/trades/${tradeId}`)).body;
    const cards = [...detail.user_trade_items, ...detail.user2_trade_items].map((c: { uuid: string }) => c.uuid);
    return receiver.request("PATCH", `/api/v1/trades/${tradeId}`, { combinedCards: cards });
  };
  const results = await Promise.all([accept(fromTest1), accept(fromTest3)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 422]);
  const winner = results[0].status === 200 ? 1 : 3;
  assert.equal(await ownerOf(contested), winner);

  const loser = winner === 1 ? fromTest3 : fromTest1;
  assert.equal((await tradeRow(loser)).status, 0, "the losing trade stays pending with an error flag");
  const list = (await receiver.get("/api/v1/trades")).body;
  assert.equal(list.trade_errors[list.trades.indexOf(loser)], true);
});

// --- decline -------------------------------------------------------------

test("declining a pending trade closes it and releases the proposer's cards", async () => {
  const offered = await giveCards(1, "Bronze", 1);
  const tradeId = await proposal(1, "Test2", offered, await giveCards(2, "Bronze", 1));

  assert.equal((await (await clientFor(USERS.Test3)).request("DELETE", `/api/v1/trades/${tradeId}`)).status, 404);
  assert.equal((await new Client().request("DELETE", `/api/v1/trades/${tradeId}`)).status, 401);
  assert.equal((await (await clientFor(USERS.Test2, null)).request("DELETE", `/api/v1/trades/${tradeId}`)).status, 403);
  assert.equal((await tradeRow(tradeId)).status, 0);

  const res = await (await clientFor(USERS.Test2)).request("DELETE", `/api/v1/trades/${tradeId}`);
  assert.deepEqual([res.status, res.body], [204, null]);
  assert.equal((await tradeRow(tradeId)).status, 2);
  const history = (await (await clientFor(USERS.Test1)).get("/api/v1/trades")).body.history;
  assert.equal(history.find((h: { id: number }) => h.id === tradeId)?.status, "declined");

  // The offered card is free again.
  assert.equal((await (await clientFor(USERS.Test1)).post("/api/v1/trades", { combinedCards: offered, receiver: "Test3" })).status, 201);
});

test("declining an accepted trade is a no-op", async () => {
  const offered = await giveCards(1, "Bronze", 1);
  const requested = await giveCards(2, "Bronze", 1);
  const tradeId = await proposal(1, "Test2", offered, requested);
  const receiver = await clientFor(USERS.Test2);
  await receiver.request("PATCH", `/api/v1/trades/${tradeId}`, { combinedCards: [...offered, ...requested] });
  assert.equal((await (await clientFor(USERS.Test1)).request("DELETE", `/api/v1/trades/${tradeId}`)).status, 204);
  assert.equal((await tradeRow(tradeId)).status, 1);
});
