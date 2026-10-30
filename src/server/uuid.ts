// user_cards.uuid and trade_items.user_card_id are VARBINARY(16) holding the
// UUID bytes in plain order (HEX(uuid) is the UUID without dashes), matching
// mysql-binuuid-rails and MySQL's BIN_TO_UUID(x) without the swap flag.
import { randomUUID } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function uuidToBin(uuid: string): Buffer {
  if (!isUuid(uuid)) throw new TypeError(`Invalid UUID: ${uuid}`);
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

export function binToUuid(bin: Buffer): string {
  if (bin.length !== 16) throw new TypeError(`Expected 16 bytes, got ${bin.length}`);
  const hex = bin.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newUuid(): string {
  return randomUUID();
}
