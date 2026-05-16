import { expect, test, describe } from "bun:test";
import {
  BodyParseError,
  formFile,
  formValue,
  formValues,
  queryParam,
  queryParams,
  readForm,
  readJson,
  readText,
  searchParams,
} from "../src/index.ts";

function makeRequest(body: BodyInit | null, init: RequestInit = {}): Request {
  return new Request("http://localhost/test", { method: "POST", body, ...init });
}

describe("readJson()", () => {
  test("parses valid JSON", async () => {
    const req = makeRequest(JSON.stringify({ a: 1 }), {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(await readJson(req)).toEqual({ a: 1 });
  });

  test("accepts application/vnd.api+json", async () => {
    const req = makeRequest(JSON.stringify({ a: 1 }), {
      method: "POST",
      headers: { "content-type": "application/vnd.api+json" },
    });
    expect(await readJson(req)).toEqual({ a: 1 });
  });

  test("throws BodyParseError on invalid JSON", async () => {
    const req = makeRequest("not json", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    await expect(readJson(req)).rejects.toBeInstanceOf(BodyParseError);
  });

  test("throws on empty body", async () => {
    const req = makeRequest("", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    await expect(readJson(req)).rejects.toBeInstanceOf(BodyParseError);
  });

  test("throws 415 on wrong content-type", async () => {
    const req = makeRequest("{}", {
      method: "POST",
      headers: { "content-type": "text/plain" },
    });
    try {
      await readJson(req);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BodyParseError);
      expect((err as BodyParseError).status).toBe(415);
    }
  });
});

describe("readForm()", () => {
  test("reads urlencoded form data", async () => {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=elizabeth&color=purple",
    });
    const form = await readForm(req);
    expect(form.get("name")).toBe("elizabeth");
    expect(form.get("color")).toBe("purple");
  });
});

describe("readText()", () => {
  test("returns raw body", async () => {
    const req = makeRequest("plain body");
    expect(await readText(req)).toBe("plain body");
  });
});

describe("formValue / formValues / formFile", () => {
  test("returns string value or null", () => {
    const form = new FormData();
    form.append("name", "liz");
    form.append("tag", "a");
    form.append("tag", "b");
    expect(formValue(form, "name")).toBe("liz");
    expect(formValue(form, "missing")).toBeNull();
    expect(formValues(form, "tag")).toEqual(["a", "b"]);
  });

  test("formFile returns File or null", () => {
    const form = new FormData();
    const file = new File(["data"], "a.txt", { type: "text/plain" });
    form.append("upload", file);
    form.append("name", "liz");
    expect(formFile(form, "upload")).toBeInstanceOf(File);
    expect(formFile(form, "name")).toBeNull();
    expect(formFile(form, "missing")).toBeNull();
  });
});

describe("searchParams / queryParam / queryParams", () => {
  test("works with Request, URL, and string", () => {
    const url = "http://localhost/foo?a=1&a=2&b=x";
    expect(queryParam(url, "a")).toBe("1");
    expect(queryParams(url, "a")).toEqual(["1", "2"]);
    expect(queryParam(new URL(url), "b")).toBe("x");
    expect(queryParam(new Request(url), "b")).toBe("x");
    expect(searchParams(url).get("b")).toBe("x");
  });
});
