import { describe, expect, test } from "bun:test";
import { deleteCookie, getCookie, parseCookies, serializeCookie, setCookie } from "../src/index.ts";

describe("parseCookies()", () => {
  test("parses a single cookie", () => {
    expect(parseCookies("foo=bar")).toEqual({ foo: "bar" });
  });

  test("parses multiple cookies and decodes values", () => {
    expect(parseCookies("foo=bar; greeting=hi%20there")).toEqual({ foo: "bar", greeting: "hi there" });
  });

  test("handles quoted values", () => {
    expect(parseCookies('foo="bar"')).toEqual({ foo: "bar" });
  });

  test("returns first occurrence for duplicate names", () => {
    expect(parseCookies("a=1; a=2")).toEqual({ a: "1" });
  });

  test("works from Request and Headers", () => {
    const headers = new Headers({ cookie: "x=y" });
    expect(parseCookies(headers)).toEqual({ x: "y" });

    const req = new Request("http://localhost/", { headers });
    expect(parseCookies(req)).toEqual({ x: "y" });
  });

  test("getCookie returns value or null", () => {
    const req = new Request("http://localhost/", { headers: { cookie: "x=y" } });
    expect(getCookie(req, "x")).toBe("y");
    expect(getCookie(req, "z")).toBeNull();
  });
});

describe("serializeCookie()", () => {
  test("encodes value", () => {
    expect(serializeCookie("foo", "bar baz")).toBe("foo=bar%20baz");
  });

  test("supports all options", () => {
    const expires = new Date("2025-01-01T00:00:00Z");
    const serialized = serializeCookie("session", "abc", {
      domain: "example.com",
      path: "/",
      maxAge: 3600,
      expires,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      partitioned: true,
    });

    expect(serialized).toContain("session=abc");
    expect(serialized).toContain("Max-Age=3600");
    expect(serialized).toContain("Domain=example.com");
    expect(serialized).toContain("Path=/");
    expect(serialized).toContain(`Expires=${expires.toUTCString()}`);
    expect(serialized).toContain("HttpOnly");
    expect(serialized).toContain("Secure");
    expect(serialized).toContain("Partitioned");
    expect(serialized).toContain("SameSite=Lax");
  });

  test("normalizes sameSite casing", () => {
    expect(serializeCookie("a", "b", { sameSite: "strict" })).toContain("SameSite=Strict");
    expect(serializeCookie("a", "b", { sameSite: "none" })).toContain("SameSite=None");
  });

  test("rejects invalid cookie names", () => {
    expect(() => serializeCookie("bad name", "x")).toThrow(TypeError);
  });

  test("rejects non-integer maxAge", () => {
    expect(() => serializeCookie("a", "b", { maxAge: 1.5 })).toThrow(TypeError);
  });
});

describe("setCookie / deleteCookie", () => {
  test("setCookie appends Set-Cookie header", () => {
    const res = new Response();
    setCookie(res, "a", "1");
    setCookie(res, "b", "2", { path: "/" });
    const headers = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
    expect(headers.length).toBeGreaterThanOrEqual(1);
    expect(headers.join("\n")).toContain("a=1");
    expect(headers.join("\n")).toContain("b=2");
    expect(headers.join("\n")).toContain("Path=/");
  });

  test("deleteCookie sets maxAge=0 and an epoch expires", () => {
    const res = new Response();
    deleteCookie(res, "a", { path: "/" });
    const headers = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
    const joined = headers.join("\n");
    expect(joined).toContain("a=");
    expect(joined).toContain("Max-Age=0");
    expect(joined).toContain("Expires=Thu, 01 Jan 1970");
    expect(joined).toContain("Path=/");
  });
});
