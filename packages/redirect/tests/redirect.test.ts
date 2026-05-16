import { expect, test, describe } from "bun:test";
import {
  isNotFoundResult,
  isRedirectResult,
  notFound,
  permanentRedirect,
  redirect,
  redirectBack,
  seeOther,
  temporaryRedirect,
} from "../src/index.ts";

describe("redirect helpers", () => {
  test("redirect() returns 302 by default", () => {
    const result = redirect("/login");
    expect(result.location).toBe("/login");
    expect(result.status).toBe(302);
    expect(isRedirectResult(result)).toBe(true);
  });

  test("status variants", () => {
    expect(permanentRedirect("/a").status).toBe(308);
    expect(temporaryRedirect("/a").status).toBe(307);
    expect(seeOther("/a").status).toBe(303);
  });

  test("redirectBack uses Referer or fallback", () => {
    const withReferer = new Request("http://localhost/x", {
      headers: { referer: "http://localhost/back" },
    });
    expect(redirectBack(withReferer, "/fallback").location).toBe("http://localhost/back");

    const noReferer = new Request("http://localhost/x");
    expect(redirectBack(noReferer, "/fallback").location).toBe("/fallback");
  });

  test("notFound result and guard", () => {
    const result = notFound();
    expect(isNotFoundResult(result)).toBe(true);
    expect(isRedirectResult(result)).toBe(false);
  });

  test("isRedirectResult is symbol-compatible with the core package's redirect()", async () => {
    const { redirect: coreRedirect } = await import("../../../src/route.ts");
    expect(isRedirectResult(coreRedirect("/x"))).toBe(true);
  });

  test("isNotFoundResult is symbol-compatible with the core package's notFound()", async () => {
    const { notFound: coreNotFound } = await import("../../../src/route.ts");
    expect(isNotFoundResult(coreNotFound())).toBe(true);
  });
});
