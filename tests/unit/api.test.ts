import { test } from "node:test";
import assert from "node:assert/strict";
import type { NextApiRequest } from "next";
import { isSameOrigin } from "../../src/server/api.ts";
import { createLimiter } from "../../src/server/rateLimit.ts";

const req = (headers: Record<string, string>) => ({ headers }) as unknown as NextApiRequest;

test("same-origin check accepts matching Origin or Referer hosts", () => {
  delete process.env.APP_ORIGIN;
  assert.equal(isSameOrigin(req({ host: "stickers.example", origin: "https://stickers.example" })), true);
  assert.equal(isSameOrigin(req({ host: "localhost:3000", referer: "http://localhost:3000/Trading" })), true);
  assert.equal(isSameOrigin(req({ host: "internal:3000", "x-forwarded-host": "stickers.example", origin: "https://stickers.example" })), true);
});

test("same-origin check rejects other sites, missing headers, and junk", () => {
  delete process.env.APP_ORIGIN;
  assert.equal(isSameOrigin(req({ host: "stickers.example", origin: "https://evil.example" })), false);
  assert.equal(isSameOrigin(req({ host: "stickers.example" })), false);
  assert.equal(isSameOrigin(req({ host: "stickers.example", origin: "null" })), false);
});

test("APP_ORIGIN overrides the Host header", () => {
  process.env.APP_ORIGIN = "https://stickers.example";
  try {
    assert.equal(isSameOrigin(req({ host: "127.0.0.1:3000", origin: "https://stickers.example" })), true);
    assert.equal(isSameOrigin(req({ host: "stickers.example", origin: "http://127.0.0.1:3000" })), false);
  } finally {
    delete process.env.APP_ORIGIN;
  }
});

test("rate limiter blocks after the limit until the window passes", () => {
  const limiter = createLimiter({ limit: 2, windowMs: 1000 });
  limiter.hit("k", 0);
  assert.equal(limiter.retryAfter("k", 10), 0);
  limiter.hit("k", 20);
  assert.equal(limiter.retryAfter("k", 30), 1);
  assert.equal(limiter.retryAfter("k", 1001), 0);
  limiter.hit("k", 1001);
  limiter.reset("k");
  assert.equal(limiter.retryAfter("k", 1002), 0);
});
