import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import type { RowDataPacket } from "mysql2/promise";
import { Client, clientFor, db, loadBaseline, loadFixture, resetDatabase, startServer, stopServer } from "./harness.ts";
import { fake, startFakeCloudinary, stopFakeCloudinary } from "./fakeCloudinary.ts";

const MODERATOR = { id: 1, forumUid: 9001 };
const NORMAL = { id: 4, forumUid: 9004 };
const ADMIN = { id: 5, forumUid: 9005 };

// A real 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const zipOf = (files: Record<string, Uint8Array>) => zipSync(files);
const pngs = (...names: string[]) => Object.fromEntries(names.map((name) => [name, new Uint8Array(PNG)]));

async function upload(client: Client, zip: Uint8Array | null) {
  const form = new FormData();
  if (zip) form.append("zip", new Blob([new Uint8Array(zip)], { type: "application/zip" }), "cards.zip");
  return client.post("/api/v1/original_cards", form);
}

const originals = async (where = "TRUE") => db.query<RowDataPacket>(`SELECT * FROM original_cards WHERE ${where} ORDER BY id`);
const uploadCalls = () => fake.calls.filter((c) => c.action === "upload").length;

before(async () => {
  await startFakeCloudinary();
  await startServer();
});

beforeEach(async () => {
  await resetDatabase(
    [MODERATOR, NORMAL, ADMIN].map((u) => ({ uid: u.forumUid, username: `Test${u.id}`, password: "unused" })),
  );
  await loadFixture();
  await db.execute("UPDATE users SET status = 0 WHERE id = ?", [NORMAL.id]);
  await db.execute("UPDATE users SET status = 3 WHERE id = ?", [ADMIN.id]);
  fake.reset();
});

after(async () => {
  await stopServer();
  await stopFakeCloudinary();
});

test("the review queue keeps the Rails response for admins; moderators no longer see it", async () => {
  const entries = (await loadBaseline()).filter((e) => e.path === "/api/v1/unapproved");
  assert.equal(entries.length, 3);
  for (const entry of entries) {
    // Recorded as moderators, who could see the queue in Rails; review is admin-only now.
    const id = Number(entry.user.replace("Test", ""));
    assert.equal((await (await clientFor({ id, forumUid: 9000 + id })).get("/api/v1/unapproved")).status, 403);
    const res = await (await clientFor(ADMIN)).get("/api/v1/unapproved");
    assert.deepEqual([res.status, res.body], [entry.status, entry.body]);
  }
});

