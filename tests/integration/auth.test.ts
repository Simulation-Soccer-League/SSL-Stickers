import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import type { RowDataPacket } from "mysql2/promise";
import { Client, PACK_GRANT_TOKEN, SESSION_SECRET, db, resetDatabase, startServer, stopServer } from "./harness.ts";

const forumUsers = [
  { uid: 101, username: "Alice", password: "alice-pw" },
  { uid: 102, username: "Bob", password: "bob-pw", algorithm: "bcrypt" },
  { uid: 103, username: "Banned", password: "pw", usergroup: 7 },
  { uid: 104, username: "Pending", password: "pw", usergroup: 5 },
  { uid: 105, username: "Argon", password: "pw", algorithm: "argon2" },
  { uid: 106, username: "Legacy", password: "legacy-pw" },
  { uid: 107, username: "RenamedNow", password: "renamed-pw" },
  { uid: 108, username: "Locked", password: "locked-pw" },
];

type UserRow = RowDataPacket & { id: number; username: string; forum_uid: number | null; packs_available: number; status: number };
const usersByName = async () =>
  new Map((await db.query<UserRow>("SELECT * FROM users ORDER BY id")).map((u) => [u.username, u]));

before(async () => {
  await resetDatabase(forumUsers);
  // A pre-migration row with no forum link, and a linked row whose forum account was renamed.
  await db.execute(
    "INSERT INTO users (username, status, packs_available, created_at, updated_at) VALUES ('Legacy', 1, 3, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
  );
  await db.execute(
    "INSERT INTO users (username, forum_uid, status, packs_available, created_at, updated_at) VALUES ('RenamedBefore', 107, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
  );
  await startServer();
});

after(stopServer);

test("legacy MD5 login creates the user, sets a secure session cookie, and hides secrets", async () => {
  const client = new Client();
  const res = await client.post("/api/v1/login", { username: "alice", password: "alice-pw" });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ["id", "username"]);
  assert.equal(res.body.username, "Alice", "username comes from the forum account");

  const cookie = client.lastSetCookie.find((c) => c.startsWith("ssl_session="));
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=2592000/);

  const alice = (await usersByName()).get("Alice")!;
  assert.equal(alice.forum_uid, 101);
  assert.equal(alice.status, 0);
  assert.equal(alice.packs_available, 0);

  assert.deepEqual((await client.get("/api/v1/me")).body, { status: "normal", id: alice.id, username: "Alice" });
});

test("bcrypt login works", async () => {
  const res = await new Client().post("/api/v1/login", { username: "Bob", password: "bob-pw" });
  assert.equal(res.status, 200);
});

test("bad credentials, blocked groups, and unsupported hashes are refused", async () => {
  const client = new Client();
  assert.deepEqual(await client.post("/api/v1/login", { username: "Alice", password: "nope" }).then((r) => [r.status, r.body]), [
    401,
    { error: "Invalid credentials" },
  ]);
  assert.equal((await client.post("/api/v1/login", { username: "Nobody", password: "x" })).status, 401);
  assert.equal((await client.post("/api/v1/login", {})).status, 401);
  assert.deepEqual((await client.post("/api/v1/login", { username: "Banned", password: "pw" })).body, {
    error: "Your forum account is banned",
  });
  assert.equal((await client.post("/api/v1/login", { username: "Pending", password: "pw" })).status, 403);
  // Wrong password for a banned account must not reveal the ban.
  assert.equal((await client.post("/api/v1/login", { username: "Banned", password: "bad" })).status, 401);
  assert.equal((await client.post("/api/v1/login", { username: "Argon", password: "pw" })).status, 401);
  assert.equal(client.cookies.has("ssl_session"), false);
  assert.equal((await usersByName()).has("Banned"), false);
});

test("login and logout reject cross-site requests", async () => {
  const noOrigin = new Client(null);
  assert.equal((await noOrigin.post("/api/v1/login", { username: "Alice", password: "alice-pw" })).status, 403);
  const evil = new Client("https://evil.example");
  assert.equal((await evil.post("/api/v1/login", { username: "Alice", password: "alice-pw" })).status, 403);
  assert.equal((await evil.post("/api/v1/logout")).status, 403);
});

test("first login links a pre-existing unlinked row instead of creating a duplicate", async () => {
  const res = await new Client().post("/api/v1/login", { username: "Legacy", password: "legacy-pw" });
  assert.equal(res.status, 200);
  const legacy = [...(await usersByName()).values()].filter((u) => u.username === "Legacy");
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].forum_uid, 106);
  assert.equal(legacy[0].packs_available, 3, "existing data kept");
  assert.equal(res.body.id, legacy[0].id);
});

test("login follows forum renames by uid", async () => {
  const res = await new Client().post("/api/v1/login", { username: "RenamedNow", password: "renamed-pw" });
  assert.equal(res.status, 200);
  const users = await usersByName();
  assert.equal(users.get("RenamedNow")?.forum_uid, 107);
  assert.equal(users.has("RenamedBefore"), false);
});

