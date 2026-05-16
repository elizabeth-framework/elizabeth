import { describe, expect, test } from "bun:test";
import { sleep } from "@elizabeth-js/async";
import { createMemoryStore, rateLimit } from "../src/index.ts";

describe("createMemoryStore()", () => {
  test("hits increment until window expires", async () => {
    const store = createMemoryStore();
    const a = await store.hit("k", 1000);
    const b = await store.hit("k", 1000);
    expect(a.count).toBe(1);
    expect(b.count).toBe(2);
    expect(a.resetAt).toBe(b.resetAt);
  });

  test("expired window resets count", async () => {
    const store = createMemoryStore();
    await store.hit("k", 10);
    await sleep(20);
    const next = await store.hit("k", 10);
    expect(next.count).toBe(1);
  });

  test("reset clears the bucket", async () => {
    const store = createMemoryStore();
    await store.hit("k", 1000);
    await store.reset("k");
    const next = await store.hit("k", 1000);
    expect(next.count).toBe(1);
  });
});

describe("rateLimit()", () => {
  test("rejects invalid options", () => {
    expect(() => rateLimit({ max: 0, windowMs: 1000 })).toThrow(RangeError);
    expect(() => rateLimit({ max: 1.5, windowMs: 1000 })).toThrow(RangeError);
    expect(() => rateLimit({ max: 1, windowMs: 0 })).toThrow(RangeError);
  });

  test("returns ok=true under the limit and ok=false above", async () => {
    const limiter = rateLimit({ max: 2, windowMs: 1000 });
    const first = await limiter.check("ip:1");
    const second = await limiter.check("ip:1");
    const third = await limiter.check("ip:1");
    expect(first.ok).toBe(true);
    expect(first.remaining).toBe(1);
    expect(second.ok).toBe(true);
    expect(second.remaining).toBe(0);
    expect(third.ok).toBe(false);
    expect(third.remaining).toBe(0);
    expect(third.retryAfter).toBeGreaterThanOrEqual(0);
  });

  test("isolates different keys", async () => {
    const limiter = rateLimit({ max: 1, windowMs: 1000 });
    expect((await limiter.check("a")).ok).toBe(true);
    expect((await limiter.check("a")).ok).toBe(false);
    expect((await limiter.check("b")).ok).toBe(true);
  });

  test("applyHeaders sets rate-limit + retry-after on failure", async () => {
    const limiter = rateLimit({ max: 1, windowMs: 1000 });
    const ok = await limiter.check("h");
    const okRes = limiter.applyHeaders(new Response(), ok);
    expect(okRes.headers.get("x-ratelimit-limit")).toBe("1");
    expect(okRes.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(okRes.headers.get("retry-after")).toBeNull();

    const blocked = await limiter.check("h");
    const blockedRes = limiter.applyHeaders(new Response(), blocked);
    expect(blockedRes.headers.get("retry-after")).not.toBeNull();
  });

  test("reset clears state for a key", async () => {
    const limiter = rateLimit({ max: 1, windowMs: 1000 });
    await limiter.check("r");
    expect((await limiter.check("r")).ok).toBe(false);
    await limiter.reset("r");
    expect((await limiter.check("r")).ok).toBe(true);
  });
});
