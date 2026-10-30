import type { NextApiRequest, NextApiResponse } from "next";
import { apiRoute, requireUser } from "../../../server/api.ts";
import { UserStatus } from "../../../server/enums.ts";

async function me(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res, { user: null });
  if (!user) return;
  res.status(200).json({ status: UserStatus.toName(user.status), id: user.id, username: user.username });
}

export default apiRoute({ GET: me });
