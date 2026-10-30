// Verifies a plaintext password against a MyBB forum user's stored hash.
// Port of the Rails MybbPasswordVerifier (PR #5), plus explicit handling of
// formats it could not verify.
import { createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

export type MybbPasswordFields = {
  password: string | null;
  salt: string | null;
  password_algorithm: string | null;
  password_encryption: number | null;
};

export type PasswordCheck = { valid: true } | { valid: false; unsupported?: string };

// $2a$/$2b$ are standard bcrypt; $2y$ is PHP's name for $2b$. $2x$ (the
// pre-2011 crypt_blowfish bug variant) is not reproducible here.
const BCRYPT_PREFIX = /^\$2[aby]\$/;
const LEGACY_ALGORITHMS = new Set(["", "mybb"]);

const md5 = (value: string) => createHash("md5").update(value, "utf8").digest("hex");

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function checkMybbPassword(user: MybbPasswordFields, plaintext: string): PasswordCheck {
  const stored = user.password ?? "";
  if (!plaintext || !stored) return { valid: false };
  if (Number(user.password_encryption ?? 0) !== 0) {
    return { valid: false, unsupported: `password_encryption=${user.password_encryption}` };
  }

  const algorithm = (user.password_algorithm ?? "").toLowerCase();

  if (algorithm === "bcrypt" || stored.startsWith("$2")) {
    if (!BCRYPT_PREFIX.test(stored)) return { valid: false, unsupported: `bcrypt prefix ${stored.slice(0, 4)}` };
    try {
      return { valid: bcrypt.compareSync(plaintext, stored) };
    } catch {
      return { valid: false, unsupported: "malformed bcrypt hash" };
    }
  }

  if (LEGACY_ALGORITHMS.has(algorithm)) {
    const computed = md5(md5(user.salt ?? "") + md5(plaintext));
    return { valid: safeEqual(computed, stored.toLowerCase()) };
  }

  // e.g. argon2 via a MyBB plugin. Add a verifier before go-live if production uses one.
  return { valid: false, unsupported: `password_algorithm=${algorithm}` };
}
