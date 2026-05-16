import { describe, expect, test } from "bun:test";
import { retry, sleep, TimeoutError, withTimeout } from "../src/index.ts";

describe("sleep()", () => {
  test("resolves after at least the given duration", async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  test("rejects negative or non-finite durations", () => {
    expect(() => sleep(-1)).toThrow(RangeError);
    expect(() => sleep(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("withTimeout()", () => {
  test("resolves when the promise resolves in time", async () => {
    const value = await withTimeout(Promise.resolve(42), 100);
    expect(value).toBe(42);
  });

  test("rejects with TimeoutError after the deadline", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 200));
    await expect(withTimeout(slow, 20)).rejects.toBeInstanceOf(TimeoutError);
  });

  test("propagates the underlying rejection", async () => {
    const failing = Promise.reject(new Error("boom"));
    await expect(withTimeout(failing, 100)).rejects.toThrow("boom");
  });
});

describe("retry()", () => {
  test("returns on first success", async () => {
    let calls = 0;
    const value = await retry(async () => {
      calls++;
      return "ok";
    });
    expect(value).toBe("ok");
    expect(calls).toBe(1);
  });

  test("retries on failure up to the limit", async () => {
    let calls = 0;
    const value = await retry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("nope");
        return "done";
      },
      { attempts: 4, delayMs: 1, backoff: 1 },
    );
    expect(value).toBe("done");
    expect(calls).toBe(3);
  });

  test("throws the last error when all attempts fail", async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls++;
          throw new Error(`fail-${calls}`);
        },
        { attempts: 3, delayMs: 1, backoff: 1 },
      ),
    ).rejects.toThrow("fail-3");
    expect(calls).toBe(3);
  });

  test("rejects invalid attempts", async () => {
    await expect(retry(async () => 1, { attempts: 0 })).rejects.toBeInstanceOf(RangeError);
  });
});
