// Admin user management: listing users and changing their role (users.status).
import type { RowDataPacket } from "mysql2/promise";
import { execute, query } from "../db.ts";
import { UserStatus, type UserStatusName } from "../enums.ts";
import type { StickersUser } from "../users.ts";

export class AdminError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type AdminUserRow = {
  id: number;
  username: string;
  role: UserStatusName | null;
  forum_uid: number | null;
  packs_available: number;
  created_at: Date;
};

type Row = RowDataPacket & {
  id: number;
  username: string;
  status: number;
  forum_uid: number | null;
  packs_available: number;
  created_at: Date;
};

const COLUMNS = "id, username, status, forum_uid, packs_available, created_at";
const toJson = (row: Row): AdminUserRow => ({
  id: row.id,
  username: row.username,
  role: UserStatus.toName(row.status),
  forum_uid: row.forum_uid,
  packs_available: row.packs_available,
  created_at: row.created_at,
});

export const USER_LIST_LIMIT = 100;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

// Users ordered by username, optionally filtered by a case-insensitive name
// search and/or role. Returns at most USER_LIST_LIMIT rows plus the total match count.
export async function listUsers(search: string | null, role: string | null) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (search && search.trim()) {
    where.push("username LIKE ?");
    params.push(`%${escapeLike(search.trim())}%`);
  }
  if (role) {
    const value = UserStatus.toValue(role);
    if (value === null) throw new AdminError(422, "Unknown role");
    where.push("status = ?");
    params.push(value);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [{ total }] = await query<RowDataPacket & { total: number }>(`SELECT COUNT(*) AS total FROM users ${clause}`, params);
  const rows = await query<Row>(`SELECT ${COLUMNS} FROM users ${clause} ORDER BY username, id LIMIT ?`, [...params, USER_LIST_LIMIT]);
  return { users: rows.map(toJson), total: Number(total), limit: USER_LIST_LIMIT };
}

// Changes a user's role. Admins cannot change their own role, which also
// guarantees at least one admin always remains.
export async function setUserRole(actor: StickersUser, targetId: number, roleName: unknown): Promise<AdminUserRow> {
  const value = UserStatus.toValue(roleName);
  if (value === null) throw new AdminError(422, `Role must be one of: ${UserStatus.names.join(", ")}`);
  if (targetId === actor.id) throw new AdminError(422, "You cannot change your own role");

  const [target] = await query<Row>(`SELECT ${COLUMNS} FROM users WHERE id = ?`, [targetId]);
  if (!target) throw new AdminError(404, "User not found");

  if (target.status !== value) {
    await execute("UPDATE users SET status = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?", [value, targetId]);
    console.info(
      `Role change: ${actor.username} (#${actor.id}) set ${target.username} (#${target.id}) ` +
        `from ${UserStatus.toName(target.status)} to ${roleName}`,
    );
  }
  const [updated] = await query<Row>(`SELECT ${COLUMNS} FROM users WHERE id = ?`, [targetId]);
  return toJson(updated);
}
