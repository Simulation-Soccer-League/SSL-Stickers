// Minimal stand-in for the Cloudinary upload and admin APIs, so the real SDK
// can be exercised without touching a real account. The app reaches it via
// CLOUDINARY_URL=cloudinary://key:secret@<cloud>?upload_prefix=http://127.0.0.1:<port>.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomBytes } from "node:crypto";

export const FAKE_CLOUD = "fakecloud";
const PORT = Number(process.env.TEST_CLOUDINARY_PORT ?? 3200);
export const FAKE_CLOUDINARY_URL = `cloudinary://test_key:test_secret@${FAKE_CLOUD}?upload_prefix=http://127.0.0.1:${PORT}`;

export type Action = "upload" | "rename" | "destroy" | "update";
export type Asset = { public_id: string; asset_folder: string; bytes: number };

export const fake = {
  assets: new Map<string, Asset>(),
  calls: [] as { action: Action; params: Record<string, string> }[],
  // Forced failures per action: skip `after` successful calls, then fail `times` calls.
  failures: new Map<Action, { after: number; times: number }>(),
  reset() {
    this.assets.clear();
    this.calls = [];
    this.failures.clear();
  },
  failNext(action: Action, { times = 1, after = 0 } = {}) {
    this.failures.set(action, { after, times });
  },
};

async function readParams(req: IncomingMessage): Promise<{ params: Record<string, string>; fileBytes: number }> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);
  const type = String(req.headers["content-type"] ?? "");
  if (type.includes("application/json")) return { params: raw.length ? JSON.parse(raw.toString()) : {}, fileBytes: 0 };
  const form = await new Response(new Uint8Array(raw), { headers: { "content-type": type } }).formData();
  const params: Record<string, string> = {};
  let fileBytes = 0;
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
    else fileBytes = value.size;
  }
  return { params, fileBytes };
}

function handle(action: Action, params: Record<string, string>, fileBytes: number, publicIdFromPath?: string): [number, unknown] {
  const failure = fake.failures.get(action);
  if (failure && failure.after > 0) {
    failure.after -= 1;
  } else if (failure && failure.times > 0) {
    failure.times -= 1;
    return [500, { error: { message: `Injected ${action} failure` } }];
  }
  switch (action) {
    case "upload": {
      const folder = params.folder ?? "";
      const publicId = `${folder ? `${folder}/` : ""}${randomBytes(10).toString("hex")}`;
      fake.assets.set(publicId, { public_id: publicId, asset_folder: folder, bytes: fileBytes });
      return [200, { public_id: publicId, asset_folder: folder, bytes: fileBytes, resource_type: "image", type: "upload" }];
    }
    case "rename": {
      const asset = fake.assets.get(params.from_public_id);
      if (!asset) return [404, { error: { message: `Resource not found - ${params.from_public_id}` } }];
      if (fake.assets.has(params.to_public_id)) return [400, { error: { message: "to_public_id already exists" } }];
      fake.assets.delete(params.from_public_id);
      fake.assets.set(params.to_public_id, { ...asset, public_id: params.to_public_id });
      return [200, { public_id: params.to_public_id, asset_folder: asset.asset_folder }];
    }
    case "destroy":
      return [200, { result: fake.assets.delete(params.public_id) ? "ok" : "not found" }];
    case "update": {
      const asset = fake.assets.get(publicIdFromPath!);
      if (!asset) return [404, { error: { message: `Resource not found - ${publicIdFromPath}` } }];
      if (params.asset_folder !== undefined) asset.asset_folder = params.asset_folder;
      return [200, { public_id: asset.public_id, asset_folder: asset.asset_folder }];
    }
  }
}

let server: Server | null = null;

export async function startFakeCloudinary() {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const prefix = `/v1_1/${FAKE_CLOUD}/`;
    let action: Action | null = null;
    let publicIdFromPath: string | undefined;
    if (req.method === "POST" && url.pathname === `${prefix}image/upload`) action = "upload";
    else if (req.method === "POST" && url.pathname === `${prefix}image/rename`) action = "rename";
    else if (req.method === "POST" && url.pathname === `${prefix}image/destroy`) action = "destroy";
    else if (req.method === "POST" && url.pathname.startsWith(`${prefix}resources/image/upload/`)) {
      action = "update";
      publicIdFromPath = decodeURIComponent(url.pathname.slice(`${prefix}resources/image/upload/`.length));
    }
    if (!action) {
      res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: `No fake for ${req.method} ${url.pathname}` } }));
      return;
    }
    const { params, fileBytes } = await readParams(req);
    fake.calls.push({ action, params: publicIdFromPath ? { ...params, public_id: publicIdFromPath } : params });
    const [status, body] = handle(action, params, fileBytes, publicIdFromPath);
    res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server!.listen(PORT, "127.0.0.1", resolve));
}

export async function stopFakeCloudinary() {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
}
