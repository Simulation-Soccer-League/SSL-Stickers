// In-memory fixed-window limiter. Sufficient for the single Node server this
// app is deployed as; state resets on restart.
import type { IncomingMessage } from "node:http";

type Window = { count: number; resetAt: number };

export function createLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const windows = new Map<string, Window>();

  function current(key: string, now: number) {
    const window = windows.get(key);
    if (window && window.resetAt > now) return window;
    windows.delete(key);
    return null;
  }

  return {
    // Seconds until the key may try again, or 0 if it is under the limit.
    retryAfter(key: string, now = Date.now()): number {
      const window = current(key, now);
      return window && window.count >= limit ? Math.ceil((window.resetAt - now) / 1000) : 0;
    },
    hit(key: string, now = Date.now()) {
      const window = current(key, now);
      if (window) window.count += 1;
      else windows.set(key, { count: 1, resetAt: now + windowMs });
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
      }
    },
    reset(key: string) {
      windows.delete(key);
    },
  };
}

// Client IP. X-Forwarded-For is trusted only when TRUST_PROXY=true (set it
// when running behind a reverse proxy that overwrites the header).
export function clientIp(req: IncomingMessage): string {
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress ?? "unknown";
}
