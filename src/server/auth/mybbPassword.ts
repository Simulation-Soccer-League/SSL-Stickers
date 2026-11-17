// Verifies a plaintext password against a MyBB forum user's stored hash.
// Port of the Rails MybbPasswordVerifier (PR #5), plus explicit handling of
// formats it could not verify. The forum's users table has no algorithm
// column, so the format is detected from the stored hash itself.
import { createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

export type MybbPasswordFields = {
  password: string | null;
  salt: string | null;
};

export type PasswordCheck = { valid: true } | { valid: false; unsupported?: string };

// $2a$/$2b$ are standard bcrypt; $2y$ is PHP's name for $2b$. $2x$ (the
// pre-2011 crypt_blowfish bug variant) is not reproducible here.
const BCRYPT_PREFIX = /^\$2[aby]\$/;
// MyBB's legacy format: md5(md5(salt) + md5(password)), 32 hex characters.
const LEGACY_HASH = /^[0-9a-f]{32}$/i;

const md5 = (value: string) => createHash("md5").update(value, "utf8").digest("hex");

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function checkMybbPassword(user: MybbPasswordFields, plaintext: string): PasswordCheck {
  const stored = user.password ?? "";
  if (!plaintext || !stored) return { valid: false };

  if (stored.startsWith("$2")) {
    if (!BCRYPT_PREFIX.test(stored)) return { valid: false, unsupported: `bcrypt prefix ${stored.slice(0, 4)}` };
    try {
      return { valid: bcrypt.compareSync(plaintext, stored) };
    } catch {
      return { valid: false, unsupported: "malformed bcrypt hash" };
    }
  }

  if (LEGACY_HASH.test(stored)) {
    const computed = md5(md5(user.salt ?? "") + md5(plaintext));
    return { valid: safeEqual(computed, stored.toLowerCase()) };
  }

  // e.g. argon2 via a MyBB plugin. Add a verifier if production uses one.
  return { valid: false, unsupported: `hash format ${stored.startsWith("$") ? stored.split("$")[1] : "unknown"}` };
}
