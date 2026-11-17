// Port of back/test/services/mybb_password_verifier_test.rb, plus formats the
// Node verifier handles explicitly.
import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { checkMybbPassword, type MybbPasswordFields } from "../../src/server/auth/mybbPassword.ts";

const md5 = (value: string) => createHash("md5").update(value).digest("hex");

function legacyUser(plaintext: string, overrides: Partial<MybbPasswordFields> = {}): MybbPasswordFields {
  const salt = "abc123";
  return {
    password: md5(md5(salt) + md5(plaintext)),
    salt,
    ...overrides,
  };
}

function bcryptUser(plaintext: string, overrides: Partial<MybbPasswordFields> = {}): MybbPasswordFields {
  return {
    password: bcrypt.hashSync(plaintext, 4),
    salt: "",
    ...overrides,
  };
}

test("accepts a valid legacy MyBB salted MD5 password", () => {
  const user = legacyUser("correct horse");
  assert.equal(checkMybbPassword(user, "correct horse").valid, true);
  assert.equal(checkMybbPassword(user, "wrong password").valid, false);
});

test("legacy hashes compare case-insensitively", () => {
  const user = legacyUser("correct horse");
  assert.equal(checkMybbPassword({ ...user, password: user.password!.toUpperCase() }, "correct horse").valid, true);
});

test("accepts a valid bcrypt password", () => {
  const user = bcryptUser("correct horse");
  assert.equal(checkMybbPassword(user, "correct horse").valid, true);
  assert.equal(checkMybbPassword(user, "wrong password").valid, false);
});

test("detects bcrypt by hash prefix, including PHP's $2y$", () => {
  const user = bcryptUser("correct horse");
  const phpHash = user.password!.replace(/^\$2[ab]\$/, "$2y$");
  assert.equal(checkMybbPassword({ ...user, password: phpHash }, "correct horse").valid, true);
});

test("rejects unknown hash formats", () => {
  const argon = { password: "$argon2id$v=19$m=65536,t=4,p=1$c2FsdA$aGFzaA", salt: "" };
  assert.deepEqual(checkMybbPassword(argon, "x"), { valid: false, unsupported: "hash format argon2id" });
  assert.deepEqual(checkMybbPassword({ password: "not-a-known-hash", salt: "" }, "x"), {
    valid: false,
    unsupported: "hash format unknown",
  });
});

test("rejects the $2x$ bcrypt variant and malformed bcrypt hashes", () => {
  const user = bcryptUser("correct horse");
  assert.equal(checkMybbPassword({ ...user, password: user.password!.replace(/^\$2[ab]\$/, "$2x$") }, "correct horse").valid, false);
  assert.equal(checkMybbPassword({ ...user, password: "$2b$10$tooshort" }, "correct horse").valid, false);
});

test("rejects blank passwords and blank stored hashes", () => {
  assert.equal(checkMybbPassword(legacyUser(""), "").valid, false);
  assert.equal(checkMybbPassword({ ...legacyUser("x"), password: "" }, "x").valid, false);
  assert.equal(checkMybbPassword({ ...legacyUser("x"), password: null }, "x").valid, false);
});
