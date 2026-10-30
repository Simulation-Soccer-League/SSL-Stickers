// Integration test harness: runs the production build (`next start`) against
// the disposable myapp_test database, with a stand-in MyBB users table inside
// it, so tests never touch development data or the real forum database.
//
// Run with `npm run test:integration` (builds first).
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { FAKE_CLOUDINARY_URL } from "./fakeCloudinary.ts";

export const TEST_DATABASE = process.env.TEST_MYSQL_DATABASE ?? "myapp_test";
export const PACK_GRANT_TOKEN = "test-pack-grant-token";
export const SESSION_SECRET = "integration-test-session-secret-0123456789";
const PORT = Number(process.env.TEST_PORT ?? 3100);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

if (!TEST_DATABASE.endsWith("_test")) throw new Error(`Refusing to run integration tests against ${TEST_DATABASE}`);

// Point every pool at the test database before the DB module loads.
process.env.MYSQL_DATABASE = TEST_DATABASE;
process.env.MYBB_DATABASE = TEST_DATABASE;
delete process.env.MYBB_MYSQL_HOST;
delete process.env.MYBB_MYSQL_USERNAME;
delete process.env.MYBB_MYSQL_PASSWORD;
process.env.SESSION_SECRET = SESSION_SECRET;
// Never let tests reach the real Cloudinary account configured in .env.local.
process.env.CLOUDINARY_URL = FAKE_CLOUDINARY_URL;

export const db = await import("../../src/server/db.ts");

const md5 = (value: string) => createHash("md5").update(value).digest("hex");

export type ForumSeed = {
  uid: number;
  username: string;
  password: string;
  usergroup?: number;
  algorithm?: "" | "bcrypt" | string;
  encryption?: number;
};

export async function resetDatabase(forumUsers: ForumSeed[]) {
  for (const table of ["trade_items", "trade_participants", "trades", "user_cards", "users", "original_cards"]) {
    await db.execute(`DELETE FROM \`${table}\``);
  }
  await db.execute("DROP TABLE IF EXISTS mybb_users");
  await db.execute(
    `CREATE TABLE mybb_users (
       uid INT UNSIGNED NOT NULL PRIMARY KEY,
       username VARCHAR(120) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL UNIQUE,
       password VARCHAR(500) NOT NULL DEFAULT '',
       salt VARCHAR(10) NOT NULL DEFAULT '',
       usergroup SMALLINT UNSIGNED NOT NULL DEFAULT 2,
       password_algorithm VARCHAR(30) NOT NULL DEFAULT '',
       password_encryption SMALLINT NOT NULL DEFAULT 0
     )`,
  );
  for (const user of forumUsers) {
    const salt = "s4lt" + user.uid;
    const hash =
      user.algorithm === "bcrypt" ? bcrypt.hashSync(user.password, 4) : md5(md5(salt) + md5(user.password));
    await db.execute(
      "INSERT INTO mybb_users (uid, username, password, salt, usergroup, password_algorithm, password_encryption) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [user.uid, user.username, hash, salt, user.usergroup ?? 2, user.algorithm ?? "", user.encryption ?? 0],
    );
  }
}

// Loads tests/fixtures/baseline-db.sql (the data behind rails-baseline.json).
// Call after resetDatabase.
export async function loadFixture() {
  const sql = await readFile(path.resolve(import.meta.dirname, "../fixtures/baseline-db.sql"), "utf8");
  for (const statement of sql.split(/;\r?\n/).map((s) => s.replace(/^--.*$/gm, "").trim()).filter(Boolean)) {
    await db.execute(statement);
  }
}

export const RARITIES = ["Bronze", "Silver", "Gold", "Diamond"] as const;
export type Rarity = (typeof RARITIES)[number];

// Gives a user `n` copies of an approved original card of `rarity`; returns their UUIDs.
export async function giveCards(userId: number, rarity: Rarity, n: number): Promise<string[]> {
  const [original] = await db.query<import("mysql2/promise").RowDataPacket>(
    "SELECT name, api_id, season FROM original_cards WHERE approved = TRUE AND cardtype = ? ORDER BY id LIMIT 1",
    [RARITIES.indexOf(rarity)],
  );
  if (!original) throw new Error(`No approved ${rarity} original card to copy`);
  const uuids: string[] = [];
  for (let i = 0; i < n; i++) {
    const uuid = crypto.randomUUID();
    await db.execute(
      `INSERT INTO user_cards (uuid, user_id, cardtype, season, api_id, card_name, created_at, updated_at)
       VALUES (UNHEX(REPLACE(?, '-', '')), ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [uuid, userId, RARITIES.indexOf(rarity), original.season, original.api_id, original.name],
    );
    uuids.push(uuid);
  }
  return uuids;
}

// Client logged in as a user via a minted session cookie.
export async function clientFor(user: { id: number; forumUid: number }, origin: string | null = BASE_URL) {
  const client = new Client(origin);
  client.cookies.set("ssl_session", await sessionToken(user.id, user.forumUid));
  return client;
}

// Session cookie value for a user, as /api/v1/login would issue it.
export async function sessionToken(userId: number, forumUid: number): Promise<string> {
  const { createSessionToken } = await import("../../src/server/auth/session.ts");
  return createSessionToken({ id: userId, forum_uid: forumUid });
}

export type BaselineEntry = {
  user: string;
  method: string;
  path: string;
  params: Record<string, string | number> | null;
  status: number;
  body: unknown;
};

export async function loadBaseline(): Promise<BaselineEntry[]> {
  return JSON.parse(await readFile(path.resolve(import.meta.dirname, "../fixtures/rails-baseline.json"), "utf8"));
}

let server: ChildProcess | null = null;

export async function startServer() {
  const nextBin = path.resolve(import.meta.dirname, "../../node_modules/next/dist/bin/next");
  server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    cwd: path.resolve(import.meta.dirname, "../.."),
    env: { ...process.env, PACK_GRANT_API_TOKEN: PACK_GRANT_TOKEN, NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Next.js server did not become healthy");
}

export async function stopServer() {
  server?.kill();
  server = null;
  await db.closePools();
}

// Minimal browser-like client: keeps cookies and sends a same-site Origin.
export class Client {
  cookies = new Map<string, string>();
  lastSetCookie: string[] = [];

  private origin: string | null;

  constructor(origin: string | null = BASE_URL) {
    this.origin = origin;
  }

  async request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const init: RequestInit = { method, headers: { ...headers }, redirect: "manual" };
    const h = init.headers as Record<string, string>;
    if (this.origin) h.Origin = this.origin;
    if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      h["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await fetch(BASE_URL + url, init);
    this.lastSetCookie = res.headers.getSetCookie();
    for (const cookie of this.lastSetCookie) {
      const [pair, ...attrs] = cookie.split(";");
      const [name, value] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
      if (attrs.some((a) => a.trim().toLowerCase() === "max-age=0") || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json as any, headers: res.headers }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  get = (url: string) => this.request("GET", url);
  post = (url: string, body?: unknown, headers?: Record<string, string>) => this.request("POST", url, body, headers);
}
