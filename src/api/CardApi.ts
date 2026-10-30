import type { GridRowId } from "@mui/x-data-grid";
import { apiRequest } from "../lib/request.ts";

// An original card as returned by the upload and review endpoints.
export type OriginalCard = {
  id: number;
  name: string | null;
  cardtype: "Bronze" | "Silver" | "Gold" | "Diamond";
  approved: boolean;
  api_id: string;
  season: number;
  team: string | null;
  created_at: string;
  updated_at: string;
};

// Uploads a .zip of card PNGs. Admins' cards publish immediately; moderators'
// wait for approval. Failures are ApiError; `body.files` lists offending files.
export function uploadCards(zip: File) {
  const form = new FormData();
  form.append("zip", zip);
  return apiRequest<OriginalCard[]>("/api/v1/original_cards", { method: "POST", form });
}

export function UnapprovedCards() {
  return apiRequest<{ all_cards: OriginalCard[] }>("/api/v1/unapproved");
}

export function ApproveCards(ids: Set<GridRowId> | number[]) {
  return apiRequest<unknown[]>("/api/v1/approved", { method: "POST", json: { ids: Array.from(ids) } });
}

export async function DeleteCards(ids: Set<GridRowId> | number[]) {
  await apiRequest<null>("/api/v1/delete_cards", { method: "POST", json: { ids: Array.from(ids) } });
  return 200;
}
