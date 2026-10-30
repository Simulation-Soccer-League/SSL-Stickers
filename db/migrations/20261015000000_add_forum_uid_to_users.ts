// Links each stickers user to its MyBB forum account (mybb_users.uid).
// Logins and pack grants identify users by forum_uid from now on, so forum
// renames no longer break card ownership.
//
// Re-runnable: each step checks whether it already happened. Users without a
// forum account keep forum_uid NULL (they cannot log in). Removing them is a
// separate, explicitly confirmed cutover step: scripts/delete-unlinked-users.ts.
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { forumPool, query } from "../../src/server/db.ts";
import { forumUsersTable } from "../../src/server/auth/forumUsers.ts";
import type { MigrationContext } from "../../scripts/db-migrate.ts";

async function columnExists(conn: PoolConnection, database: string) {
  const rows = await query<RowDataPacket>(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'forum_uid'",
    [database],
    conn,
  );
  return rows.length > 0;
}

async function indexExists(conn: PoolConnection, database: string) {
  const rows = await query<RowDataPacket>(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND INDEX_NAME = 'index_users_on_forum_uid'",
    [database],
    conn,
  );
  return rows.length > 0;
}

export async function up(conn: PoolConnection, { database, log }: MigrationContext) {
  if (!(await columnExists(conn, database))) {
    await conn.query("ALTER TABLE users ADD COLUMN forum_uid INT UNSIGNED NULL AFTER id");
    log("added users.forum_uid");
  }

  const unlinked = await query<{ id: number; username: string | null } & RowDataPacket>(
    "SELECT id, username FROM users WHERE forum_uid IS NULL ORDER BY id",
    [],
    conn,
  );

  // Same lookup Rails login used (MybbUser.find_by(username:)), so the forum
  // column's collation decides matches.
  const matches: { id: number; uid: number; username: string; forumUsername: string }[] = [];
  const missing: string[] = [];
  for (const user of unlinked) {
    if (!user.username) {
      missing.push(`#${user.id} (no username)`);
      continue;
    }
    const forumUsers = await query<{ uid: number; username: string } & RowDataPacket>(
      `SELECT uid, username FROM ${forumUsersTable()} WHERE username = ?`,
      [user.username],
      forumPool(),
    );
    if (forumUsers.length === 1) {
      matches.push({ id: user.id, uid: forumUsers[0].uid, username: user.username, forumUsername: forumUsers[0].username });
    } else {
      missing.push(forumUsers.length === 0 ? user.username : `${user.username} (${forumUsers.length} forum matches)`);
    }
  }

  // Two stickers users must not claim the same forum account.
  const byUid = new Map<number, string[]>();
  for (const match of matches) byUid.set(match.uid, [...(byUid.get(match.uid) ?? []), match.username]);
  const conflicts = [...byUid.entries()].filter(([, names]) => names.length > 1);
  if (conflicts.length > 0) {
    throw new Error(
      `Multiple stickers users match one forum account: ${conflicts.map(([uid, names]) => `uid ${uid}: ${names.join(", ")}`).join("; ")}. Resolve manually and re-run.`,
    );
  }

  await conn.beginTransaction();
  try {
    for (const match of matches) {
      await conn.query("UPDATE users SET forum_uid = ? WHERE id = ? AND forum_uid IS NULL", [match.uid, match.id]);
      const renamed = match.forumUsername === match.username ? "" : ` (forum name "${match.forumUsername}")`;
      log(`linked ${match.username} -> forum uid ${match.uid}${renamed}`);
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  }

  if (missing.length > 0) {
    log(`no forum account (left unlinked): ${missing.join(", ")}`);
  }

  if (!(await indexExists(conn, database))) {
    await conn.query("CREATE UNIQUE INDEX index_users_on_forum_uid ON users (forum_uid)");
    log("added unique index index_users_on_forum_uid");
  }
}
