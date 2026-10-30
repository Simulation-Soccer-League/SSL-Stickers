import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import {
  Client,
  RARITIES,
  type Rarity,
  clientFor,
  db,
  giveCards,
  loadBaseline,
  loadFixture,
  resetDatabase,
  sessionToken,
  startServer,
  stopServer,
} from "./harness.ts";

const USERS = { Test1: { id: 1, forumUid: 9001 }, Test2: { id: 2, forumUid: 9002 }, Test3: { id: 3, forumUid: 9003 } };

const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.query<RowDataPacket & { n: number }>(sql, params))[0].n);
const packsOf = (userId: number) => count("SELECT packs_available AS n FROM users WHERE id = ?", [userId]);
const cardsOf = (userId: number) => count("SELECT COUNT(*) AS n FROM user_cards WHERE user_id = ?", [userId]);

before(async () => {
  await startServer();
});

beforeEach(async () => {
  await resetDatabase(Object.entries(USERS).map(([username, u]) => ({ uid: u.forumUid, username, password: "unused" })));
  await loadFixture();
});

after(stopServer);

test("pack_count matches the Rails baseline", async () => {
  const entries = (await loadBaseline()).filter((e) => e.path === "/api/v1/pack_count");
  assert.equal(entries.length, 4);
  for (const entry of entries) {
    const user = USERS[entry.user as keyof typeof USERS];
    const client = user ? await clientFor(user) : new Client();
    const res = await client.get("/api/v1/pack_count");
    assert.deepEqual([res.status, res.body], [entry.status, entry.body], entry.user);
  }
});

test("opening a pack grants five approved cards and spends one pack", async () => {
  const client = await clientFor(USERS.Test2);
  const before = { packs: await packsOf(2), cards: await cardsOf(2) };
  const owned = new Set(
    (await db.query<RowDataPacket>("SELECT CONCAT(season, '/', cardtype, '/', api_id) AS k FROM user_cards WHERE user_id = 2")).map(
      (r) => String(r.k),
    ),
  );

  const res = await client.post("/api/v1/pack");
  assert.equal(res.status, 200);
  assert.equal(res.body.packs_available, before.packs - 1);
  assert.equal(await packsOf(2), before.packs - 1);
  assert.equal(await cardsOf(2), before.cards + 5);
  assert.equal(res.body.cards.length, 5);

  const seen = new Set<string>();
  for (const card of res.body.cards as { public_id: string; rarity: Rarity; new_card: boolean }[]) {
    const [season, rarity, apiId] = card.public_id.split("/");
    assert.equal(rarity, card.rarity);
    const [original] = await db.query<RowDataPacket>(
      "SELECT approved FROM original_cards WHERE season = ? AND cardtype = ? AND api_id = ?",
      [season, RARITIES.indexOf(card.rarity), apiId],
    );
    assert.equal(original?.approved, true, `${card.public_id} is an approved original`);
    const k = `${season}/${RARITIES.indexOf(card.rarity)}/${apiId}`;
    assert.equal(card.new_card, !owned.has(k) && !seen.has(k), `new_card for ${card.public_id}`);
    seen.add(k);
  }
});

test("users without packs get 422 and nothing changes", async () => {
  const client = await clientFor(USERS.Test1);
  const cards = await cardsOf(1);
  const res = await client.post("/api/v1/pack");
  assert.deepEqual([res.status, res.body], [422, { error: "No packs available" }]);
  assert.equal(await cardsOf(1), cards);
  assert.equal(await packsOf(1), 0);
});

test("concurrent pack opening never spends more packs than the user has", async () => {
  await db.execute("UPDATE users SET packs_available = 3 WHERE id = 3");
  const cards = await cardsOf(3);
  const client = await clientFor(USERS.Test3);
  const results = await Promise.all(Array.from({ length: 10 }, () => client.post("/api/v1/pack")));
  assert.equal(results.filter((r) => r.status === 200).length, 3);
  assert.equal(results.filter((r) => r.status === 422).length, 7);
  assert.equal(await packsOf(3), 0);
  assert.equal(await cardsOf(3), cards + 15);
});

