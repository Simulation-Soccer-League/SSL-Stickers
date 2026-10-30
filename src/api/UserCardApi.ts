import { apiRequest } from "../lib/request.ts";
import type { CardRarity } from "./PackApi.ts";

// The original card awarded by the factory.
export type FactoryReward = {
  id: number;
  name: string;
  cardtype: CardRarity;
  approved: boolean;
  api_id: string;
  season: number;
  team: string | null;
  created_at: string;
  updated_at: string;
};

const formOf = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
};

export function UserCards(page: number, per_page: number) {
  return apiRequest<unknown[]>(`/api/v1/user_cards?page=${page}&per_page=${per_page}`);
}

export function UserCardCount() {
  return apiRequest<number>("/api/v1/get_user_card_count");
}

export function CardsWithParams(name: string, sort: string, page: number, perPage: number, includeUnowned = false) {
  return apiRequest<unknown>("/api/v1/cards_with_params", {
    method: "POST",
    form: formOf({
      name,
      sort,
      page: page.toString(),
      per_page: perPage.toString(),
      include_unowned: includeUnowned.toString(),
    }),
  });
}

// Tradeable card groups for `username`, or the logged-in user when omitted.
export function TradeCardOptions(username?: string) {
  return apiRequest<unknown>("/api/v1/cards_by_rarity", {
    method: "POST",
    form: formOf(username ? { visual: "true", name: username } : { visual: "true" }),
  });
}

// Exchanges cards in the factory; resolves the awarded original card and
// throws ApiError with the server's reason on failure.
export function FactoryPack(cards: string[] = [], rarity: string) {
  return apiRequest<FactoryReward>("/api/v1/factory_pack", { method: "POST", json: { cards, rarity } });
}
