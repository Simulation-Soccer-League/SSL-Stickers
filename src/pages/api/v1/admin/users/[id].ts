import type { NextApiRequest, NextApiResponse } from "next";
import { ADMINS, apiRoute, requireRole } from "../../../../../server/api.ts";
import { AdminError, setUserRole } from "../../../../../server/services/adminUsers.ts";

// PATCH /api/v1/admin/users/:id (JSON {role}) (admins only): changes a user's role.
async function update(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireRole(req, res, ADMINS);
  if (!actor) return;
  const id = String(req.query.id ?? "");
  if (!/^\d+$/.test(id)) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  try {
    res.status(200).json(await setUserRole(actor, Number(id), (req.body ?? {}).role));
  } catch (error) {
    if (!(error instanceof AdminError)) throw error;
    res.status(error.status).json({ error: error.message });
  }
}

export default apiRoute({ PATCH: update });
