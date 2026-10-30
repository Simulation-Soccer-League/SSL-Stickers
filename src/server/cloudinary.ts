// Server-only Cloudinary access (configured from CLOUDINARY_URL, which holds
// the API secret). Errors are normalized to CloudinaryError.
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

export class CloudinaryError extends Error {
  readonly httpCode: number | null;

  constructor(message: string, httpCode: number | null = null) {
    super(message);
    this.httpCode = httpCode;
  }
}

function normalize(error: unknown): CloudinaryError {
  if (error instanceof CloudinaryError) return error;
  const e = (error ?? {}) as { message?: string; http_code?: number; error?: { message?: string; http_code?: number } };
  const inner = e.error ?? e;
  return new CloudinaryError(inner.message ?? "Cloudinary request failed", inner.http_code ?? null);
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw normalize(error);
  }
}

export function uploadImage(data: Uint8Array, folder: string): Promise<UploadApiResponse> {
  return call(
    () =>
      new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder, resource_type: "image" }, (error, result) =>
          error || !result ? reject(error ?? new CloudinaryError("Empty upload response")) : resolve(result),
        );
        stream.end(Buffer.from(data));
      }),
  );
}

export function setAssetFolder(publicId: string, assetFolder: string): Promise<Record<string, unknown>> {
  return call(() => cloudinary.api.update(publicId, { asset_folder: assetFolder }));
}

export function renameAsset(fromPublicId: string, toPublicId: string): Promise<Record<string, unknown>> {
  return call(() => cloudinary.uploader.rename(fromPublicId, toPublicId));
}

// Resolves "ok" or "not found" (both mean the asset is gone).
export async function destroyAsset(publicId: string): Promise<string> {
  const result = (await call(() => cloudinary.uploader.destroy(publicId))) as { result?: string };
  if (result.result !== "ok" && result.result !== "not found") {
    throw new CloudinaryError(`Unexpected destroy result: ${result.result}`);
  }
  return result.result;
}
