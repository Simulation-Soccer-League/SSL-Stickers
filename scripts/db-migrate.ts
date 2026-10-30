// Applies pending migrations from db/migrations, recording each version in the
// `schema_migrations` table inherited from Rails (Rails versions without a file
// here are treated as already applied).
//
//   npm run db:migrate                      apply pending migrations
//   npm run db:migrate -- --status          list applied/pending
//   npm run db:migrate -- --dry-run         show what would run
//   npm run db:migrate -- --database=NAME   target another database (e.g. myapp_test)
//
// Migration files: <14-digit version>_<name>.sql or .ts. A .ts migration exports
// `async function up(conn, context)`. MySQL commits DDL implicitly, so write
// migrations to be safe to re-run if they fail partway.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { fail, loadDb, parseArgs } from "./db-cli.ts";

export type MigrationContext = { database: string; log: (message: string) => void };
type MigrationModule = { up: (conn: PoolConnection, context: MigrationContext) => Promise<void> };

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../db/migrations");
const FILE_PATTERN = /^(\d{14})_([a-z0-9_]+)\.(sql|ts)$/;

async function main() {
  const args = parseArgs();
  const db = await loadDb(args);
  const pool = db.stickersPool();
  const database = process.env.MYSQL_DATABASE as string;

  try {
    await db.execute(
      "CREATE TABLE IF NOT EXISTS `schema_migrations` (`version` varchar(255) NOT NULL, PRIMARY KEY (`version`)) " +
        "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    );
    const applied = new Set(
      (await db.query<{ version: string } & RowDataPacket>("SELECT version FROM schema_migrations")).map(
        (row) => row.version,
      ),
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((file) => FILE_PATTERN.test(file)).sort();
    const pending = files.filter((file) => !applied.has(FILE_PATTERN.exec(file)![1]));

    if (args.has("status")) {
      for (const file of files) console.log(`${applied.has(FILE_PATTERN.exec(file)![1]) ? "up     " : "pending"}  ${file}`);
      console.log(`${database}: ${pending.length} pending`);
      return;
    }
    if (pending.length === 0) {
      console.log(`${database}: no pending migrations`);
      return;
    }
    if (args.has("dry-run")) {
      for (const file of pending) console.log(`would run  ${file}`);
      return;
    }

    for (const file of pending) {
      const [, version, , kind] = FILE_PATTERN.exec(file)!;
      const fullPath = path.join(MIGRATIONS_DIR, file);
      console.log(`== ${file}`);
      const conn = await pool.getConnection();
      try {
        if (kind === "sql") {
          for (const statement of splitSql(await readFile(fullPath, "utf8"))) await conn.query(statement);
        } else {
          const migration = (await import(pathToFileURL(fullPath).href)) as MigrationModule;
          await migration.up(conn, { database, log: (message) => console.log(`   ${message}`) });
        }
        await conn.query("INSERT INTO schema_migrations (version) VALUES (?)", [version]);
      } finally {
        conn.release();
      }
      console.log(`   done`);
    }
  } finally {
    await db.closePools();
  }
}

// Splits a migration on semicolons that end a line. Keep one statement per
// `;`-terminated line group; no procedures or semicolons inside string literals.
function splitSql(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

main().catch(fail);
