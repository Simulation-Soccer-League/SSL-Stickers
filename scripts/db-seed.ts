// Loads development seed data (db/seeds/*.sql, in name order).
//
//   npm run db:seed [-- --database=NAME]
//
// Seeds are idempotent (INSERT … ON DUPLICATE KEY UPDATE). Run against a fresh
// development database after `npm run db:schema:load`; never against production.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fail, loadDb, parseArgs } from "./db-cli.ts";

const SEEDS_DIR = path.resolve(import.meta.dirname, "../db/seeds");

async function main() {
  const db = await loadDb(parseArgs());
  const database = process.env.MYSQL_DATABASE as string;
  try {
    for (const file of (await readdir(SEEDS_DIR)).filter((f) => f.endsWith(".sql")).sort()) {
      const sql = (await readFile(path.join(SEEDS_DIR, file), "utf8")).replace(/^--.*$/gm, "");
      for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) {
        const result = await db.execute(statement);
        console.log(`${database}: ${file}: ${result.affectedRows} rows affected`);
      }
    }
  } finally {
    await db.closePools();
  }
}

main().catch(fail);
