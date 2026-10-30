// Cutover step: deletes stickers users that have no forum account
// (users.forum_uid IS NULL after the add_forum_uid_to_users migration) along
// with their cards and every trade they took part in.
//
//   npm run db:delete-unlinked-users [-- --database=NAME]             list only
//   npm run db:delete-unlinked-users -- --confirm [--database=NAME]   delete
//
// The database has no foreign keys, so dependent rows are removed explicitly,
// all in one transaction. Take a backup first.
import type { RowDataPacket } from "mysql2/promise";
import { fail, loadDb, parseArgs } from "./db-cli.ts";

type Row = RowDataPacket & Record<string, number | string | null>;

async function main() {
  const args = parseArgs();
  const db = await loadDb(args);
  const database = process.env.MYSQL_DATABASE as string;

  try {
    const users = await db.query<Row>(
      `SELECT u.id, u.username,
              (SELECT COUNT(*) FROM user_cards c WHERE c.user_id = u.id) AS cards,
              (SELECT COUNT(DISTINCT p.trade_id) FROM trade_participants p WHERE p.user_id = u.id) AS trades
         FROM users u
        WHERE u.forum_uid IS NULL
        ORDER BY u.id`,
    );

    if (users.length === 0) {
      console.log(`${database}: no unlinked users`);
      return;
    }

    console.log(`${database}: users without a forum account:`);
    for (const user of users) console.log(`  #${user.id} ${user.username ?? "(no username)"}: ${user.cards} cards, ${user.trades} trades`);

    const userIds = users.map((user) => Number(user.id));
    const tradeIds = (
      await db.query<Row>("SELECT DISTINCT trade_id FROM trade_participants WHERE user_id IN (?) AND trade_id IS NOT NULL", [userIds])
    ).map((row) => Number(row.trade_id));
    console.log(`  trades to delete (including the other participant's side): ${tradeIds.length ? tradeIds.join(", ") : "none"}`);

    if (!args.has("confirm")) {
      console.log("Dry run. Re-run with --confirm to delete these users, their cards, and these trades.");
      return;
    }

    const deleted = await db.withTransaction(async (conn) => {
      // Lock the users so a concurrent login cannot link them mid-delete.
      await conn.query("SELECT id FROM users WHERE id IN (?) AND forum_uid IS NULL FOR UPDATE", [userIds]);
      const counts: Record<string, number> = {};
      if (tradeIds.length > 0) {
        counts.trade_items = (await db.execute("DELETE FROM trade_items WHERE trade_id IN (?)", [tradeIds], conn)).affectedRows;
        counts.trade_participants = (await db.execute("DELETE FROM trade_participants WHERE trade_id IN (?)", [tradeIds], conn)).affectedRows;
        counts.trades = (await db.execute("DELETE FROM trades WHERE id IN (?)", [tradeIds], conn)).affectedRows;
      }
      counts.user_cards = (await db.execute("DELETE FROM user_cards WHERE user_id IN (?)", [userIds], conn)).affectedRows;
      counts.users = (await db.execute("DELETE FROM users WHERE id IN (?) AND forum_uid IS NULL", [userIds], conn)).affectedRows;
      return counts;
    });

    console.log(`deleted: ${Object.entries(deleted).map(([table, n]) => `${table} ${n}`).join(", ")}`);
  } finally {
    await db.closePools();
  }
}

main().catch(fail);
