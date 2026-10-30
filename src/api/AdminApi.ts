import { apiRequest } from "../lib/request.ts";
import type { Role } from "./UserApi.ts";

export const ROLES: { value: Role; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "moderator", label: "Moderator" },
  { value: "admin", label: "Admin" },
];

export type AdminUser = {
  id: number;
  username: string;
  role: Role;
  forum_uid: number | null;
  packs_available: number;
  created_at: string;
};

export type AdminUserList = { users: AdminUser[]; total: number; limit: number };

export function listUsers(search = "", role = "") {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  if (role) params.set("role", role);
  const query = params.toString();
  return apiRequest<AdminUserList>(`/api/v1/admin/users${query ? `?${query}` : ""}`);
}

export function setUserRole(userId: number, role: Role) {
  return apiRequest<AdminUser>(`/api/v1/admin/users/${userId}`, { method: "PATCH", json: { role } });
}
