// Builds Card Upload ZIPs from a Cloudinary export (scripts/cloudinary-export.ts),
// naming each image in the upload format from its card's data in the database,
// so the cards can be recreated from scratch through the site's upload page.
//
//   npm run cards:build-upload-zips -- [--export=<dir>] [--out=<dir>] [--database=NAME] [--name=<card id>:<name>]...
//
// Defaults: --export=../SSLStickers-cloudinary-export, --out=../SSLStickers-upload-zips.
// Output: one ZIP per rarity (split if over the upload limits) and report.json.
// Every filename is checked to parse back to exactly its card's name, rarity, season and team.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import type { RowDataPacket } from "mysql2/promise";
import { fail, loadDb } from "./db-cli.ts";
import { CardType } from "../src/server/enums.ts";
import { ZIP_LIMITS, parseCardFilename } from "../src/server/services/originalCards.ts";

type ManifestEntry = { public_id: string; file: string; bytes: number };
type Card = { id: number; name: string | null; rarity: string; season: number; api_id: string; team: string | null };
type Planned = { card: Card; source: string; filename: string; bytes: number };

// Like parseArgs, but --name may repeat.
function args(argv: string[]) {
  const single = new Map<string, string>();
  const names = new Map<number, string>();
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Unrecognized argument: ${arg}`);
    if (match[1] === "name") {
      const [id, ...rest] = match[2].split(":");
      if (!/^\d+$/.test(id) || !rest.length) throw new Error(`--name must be <card id>:<name>, got ${match[2]}`);
      names.set(Number(id), rest.join(":"));
    } else single.set(match[1], match[2]);
  }
  return { single, names };
}

const underscore = (value: string) => value.trim().replace(/ /g, "_");

// Problems that make a value unrepresentable in the upload filename format.
function unsafe(label: string, value: string): string | null {
  if (value.includes("-")) return `${label} contains "-"`;
  if (value.includes("_")) return `${label} contains "_" (would become a space)`;
  if (/[\\/:*?"<>|\x00-\x1f]/.test(value)) return `${label} contains a character not allowed in file names`;
  if (/ {2}/.test(value) || value !== value.trim()) return `${label} has extra spaces`;
  return null;
}

async function main() {
  const { single, names: nameOverrides } = args(process.argv.slice(2));
  const root = path.resolve(import.meta.dirname, "..");
  const exportDir = path.resolve(root, single.get("export") ?? "../SSLStickers-cloudinary-export");
  const outDir = path.resolve(root, single.get("out") ?? "../SSLStickers-upload-zips");
  const db = await loadDb(new Map(single.has("database") ? [["database", single.get("database")!]] : []));

  try {
    const manifest = JSON.parse(await readFile(path.join(exportDir, "manifest.json"), "utf8")) as { resources: ManifestEntry[] };
    const rows = await db.query<RowDataPacket & { id: number; name: string | null; cardtype: number; season: number; api_id: string; team: string | null }>(
      "SELECT id, name, cardtype, season, api_id, team FROM original_cards ORDER BY id",
    );
    const cards = new Map<string, Card>();
    for (const row of rows) {
      const rarity = CardType.toName(row.cardtype) ?? "?";
      cards.set(`${row.season}/${rarity}/${row.api_id}`, { ...row, rarity, name: nameOverrides.get(row.id) ?? row.name });
    }

    const skipped: { image: string; card_id: number | null; reason: string }[] = [];
    const planned: Planned[] = [];
    const used = new Map<string, Set<string>>(); // rarity -> filenames
    for (const entry of manifest.resources) {
      const card = cards.get(entry.public_id);
      if (!card) {
        skipped.push({ image: entry.public_id, card_id: null, reason: "no card in the database uses this image" });
        continue;
      }
      if (!card.name) {
        skipped.push({ image: entry.public_id, card_id: card.id, reason: `card has no name (pass --name=${card.id}:<name>)` });
        continue;
      }
      const problem = unsafe("name", card.name) ?? (card.team ? unsafe("team", card.team) : null);
      if (problem) {
        skipped.push({ image: entry.public_id, card_id: card.id, reason: problem });
        continue;
      }

      const base = `${underscore(card.name)}-${card.rarity.toLowerCase()}-S${card.season}${card.team ? `-${underscore(card.team)}` : ""}`;
      const taken = used.get(card.rarity) ?? new Set<string>();
      let filename = `${base}.png`;
      for (let n = 2; taken.has(filename.toLowerCase()); n++) {
        // Without a team the suffix would be read as the team, so add an empty team segment first.
        filename = `${base}${card.team ? "" : "-"}-${n}.png`;
      }
      taken.add(filename.toLowerCase());
      used.set(card.rarity, taken);

      const parsed = parseCardFilename(filename);
      const expected = { name: card.name.trim(), rarity: card.rarity, season: card.season, team: card.team?.trim() || null };
      if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
        skipped.push({ image: entry.public_id, card_id: card.id, reason: `"${filename}" parses as ${JSON.stringify(parsed)}` });
        continue;
      }
      planned.push({ card, source: path.join(exportDir, entry.file), filename, bytes: entry.bytes });
    }

    const exported = new Set(manifest.resources.map((r) => r.public_id));
    const cardsWithoutImage = [...cards.entries()].filter(([publicId]) => !exported.has(publicId)).map(([publicId, card]) => ({ card_id: card.id, name: card.name, image: publicId }));

    // One ZIP per rarity, split to stay under the upload limits (with a little headroom).
    await mkdir(outDir, { recursive: true });
    const zips: { file: string; images: number; bytes: number }[] = [];
    for (const rarity of CardType.names) {
      const group = planned.filter((p) => p.card.rarity === rarity).sort((a, b) => a.filename.localeCompare(b.filename));
      const chunks: Planned[][] = [];
      for (const item of group) {
        const last = chunks.at(-1);
        const lastBytes = last?.reduce((sum, p) => sum + p.bytes, 0) ?? 0;
        if (!last || last.length >= ZIP_LIMITS.maxEntries || lastBytes + item.bytes > ZIP_LIMITS.maxZipBytes * 0.95) chunks.push([item]);
        else last.push(item);
      }
      for (const [index, chunk] of chunks.entries()) {
        const files: Record<string, Uint8Array> = {};
        for (const item of chunk) files[item.filename] = new Uint8Array(await readFile(item.source));
        // PNGs are already compressed; store them as-is.
        const zip = zipSync(files, { level: 0 });
        const name = `cards-${rarity.toLowerCase()}${chunks.length > 1 ? `-${index + 1}` : ""}.zip`;
        await writeFile(path.join(outDir, name), zip);
        zips.push({ file: name, images: chunk.length, bytes: zip.length });
      }
    }

    const report = {
      built_at: new Date().toISOString(),
      source_database: process.env.MYSQL_DATABASE,
      zips,
      images: planned.map((p) => ({ card_id: p.card.id, zip_name: p.filename, from: p.source })),
      skipped,
      cards_without_image: cardsWithoutImage,
    };
    await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));

    for (const z of zips) console.log(`${z.file}: ${z.images} images, ${(z.bytes / 1024 / 1024).toFixed(1)} MB`);
    console.log(`${planned.length} images named and zipped; ${skipped.length} skipped`);
    for (const s of skipped) console.log(`  SKIPPED ${s.image} (card ${s.card_id ?? "-"}): ${s.reason}`);
    if (cardsWithoutImage.length) {
      console.log(`${cardsWithoutImage.length} cards in the database have no exported image (not included):`);
      for (const c of cardsWithoutImage) console.log(`  card ${c.card_id} ${c.name ?? "(no name)"} ${c.image}`);
    }
    console.log(`report: ${path.join(outDir, "report.json")}`);
  } finally {
    await db.closePools();
  }
}

main().catch(fail);
