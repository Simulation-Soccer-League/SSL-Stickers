// POST /api/v1/external/pack_grants: grants one pack to a forum user.
// Called by an external system with `Authorization: Bearer <PACK_GRANT_API_TOKEN>`;
// not used by the browser, so it skips the session cookie and same-origin check.
import { timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import type { RowDataPacket } from "mysql2/promise";
import { apiRoute, bodyString } from "../../../../server/api.ts";
import { execute, query } from "../../../../server/db.ts";
import { findForumUser } from "../../../../server/auth/forumUsers.ts";
import { findOrCreateUserForForumAccount } from "../../../../server/users.ts";

function authorized(req: NextApiRequest): boolean {
  const expected = process.env.PACK_GRANT_API_TOKEN ?? "";
  const header = req.headers.authorization ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return expected.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

async function grantPack(req: NextApiRequest, res: NextApiResponse) {
  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const username = bodyString(req, "username");
  if (!username) {
    res.status(400).json({ error: "param is missing or the value is empty: username" });
    return;
  }

  const forumUser = await findForumUser(username);
  if (!forumUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const user = await findOrCreateUserForForumAccount(forumUser);
  // Atomic increment, like Rails' update_counters (no read-modify-write race).
  await execute("UPDATE users SET packs_available = packs_available + 1 WHERE id = ?", [user.id]);
  const [row] = await query<{ username: string; packs_available: number } & RowDataPacket>(
    "SELECT username, packs_available FROM users WHERE id = ?",
    [user.id],
  );

  res.status(200).json({ username: row.username, packs_available: row.packs_available });
}

export default apiRoute({ POST: grantPack }, { crossOrigin: true });
