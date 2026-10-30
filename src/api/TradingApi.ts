import { apiRequest } from "../lib/request.ts";

export const tradesUpdatedEvent = "trades-updated";

function notifyTradesUpdated() {
  window.dispatchEvent(new Event(tradesUpdatedEvent));
}

// Errors are ApiError; `cardIds` lists cards the server flagged as unavailable.

export async function createTrade(Cards: string[] = [], receiver: string) {
  const result = await apiRequest<unknown>("/api/v1/trades", {
    method: "POST",
    json: { combinedCards: [...Cards], receiver },
  });
  notifyTradesUpdated();
  return result;
}

export function Trades() {
  return apiRequest<unknown>("/api/v1/trades");
}

export type TradeCard = {
  uuid: string;
  created_at: string;
  updated_at: string;
  user_id: number;
  cardtype: "Bronze" | "Silver" | "Gold" | "Diamond";
  season: number;
  api_id: string;
  card_name: string;
};

export type TradeDetail = {
  user_trade_items: TradeCard[];
  user2_trade_items: TradeCard[];
  current_user_accept: boolean | null;
  user2_name: string | null;
  unavailable_card_ids: string[];
};

export function GetTrade(trade_id?: number) {
  return apiRequest<TradeDetail>(`/api/v1/trades/${trade_id}`);
}

export async function DestroyTrade(trade_id?: number) {
  await apiRequest<null>(`/api/v1/trades/${trade_id}`, { method: "DELETE" });
  notifyTradesUpdated();
}

// Accepts an offer; `Cards` must be the trade's full card set.
export async function updateTrade(Cards: string[] = [], trade_id: number) {
  const result = await apiRequest<unknown>(`/api/v1/trades/${trade_id}`, {
    method: "PATCH",
    json: { combinedCards: [...Cards] },
  });
  notifyTradesUpdated();
  return result;
}
