import { api } from "./api.ts";

// A failed API request. `message` is the server's `error` text when it sent one.
export class ApiError extends Error {
  readonly status: number;
  // Card IDs the server flagged (trades), for highlighting in the UI.
  readonly cardIds: string[];
  // The full JSON error body, for endpoint-specific details (e.g. upload `files`).
  readonly body: unknown;

  constructor(status: number, message: string, cardIds: string[] = [], body: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.cardIds = cardIds;
    this.body = body;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  // Sent as a JSON body.
  json?: unknown;
  // Sent as multipart/form-data.
  form?: FormData;
};

// Calls a same-origin API route with the session cookie. Resolves the parsed
// JSON body (null for empty responses such as 204); throws ApiError otherwise.
export async function apiRequest<T>(path: string, { method = "GET", json, form }: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${api}${path}`, {
      method,
      credentials: "include",
      headers: json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: json !== undefined ? JSON.stringify(json) : form,
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const payload = (body ?? {}) as { error?: unknown; card_ids?: unknown };
    const message = typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
    const cardIds = Array.isArray(payload.card_ids) ? payload.card_ids.map(String) : [];
    throw new ApiError(response.status, message, cardIds, body);
  }
  return body as T;
}
