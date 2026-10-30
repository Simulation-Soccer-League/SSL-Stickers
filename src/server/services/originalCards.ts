// Card image uploads (ZIP of PNGs), the approval queue, approval, and
// deletion. Straight port of the Rails OriginalCardsController with input
// validation and compensation for partial Cloudinary/database failures.
//
// Cloudinary layout (unchanged): approved images live at
// <season>/<Rarity>/<api_id>, unapproved ones at <season>/Unapproved/<api_id>.
import { unzipSync } from "fflate";
import type { RowDataPacket } from "mysql2/promise";
import { execute, query, withTransaction } from "../db.ts";
import { CardType, UserStatus, type CardTypeName } from "../enums.ts";
import { destroyAsset, renameAsset, setAssetFolder, uploadImage } from "../cloudinary.ts";
import type { StickersUser } from "../users.ts";
import type { OriginalCard } from "./cards.ts";

export const ZIP_LIMITS = {
  maxZipBytes: 50 * 1024 * 1024,
  maxEntries: 200,
  maxImageBytes: 20 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export class UploadError extends Error {
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(status: number, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }

  body() {
    return { error: this.message, ...this.details };
  }
}

// --- file names ----------------------------------------------------------

export type ParsedCardFile = { name: string; rarity: CardTypeName; season: number; team: string | null };

export const CARD_FILENAME_FORMAT = "<Player_Name>-<rarity>-<season>-<Team_Name>.png (team optional)";
const MAX_TEAM_LENGTH = 100; // original_cards.team is VARCHAR(100)

// "<Player_Name>-<rarity>-<season>[-<Team_Name>][-<anything>].png"
//   1. name: underscores become spaces
//   2. rarity: capitalized as in Ruby (first letter upper, rest lower)
//   3. season: the first two consecutive digits (e.g. "S23" → 23)
//   4. team (optional): underscores become spaces
// Segments after the team are ignored, so two images of the same card can be
// told apart with a suffix (e.g. "…-Team-2.png").
export function parseCardFilename(basename: string): ParsedCardFile | null {
  const parts = basename.replace(/\.png$/i, "").split("-");
  if (parts.length < 3) return null;
  // Rails' String#tr! returned nil for names without underscores; keep the name instead.
  const name = parts[0].replace(/_/g, " ").trim();
  const rarity = parts[1].charAt(0).toUpperCase() + parts[1].slice(1).toLowerCase();
  const season = /\d\d/.exec(parts[2])?.[0];
  const team = (parts[3] ?? "").replace(/_/g, " ").trim() || null;
  if (!name || CardType.toValue(rarity) === null || !season) return null;
  if (team && team.length > MAX_TEAM_LENGTH) return null;
  // Number() keeps folder names consistent with the integer season stored in the database.
  return { name, rarity: rarity as CardTypeName, season: Number(season), team };
}

// --- ZIP reading ---------------------------------------------------------

type CardImage = ParsedCardFile & { filename: string; data: Uint8Array };

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const isJunk = (path: string) => path.startsWith("__MACOSX/") || baseName(path).startsWith("._") || baseName(path) === ".DS_Store";

// Validates every entry before anything is uploaded (Rails uploaded entries
// one by one and stopped at the first non-PNG, leaving earlier ones behind).
export function readCardZip(zip: Uint8Array): CardImage[] {
  if (zip.length > ZIP_LIMITS.maxZipBytes) throw new UploadError(413, "ZIP file is too large");

  const entries: { path: string; size: number }[] = [];
  try {
    unzipSync(zip, {
      filter: (file) => {
        if (!file.name.endsWith("/") && !isJunk(file.name)) entries.push({ path: file.name, size: file.originalSize });
        return false;
      },
    });
  } catch {
    throw new UploadError(422, "File is not a valid ZIP archive");
  }

  if (entries.length === 0) throw new UploadError(422, "ZIP file contains no card images");
  if (entries.length > ZIP_LIMITS.maxEntries) throw new UploadError(422, `ZIP file contains more than ${ZIP_LIMITS.maxEntries} files`);
  const tooLarge = entries.filter((e) => e.size > ZIP_LIMITS.maxImageBytes).map((e) => baseName(e.path));
  if (tooLarge.length) throw new UploadError(422, "Some images are too large", { files: tooLarge });
  if (entries.reduce((sum, e) => sum + e.size, 0) > ZIP_LIMITS.maxTotalBytes) throw new UploadError(422, "ZIP contents are too large");

  const invalid = entries
    .map((e) => baseName(e.path))
    .filter((name) => !/\.png$/i.test(name) || !parseCardFilename(name));
  if (invalid.length) {
    throw new UploadError(422, `Every file must be a PNG named ${CARD_FILENAME_FORMAT}`, { files: invalid });
  }

  const wanted = new Set(entries.map((e) => e.path));
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, { filter: (file) => wanted.has(file.name) && file.originalSize <= ZIP_LIMITS.maxImageBytes });
  } catch {
    throw new UploadError(422, "File is not a valid ZIP archive");
  }

  return entries.map(({ path }) => {
    const data = files[path];
    const filename = baseName(path);
    if (!data || data.length > ZIP_LIMITS.maxImageBytes || !PNG_SIGNATURE.every((byte, i) => data[i] === byte)) {
      throw new UploadError(422, "Some files are not valid PNG images", { files: [filename] });
    }
    return { ...parseCardFilename(filename)!, filename, data };
  });
}

// --- rows ----------------------------------------------------------------

type OriginalRow = Omit<OriginalCard, "cardtype"> & { cardtype: number | null } & RowDataPacket;
const COLUMNS = "id, created_at, updated_at, name, cardtype, approved, api_id, season, team";
const toJson = (row: OriginalRow): OriginalCard => ({ ...row, cardtype: CardType.toName(row.cardtype) });

