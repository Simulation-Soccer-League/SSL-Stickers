// Downloads every image in the configured Cloudinary account (CLOUDINARY_URL)
// to a local folder, keeping each public ID as the file path
// (e.g. 23/Gold/abc123.png), and writes manifest.json describing every asset.
// Read-only: nothing in Cloudinary is changed.
//
//   npm run cloudinary:export -- --out=<folder> [--dry-run] [--concurrency=6]
//
// Re-running skips files already downloaded with the expected size, so an
// interrupted export can be resumed.
import { createWriteStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { v2 as cloudinary } from "cloudinary";
import { fail, parseArgs } from "./db-cli.ts";

type Resource = {
  public_id: string;
  format: string;
  resource_type: string;
  type: string;
  bytes: number;
  width: number;
  height: number;
  created_at: string;
  asset_folder?: string;
  secure_url: string;
};

const DELIVERY_TYPES = ["upload", "private", "authenticated"] as const;

async function listAll(type: string): Promise<Resource[]> {
  const all: Resource[] = [];
  let cursor: string | undefined;
  do {
    const page = await cloudinary.api.resources({ resource_type: "image", type, max_results: 500, next_cursor: cursor });
    all.push(...(page.resources as Resource[]));
    cursor = page.next_cursor;
  } while (cursor);
  return all;
}

// Local path for a public ID, refusing anything that could escape the output folder.
function localPath(outDir: string, resource: Resource): string {
  const segments = resource.public_id.split("/");
  if (segments.some((s) => s === "" || s === "." || s === ".." || /[<>:"\\|?*\x00-\x1f]/.test(s))) {
    throw new Error(`Unsafe public ID for a file path: ${resource.public_id}`);
  }
  return path.join(outDir, resource.type === "upload" ? "" : `_${resource.type}`, ...segments) + `.${resource.format}`;
}

async function alreadyDownloaded(file: string, bytes: number) {
  try {
    return (await stat(file)).size === bytes;
  } catch {
    return false;
  }
}

async function download(resource: Resource, file: string) {
  // private/authenticated originals need a signed URL; upload originals are public.
  const url =
    resource.type === "upload"
      ? resource.secure_url
      : cloudinary.utils.private_download_url(resource.public_id, resource.format, { type: resource.type, resource_type: "image" });
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.part`;
  await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(partial));
  const { rename } = await import("node:fs/promises");
  await rename(partial, file);
}

async function main() {
  const args = parseArgs();
  if (!process.env.CLOUDINARY_URL) throw new Error("CLOUDINARY_URL is not set");
  const outArg = args.get("out");
  if (typeof outArg !== "string") throw new Error("Pass --out=<folder> for the downloaded images");
  const outDir = path.resolve(outArg);
  const concurrency = Math.max(1, Number(args.get("concurrency") ?? 6));
  const cloud = cloudinary.config().cloud_name;

  const resources: Resource[] = [];
  for (const type of DELIVERY_TYPES) {
    const found = await listAll(type);
    console.log(`${cloud}: ${found.length} ${type} images`);
    resources.push(...found);
  }
  const totalBytes = resources.reduce((sum, r) => sum + r.bytes, 0);
  const folders = new Map<string, number>();
  for (const r of resources) {
    const folder = r.public_id.includes("/") ? r.public_id.slice(0, r.public_id.lastIndexOf("/")) : "(root)";
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
  }
  console.log(`total: ${resources.length} images, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  for (const [folder, count] of [...folders].sort()) console.log(`  ${folder}: ${count}`);

  if (args.has("dry-run")) return;

  await mkdir(outDir, { recursive: true });
  const queue = resources.map((resource) => ({ resource, file: localPath(outDir, resource) }));
  let done = 0;
  let skipped = 0;
  const failures: { public_id: string; error: string }[] = [];

  async function worker() {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        if (await alreadyDownloaded(item.file, item.resource.bytes)) skipped += 1;
        else await download(item.resource, item.file);
        if (!(await alreadyDownloaded(item.file, item.resource.bytes))) throw new Error("size mismatch after download");
      } catch (error) {
        failures.push({ public_id: item.resource.public_id, error: (error as Error).message });
      }
      done += 1;
      if (done % 25 === 0 || done === resources.length) console.log(`  ${done}/${resources.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const manifest = {
    exported_at: new Date().toISOString(),
    cloud_name: cloud,
    count: resources.length,
    total_bytes: totalBytes,
    failures,
    resources: resources.map((r) => ({
      public_id: r.public_id,
      file: path.relative(outDir, localPath(outDir, r)).split(path.sep).join("/"),
      type: r.type,
      format: r.format,
      bytes: r.bytes,
      width: r.width,
      height: r.height,
      asset_folder: r.asset_folder ?? null,
      created_at: r.created_at,
    })),
  };
  await writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`downloaded ${resources.length - skipped - failures.length}, already present ${skipped}, failed ${failures.length}`);
  for (const f of failures) console.log(`  FAILED ${f.public_id}: ${f.error}`);
  console.log(`manifest: ${path.join(outDir, "manifest.json")}`);
  if (failures.length) process.exitCode = 1;
}

main().catch(fail);
