import type { NextApiRequest, NextApiResponse } from "next";
import { CARD_UPLOADERS, apiRoute, requireRole } from "../../../server/api.ts";
import { readForm } from "../../../server/forms.ts";
import { UploadError, ZIP_LIMITS, uploadCards } from "../../../server/services/originalCards.ts";

export const config = { api: { bodyParser: false } };

// POST /api/v1/original_cards (multipart `zip`): uploads a ZIP of card PNGs.
// Moderators and admins only. Admins' uploads are approved immediately; moderators' go to the review queue.
async function upload(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireRole(req, res, CARD_UPLOADERS);
  if (!user) return;
  const form = await readForm(req, { maxBytes: ZIP_LIMITS.maxZipBytes + 1024 * 1024 });
  const zip = form.file("zip");
  if (!zip) {
    res.status(422).json({ error: "A ZIP file is required" });
    return;
  }
  try {
    res.status(201).json(await uploadCards(user, new Uint8Array(await zip.arrayBuffer())));
  } catch (error) {
    if (!(error instanceof UploadError)) throw error;
    res.status(error.status).json(error.body());
  }
}

export default apiRoute({ POST: upload });
