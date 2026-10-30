import type { NextApiRequest, NextApiResponse } from "next";
import { apiRoute } from "../../../server/api.ts";
import { endSession } from "../../../server/auth/session.ts";

function logout(_req: NextApiRequest, res: NextApiResponse) {
  endSession(res);
  res.status(204).end();
}

export default apiRoute({ POST: logout });
