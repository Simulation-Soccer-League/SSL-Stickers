import type { NextApiRequest, NextApiResponse } from "next";
import { apiRoute, bodyString } from "../../../server/api.ts";
import { blockedReason, findForumLogin } from "../../../server/auth/forumUsers.ts";
import { checkMybbPassword } from "../../../server/auth/mybbPassword.ts";
import { startSession } from "../../../server/auth/session.ts";
import { clientIp, createLimiter } from "../../../server/rateLimit.ts";
import { findOrCreateUserForForumAccount } from "../../../server/users.ts";

// Failed attempts per account+IP, and per IP across accounts.
const accountFailures = createLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });
const ipFailures = createLimiter({ limit: 50, windowMs: 15 * 60 * 1000 });

async function login(req: NextApiRequest, res: NextApiResponse) {
  const username = (bodyString(req, "username") ?? "").trim();
  const password = bodyString(req, "password") ?? "";
  const ip = clientIp(req);
  const accountKey = `${username.toLowerCase()}|${ip}`;

  const retryAfter = Math.max(accountFailures.retryAfter(accountKey), ipFailures.retryAfter(ip));
  if (retryAfter > 0) {
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Too many login attempts. Try again later." });
    return;
  }

  const forumUser = username ? await findForumLogin(username) : null;
  const check = forumUser ? checkMybbPassword(forumUser, password) : { valid: false as const };
  if (forumUser && !check.valid && "unsupported" in check && check.unsupported) {
    console.warn(`Login refused for forum uid ${forumUser.uid}: unsupported ${check.unsupported}`);
  }
  if (!forumUser || !check.valid) {
    accountFailures.hit(accountKey);
    ipFailures.hit(ip);
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  accountFailures.reset(accountKey);

  const blocked = blockedReason(forumUser);
  if (blocked) {
    res.status(403).json({ error: blocked });
    return;
  }

  const user = await findOrCreateUserForForumAccount(forumUser);
  await startSession(res, user);
  res.status(200).json({ id: user.id, username: user.username });
}

export default apiRoute({ POST: login });
