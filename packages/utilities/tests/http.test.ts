import { expect, test, describe } from "bun:test";
import {
  badRequest,
  conflict,
  created,
  error,
  forbidden,
  html,
  internalServerError,
  json,
  methodNotAllowed,
  noContent,
  notFoundResponse,
  text,
  unauthorized,
  unprocessable,
} from "../src/http.ts";

describe("json()", () => {
  test("returns 200 with json content-type and serialized body", async () => {
    const res = json({ ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ ok: true });
  });

  test("honors custom status and merges headers without overriding caller content-type", async () => {
    const res = json({ id: 1 }, { status: 201, headers: { "x-test": "yes", "content-type": "application/vnd.api+json" } });
    expect(res.status).toBe(201);
    expect(res.headers.get("x-test")).toBe("yes");
    expect(res.headers.get("content-type")).toBe("application/vnd.api+json");
  });
});

describe("text()", () => {
  test("returns plain text", async () => {
    const res = text("hello");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("hello");
  });
});

describe("html()", () => {
  test("returns html content", async () => {
    const res = html("<h1>hi</h1>");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("<h1>hi</h1>");
  });
});

describe("noContent()", () => {
  test("returns 204 with empty body", async () => {
    const res = noContent();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });
});

describe("created()", () => {
  test("returns 201 with Location and no body when body is undefined", async () => {
    const res = created("/users/1");
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toBe("/users/1");
    expect(await res.text()).toBe("");
  });

  test("serializes object body as JSON", async () => {
    const res = created("/users/1", { id: 1 });
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ id: 1 });
  });

  test("returns string body as plain text", async () => {
    const res = created("/users/1", "ok");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("ok");
  });
});

describe("error()", () => {
  test("rejects out-of-range status", () => {
    expect(() => error(200)).toThrow(RangeError);
    expect(() => error(600)).toThrow(RangeError);
  });

  test("uses default status text when no message", async () => {
    const res = error(503);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("Service Unavailable");
  });

  test("uses provided message", async () => {
    const res = error(418, "I'm a teapot");
    expect(await res.text()).toBe("I'm a teapot");
  });
});

describe("error shortcuts", () => {
  test("badRequest is 400", () => { expect(badRequest().status).toBe(400); });
  test("unauthorized is 401", () => { expect(unauthorized().status).toBe(401); });
  test("forbidden is 403", () => { expect(forbidden().status).toBe(403); });
  test("notFoundResponse is 404", () => { expect(notFoundResponse().status).toBe(404); });
  test("conflict is 409", () => { expect(conflict().status).toBe(409); });
  test("unprocessable is 422", () => { expect(unprocessable().status).toBe(422); });
  test("internalServerError is 500", () => { expect(internalServerError().status).toBe(500); });
});

describe("methodNotAllowed()", () => {
  test("sets Allow header and 405 status", async () => {
    const res = methodNotAllowed(["get", "post"]);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, POST");
    expect(await res.text()).toBe("Method Not Allowed");
  });
});
