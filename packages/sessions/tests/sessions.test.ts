import { expect, test, describe } from "bun:test";
import { createSessionStore } from "../src/index.ts";

const SECRET = "test-secret-at-least-16-chars";

describe("createSessionStore()", () => {
  test("rejects short secrets", () => {
    expect(() => createSessionStore({ secret: "short" })).toThrow(TypeError);
  });

  test("round-trips data via serialize/parse", () => {
    const store = createSessionStore<{ userId: number }>({ secret: SECRET });
    const signed = store.serialize({ userId: 42 });
    expect(store.parse(signed)).toEqual({ userId: 42 });
  });

  test("write attaches a Set-Cookie header", () => {
    const store = createSessionStore<{ id: string }>({ secret: SECRET });
    const res = new Response();
    store.write(res, { id: "abc" });
    const cookies = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
    const joined = cookies.join("\n");
    expect(joined).toContain("session=");
    expect(joined).toContain("HttpOnly");
    expect(joined).toContain("SameSite=Lax");
    expect(joined).toContain("Path=/");
  });

  test("read parses the cookie back to the data", () => {
    const store = createSessionStore<{ id: string }>({ secret: SECRET });
    const res = new Response();
    store.write(res, { id: "abc" });
    const setCookie = (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""])[0];
    const cookieValue = setCookie.split(";")[0];
    const request = new Request("http://localhost/", {
      headers: { cookie: cookieValue },
    });
    expect(store.read(request)).toEqual({ id: "abc" });
  });

  test("read returns null when cookie is missing or tampered", () => {
    const store = createSessionStore<{ id: string }>({ secret: SECRET });
    expect(store.read(new Request("http://localhost/"))).toBeNull();

    const tampered = new Request("http://localhost/", {
      headers: { cookie: "session=bad.sig" },
    });
    expect(store.read(tampered)).toBeNull();
  });

  test("destroy emits an expiring cookie", () => {
    const store = createSessionStore({ secret: SECRET });
    const res = new Response();
    store.destroy(res);
    const cookies = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
    const joined = cookies.join("\n");
    expect(joined).toContain("Max-Age=0");
    expect(joined).toContain("Expires=Thu, 01 Jan 1970");
  });

  test("custom cookie name and options are respected", () => {
    const store = createSessionStore({
      secret: SECRET,
      cookieName: "sid",
      cookieOptions: { sameSite: "Strict", secure: true, path: "/app" },
    });
    const res = new Response();
    store.write(res, { x: 1 });
    const setCookie = (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""])[0];
    expect(setCookie.startsWith("sid=")).toBe(true);
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Path=/app");
  });
});
