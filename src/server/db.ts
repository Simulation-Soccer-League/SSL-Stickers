// Server-only MySQL access. Never import this module from pages, views, or components.
import mysql, {
  type Pool,
  type PoolConnection,
  type PoolOptions,
  type QueryValues,
  type ResultSetHeader,
  type RowDataPacket,
  type TypeCastField,
  type TypeCastNext,
} from "mysql2/promise";

export type Params = QueryValues;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

// Match ActiveRecord: TINYINT(1) columns (e.g. approved, accept) are booleans.
function typeCast(field: TypeCastField, next: TypeCastNext) {
  if (field.type === "TINY" && field.length === 1) {
    const value = field.string();
    return value === null ? null : value === "1";
  }
  return next();
}

function poolOptions(overrides: { host?: string; user?: string; password?: string; database: string }): PoolOptions {
  return {
    host: overrides.host ?? process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: overrides.user ?? requireEnv("MYSQL_USERNAME"),
    password: overrides.password ?? process.env.MYSQL_PASSWORD,
    database: overrides.database,
    charset: "utf8mb4_unicode_ci",
    // Rails stores DATETIME values in UTC; read and write them as UTC.
    timezone: "Z",
    ssl: process.env.MYSQL_SSL_MODE === "required" ? { rejectUnauthorized: true } : undefined,
    connectionLimit: Number(process.env.MYSQL_POOL_SIZE ?? 10),
    waitForConnections: true,
    typeCast,
  };
}

// Keep pools across hot reloads in development.
const globalPools = globalThis as unknown as { stickersPool?: Pool; forumPool?: Pool };

export function stickersPool(): Pool {
  globalPools.stickersPool ??= mysql.createPool(
    poolOptions({ database: requireEnv("MYSQL_DATABASE") }),
  );
  return globalPools.stickersPool;
}

// The MyBB forum database. Use a MySQL account with SELECT-only access to it.
export function forumPool(): Pool {
  globalPools.forumPool ??= mysql.createPool(
    poolOptions({
      host: process.env.MYBB_MYSQL_HOST,
      user: process.env.MYBB_MYSQL_USERNAME,
      password: process.env.MYBB_MYSQL_PASSWORD,
      database: process.env.MYBB_DATABASE ?? "mybbdb",
    }),
  );
  return globalPools.forumPool;
}

// For scripts: closes whichever pools were opened so the process can exit.
export async function closePools(): Promise<void> {
  const pools = [globalPools.stickersPool, globalPools.forumPool].filter((pool): pool is Pool => Boolean(pool));
  globalPools.stickersPool = undefined;
  globalPools.forumPool = undefined;
  await Promise.all(pools.map((pool) => pool.end()));
}

type Queryable = Pool | PoolConnection;

export async function query<T extends RowDataPacket>(
  sql: string,
  params: Params = [],
  db: Queryable = stickersPool(),
): Promise<T[]> {
  const [rows] = await db.query<T[]>(sql, params);
  return rows;
}

export async function execute(
  sql: string,
  params: Params = [],
  db: Queryable = stickersPool(),
): Promise<ResultSetHeader> {
  const [result] = await db.query<ResultSetHeader>(sql, params);
  return result;
}

// Runs fn on one checked-out connection inside a transaction. Commits when fn
// resolves, rolls back when it throws, and always releases the connection.
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await stickersPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
