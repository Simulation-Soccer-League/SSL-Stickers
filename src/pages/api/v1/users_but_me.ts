import type { NextApiRequest, NextApiResponse } from "next";
import type { RowDataPacket } from "mysql2/promise";
import { apiRoute, requireUser } from "../../../server/api.ts";
import { query } from "../../../server/db.ts";

// Usernames of every other user (trade recipients). Requires login; Rails
// returned all usernames to anonymous callers.
async function usersButMe(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;
  const rows = await query<{ username: string } & RowDataPacket>(
    "SELECT username FROM users WHERE id <> ? ORDER BY id",
    [user.id],
  );
  res.status(200).json(rows.map((row) => row.username));
}

export default apiRoute({ GET: usersButMe });
