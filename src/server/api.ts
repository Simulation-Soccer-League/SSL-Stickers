// Shared plumbing for API routes: method dispatch, same-origin protection for
// cookie-authenticated mutations, login checks, and error handling.
import type { NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "./auth/session.ts";
import { BodyTooLargeError } from "./forms.ts";
import { UserStatus, type UserStatusName } from "./enums.ts";
import type { StickersUser } from "./users.ts";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Handler = (req: NextApiRequest, res: NextApiResponse) => unknown | Promise<unknown>;

type RouteOptions = {
  // Skip the same-origin check (for endpoints authenticated by a bearer token, not the session cookie).
  crossOrigin?: boolean;
};

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// The session cookie is SameSite=Lax; additionally require mutations to come
// from this site's own pages. Browsers send Origin on POST/PUT/PATCH/DELETE.
export function isSameOrigin(req: NextApiRequest): boolean {
  const source = req.headers.origin ?? req.headers.referer;
  if (!source) return false;

  let sourceHost: string;
  try {
    sourceHost = new URL(source).host;
  } catch {
    return false;
  }

  const allowed = process.env.APP_ORIGIN
    ? [new URL(process.env.APP_ORIGIN).host]
    : [req.headers["x-forwarded-host"], req.headers.host].flatMap((value) => (value ? String(value).split(",") : []));
  return allowed.some((host) => host.trim() === sourceHost);
}

export function apiRoute(handlers: Partial<Record<Method, Handler>>, options: RouteOptions = {}) {
  return async function route(req: NextApiRequest, res: NextApiResponse) {
    const method = (req.method ?? "GET").toUpperCase() as Method;
    const handler = handlers[method];
    if (!handler) {
      res.setHeader("Allow", Object.keys(handlers).join(", "));
      res.status(405).json({ error: `Method ${method} not allowed` });
      return;
    }
    if (MUTATING.has(method) && !options.crossOrigin && !isSameOrigin(req)) {
      res.status(403).json({ error: "Cross-site request rejected" });
      return;
    }
    try {
      await handler(req, res);
    } catch (error) {
      if (res.headersSent) {
        console.error(`${method} ${req.url} failed after responding`, error);
      } else if (error instanceof BodyTooLargeError) {
        res.status(413).json({ error: error.message });
      } else if (error instanceof SyntaxError) {
        res.status(400).json({ error: "Malformed request body" });
      } else {
        console.error(`${method} ${req.url} failed`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  };
}

// Returns the logged-in user, or sends 401 with `body` and returns null.
export async function requireUser(
  req: NextApiRequest,
  res: NextApiResponse,
  body: unknown = { error: "You must be logged in" },
): Promise<StickersUser | null> {
  const user = await getSessionUser(req, res);
  if (!user) res.status(401).json(body);
  return user;
}

// Roles allowed to upload card images. Moderators' uploads wait for an admin; admins' publish directly.
export const CARD_UPLOADERS: readonly UserStatusName[] = ["moderator", "admin"];
// Admins: everything, including the review queue, card approval/removal, and user roles.
export const ADMINS: readonly UserStatusName[] = ["admin"];

// Returns the logged-in user if their role is one of `roles`; otherwise sends 401/403 and returns null.
export async function requireRole(
  req: NextApiRequest,
  res: NextApiResponse,
  roles: readonly UserStatusName[],
): Promise<StickersUser | null> {
  const user = await requireUser(req, res);
  if (!user) return null;
  const role = UserStatus.toName(user.status);
  if (!role || !roles.includes(role)) {
    res.status(403).json({ error: "You do not have permission to do that" });
    return null;
  }
  return user;
}

// Reads a string field from a JSON or form-encoded body.
export function bodyString(req: NextApiRequest, field: string): string | null {
  const value = (req.body as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
}
