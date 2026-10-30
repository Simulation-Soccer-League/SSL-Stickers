import type { NextApiRequest, NextApiResponse } from "next";
import { ADMINS, apiRoute, requireRole } from "../../../../../server/api.ts";
import { AdminError, listUsers } from "../../../../../server/services/adminUsers.ts";

const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

// GET /api/v1/admin/users?search=&role= (admins only): {users, total, limit}.
async function list(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireRole(req, res, ADMINS))) return;
  try {
    res.status(200).json(await listUsers(param(req.query.search), param(req.query.role)));
  } catch (error) {
    if (!(error instanceof AdminError)) throw error;
    res.status(error.status).json({ error: error.message });
  }
}

export default apiRoute({ GET: list });
