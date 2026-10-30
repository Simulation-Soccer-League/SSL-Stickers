// Replays the recorded Rails collection responses (tests/fixtures/rails-baseline.json)
// against the Next.js routes, on the same data (tests/fixtures/baseline-db.sql).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type BaselineEntry, Client, loadBaseline, loadFixture, resetDatabase, sessionToken, startServer, stopServer } from "./harness.ts";

const USERS: Record<string, { id: number; forumUid: number }> = {
  Test1: { id: 1, forumUid: 9001 },
  Test2: { id: 2, forumUid: 9002 },
  Test3: { id: 3, forumUid: 9003 },
};
const COLLECTION_PATHS = ["/api/v1/user_cards", "/api/v1/get_user_card_count", "/api/v1/cards_with_params", "/api/v1/cards_by_rarity"];

let baseline: BaselineEntry[] = [];

before(async () => {
  await resetDatabase(Object.entries(USERS).map(([username, u]) => ({ uid: u.forumUid, username, password: "unused" })));
  await loadFixture();
  baseline = (await loadBaseline()).filter((entry) => COLLECTION_PATHS.includes(entry.path));
  await startServer();
});

after(stopServer);

async function replay(entry: BaselineEntry) {
  const client = new Client();
  const user = USERS[entry.user];
  if (user) client.cookies.set("ssl_session", await sessionToken(user.id, user.forumUid));

  if (entry.method === "GET") {
    const qs = entry.params ? `?${new URLSearchParams(Object.entries(entry.params).map(([k, v]) => [k, String(v)]))}` : "";
    return client.get(entry.path + qs);
  }
  const form = new FormData();
  for (const [k, v] of Object.entries(entry.params ?? {})) form.append(k, String(v));
  return client.post(entry.path, form);
}

const describe = (entry: BaselineEntry) => `${entry.user} ${entry.method} ${entry.path} ${JSON.stringify(entry.params)}`;

test("logged-in collection responses match Rails exactly", async () => {
  const entries = baseline.filter((entry) => entry.user in USERS);
  assert.equal(entries.length, 57, "expected every recorded logged-in collection request");
  const mismatches: string[] = [];
  for (const entry of entries) {
    const res = await replay(entry);
    try {
      assert.equal(res.status, entry.status);
      assert.deepEqual(res.body, entry.body);
    } catch (error) {
      mismatches.push(`${describe(entry)}\n${(error as Error).message.slice(0, 1500)}`);
    }
  }
  assert.equal(mismatches.length, 0, `${mismatches.length}/${entries.length} mismatches:\n\n${mismatches.join("\n\n")}`);
});

test("collection endpoints now require login (Rails served anonymous callers)", async () => {
  for (const entry of baseline.filter((e) => e.user === "anonymous")) {
    assert.equal((await replay(entry)).status, 401, describe(entry));
  }
  const anonymous = new Client();
  assert.equal((await anonymous.get("/api/v1/user_cards")).status, 401);
  assert.equal((await anonymous.get("/api/v1/get_user_card_count")).status, 401);
  assert.equal((await anonymous.post("/api/v1/cards_by_rarity", new FormData())).status, 401);
});

test("legacy non-visual cards_by_rarity is rejected", async () => {
  const client = new Client();
  client.cookies.set("ssl_session", await sessionToken(1, 9001));
  const form = new FormData();
  form.append("cardtype", "Bronze");
  form.append("name", "undefined");
  assert.equal((await client.post("/api/v1/cards_by_rarity", form)).status, 400);
});

test("cards_by_rarity for an unknown user returns an empty list", async () => {
  const client = new Client();
  client.cookies.set("ssl_session", await sessionToken(1, 9001));
  const form = new FormData();
  form.append("visual", "true");
  form.append("name", "NoSuchUser");
  const res = await client.post("/api/v1/cards_by_rarity", form);
  assert.deepEqual([res.status, res.body], [200, []]);
});

test("pagination input is validated and LIKE wildcards are literal", async () => {
  const client = new Client();
  client.cookies.set("ssl_session", await sessionToken(1, 9001));
  const search = async (fields: Record<string, string>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries({ name: "", sort: "", page: "1", per_page: "10", include_unowned: "false", ...fields })) {
      form.append(k, v);
    }
    return (await client.post("/api/v1/cards_with_params", form)).body as { cards: unknown[]; count: number };
  };
  const first = await search({});
  assert.deepEqual(await search({ page: "0" }), first, "page 0 falls back to page 1");
  assert.deepEqual(await search({ page: "abc", per_page: "-5" }), first, "junk falls back to defaults");
  assert.equal((await search({ per_page: "100000" })).cards.length, Math.min(first.count, 100), "per_page is capped at 100");
  assert.equal((await search({ name: "%" })).count, 0, "a literal % matches nothing");
  assert.equal((await search({ name: "_" })).count, 0, "a literal _ matches nothing");
});
