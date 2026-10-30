import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { RowDataPacket } from "mysql2/promise";
import { Client, clientFor, db, loadFixture, resetDatabase, startServer, stopServer } from "./harness.ts";

// Fixture users Test1–Test5 (ids 1–5, forum uids 9001–9005); roles set per test run below.
const MODERATOR = { id: 1, forumUid: 9001 };
const NORMAL = { id: 4, forumUid: 9004 };
const ADMIN = { id: 5, forumUid: 9005 };

const roleOf = async (id: number) =>
  Number((await db.query<RowDataPacket>("SELECT status FROM users WHERE id = ?", [id]))[0].status);

before(startServer);

beforeEach(async () => {
  await resetDatabase([]);
  await loadFixture();
  await db.execute("UPDATE users SET status = 0 WHERE id = ?", [NORMAL.id]);
  await db.execute("UPDATE users SET status = 3 WHERE id = ?", [ADMIN.id]);
});

after(stopServer);

test("only admins can use the admin user endpoints", async () => {
  assert.equal((await new Client().get("/api/v1/admin/users")).status, 401);
  for (const user of [NORMAL, MODERATOR]) {
    const client = await clientFor(user);
    assert.deepEqual(await client.get("/api/v1/admin/users").then((r) => [r.status, r.body]), [
      403,
      { error: "You do not have permission to do that" },
    ]);
    assert.equal((await client.request("PATCH", `/api/v1/admin/users/${NORMAL.id}`, { role: "admin" })).status, 403);
  }
  assert.equal(await roleOf(NORMAL.id), 0, "nobody escalated");
});

test("admins list users with search and role filters", async () => {
  const admin = await clientFor(ADMIN);
  const all = (await admin.get("/api/v1/admin/users")).body;
  assert.equal(all.total, 6);
  assert.equal(all.limit, 100);
  assert.deepEqual(
    all.users.map((u: { username: string }) => u.username),
    ["AustinP0027", "Test1", "Test2", "Test3", "Test4", "Test5"],
  );
  assert.deepEqual(Object.keys(all.users[0]).sort(), ["created_at", "forum_uid", "id", "packs_available", "role", "username"]);
  assert.equal(JSON.stringify(all).includes("password"), false);

  const roles = Object.fromEntries(all.users.map((u: { username: string; role: string }) => [u.username, u.role]));
  assert.deepEqual(roles, {
    AustinP0027: "normal",
    Test1: "moderator",
    Test2: "moderator",
    Test3: "moderator",
    Test4: "normal",
    Test5: "admin",
  });

  assert.deepEqual((await admin.get("/api/v1/admin/users?search=TEST3")).body.users.map((u: { id: number }) => u.id), [3]);
  assert.equal((await admin.get("/api/v1/admin/users?search=%25")).body.total, 0, "LIKE wildcards are literal");
  assert.deepEqual(
    (await admin.get("/api/v1/admin/users?role=normal")).body.users.map((u: { username: string }) => u.username),
    ["AustinP0027", "Test4"],
  );
  assert.equal((await admin.get("/api/v1/admin/users?role=superuser")).status, 422);
});

test("role changes apply on the user's very next request", async () => {
  const admin = await clientFor(ADMIN);
  const target = await clientFor(NORMAL);
  assert.equal((await target.get("/api/v1/unapproved")).status, 403);

  const promoted = await admin.request("PATCH", `/api/v1/admin/users/${NORMAL.id}`, { role: "moderator" });
  assert.equal(promoted.status, 200);
  assert.deepEqual([promoted.body.id, promoted.body.username, promoted.body.role], [NORMAL.id, "Test4", "moderator"]);
  assert.equal(await roleOf(NORMAL.id), 1);
  assert.equal((await target.get("/api/v1/me")).body.status, "moderator");
  assert.equal((await target.get("/api/v1/unapproved")).status, 403, "moderators upload only; review stays admin-only");

  assert.equal((await admin.request("PATCH", `/api/v1/admin/users/${NORMAL.id}`, { role: "admin" })).status, 200);
  assert.equal((await target.get("/api/v1/admin/users")).status, 200, "new admins get the admin area without re-login");
  assert.equal((await target.get("/api/v1/unapproved")).status, 200, "and the review queue");

  assert.equal((await admin.request("PATCH", `/api/v1/admin/users/${NORMAL.id}`, { role: "normal" })).status, 200);
  assert.equal((await target.get("/api/v1/admin/users")).status, 403, "demotion is immediate");
  assert.equal((await target.get("/api/v1/unapproved")).status, 403);
});

test("admins cannot change their own role, and inputs are validated", async () => {
  const admin = await clientFor(ADMIN);
  const patch = (id: number | string, body: unknown) => admin.request("PATCH", `/api/v1/admin/users/${id}`, body);

  assert.deepEqual(await patch(ADMIN.id, { role: "normal" }).then((r) => [r.status, r.body]), [
    422,
    { error: "You cannot change your own role" },
  ]);
  assert.equal(await roleOf(ADMIN.id), 3);
  assert.deepEqual((await patch(NORMAL.id, { role: "superuser" })).body, {
    error: "Role must be one of: normal, moderator, admin",
  });
  assert.equal((await patch(NORMAL.id, {})).status, 422);
  assert.equal((await patch(NORMAL.id, { role: 3 })).status, 422, "role names only, not numbers");
  assert.equal((await patch(NORMAL.id, { role: "card_approver" })).status, 422, "retired role");
  assert.deepEqual(await patch(99999, { role: "normal" }).then((r) => [r.status, r.body]), [404, { error: "User not found" }]);
  assert.equal((await patch("abc", { role: "normal" })).status, 404);
  assert.equal((await admin.request("GET", `/api/v1/admin/users/${NORMAL.id}`)).status, 405);

  const evil = await clientFor(ADMIN, "https://evil.example");
  assert.equal((await evil.request("PATCH", `/api/v1/admin/users/${NORMAL.id}`, { role: "admin" })).status, 403);
  assert.equal(await roleOf(NORMAL.id), 0);
});

test("admins can use the card review endpoints, and /me identifies the user", async () => {
  const admin = await clientFor(ADMIN);
  assert.deepEqual((await admin.get("/api/v1/unapproved")).body, { all_cards: [] });
  assert.deepEqual((await admin.get("/api/v1/me")).body, { status: "admin", id: ADMIN.id, username: "Test5" });
});
