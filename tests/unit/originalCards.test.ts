import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCardFilename } from "../../src/server/services/originalCards.ts";

test("card file names parse name, rarity and season like Rails get_file_name_args", () => {
  assert.deepEqual(parseCardFilename("John_Doe-gold-S23.png"), { name: "John Doe", rarity: "Gold", season: 23, team: null });
  assert.deepEqual(parseCardFilename("Pele-diamond-season2024.png"), { name: "Pele", rarity: "Diamond", season: 20, team: null }, "first two digits, as in Rails");
  assert.deepEqual(parseCardFilename("A_B-bronze-07.png"), { name: "A B", rarity: "Bronze", season: 7, team: null });
  assert.deepEqual(parseCardFilename("jerry-bronze-S23.PNG"), { name: "jerry", rarity: "Bronze", season: 23, team: null }, "single-word names are kept");
});

test("an optional fourth segment is the team; later segments are ignored", () => {
  assert.deepEqual(parseCardFilename("John_Doe-gold-S23-Tokyo_S.C..png"), { name: "John Doe", rarity: "Gold", season: 23, team: "Tokyo S.C." });
  assert.deepEqual(parseCardFilename("Mary_Ann_Lee-SILVER-23-Xelajú_Cósmico_FC.png"), {
    name: "Mary Ann Lee",
    rarity: "Silver",
    season: 23,
    team: "Xelajú Cósmico FC",
  });
  assert.deepEqual(
    parseCardFilename("matt_oopsie-silver-S23-Hollywood_FC-2.png"),
    { name: "matt oopsie", rarity: "Silver", season: 23, team: "Hollywood FC" },
    "a suffix after the team tells duplicate images apart",
  );
  assert.equal(parseCardFilename("A_B-gold-23-_.png")?.team, null, "blank team");
  assert.equal(parseCardFilename(`A_B-gold-23-${"x".repeat(101)}.png`), null, "team longer than the column");
});

test("unparseable names are rejected", () => {
  assert.equal(parseCardFilename("John_Doe-gold.png"), null, "missing season segment");
  assert.equal(parseCardFilename("John_Doe-gold-S2.png"), null, "fewer than two digits");
  assert.equal(parseCardFilename("John_Doe-platinum-23.png"), null, "unknown rarity");
  assert.equal(parseCardFilename("Jean-Luc_Picard-gold-23.png"), null, "hyphenated names split like Rails");
  assert.equal(parseCardFilename("_-gold-23.png"), null, "blank name");
});