test("packs only contain approved cards", async () => {
  // Leave one approved card per rarity; everything else becomes unapproved.
  await db.execute(
    `UPDATE original_cards o
       LEFT JOIN (SELECT MIN(id) AS id FROM original_cards GROUP BY cardtype) keep ON keep.id = o.id
        SET o.approved = (keep.id IS NOT NULL)`,
  );
  const allowed = new Set(
    (await db.query<RowDataPacket>("SELECT CONCAT(season, '/', cardtype, '/', api_id) AS k FROM original_cards WHERE approved")).map(
      (r) => String(r.k),
    ),
  );
  assert.equal(allowed.size, 4);
  await db.execute("UPDATE users SET packs_available = 20 WHERE id = 2");
  const client = await clientFor(USERS.Test2);
  for (let i = 0; i < 20; i++) {
    const res = await client.post("/api/v1/pack");
    assert.equal(res.status, 200);
    for (const card of res.body.cards as { public_id: string; rarity: Rarity }[]) {
      const [season, , apiId] = card.public_id.split("/");
      assert.ok(allowed.has(`${season}/${RARITIES.indexOf(card.rarity)}/${apiId}`), card.public_id);
    }
  }
});

test("a rarity with no approved cards rolls back without spending the pack", async () => {
  await db.execute("UPDATE original_cards SET approved = FALSE");
  const client = await clientFor(USERS.Test2);
  const before = { packs: await packsOf(2), cards: await cardsOf(2) };
  const res = await client.post("/api/v1/pack");
  assert.equal(res.status, 503);
  assert.match(res.body.error, /^No approved \w+ cards are available; your pack was not used$/);
  assert.deepEqual({ packs: await packsOf(2), cards: await cardsOf(2) }, before);
});

test("packs require login and a same-site request", async () => {
  assert.deepEqual(await new Client().post("/api/v1/pack").then((r) => [r.status, r.body]), [
    401,
    { error: "You must be logged in" },
  ]);
  const evil = new Client("https://evil.example");
  evil.cookies.set("ssl_session", await sessionToken(2, 9002));
  assert.equal((await evil.post("/api/v1/pack")).status, 403);
  assert.equal(await packsOf(2), 8);
});

// --- factory -------------------------------------------------------------

const recipes: [Rarity, Rarity, number][] = [
  ["Bronze", "Bronze", 2],
  ["Silver", "Bronze", 5],
  ["Silver", "Silver", 2],
  ["Gold", "Silver", 5],
  ["Gold", "Gold", 2],
  ["Diamond", "Gold", 5],
  ["Diamond", "Diamond", 2],
];

