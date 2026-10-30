import type { NextApiRequest, NextApiResponse } from "next";
import { ADMINS, apiRoute, requireRole } from "../../../server/api.ts";
import { UploadError, approveCards } from "../../../server/services/originalCards.ts";

// POST /api/v1/approved (JSON {ids}): approves unapproved cards; responds with the Cloudinary update results.
async function approve(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireRole(req, res, ADMINS))) return;
  try {
    res.status(200).json(await approveCards((req.body ?? {}).ids));
  } catch (error) {
    if (!(error instanceof UploadError)) throw error;
    res.status(error.status).json(error.body());
  }
}

export default apiRoute({ POST: approve });
