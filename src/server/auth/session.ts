// Login sessions: an HS256 JWT in an HTTP-only cookie.
//
// Tokens last 30 days. Once a token is more than a day old, the next request
// re-checks the forum account (still exists, not banned or awaiting
// activation) and reissues it, so activity keeps a login alive and forum bans
// take effect within a day. Logout clears the cookie; tokens are not stored
// server-side, so a copied token stays valid until it expires (accepted
// trade-off of the stateless design).
import type { IncomingMessage, ServerResponse } from "node:http";
import { SignJWT, jwtVerify } from "jose";
import { findUserById, type StickersUser } from "../users.ts";
import { blockedReason, findForumUserByUid } from "./forumUsers.ts";

export const SESSION_COOKIE = "ssl_session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const RENEW_AFTER_SECONDS = 24 * 60 * 60;

type SessionClaims = { sub: string; fuid: number; iat: number; exp: number };

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(user: Pick<StickersUser, "id" | "forum_uid">): Promise<string> {
  return new SignJWT({ fuid: user.forum_uid })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.fuid !== "number") return null;
    return payload as unknown as SessionClaims;
  } catch {
    return null;
  }
}

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index !== -1 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

function appendSetCookie(res: ServerResponse, cookie: string) {
  const current = res.getHeader("Set-Cookie");
  const list = current === undefined ? [] : Array.isArray(current) ? current : [String(current)];
  res.setHeader("Set-Cookie", [...list, cookie]);
}

function cookieAttributes(maxAge: number) {
  const secure = process.env.NODE_ENV === "production" && process.env.SESSION_COOKIE_INSECURE !== "true";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export async function startSession(res: ServerResponse, user: Pick<StickersUser, "id" | "forum_uid">) {
  appendSetCookie(res, `${SESSION_COOKIE}=${await createSessionToken(user)}; ${cookieAttributes(MAX_AGE_SECONDS)}`);
}

export function endSession(res: ServerResponse) {
  appendSetCookie(res, `${SESSION_COOKIE}=; ${cookieAttributes(0)}`);
}

// Returns the logged-in stickers user, or null (clearing an invalid cookie).
export async function getSessionUser(req: IncomingMessage, res: ServerResponse): Promise<StickersUser | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;

  const claims = await verifySessionToken(token);
  const user = claims ? await findUserById(Number(claims.sub)) : null;
  if (!claims || !user || user.forum_uid !== claims.fuid) {
    endSession(res);
    return null;
  }

  if (Date.now() / 1000 - claims.iat > RENEW_AFTER_SECONDS) {
    const forumUser = await findForumUserByUid(claims.fuid);
    if (!forumUser || blockedReason(forumUser)) {
      endSession(res);
      return null;
    }
    await startSession(res, user);
  }

  return user;
}
