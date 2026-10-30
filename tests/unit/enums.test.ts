import { test } from "node:test";
import assert from "node:assert/strict";
import { CardType, TradeStatus, UserStatus } from "../../src/server/enums.ts";

test("user roles keep their stored values; the retired card_approver (2) maps to nothing", () => {
  assert.deepEqual(UserStatus.names, ["normal", "moderator", "admin"]);
  assert.deepEqual(UserStatus.names.map((name) => UserStatus.toValue(name)), [0, 1, 3]);
  assert.equal(UserStatus.toName(3), "admin");
  assert.equal(UserStatus.toName(2), null);
  assert.equal(UserStatus.toValue("card_approver"), null);
  assert.equal(UserStatus.toValue("constructor"), null, "only declared names");
  assert.equal(UserStatus.toValue(1), null, "names only");
});

test("card types and trade statuses are positional", () => {
  assert.deepEqual(CardType.names.map((name) => CardType.toValue(name)), [0, 1, 2, 3]);
  assert.equal(CardType.toName(3), "Diamond");
  assert.equal(TradeStatus.toName(2), "declined");
  assert.equal(TradeStatus.toValue("pending"), 0);
});
