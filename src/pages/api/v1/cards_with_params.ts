import type { NextApiRequest, NextApiResponse } from "next";
import { apiRoute, requireUser } from "../../../server/api.ts";
import { castBoolean, readForm } from "../../../server/forms.ts";
import { cardsWithParams, parsePagination } from "../../../server/services/collection.ts";

export const config = { api: { bodyParser: false } };

// POST /api/v1/cards_with_params (form data: name, sort, page, per_page, include_unowned).
async function search(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;
  const form = await readForm(req);
  const result = await cardsWithParams(user.id, {
    name: form.get("name"),
    sort: form.get("sort"),
    includeUnowned: castBoolean(form.get("include_unowned")) === true,
    ...parsePagination(form.get("page"), form.get("per_page")),
  });
  res.status(200).json(result);
}

export default apiRoute({ POST: search });
