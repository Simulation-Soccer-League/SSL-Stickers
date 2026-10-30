import { ApiError, apiRequest } from "../lib/request.ts";

export type LoginResult = { id: number; username: string };
export type Role = "normal" | "moderator" | "admin";
export type CurrentUser = { status: Role; id: number; username: string };

// Logs in with forum credentials; throws ApiError with the server's reason
// (invalid credentials, banned or inactive account, too many attempts).
export function getUser(username: string, password: string) {
  return apiRequest<LoginResult>("/api/v1/login", { method: "POST", json: { username, password } });
}

// The logged-in user's role, or false when not logged in.
export async function WhoAmI(): Promise<CurrentUser | false> {
  try {
    return await apiRequest<CurrentUser>("/api/v1/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return false;
    throw error;
  }
}

export async function LogOut(): Promise<void> {
  await apiRequest<null>("/api/v1/logout", { method: "POST" });
}

// Usernames of every other user (trade recipients).
export function Users() {
  return apiRequest<string[]>("/api/v1/users_but_me");
}
