import { describe, expect, test } from "bun:test";
import { formatDuration, formatRelative, parseDuration } from "../src/index.ts";

describe("parseDuration()", () => {
  test("number input returns rounded integer", () => {
    expect(parseDuration(1500)).toBe(1500);
    expect(parseDuration(1.4)).toBe(1);
  });

  test("rejects non-finite numbers", () => {
    expect(() => parseDuration(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => parseDuration(Number.NaN)).toThrow(TypeError);
  });

  test("parses known units", () => {
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("2s")).toBe(2_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("1h")).toBe(3_600_000);
    expect(parseDuration("2d")).toBe(172_800_000);
    expect(parseDuration("1w")).toBe(604_800_000);
  });

  test("accepts long aliases", () => {
    expect(parseDuration("3 sec")).toBe(3_000);
    expect(parseDuration("10 min")).toBe(600_000);
    expect(parseDuration("4 hr")).toBe(14_400_000);
    expect(parseDuration("1 day")).toBe(86_400_000);
  });

  test("sums multi-component durations", () => {
    expect(parseDuration("1h 30m")).toBe(5_400_000);
    expect(parseDuration("1d 12h")).toBe(129_600_000);
  });

  test("rejects unknown units and empty strings", () => {
    expect(() => parseDuration("5x")).toThrow(TypeError);
    expect(() => parseDuration("")).toThrow(TypeError);
    expect(() => parseDuration("   ")).toThrow(TypeError);
  });
});

describe("formatDuration()", () => {
  test("formats across units", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(1_500)).toBe("1.5s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(120_000)).toBe("2m");
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(86_400_000)).toBe("1d");
    expect(formatDuration(604_800_000)).toBe("1w");
  });

  test("preserves sign", () => {
    expect(formatDuration(-500)).toBe("-500ms");
    expect(formatDuration(-3_600_000)).toBe("-1h");
  });

  test("handles infinity", () => {
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("∞");
  });
});

describe("formatRelative()", () => {
  test("just now for <1s", () => {
    const now = new Date("2025-01-01T00:00:00Z");
    expect(formatRelative(new Date("2025-01-01T00:00:00.500Z"), now)).toBe("just now");
  });

  test("past durations", () => {
    const now = new Date("2025-01-01T00:00:00Z");
    expect(formatRelative(new Date("2024-12-31T23:59:00Z"), now)).toMatch(/minute/);
    expect(formatRelative(new Date("2024-12-31T22:00:00Z"), now)).toMatch(/hour/);
    expect(formatRelative(new Date("2024-12-25T00:00:00Z"), now)).toMatch(/week|day/);
  });

  test("future durations", () => {
    const now = new Date("2025-01-01T00:00:00Z");
    expect(formatRelative(new Date("2025-01-01T00:05:00Z"), now)).toMatch(/minute/);
  });
});
