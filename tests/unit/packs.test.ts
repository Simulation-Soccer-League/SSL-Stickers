import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidRecipe } from "../../src/server/services/factory.ts";
import { randomRoll, rarityForRoll } from "../../src/server/services/packs.ts";

test("pack odds thresholds: Diamond < 0.5, Gold < 3, Silver < 20, else Bronze", () => {
  const cases: [number, string][] = [
    [0, "Diamond"],
    [0.4999, "Diamond"],
    [0.5, "Gold"],
    [2.9999, "Gold"],
    [3, "Silver"],
    [19.9999, "Silver"],
    [20, "Bronze"],
    [99.9999, "Bronze"],
  ];
  for (const [roll, rarity] of cases) assert.equal(rarityForRoll(roll), rarity, String(roll));
});

test("random rolls stay in [0, 100) and follow the configured odds", () => {
  const counts: Record<string, number> = { Bronze: 0, Silver: 0, Gold: 0, Diamond: 0 };
  const draws = 200_000;
  for (let i = 0; i < draws; i++) {
    const roll = randomRoll();
    assert.ok(roll >= 0 && roll < 100);
    counts[rarityForRoll(roll)] += 1;
  }
  const expected = { Bronze: 0.8, Silver: 0.17, Gold: 0.025, Diamond: 0.005 };
  for (const [rarity, p] of Object.entries(expected)) {
    // Five standard deviations: fails by chance far less than once in a million runs.
    const tolerance = 5 * Math.sqrt((p * (1 - p)) / draws);
    assert.ok(Math.abs(counts[rarity] / draws - p) < tolerance, `${rarity}: ${counts[rarity] / draws} vs ${p}`);
  }
});

test("factory recipes", () => {
  const n = (count: number, rarity: "Bronze" | "Silver" | "Gold" | "Diamond") => Array(count).fill(rarity);
  assert.equal(isValidRecipe(n(2, "Bronze"), "Bronze"), true);
  assert.equal(isValidRecipe(n(5, "Bronze"), "Silver"), true);
  assert.equal(isValidRecipe(n(2, "Silver"), "Silver"), true);
  assert.equal(isValidRecipe(n(5, "Silver"), "Gold"), true);
  assert.equal(isValidRecipe(n(2, "Gold"), "Gold"), true);
  assert.equal(isValidRecipe(n(5, "Gold"), "Diamond"), true);
  assert.equal(isValidRecipe(n(2, "Diamond"), "Diamond"), true);

  assert.equal(isValidRecipe(n(3, "Bronze"), "Silver"), false, "old 3-card recipe is gone");
  assert.equal(isValidRecipe(n(3, "Bronze"), "Bronze"), false);
  assert.equal(isValidRecipe(n(2, "Bronze"), "Silver"), false);
  assert.equal(isValidRecipe(["Bronze", "Silver"], "Silver"), false);
  assert.equal(isValidRecipe([...n(4, "Gold"), "Diamond"], "Diamond"), false);
  assert.equal(isValidRecipe([], "Bronze"), false);
});
