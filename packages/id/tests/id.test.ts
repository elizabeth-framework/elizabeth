import { describe, expect, test } from "bun:test";
import { generateId, parseIdTime, randomId } from "../src/index.ts";

describe("generateId()", () => {
  test("returns a 26-char Crockford base32 string", () => {
    const id = generateId();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
  });

  test("ids are sortable by creation time", async () => {
    const a = generateId(1_700_000_000_000);
    const b = generateId(1_700_000_001_000);
    expect(a < b).toBe(true);
  });

  test("ids generated at the same ms differ via randomness", () => {
    const ts = 1_700_000_000_000;
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(generateId(ts));
    }
    expect(seen.size).toBeGreaterThan(90);
  });

  test("rejects out-of-range timestamps", () => {
    expect(() => generateId(-1)).toThrow(RangeError);
    expect(() => generateId(2 ** 48)).toThrow(RangeError);
    expect(() => generateId(1.5)).toThrow(RangeError);
  });
});

describe("parseIdTime()", () => {
  test("decodes the timestamp prefix back to a Date", () => {
    const now = 1_700_000_000_000;
    const id = generateId(now);
    expect(parseIdTime(id).getTime()).toBe(now);
  });

  test("rejects malformed inputs", () => {
    expect(() => parseIdTime("short")).toThrow(TypeError);
    expect(() => parseIdTime("123456789!" + "0".repeat(16))).toThrow(TypeError);
  });
});

describe("randomId()", () => {
  test("returns a UUID v4", () => {
    expect(randomId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
