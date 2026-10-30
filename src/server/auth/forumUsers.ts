// Read-only access to MyBB forum accounts (MYBB_USERS_TABLE, default mybb_users, in MYBB_DATABASE).
import type { RowDataPacket } from "mysql2/promise";
import { forumPool, query } from "../db.ts";
import type { MybbPasswordFields } from "./mybbPassword.ts";

// MyBB table names carry a configurable prefix (stock: "mybb_").
export function forumUsersTable(): string {
  const table = process.env.MYBB_USERS_TABLE ?? "mybb_users";
  if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error("MYBB_USERS_TABLE may only contain letters, numbers, and underscores");
  return table;
}

export type ForumUser = { uid: number; username: string; usergroup: number };
type ForumLoginRow = ForumUser & MybbPasswordFields & RowDataPacket;

// MyBB stock usergroup IDs. Change here if the SSL forum uses different groups.
export const BLOCKED_USERGROUPS: ReadonlyMap<number, string> = new Map([
  [5, "Your forum account is awaiting activation"],
  [7, "Your forum account is banned"],
]);

export function blockedReason(user: Pick<ForumUser, "usergroup">): string | null {
  return BLOCKED_USERGROUPS.get(Number(user.usergroup)) ?? null;
}

// Matches by the forum column's collation, as the Rails login did.
export async function findForumLogin(username: string): Promise<ForumLoginRow | null> {
  const rows = await query<ForumLoginRow>(
    `SELECT uid, username, usergroup, password, salt, password_algorithm, password_encryption
       FROM ${forumUsersTable()} WHERE username = ? LIMIT 2`,
    [username],
    forumPool(),
  );
  // The forum's username column has a unique index; treat anything else as no match.
  return rows.length === 1 ? rows[0] : null;
}

export async function findForumUser(username: string): Promise<ForumUser | null> {
  const rows = await query<ForumUser & RowDataPacket>(
    `SELECT uid, username, usergroup FROM ${forumUsersTable()} WHERE username = ? LIMIT 2`,
    [username],
    forumPool(),
  );
  return rows.length === 1 ? rows[0] : null;
}

export async function findForumUserByUid(uid: number): Promise<ForumUser | null> {
  const rows = await query<ForumUser & RowDataPacket>(
    `SELECT uid, username, usergroup FROM ${forumUsersTable()} WHERE uid = ?`,
    [uid],
    forumPool(),
  );
  return rows[0] ?? null;
}
