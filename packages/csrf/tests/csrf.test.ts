import { expect, test, describe } from "bun:test";
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
    const tampered = token.replace(/.$/, (ch) => (ch === "A" ? "B" : "A"));
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
