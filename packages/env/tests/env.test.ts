import { afterEach, describe, expect, test } from "bun:test";
import { env, envFlag, envInt, isDev, isProduction, isTest, requireEnv } from "../src/index.ts";

const keys = ["ELIZA_T_KEY", "ELIZA_T_FLAG", "ELIZA_T_INT", "NODE_ENV"];
const snapshots: Record<string, string | undefined> = {};

for (const key of keys) {
  snapshots[key] = process.env[key];
}

afterEach(() => {
  for (const key of keys) {
    if (snapshots[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshots[key];
    }
  }
});

describe("env()", () => {
  test("returns the value or fallback", () => {
    process.env.ELIZA_T_KEY = "value";
    expect(env("ELIZA_T_KEY")).toBe("value");
    delete process.env.ELIZA_T_KEY;
    expect(env("ELIZA_T_KEY")).toBeUndefined();
    expect(env("ELIZA_T_KEY", "default")).toBe("default");
  });

  test("treats empty string as missing", () => {
    process.env.ELIZA_T_KEY = "";
    expect(env("ELIZA_T_KEY", "default")).toBe("default");
  });
});

describe("requireEnv()", () => {
  test("returns value when set", () => {
    process.env.ELIZA_T_KEY = "abc";
    expect(requireEnv("ELIZA_T_KEY")).toBe("abc");
  });

  test("throws when missing", () => {
    delete process.env.ELIZA_T_KEY;
    expect(() => requireEnv("ELIZA_T_KEY")).toThrow(/ELIZA_T_KEY/);
  });
});

describe("envFlag()", () => {
  test("recognises truthy strings", () => {
    for (const v of ["1", "true", "yes", "on", "TRUE", "Yes"]) {
      process.env.ELIZA_T_FLAG = v;
      expect(envFlag("ELIZA_T_FLAG")).toBe(true);
    }
  });

  test("recognises falsy strings", () => {
    for (const v of ["0", "false", "no", "off"]) {
      process.env.ELIZA_T_FLAG = v;
      expect(envFlag("ELIZA_T_FLAG", true)).toBe(false);
    }
  });

  test("uses fallback when unset", () => {
    delete process.env.ELIZA_T_FLAG;
    expect(envFlag("ELIZA_T_FLAG", true)).toBe(true);
    expect(envFlag("ELIZA_T_FLAG", false)).toBe(false);
  });
});

describe("envInt()", () => {
  test("parses integers", () => {
    process.env.ELIZA_T_INT = "42";
    expect(envInt("ELIZA_T_INT")).toBe(42);
  });

  test("returns fallback on non-integer", () => {
    process.env.ELIZA_T_INT = "1.5";
    expect(envInt("ELIZA_T_INT", 10)).toBe(10);
    process.env.ELIZA_T_INT = "nope";
    expect(envInt("ELIZA_T_INT", 10)).toBe(10);
  });
});

describe("isDev / isProduction / isTest", () => {
  test("respects NODE_ENV", () => {
    process.env.NODE_ENV = "production";
    expect(isProduction()).toBe(true);
    expect(isDev()).toBe(false);
    expect(isTest()).toBe(false);

    process.env.NODE_ENV = "test";
    expect(isTest()).toBe(true);
    expect(isProduction()).toBe(false);
    expect(isDev()).toBe(true);

    process.env.NODE_ENV = "development";
    expect(isDev()).toBe(true);
  });
});
