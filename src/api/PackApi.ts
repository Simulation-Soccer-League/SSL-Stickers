import { apiRequest } from "../lib/request.ts";

export type CardRarity = "Bronze" | "Silver" | "Gold" | "Diamond";

export interface PackCard {
  public_id: string;
  rarity: CardRarity;
  new_card: boolean;
}

export interface PackResponse {
  cards: PackCard[];
  packs_available: number;
}

export function OpenPack() {
  return apiRequest<PackResponse>("/api/v1/pack", { method: "POST" });
}

export function GetPackCount() {
  return apiRequest<Pick<PackResponse, "packs_available">>("/api/v1/pack_count");
}
