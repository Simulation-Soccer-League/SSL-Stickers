// Retires the card_approver role (users.status = 2). Card approval and removal
// are now admin-only, so existing card approvers become moderators (upload only);
// promote any who should keep approving to admin under Admin → User Roles.
// Re-runnable: does nothing once no status-2 users remain.
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { query } from "../../src/server/db.ts";
import type { MigrationContext } from "../../scripts/db-migrate.ts";

export async function up(conn: PoolConnection, { log }: MigrationContext) {
  const approvers = await query<RowDataPacket & { id: number; username: string | null }>(
    "SELECT id, username FROM users WHERE status = 2 ORDER BY id",
    [],
    conn,
  );
  if (approvers.length === 0) {
    log("no card_approver users");
    return;
  }
  await conn.query("UPDATE users SET status = 1, updated_at = UTC_TIMESTAMP(6) WHERE status = 2");
  log(`card_approver -> moderator: ${approvers.map((u) => `${u.username ?? "(no name)"} (#${u.id})`).join(", ")}`);
}
