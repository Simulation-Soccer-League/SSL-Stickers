// Drops users.password, left over from the Rails app. Logins are checked against
// the forum's users table, so the stickers database stores no passwords.
// Re-runnable: does nothing once the column is gone.
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { query } from "../../src/server/db.ts";
import type { MigrationContext } from "../../scripts/db-migrate.ts";

export async function up(conn: PoolConnection, { database, log }: MigrationContext) {
  const rows = await query<RowDataPacket>(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password'",
    [database],
    conn,
  );
  if (rows.length === 0) {
    log("users.password already removed");
    return;
  }
  await conn.query("ALTER TABLE users DROP COLUMN password");
  log("dropped users.password");
}
