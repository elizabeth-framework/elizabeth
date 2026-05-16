import { expect, test, describe } from "bun:test";
import {
  hashPassword,
  hmac,
  randomToken,
  signValue,
  timingSafeEqual,
  unsignValue,
  verifyPassword,
} from "../src/index.ts";

describe("hashPassword / verifyPassword", () => {
  test("hash produces a scrypt-formatted string", async () => {
    const hash = await hashPassword("hunter2", { N: 1024, r: 8, p: 1, keyLength: 32 });
    expect(hash.startsWith("scrypt$1024$8$1$")).toBe(true);
    expect(hash.split("$")).toHaveLength(6);
  });

  test("verify accepts correct password", async () => {
    const hash = await hashPassword("hunter2", { N: 1024, r: 8, p: 1, keyLength: 32 });
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });

  test("verify rejects wrong password", async () => {
    const hash = await hashPassword("hunter2", { N: 1024, r: 8, p: 1, keyLength: 32 });
    expect(await verifyPassword("nope", hash)).toBe(false);
  });

  test("verify rejects malformed hash", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "scrypt$badly$formed")).toBe(false);
  });

  test("hashPassword rejects empty password", async () => {
    await expect(hashPassword("")).rejects.toBeInstanceOf(TypeError);
  });

  test("two hashes of the same password differ (salt)", async () => {
    const a = await hashPassword("hunter2", { N: 1024, r: 8, p: 1, keyLength: 32 });
    const b = await hashPassword("hunter2", { N: 1024, r: 8, p: 1, keyLength: 32 });
    expect(a).not.toBe(b);
    expect(await verifyPassword("hunter2", a)).toBe(true);
    expect(await verifyPassword("hunter2", b)).toBe(true);
  });
});

describe("randomToken()", () => {
  test("returns a base64url string of expected size", () => {
    const tok = randomToken(16);
    expect(tok).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tok.length).toBeGreaterThanOrEqual(20);
  });

  test("rejects invalid byte counts", () => {
    expect(() => randomToken(0)).toThrow(RangeError);
    expect(() => randomToken(-1)).toThrow(RangeError);
    expect(() => randomToken(1.5)).toThrow(RangeError);
  });

  test("two consecutive tokens differ", () => {
    expect(randomToken(16)).not.toBe(randomToken(16));
  });
});

describe("signValue / unsignValue", () => {
  test("round-trips", () => {
    const signed = signValue("hello", "secret-key");
    expect(unsignValue(signed, "secret-key")).toBe("hello");
  });

  test("rejects tampered value", () => {
    const signed = signValue("hello", "secret-key");
    const tampered = `world${signed.slice(signed.lastIndexOf("."))}`;
    expect(unsignValue(tampered, "secret-key")).toBeNull();
  });

  test("rejects wrong secret", () => {
    const signed = signValue("hello", "secret-key");
    expect(unsignValue(signed, "other")).toBeNull();
  });

  test("rejects malformed input", () => {
    expect(unsignValue("no-dot", "secret")).toBeNull();
    expect(unsignValue(".sig", "secret")).toBeNull();
    expect(unsignValue("value.", "secret")).toBeNull();
    expect(unsignValue("", "secret")).toBeNull();
  });

  test("signValue rejects empty secret", () => {
    expect(() => signValue("v", "")).toThrow(TypeError);
  });
});

describe("timingSafeEqual()", () => {
  test("returns true for equal strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
  });

  test("returns false for different strings or lengths", () => {
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "x")).toBe(false);
  });
});

describe("hmac()", () => {
  test("is deterministic", () => {
    expect(hmac("value", "secret")).toBe(hmac("value", "secret"));
  });

  test("changes with input or secret", () => {
    expect(hmac("v", "s")).not.toBe(hmac("v", "s2"));
    expect(hmac("v", "s")).not.toBe(hmac("v2", "s"));
  });
});