test("moderators' uploads go to the review queue", async () => {
  const client = await clientFor(MODERATOR);
  const res = await upload(client, zipOf({ ...pngs("John_Doe-gold-S23.png", "Jane-Silver-23x.png"), "__MACOSX/._John_Doe-gold-S23.png": new Uint8Array([0]) }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.length, 2);

  const [john, jane] = res.body;
  assert.deepEqual(
    { name: john.name, cardtype: john.cardtype, season: john.season, approved: john.approved, team: john.team },
    { name: "John Doe", cardtype: "Gold", season: 23, approved: false, team: null },
  );
  assert.equal(jane.name, "Jane", "names without underscores are kept (Rails stored nil)");
  assert.equal(jane.cardtype, "Silver");
  assert.ok(fake.assets.has(`23/Unapproved/${john.api_id}`));
  assert.ok(fake.assets.has(`23/Unapproved/${jane.api_id}`));
  assert.equal(uploadCalls(), 2, "macOS metadata entries are skipped");

  const queue = (await (await clientFor(ADMIN)).get("/api/v1/unapproved")).body.all_cards;
  assert.deepEqual(queue.map((c: { id: number }) => c.id), [john.id, jane.id]);
  // Unapproved cards never appear in packs or the catalogue.
  assert.equal((await originals("approved = FALSE")).length, 2);
});

test("admins' uploads are approved immediately", async () => {
  const res = await upload(await clientFor(ADMIN), zipOf(pngs("Ana_Lopez-DIAMOND-season07.png")));
  assert.equal(res.status, 201);
  const [card] = res.body;
  assert.deepEqual([card.approved, card.cardtype, card.season], [true, "Diamond", 7]);
  assert.ok(fake.assets.has(`7/Diamond/${card.api_id}`), "folder uses the integer season, matching display URLs");
});

test("the team comes from the optional fourth filename segment, including accented names", async () => {
  const res = await upload(
    await clientFor(ADMIN),
    zipOf(pngs("Ana_Lopez-gold-S23-Xelajú_Cósmico_FC.png", "Bo_Li-gold-S23-Xelajú_Cósmico_FC-2.png", "Cy_Ng-silver-23.png")),
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(
    res.body.map((card: { name: string; team: string | null }) => [card.name, card.team]),
    [["Ana Lopez", "Xelajú Cósmico FC"], ["Bo Li", "Xelajú Cósmico FC"], ["Cy Ng", null]],
  );
  const stored = await originals(`id IN (${res.body.map((c: { id: number }) => c.id).join(",")})`);
  assert.deepEqual(stored.map((r) => r.team), ["Xelajú Cósmico FC", "Xelajú Cósmico FC", null]);
});

test("invalid uploads are rejected before anything reaches Cloudinary", async () => {
  const client = await clientFor(MODERATOR);
  const tooMany = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`P${i}_X-bronze-23.png`, new Uint8Array(PNG)]));
  const cases: [Uint8Array | null, number, RegExp][] = [
    [null, 422, /A ZIP file is required/],
    [new TextEncoder().encode("not a zip"), 422, /not a valid ZIP/],
    [zipOf({}), 422, /no card images/],
    [zipOf({ ...pngs("Good_Card-gold-23.png"), "notes.txt": new Uint8Array([1]) }), 422, /Every file must be a PNG/],
    [zipOf(pngs("Good_Card-gold-23.png", "Bad_Card-platinum-23.png")), 422, /Every file must be a PNG/],
    [zipOf(pngs("No_Season-gold-SX.png")), 422, /Every file must be a PNG/],
    [zipOf(pngs("TwoParts-gold.png")), 422, /Every file must be a PNG/],
    [zipOf({ "Fake_Png-gold-23.png": new TextEncoder().encode("GIF89a") }), 422, /not valid PNG/],
    [zipOf(tooMany), 422, /more than 200 files/],
  ];
  for (const [zip, status, message] of cases) {
    const res = await upload(client, zip);
    assert.equal(res.status, status, JSON.stringify(res.body));
    assert.match(res.body.error, message);
  }
  const bad = await upload(client, zipOf({ ...pngs("Good_Card-gold-23.png"), "dir/notes.txt": new Uint8Array([1]) }));
  assert.deepEqual(bad.body.files, ["notes.txt"]);

  assert.equal(uploadCalls(), 0);
  assert.equal((await originals("approved = FALSE")).length, 0);

  assert.equal((await upload(new Client(), zipOf(pngs("A_B-gold-23.png")))).status, 401);
  assert.deepEqual(await upload(await clientFor(NORMAL), zipOf(pngs("A_B-gold-23.png"))).then((r) => [r.status, r.body]), [
    403,
    { error: "You do not have permission to do that" },
  ], "regular users cannot upload");
  assert.equal((await upload(await clientFor(MODERATOR, "https://evil.example"), zipOf(pngs("A_B-gold-23.png")))).status, 403);
  assert.equal(uploadCalls(), 0);
});

test("a failed upload removes the images already uploaded and adds no cards", async () => {
  fake.failNext("upload", { after: 2 });
  const res = await upload(await clientFor(MODERATOR), zipOf(pngs("A_One-gold-23.png", "B_Two-gold-23.png", "C_Three-gold-23.png")));
  assert.equal(res.status, 502);
  assert.match(res.body.error, /^Uploading C_Three-gold-23\.png to Cloudinary failed; no cards were added$/);
  assert.equal(fake.assets.size, 0, "uploaded images were destroyed");
  assert.equal(fake.calls.filter((c) => c.action === "destroy").length, 2);
  assert.equal((await originals("approved = FALSE")).length, 0);
});

test("only admins can see the queue, approve, or delete", async () => {
  const [card] = await queueTwo();
  for (const user of [NORMAL, MODERATOR]) {
    const client = await clientFor(user);
    assert.deepEqual(await client.get("/api/v1/unapproved").then((r) => [r.status, r.body]), [
      403,
      { error: "You do not have permission to do that" },
    ]);
    assert.equal((await client.post("/api/v1/approved", { ids: [card.id] })).status, 403);
    assert.equal((await client.post("/api/v1/delete_cards", { ids: [card.id] })).status, 403);
  }
  assert.equal((await new Client().get("/api/v1/unapproved")).status, 401);
  assert.equal((await originals("approved = FALSE")).length, 2, "nothing approved or deleted");
  assert.equal((await (await clientFor(ADMIN)).get("/api/v1/unapproved")).status, 200);
});

