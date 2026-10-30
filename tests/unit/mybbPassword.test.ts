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
    password_algorithm: "",
    password_encryption: 0,
    ...overrides,
  };
}

function bcryptUser(plaintext: string, overrides: Partial<MybbPasswordFields> = {}): MybbPasswordFields {
  return {
    password: bcrypt.hashSync(plaintext, 4),
    salt: "",
    password_algorithm: "bcrypt",
    password_encryption: 0,
    ...overrides,
  };
}

test("accepts a valid legacy MyBB salted MD5 password", () => {
  const user = legacyUser("correct horse");
  assert.equal(checkMybbPassword(user, "correct horse").valid, true);
  assert.equal(checkMybbPassword(user, "wrong password").valid, false);
});

test("legacy hashes compare case-insensitively and accept the 'mybb' algorithm name", () => {
  const user = legacyUser("correct horse");
  assert.equal(checkMybbPassword({ ...user, password: user.password!.toUpperCase() }, "correct horse").valid, true);
  assert.equal(checkMybbPassword({ ...user, password_algorithm: "MyBB" }, "correct horse").valid, true);
});

test("accepts a valid bcrypt password", () => {
  const user = bcryptUser("correct horse");
  assert.equal(checkMybbPassword(user, "correct horse").valid, true);
  assert.equal(checkMybbPassword(user, "wrong password").valid, false);
});

test("detects bcrypt by hash prefix, including PHP's $2y$", () => {
  const user = bcryptUser("correct horse", { password_algorithm: "" });
  const phpHash = user.password!.replace(/^\$2[ab]\$/, "$2y$");
  assert.equal(checkMybbPassword({ ...user, password: phpHash }, "correct horse").valid, true);
});

test("rejects encrypted and unknown password formats", () => {
  assert.deepEqual(checkMybbPassword(legacyUser("correct horse", { password_encryption: 1 }), "correct horse"), {
    valid: false,
    unsupported: "password_encryption=1",
  });
  assert.deepEqual(checkMybbPassword(legacyUser("correct horse", { password_algorithm: "unknown" }), "correct horse"), {
    valid: false,
    unsupported: "password_algorithm=unknown",
  });
  const argon = { password: "$argon2id$v=19$m=65536,t=4,p=1$c2FsdA$aGFzaA", salt: "", password_algorithm: "argon2", password_encryption: 0 };
  assert.equal(checkMybbPassword(argon, "x").valid, false);
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
