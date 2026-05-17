import { describe, expect, test } from "bun:test";
import { generateCsrfToken, verifyCsrfToken } from "../src/index.ts";

const SECRET = "csrf-secret-value";

describe("CSRF tokens", () => {
  test("generated tokens verify against the same secret", () => {
    const token = generateCsrfToken(SECRET);
    expect(verifyCsrfToken(token, SECRET)).toBe(true);
  });

  test("rejects tokens signed with a different secret", () => {
    const token = generateCsrfToken(SECRET);
    expect(verifyCsrfToken(token, "other-secret")).toBe(false);
  });

  test("rejects tampered tokens", () => {
    const token = generateCsrfToken(SECRET);
    // Tamper by appending an extra signature char. Replacing a trailing
    // base64url char isn't reliable: when the encoded byte length isn't a
    // multiple of 3, the final char carries padding bits and some flips
    // (e.g. "A" ↔ "B") decode to the same bytes.
    const tampered = `${token}X`;
    expect(verifyCsrfToken(tampered, SECRET)).toBe(false);
  });

  test("rejects null/empty/missing tokens", () => {
    expect(verifyCsrfToken(null, SECRET)).toBe(false);
    expect(verifyCsrfToken(undefined, SECRET)).toBe(false);
    expect(verifyCsrfToken("", SECRET)).toBe(false);
  });

  test("two generated tokens differ", () => {
    expect(generateCsrfToken(SECRET)).not.toBe(generateCsrfToken(SECRET));
  });
});
