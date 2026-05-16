import { expect, test, describe } from "bun:test";
import { classNames, escapeHtml, isSafeHtml, safeHtml } from "../src/index.ts";

describe("classNames()", () => {
  test("joins strings", () => {
    expect(classNames("a", "b")).toBe("a b");
  });

  test("ignores falsy values", () => {
    expect(classNames("a", null, undefined, false, 0, "")).toBe("a 0");
  });

  test("expands arrays recursively", () => {
    expect(classNames("a", ["b", ["c", null, "d"]])).toBe("a b c d");
  });

  test("expands object keys with truthy values", () => {
    expect(classNames("base", { active: true, hidden: false, "is-on": 1 })).toBe("base active is-on");
  });

  test("returns empty string when nothing passes", () => {
    expect(classNames(null, undefined, false)).toBe("");
  });
});

describe("escapeHtml()", () => {
  test("escapes special characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toContain("&lt;");
    expect(escapeHtml(`<a href="x">&'</a>`)).toContain("&gt;");
    expect(escapeHtml(`<a href="x">&'</a>`)).toContain("&amp;");
    expect(escapeHtml(`<a href="x">&'</a>`)).toContain("&quot;");
  });

  test("returns empty string for null / undefined / false", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(false)).toBe("");
  });

  test("passes through safeHtml() values", () => {
    expect(escapeHtml(safeHtml("<b>raw</b>"))).toBe("<b>raw</b>");
  });
});

describe("safeHtml() / isSafeHtml()", () => {
  test("guards correctly", () => {
    const value = safeHtml("<b>x</b>");
    expect(isSafeHtml(value)).toBe(true);
    expect(value.value).toBe("<b>x</b>");
    expect(isSafeHtml("<b>x</b>")).toBe(false);
    expect(isSafeHtml(null)).toBe(false);
  });
});