async function queueTwo() {
  const res = await upload(await clientFor(MODERATOR), zipOf(pngs("A_One-gold-23.png", "B_Two-silver-23.png")));
  assert.equal(res.status, 201);
  return res.body as { id: number; api_id: string }[];
}

test("approving moves images to the rarity folder and marks the cards approved", async () => {
  const [gold, silver] = await queueTwo();
  const res = await (await clientFor(ADMIN)).post("/api/v1/approved", { ids: [gold.id, silver.id] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.length, 2);
  assert.deepEqual(fake.assets.get(`23/Gold/${gold.api_id}`)?.asset_folder, "23/Gold", "same folder convention as existing images");
  assert.ok(fake.assets.has(`23/Silver/${silver.api_id}`));
  assert.equal(fake.assets.has(`23/Unapproved/${gold.api_id}`), false);
  assert.equal((await originals("approved = FALSE")).length, 0);
  assert.deepEqual((await (await clientFor(ADMIN)).get("/api/v1/unapproved")).body, { all_cards: [] });
});

test("approval validates ids and refuses already-approved cards", async () => {
  const client = await clientFor(ADMIN);
  const [approvedOriginal] = await originals("approved = TRUE");
  assert.deepEqual((await client.post("/api/v1/approved", { ids: [] })).status, 422);
  assert.deepEqual((await client.post("/api/v1/approved", {})).status, 422);
  assert.deepEqual((await client.post("/api/v1/approved", { ids: ["x"] })).status, 422);
  assert.deepEqual((await client.post("/api/v1/approved", { ids: [99999] })).body, { error: "Some cards were not found", ids: [99999] });
  assert.deepEqual((await client.post("/api/v1/approved", { ids: [approvedOriginal.id] })).body, {
    error: "Some cards are already approved",
    ids: [approvedOriginal.id],
  });
  assert.equal(fake.calls.length, 0);
});

test("a failed rename restores the image folder and leaves the card unapproved; other cards still succeed", async () => {
  const [gold, silver] = await queueTwo();
  fake.failNext("rename");
  const res = await (await clientFor(ADMIN)).post("/api/v1/approved", { ids: [gold.id, silver.id] });
  assert.equal(res.status, 502);
  assert.deepEqual(res.body.approved, [silver.id]);
  assert.deepEqual(res.body.failed.map((f: { id: number }) => f.id), [gold.id]);

  assert.equal(fake.assets.get(`23/Unapproved/${gold.api_id}`)?.asset_folder, "23/Unapproved", "folder restored");
  assert.ok(fake.assets.has(`23/Silver/${silver.api_id}`));
  const rows = await originals(`id IN (${gold.id}, ${silver.id})`);
  assert.deepEqual(rows.map((r) => [r.id, r.approved]), [[gold.id, false], [silver.id, true]]);

  // The failed card can be approved on retry.
  assert.equal((await (await clientFor(ADMIN)).post("/api/v1/approved", { ids: [gold.id] })).status, 200);
});

test("deleting removes unapproved images and rows", async () => {
  const [gold, silver] = await queueTwo();
  fake.assets.delete(`23/Unapproved/${silver.api_id}`); // already gone from Cloudinary
  const res = await (await clientFor(ADMIN)).post("/api/v1/delete_cards", { ids: [gold.id, silver.id] });
  assert.deepEqual([res.status, res.body], [200, null]);
  assert.equal(fake.assets.size, 0);
  assert.equal((await originals(`id IN (${gold.id}, ${silver.id})`)).length, 0);
});

test("delete refuses approved cards and keeps rows whose image could not be destroyed", async () => {
  const client = await clientFor(ADMIN);
  const [approvedOriginal] = await originals("approved = TRUE");
  assert.equal((await client.post("/api/v1/delete_cards", { ids: [approvedOriginal.id] })).status, 422);
  assert.equal((await originals(`id = ${approvedOriginal.id}`)).length, 1, "Rails deleted approved rows while leaving their images");

  const [gold] = await queueTwo();
  fake.failNext("destroy");
  const res = await client.post("/api/v1/delete_cards", { ids: [gold.id] });
  assert.equal(res.status, 502);
  assert.deepEqual(res.body.deleted, []);
  assert.equal((await originals(`id = ${gold.id}`)).length, 1);
  assert.ok(fake.assets.has(`23/Unapproved/${gold.api_id}`));
});
