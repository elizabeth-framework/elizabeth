import { expect, test, describe } from "bun:test";
import {
  SchemaValidationError,
  safeValidate,
  validate,
  validateBody,
  validateSearchParams,
  type StandardSchemaV1,
} from "../src/index.ts";

const numberSchema: StandardSchemaV1<unknown, number> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate(value) {
      if (typeof value === "number") {
        return { value };
      }
      return { issues: [{ message: "Expected a number", path: [] }] };
    },
  },
};

const userSchema: StandardSchemaV1<unknown, { name: string; age: number }> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate(value) {
      if (
        value !== null &&
        typeof value === "object" &&
        "name" in value &&
        typeof (value as { name: unknown }).name === "string" &&
        "age" in value &&
        typeof (value as { age: unknown }).age === "number"
      ) {
        return { value: value as { name: string; age: number } };
      }
      return {
        issues: [
          { message: "name must be a string", path: ["name"] },
          { message: "age must be a number", path: ["age"] },
        ],
      };
    },
  },
};

describe("validate()", () => {
  test("returns parsed value on success", async () => {
    expect(await validate(numberSchema, 42)).toBe(42);
  });

  test("throws SchemaValidationError on failure", async () => {
    try {
      await validate(numberSchema, "nope");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      expect((error as SchemaValidationError).issues).toHaveLength(1);
      expect((error as SchemaValidationError).status).toBe(422);
    }
  });
});

describe("safeValidate()", () => {
  test("returns success", async () => {
    const result = await safeValidate(numberSchema, 1);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(1);
  });

  test("returns failure object", async () => {
    const result = await safeValidate(numberSchema, "x");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.length).toBeGreaterThan(0);
  });
});

describe("validateBody()", () => {
  test("parses JSON body and validates", async () => {
    const req = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "liz", age: 12 }),
    });
    expect(await validateBody(req, userSchema)).toEqual({ name: "liz", age: 12 });
  });

  test("throws SchemaValidationError on bad body", async () => {
    const req = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 1, age: "x" }),
    });
    await expect(validateBody(req, userSchema)).rejects.toBeInstanceOf(SchemaValidationError);
  });
});

describe("validateSearchParams()", () => {
  test("converts search params to an object and validates", async () => {
    const schema: StandardSchemaV1<unknown, { q: string }> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate(value) {
          if (value && typeof value === "object" && typeof (value as { q: unknown }).q === "string") {
            return { value: value as { q: string } };
          }
          return { issues: [{ message: "q required", path: ["q"] }] };
        },
      },
    };
    expect(await validateSearchParams("http://x/?q=hi", schema)).toEqual({ q: "hi" });
    await expect(validateSearchParams("http://x/", schema)).rejects.toBeInstanceOf(SchemaValidationError);
  });
});