test("me and users_but_me require a session", async () => {
  const anonymous = new Client();
  assert.deepEqual(await anonymous.get("/api/v1/me").then((r) => [r.status, r.body]), [401, { user: null }]);
  assert.deepEqual(await anonymous.get("/api/v1/users_but_me").then((r) => [r.status, r.body]), [
    401,
    { error: "You must be logged in" },
  ]);

  const client = new Client();
  await client.post("/api/v1/login", { username: "Alice", password: "alice-pw" });
  const names = (await client.get("/api/v1/users_but_me")).body as string[];
  const ordered = [...(await usersByName()).values()].sort((a, b) => a.id - b.id).map((u) => u.username);
  assert.deepEqual(names, ordered.filter((name) => name !== "Alice"));
});

test("role is reported from users.status", async () => {
  const client = new Client();
  await client.post("/api/v1/login", { username: "Legacy", password: "legacy-pw" });
  assert.equal((await client.get("/api/v1/me")).body.status, "moderator");
});

test("logout clears the session cookie", async () => {
  const client = new Client();
  await client.post("/api/v1/login", { username: "Alice", password: "alice-pw" });
  const res = await client.post("/api/v1/logout");
  assert.equal(res.status, 204);
  assert.ok(client.lastSetCookie.some((c) => c.startsWith("ssl_session=;") && /Max-Age=0/.test(c)));
  assert.equal((await client.get("/api/v1/me")).status, 401);
});

async function token(claims: { sub: string; fuid: number }, iatSecondsAgo: number, secret = SESSION_SECRET) {
  const iat = Math.floor(Date.now() / 1000) - iatSecondsAgo;
  return new SignJWT({ fuid: claims.fuid })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 30 * 24 * 3600)
    .sign(new TextEncoder().encode(secret));
}

test("forged, mismatched, and expired tokens are rejected and cleared", async () => {
  const alice = (await usersByName()).get("Alice")!;
  const cases = [
    await token({ sub: String(alice.id), fuid: 101 }, 0, "some-other-secret-that-is-long-enough!!"),
    await token({ sub: String(alice.id), fuid: 999 }, 0),
    await token({ sub: String(alice.id), fuid: 101 }, 31 * 24 * 3600),
    "not-a-jwt",
  ];
  for (const value of cases) {
    const client = new Client();
    client.cookies.set("ssl_session", value);
    assert.equal((await client.get("/api/v1/me")).status, 401);
    assert.equal(client.cookies.has("ssl_session"), false);
  }
});

test("sessions older than a day are renewed, and dropped once the forum account is banned", async () => {
  const alice = (await usersByName()).get("Alice")!;
  const client = new Client();
  const old = await token({ sub: String(alice.id), fuid: 101 }, 2 * 24 * 3600);
  client.cookies.set("ssl_session", old);
  assert.equal((await client.get("/api/v1/me")).status, 200);
  assert.notEqual(client.cookies.get("ssl_session"), old, "token reissued");

  const fresh = new Client();
  fresh.cookies.set("ssl_session", await token({ sub: String(alice.id), fuid: 101 }, 60));
  assert.equal((await fresh.get("/api/v1/me")).status, 200);
  assert.equal(fresh.lastSetCookie.length, 0, "recent tokens are not reissued");

  await db.execute("UPDATE mybb_users SET usergroup = 7 WHERE uid = 101");
  try {
    client.cookies.set("ssl_session", await token({ sub: String(alice.id), fuid: 101 }, 2 * 24 * 3600));
    assert.equal((await client.get("/api/v1/me")).status, 401);
  } finally {
    await db.execute("UPDATE mybb_users SET usergroup = 2 WHERE uid = 101");
  }
});

test("pack grants require the bearer token and increment packs atomically", async () => {
  const external = new Client(null);
  const grant = (body: unknown, auth = `Bearer ${PACK_GRANT_TOKEN}`) =>
    external.post("/api/v1/external/pack_grants", body, { Authorization: auth });

  assert.deepEqual(await grant({ username: "Bob" }, "").then((r) => [r.status, r.body]), [401, { error: "Unauthorized" }]);
  assert.equal((await grant({ username: "Bob" }, "Bearer wrong")).status, 401);
  assert.equal((await grant({})).status, 400);
  assert.deepEqual(await grant({ username: "Nobody" }).then((r) => [r.status, r.body]), [404, { error: "User not found" }]);

  // Creates the stickers user for a forum account that never logged in.
  await db.execute("DELETE FROM users WHERE forum_uid = 102");
  const results = await Promise.all(Array.from({ length: 5 }, () => grant({ username: "bob" })));
  assert.ok(results.every((r) => r.status === 200));
  assert.deepEqual(
    results.map((r) => r.body.packs_available).sort(),
    [1, 2, 3, 4, 5],
    "concurrent grants all count",
  );
  assert.equal(results[0].body.username, "Bob");
  const bobs = [...(await usersByName()).values()].filter((u) => u.forum_uid === 102);
  assert.equal(bobs.length, 1, "concurrent first grants create one user");
  assert.equal(bobs[0].packs_available, 5);
});

test("repeated failed logins are rate limited", async () => {
  const client = new Client();
  for (let i = 0; i < 10; i++) {
    assert.equal((await client.post("/api/v1/login", { username: "Locked", password: "bad" })).status, 401);
  }
  const blocked = await client.post("/api/v1/login", { username: "Locked", password: "locked-pw" });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});
