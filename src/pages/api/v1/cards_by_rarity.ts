import type { NextApiRequest, NextApiResponse } from "next";
import type { RowDataPacket } from "mysql2/promise";
import { apiRoute, requireUser } from "../../../server/api.ts";
import { query } from "../../../server/db.ts";
import { castBoolean, readForm } from "../../../server/forms.ts";
import { tradeCardOptions } from "../../../server/services/collection.ts";

export const config = { api: { bodyParser: false } };

// POST /api/v1/cards_by_rarity (form data: visual=true, name?): tradeable card
// groups for the named user (any user, for building trade offers) or the session user.
async function options(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;
  const form = await readForm(req);

  // The legacy non-visual response (arrays of 5-tuples) is no longer used by the frontend.
  if (castBoolean(form.get("visual")) !== true) {
    res.status(400).json({ error: "visual=true is required" });
    return;
  }

  const name = form.get("name");
  let targetId = user.id;
  if (name && name.trim() !== "") {
    const [target] = await query<{ id: number } & RowDataPacket>("SELECT id FROM users WHERE username = ? LIMIT 1", [name]);
    if (!target) {
      res.status(200).json([]);
      return;
    }
    targetId = target.id;
  }

  res.status(200).json(await tradeCardOptions(targetId, user.id));
}

export default apiRoute({ POST: options });
