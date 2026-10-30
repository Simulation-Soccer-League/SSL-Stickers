import type { NextApiRequest, NextApiResponse } from "next";
import { forumPool, query, stickersPool } from "../../server/db.ts";

type Health = { status: "ok" | "error"; database: "ok" | "error"; forum: "ok" | "error" };

async function ping(pool: () => ReturnType<typeof stickersPool>): Promise<"ok" | "error"> {
  try {
    await query("SELECT 1", [], pool());
    return "ok";
  } catch (error) {
    console.error("Health check failed", error);
    return "error";
  }
}

// Replaces the Rails /up health check.
export default async function handler(_req: NextApiRequest, res: NextApiResponse<Health>) {
  const [database, forum] = await Promise.all([ping(stickersPool), ping(forumPool)]);
  const status = database === "ok" && forum === "ok" ? "ok" : "error";
  res.status(status === "ok" ? 200 : 503).json({ status, database, forum });
}
