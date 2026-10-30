// Shared setup for database scripts run with Node's TypeScript support
// (see the db:* scripts in package.json).

// Parses `--name=value` and `--flag` arguments.
export function parseArgs(argv: string[] = process.argv.slice(2)): Map<string, string | true> {
  const args = new Map<string, string | true>();
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Unrecognized argument: ${arg}`);
    args.set(match[1], match[2] ?? true);
  }
  return args;
}

// Applies --database before the DB module creates its pool, then loads it.
export async function loadDb(args: Map<string, string | true>) {
  const database = args.get("database");
  if (typeof database === "string") {
    if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error(`Invalid database name: ${database}`);
    process.env.MYSQL_DATABASE = database;
  }
  return import("../src/server/db.ts");
}

export function fail(error: unknown): never {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
