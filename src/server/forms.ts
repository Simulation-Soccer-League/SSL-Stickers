// Request body reading for routes that accept multipart/form-data (which the
// Next.js body parser does not handle) as well as JSON and URL-encoded bodies.
// Routes using it must export `config = { api: { bodyParser: false } }`.
import type { IncomingMessage } from "node:http";

export class BodyTooLargeError extends Error {}

export type FormFields = {
  get(name: string): string | null;
  file(name: string): File | null;
  json(): unknown;
};

async function readRaw(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > maxBytes) throw new BodyTooLargeError(`Request body exceeds ${maxBytes} bytes`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new BodyTooLargeError(`Request body exceeds ${maxBytes} bytes`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readForm(req: IncomingMessage, { maxBytes = 1024 * 1024 } = {}): Promise<FormFields> {
  const contentType = String(req.headers["content-type"] ?? "");
  const raw = await readRaw(req, maxBytes);

  if (/^application\/json/i.test(contentType)) {
    const data = raw.length ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {};
    return {
      get: (name) => {
        const value = data?.[name];
        return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : null;
      },
      file: () => null,
      json: () => data,
    };
  }

  const form =
    /^(multipart\/form-data|application\/x-www-form-urlencoded)/i.test(contentType) && raw.length
      ? await new Response(new Uint8Array(raw), { headers: { "content-type": contentType } }).formData()
      : new FormData();
  return {
    get: (name) => {
      const value = form.get(name);
      return typeof value === "string" ? value : null;
    },
    file: (name) => {
      const value = form.get(name);
      return value instanceof File ? value : null;
    },
    json: () => Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")),
  };
}

// ActiveModel::Type::Boolean cast: blank → null; its exact FALSE_VALUES → false; anything else → true.
const FALSE_VALUES = new Set(["0", "f", "F", "false", "FALSE", "off", "OFF"]);

export function castBoolean(value: string | null): boolean | null {
  if (value === null || value === "") return null;
  return !FALSE_VALUES.has(value);
}
