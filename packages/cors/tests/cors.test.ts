import { expect, test, describe } from "bun:test";
import { cors } from "../src/index.ts";

function preflight(headers: Record<string, string> = {}): Request {
  return new Request("http://api.example.com/x", {
    method: "OPTIONS",
    headers: {
      origin: "http://app.example.com",
      "access-control-request-method": "POST",
      ...headers,
    },
  });
}

function actual(method = "GET", headers: Record<string, string> = {}): Request {
  return new Request("http://api.example.com/x", {
    method,
    headers: { origin: "http://app.example.com", ...headers },
  });
}

describe("cors() — default wildcard", () => {
  const handler = cors();

  test("preflight returns 204 with wildcard origin", () => {
    const res = handler.preflight(preflight())!;
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  test("apply adds CORS headers to actual response", () => {
    const res = handler.apply(actual(), new Response("hi"));
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("preflight returns null for non-OPTIONS requests", () => {
    expect(handler.preflight(actual())).toBeNull();
  });

  test("preflight returns null without access-control-request-method", () => {
    const req = new Request("http://api.example.com/x", {
      method: "OPTIONS",
      headers: { origin: "http://app.example.com" },
    });
    expect(handler.preflight(req)).toBeNull();
  });
});

describe("cors() — explicit allowlist", () => {
  const handler = cors({
    origin: ["http://app.example.com", "http://other.example.com"],
    credentials: true,
    allowedHeaders: ["x-custom"],
    methods: ["GET", "POST"],
    maxAge: 600,
  });

  test("echoes allowed origin and adds vary", () => {
    const res = handler.apply(actual(), new Response());
    expect(res.headers.get("access-control-allow-origin")).toBe("http://app.example.com");
    expect(res.headers.get("vary")).toContain("Origin");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  test("preflight echoes allowed headers and methods, includes max-age", () => {
    const res = handler.preflight(preflight({ "access-control-request-headers": "x-other" }))!;
    expect(res.headers.get("access-control-allow-headers")).toBe("x-custom");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST");
    expect(res.headers.get("access-control-max-age")).toBe("600");
  });

  test("rejects disallowed origin", () => {
    const req = new Request("http://api.example.com/x", {
      method: "OPTIONS",
      headers: {
        origin: "http://evil.example.com",
        "access-control-request-method": "POST",
      },
    });
    const res = handler.preflight(req)!;
    expect(res.status).toBe(403);
  });
});

describe("cors() — function origin and regex", () => {
  test("function origin can echo selectively", () => {
    const handler = cors({
      origin: (origin) => origin === "http://allowed.test",
    });
    const ok = handler.apply(
      new Request("http://x.test/", { headers: { origin: "http://allowed.test" } }),
      new Response(),
    );
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://allowed.test");

    const blocked = handler.apply(
      new Request("http://x.test/", { headers: { origin: "http://nope.test" } }),
      new Response(),
    );
    expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("regex origin matches", () => {
    const handler = cors({ origin: /\.example\.com$/ });
    const res = handler.apply(
      new Request("http://x/", { headers: { origin: "http://app.example.com" } }),
      new Response(),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("http://app.example.com");
  });
});

describe("cors() — isAllowed", () => {
  test("reflects the resolved origin policy", () => {
    const handler = cors({ origin: ["http://yes.test"] });
    expect(handler.isAllowed(new Request("http://x/", { headers: { origin: "http://yes.test" } }))).toBe(true);
    expect(handler.isAllowed(new Request("http://x/", { headers: { origin: "http://no.test" } }))).toBe(false);
  });
});
