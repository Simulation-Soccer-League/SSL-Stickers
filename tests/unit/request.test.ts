import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, apiRequest } from "../../src/lib/request.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(status: number, body: string, calls: RequestInit[] = []) {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls.push(init);
    return new Response(body || null, { status });
  }) as typeof fetch;
  return calls;
}

test("resolves parsed JSON and sends cookies", async () => {
  const calls = stubFetch(200, '{"status":"normal"}');
  assert.deepEqual(await apiRequest("/api/v1/me"), { status: "normal" });
  assert.equal(calls[0].credentials, "include");
  assert.equal(calls[0].method, "GET");
});

test("JSON and form bodies", async () => {
  const calls = stubFetch(200, "[]");
  await apiRequest("/x", { method: "POST", json: { a: 1 } });
  assert.equal(calls[0].body, '{"a":1}');
  assert.deepEqual(calls[0].headers, { "Content-Type": "application/json" });

  const form = new FormData();
  form.append("visual", "true");
  await apiRequest("/x", { method: "POST", form });
  assert.equal(calls[1].body, form);
  assert.equal(calls[1].headers, undefined, "the browser sets the multipart boundary");
});

test("empty successful responses resolve null", async () => {
  stubFetch(204, "");
  assert.equal(await apiRequest("/api/v1/logout", { method: "POST" }), null);
});

test("errors carry the status, the server message, and card ids", async () => {
  stubFetch(422, '{"error":"One or more selected cards no longer exist","card_ids":["a","b"]}');
  await assert.rejects(apiRequest("/api/v1/trades", { method: "POST", json: {} }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 422);
    assert.equal(error.message, "One or more selected cards no longer exist");
    assert.deepEqual(error.cardIds, ["a", "b"]);
    return true;
  });
});

test("errors without a JSON message fall back to the status", async () => {
  stubFetch(500, "<html>oops</html>");
  await assert.rejects(apiRequest("/x"), { message: "Request failed (500)", cardIds: [] });
});

test("network failures become a readable ApiError", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  await assert.rejects(apiRequest("/x"), (error: unknown) => error instanceof ApiError && error.status === 0);
});
