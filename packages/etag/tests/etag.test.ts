import { describe, expect, test } from "bun:test";
import { etag, ifNoneMatch, notModified } from "../src/index.ts";

describe("etag()", () => {
  test("returns a weak tag by default", () => {
    expect(etag("hello").startsWith('W/"')).toBe(true);
    expect(etag("hello").endsWith('"')).toBe(true);
  });

  test("strong tag when weak=false", () => {
    expect(etag("hello", { weak: false }).startsWith('"')).toBe(true);
    expect(etag("hello", { weak: false }).startsWith("W/")).toBe(false);
  });

  test("deterministic for identical input", () => {
    expect(etag("hello")).toBe(etag("hello"));
    expect(etag(new TextEncoder().encode("hello"))).toBe(etag("hello"));
  });

  test("changes with input", () => {
    expect(etag("hello")).not.toBe(etag("world"));
  });
});

describe("ifNoneMatch()", () => {
  test("returns true on exact match", () => {
    const tag = etag("body");
    const req = new Request("http://x/", { headers: { "if-none-match": tag } });
    expect(ifNoneMatch(req, tag)).toBe(true);
  });

  test("returns true for wildcard", () => {
    const tag = etag("body");
    const req = new Request("http://x/", { headers: { "if-none-match": "*" } });
    expect(ifNoneMatch(req, tag)).toBe(true);
  });

  test("returns true within a list", () => {
    const tag = etag("body");
    const req = new Request("http://x/", { headers: { "if-none-match": `"other", ${tag}` } });
    expect(ifNoneMatch(req, tag)).toBe(true);
  });

  test("returns false when missing", () => {
    expect(ifNoneMatch(new Request("http://x/"), etag("body"))).toBe(false);
  });

  test("ignores weak-prefix difference when matching", () => {
    const weak = etag("body");
    const strong = weak.replace(/^W\//, "");
    const req = new Request("http://x/", { headers: { "if-none-match": strong } });
    expect(ifNoneMatch(req, weak)).toBe(true);
  });
});

describe("notModified()", () => {
  test("returns a 304 response with optional etag header", () => {
    const res = notModified('W/"abc"');
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe('W/"abc"');
  });
});
