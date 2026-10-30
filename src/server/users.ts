// Stickers-side user records (the `users` table).
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { execute, query, stickersPool } from "./db.ts";
import type { ForumUser } from "./auth/forumUsers.ts";

export type StickersUser = {
  id: number;
  username: string;
  status: number;
  packs_available: number;
  forum_uid: number | null;
};
type UserRow = StickersUser & RowDataPacket;

const USER_COLUMNS = "id, username, status, packs_available, forum_uid";

type Db = PoolConnection | ReturnType<typeof stickersPool>;

export async function findUserById(id: number, db: Db = stickersPool()): Promise<StickersUser | null> {
  const rows = await query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [id], db);
  return rows[0] ?? null;
}

async function findByForumUid(uid: number): Promise<StickersUser | null> {
  const rows = await query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE forum_uid = ?`, [uid]);
  return rows[0] ?? null;
}

// Keeps the stickers username (used to address trades) in step with forum
// renames, unless another stickers user already has that name.
async function syncUsername(user: StickersUser, forumUsername: string): Promise<StickersUser> {
  if (user.username === forumUsername) return user;
  const taken = await query<RowDataPacket>("SELECT 1 FROM users WHERE username = ? AND id <> ? LIMIT 1", [
    forumUsername,
    user.id,
  ]);
  if (taken.length > 0) {
    console.warn(`Not renaming stickers user ${user.id} to "${forumUsername}": name in use`);
    return user;
  }
  await execute("UPDATE users SET username = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?", [forumUsername, user.id]);
  return { ...user, username: forumUsername };
}

function isDuplicateKey(error: unknown) {
  return (error as { code?: string } | null)?.code === "ER_DUP_ENTRY";
}

// Returns the stickers user for a forum account, linking a legacy unlinked row
// with the same username or creating a new user on first login.
export async function findOrCreateUserForForumAccount(forumUser: ForumUser): Promise<StickersUser> {
  const existing = await findByForumUid(forumUser.uid);
  if (existing) return syncUsername(existing, forumUser.username);

  const linked = await execute(
    `UPDATE users SET forum_uid = ?, updated_at = UTC_TIMESTAMP(6)
      WHERE username = ? AND forum_uid IS NULL ORDER BY id LIMIT 1`,
    [forumUser.uid, forumUser.username],
  );

  if (linked.affectedRows === 0) {
    try {
      await execute(
        `INSERT INTO users (username, forum_uid, status, packs_available, created_at, updated_at)
         VALUES (?, ?, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
        [forumUser.username, forumUser.uid],
      );
    } catch (error) {
      // A concurrent request created it first; fall through to re-read.
      if (!isDuplicateKey(error)) throw error;
    }
  }

  const user = await findByForumUid(forumUser.uid);
  if (!user) throw new Error(`Failed to load stickers user for forum uid ${forumUser.uid}`);
  return user;
}