test("every factory recipe consumes its inputs and awards an approved card of the requested rarity", async () => {
  const client = await clientFor(USERS.Test3);
  for (const [output, input, n] of recipes) {
    const inputs = await giveCards(3, input, n);
    const before = await cardsOf(3);
    const res = await client.post("/api/v1/factory_pack", { cards: inputs, rarity: output });
    assert.equal(res.status, 200, `${n} ${input} -> ${output}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.cardtype, output);
    assert.equal(res.body.approved, true);
    assert.deepEqual(
      Object.keys(res.body).sort(),
      ["api_id", "approved", "cardtype", "created_at", "id", "name", "season", "team", "updated_at"],
    );
    assert.match(res.body.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.equal(await cardsOf(3), before - n + 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM user_cards WHERE uuid IN (?)", [inputs.map((u) => Buffer.from(u.replace(/-/g, ""), "hex"))]), 0);
    assert.equal(
      await count("SELECT COUNT(*) AS n FROM user_cards WHERE user_id = 3 AND api_id = ? AND season = ? AND cardtype = ?", [
        res.body.api_id,
        res.body.season,
        RARITIES.indexOf(output),
      ]) >= 1,
      true,
      "reward is in the collection",
    );
  }
});

test("factory rewards are never unapproved", async () => {
  await db.execute(
    `UPDATE original_cards o
       LEFT JOIN (SELECT MIN(id) AS id FROM original_cards WHERE cardtype = 0) keep ON keep.id = o.id
        SET o.approved = (keep.id IS NOT NULL) WHERE o.cardtype = 0`,
  );
  const [onlyBronze] = await db.query<RowDataPacket>("SELECT id FROM original_cards WHERE cardtype = 0 AND approved");
  const client = await clientFor(USERS.Test3);
  for (let i = 0; i < 10; i++) {
    const res = await client.post("/api/v1/factory_pack", { cards: await giveCards(3, "Bronze", 2), rarity: "Bronze" });
    assert.equal(res.body.id, onlyBronze.id);
  }
});

test("invalid factory requests are rejected without consuming cards", async () => {
  const client = await clientFor(USERS.Test3);
  const bronze = await giveCards(3, "Bronze", 3);
  const silver = await giveCards(3, "Silver", 1);
  const othersCard = (await giveCards(2, "Bronze", 1))[0];
  const [lockedRow] = await db.query<RowDataPacket>(
    `SELECT LOWER(HEX(ti.user_card_id)) AS hex FROM trade_items ti
       JOIN trades t ON t.id = ti.trade_id AND t.status = 0
       JOIN trade_participants p ON p.trade_id = t.id AND p.accept = TRUE AND p.user_id = ti.offered_by_user_id
       JOIN user_cards c ON c.uuid = ti.user_card_id AND c.user_id = ti.offered_by_user_id
      LIMIT 1`,
  );
  assert.ok(lockedRow, "fixture has a card locked in a pending trade");
  const hex = String(lockedRow.hex);
  const locked = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const [lockedOwner] = await db.query<RowDataPacket>("SELECT user_id FROM user_cards WHERE uuid = UNHEX(?)", [hex]);
  const ownerClient = await clientFor(Object.values(USERS).find((u) => u.id === lockedOwner.user_id)!);
  const ownerBronze = await giveCards(lockedOwner.user_id, "Bronze", 1);

  const total = await count("SELECT COUNT(*) AS n FROM user_cards");
  const generic = "Selected cards are unavailable, locked in a trade, or invalid for this exchange";
  const cases: [Client, unknown, number, string][] = [
    [client, { cards: [], rarity: "Bronze" }, 400, "Invalid factory card selection"],
    [client, { cards: [bronze[0], bronze[0]], rarity: "Bronze" }, 400, "Invalid factory card selection"],
    [client, { cards: ["not-a-uuid", bronze[0]], rarity: "Bronze" }, 400, "Invalid factory card selection"],
    [client, { cards: bronze.slice(0, 2), rarity: "Platinum" }, 400, "Invalid factory rarity"],
    [client, { cards: bronze.slice(0, 2) }, 400, "Invalid factory rarity"],
    [client, { cards: bronze, rarity: "Silver" }, 400, generic],
    [client, { cards: [bronze[0], silver[0]], rarity: "Silver" }, 400, generic],
    [client, { cards: [bronze[0], othersCard], rarity: "Bronze" }, 400, generic],
    [client, { cards: [bronze[0], randomUUID()], rarity: "Bronze" }, 400, generic],
    [ownerClient, { cards: [locked, ownerBronze[0]], rarity: "Bronze" }, 400, generic],
  ];
  for (const [who, body, status, error] of cases) {
    const res = await who.post("/api/v1/factory_pack", body);
    assert.deepEqual([res.status, res.body], [status, { error }], JSON.stringify(body));
  }
  assert.equal(await count("SELECT COUNT(*) AS n FROM user_cards"), total, "no cards consumed");

  assert.equal((await new Client().post("/api/v1/factory_pack", { cards: bronze.slice(0, 2), rarity: "Bronze" })).status, 401);
});

test("a factory rarity with no approved cards keeps the inputs", async () => {
  const client = await clientFor(USERS.Test3);
  const inputs = await giveCards(3, "Gold", 2);
  await db.execute("UPDATE original_cards SET approved = FALSE WHERE cardtype = 2");
  const res = await client.post("/api/v1/factory_pack", { cards: inputs, rarity: "Gold" });
  assert.deepEqual([res.status, res.body], [503, { error: "No approved Gold cards are available; your cards were not used" }]);
  assert.equal(await count("SELECT COUNT(*) AS n FROM user_cards WHERE uuid IN (?)", [inputs.map((u) => Buffer.from(u.replace(/-/g, ""), "hex"))]), 2);
});

test("the same cards cannot be exchanged twice concurrently", async () => {
  const client = await clientFor(USERS.Test3);
  const inputs = await giveCards(3, "Bronze", 2);
  const before = await cardsOf(3);
  const results = await Promise.all(Array.from({ length: 5 }, () => client.post("/api/v1/factory_pack", { cards: inputs, rarity: "Bronze" })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 400).length, 4);
  assert.equal(await cardsOf(3), before - 1);
});