const unapprovedPath = (card: { season: number | null; api_id: string | null }) => `${card.season}/Unapproved/${card.api_id}`;
const approvedPath = (card: { season: number | null; cardtype: CardTypeName | null; api_id: string | null }) =>
  `${card.season}/${card.cardtype}/${card.api_id}`;

// Best-effort undo of an external step; failures are logged for manual cleanup.
async function compensate(description: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    console.error(`Cloudinary cleanup failed (${description}); fix manually`, error);
  }
}

// --- upload --------------------------------------------------------------

export async function uploadCards(user: StickersUser, zip: Uint8Array): Promise<OriginalCard[]> {
  const images = readCardZip(zip);
  // Admins publish directly; moderators' uploads go to the review queue.
  const approved = user.status === UserStatus.toValue("admin");

  // Upload every image first; if one fails, delete the ones already uploaded.
  const uploaded: (CardImage & { publicId: string; apiId: string })[] = [];
  for (const image of images) {
    const folder = approved ? `${image.season}/${image.rarity}` : `${image.season}/Unapproved`;
    try {
      const result = await uploadImage(image.data, folder);
      const prefix = `${folder}/`;
      const apiId = result.public_id.startsWith(prefix) ? result.public_id.slice(prefix.length) : result.public_id;
      uploaded.push({ ...image, publicId: result.public_id, apiId });
    } catch (error) {
      for (const done of uploaded) await compensate(`destroy ${done.publicId}`, () => destroyAsset(done.publicId));
      throw new UploadError(502, `Uploading ${image.filename} to Cloudinary failed; no cards were added`, {
        detail: (error as Error).message,
      });
    }
  }

  try {
    return await withTransaction(async (conn) => {
      const cards: OriginalCard[] = [];
      for (const image of uploaded) {
        const { insertId } = await execute(
          `INSERT INTO original_cards (name, cardtype, approved, api_id, season, team, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
          [image.name, CardType.toValue(image.rarity), approved, image.apiId, image.season, image.team],
          conn,
        );
        const [row] = await query<OriginalRow>(`SELECT ${COLUMNS} FROM original_cards WHERE id = ?`, [insertId], conn);
        cards.push(toJson(row));
      }
      return cards;
    });
  } catch (error) {
    for (const done of uploaded) await compensate(`destroy ${done.publicId}`, () => destroyAsset(done.publicId));
    throw error;
  }
}

// --- review queue --------------------------------------------------------

export async function unapprovedCards(): Promise<OriginalCard[]> {
  const rows = await query<OriginalRow>(`SELECT ${COLUMNS} FROM original_cards WHERE NOT (approved <=> TRUE) ORDER BY id`);
  return rows.map(toJson);
}

// Loads the requested cards; all must exist and still be unapproved.
async function loadUnapproved(ids: unknown): Promise<OriginalCard[]> {
  const list = Array.isArray(ids) ? ids : [];
  const numeric = [...new Set(list.map(Number))];
  if (numeric.length === 0 || numeric.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new UploadError(422, "ids must be a non-empty list of card ids");
  }
  const cards = (await query<OriginalRow>(`SELECT ${COLUMNS} FROM original_cards WHERE id IN (?) ORDER BY id`, [numeric])).map(toJson);
  const found = new Set(cards.map((card) => card.id));
  const missing = numeric.filter((id) => !found.has(id));
  if (missing.length) throw new UploadError(422, "Some cards were not found", { ids: missing });
  const alreadyApproved = cards.filter((card) => card.approved).map((card) => card.id);
  if (alreadyApproved.length) throw new UploadError(422, "Some cards are already approved", { ids: alreadyApproved });
  return cards;
}

type Failure = { id: number; error: string };

// Moves each card's image from <season>/Unapproved to <season>/<Rarity>, then marks it approved.
export async function approveCards(ids: unknown): Promise<unknown[]> {
  const cards = await loadUnapproved(ids);
  const results: unknown[] = [];
  const approvedIds: number[] = [];
  const failed: Failure[] = [];

  for (const card of cards) {
    const from = unapprovedPath(card);
    const to = approvedPath(card);
    try {
      const result = await setAssetFolder(from, `${card.season}/${card.cardtype}`);
      try {
        await renameAsset(from, to);
      } catch (error) {
        await compensate(`restore asset folder of ${from}`, () => setAssetFolder(from, `${card.season}/Unapproved`));
        throw error;
      }
      try {
        await execute("UPDATE original_cards SET approved = TRUE, updated_at = UTC_TIMESTAMP(6) WHERE id = ?", [card.id]);
      } catch (error) {
        await compensate(`rename ${to} back`, () => renameAsset(to, from));
        await compensate(`restore asset folder of ${from}`, () => setAssetFolder(from, `${card.season}/Unapproved`));
        throw error;
      }
      results.push(result);
      approvedIds.push(card.id);
    } catch (error) {
      failed.push({ id: card.id, error: (error as Error).message });
    }
  }

  if (failed.length) throw new UploadError(502, "Some cards could not be approved", { approved: approvedIds, failed });
  return results;
}

// Deletes each unapproved card's image, then its row.
export async function deleteCards(ids: unknown): Promise<void> {
  const cards = await loadUnapproved(ids);
  const deleted: number[] = [];
  const failed: Failure[] = [];
  for (const card of cards) {
    try {
      await destroyAsset(unapprovedPath(card));
      await execute("DELETE FROM original_cards WHERE id = ? AND NOT (approved <=> TRUE)", [card.id]);
      deleted.push(card.id);
    } catch (error) {
      failed.push({ id: card.id, error: (error as Error).message });
    }
  }
  if (failed.length) throw new UploadError(502, "Some cards could not be deleted", { deleted, failed });
}
