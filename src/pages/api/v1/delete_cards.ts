import type { NextApiRequest, NextApiResponse } from "next";
import { ADMINS, apiRoute, requireRole } from "../../../server/api.ts";
import { UploadError, deleteCards } from "../../../server/services/originalCards.ts";

// POST /api/v1/delete_cards (JSON {ids}): deletes unapproved cards and their images. 200 with an empty body.
async function remove(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireRole(req, res, ADMINS))) return;
  try {
    await deleteCards((req.body ?? {}).ids);
    res.status(200).end();
  } catch (error) {
    if (!(error instanceof UploadError)) throw error;
    res.status(error.status).json(error.body());
  }
}

export default apiRoute({ POST: remove });
