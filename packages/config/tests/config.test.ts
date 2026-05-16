import { describe, expect, test } from "bun:test";
import { defineApiRoute, defineConfig } from "../src/index.ts";

describe("defineConfig()", () => {
  test("returns the config object unchanged", () => {
    const config = defineConfig({
      pageRoutes: { "src/pages": "/" },
      apiRoutes: ["src/api"],
    });

    expect(config).toEqual({
      pageRoutes: { "src/pages": "/" },
      apiRoutes: ["src/api"],
    });
  });
});

describe("defineApiRoute()", () => {
  test("returns handlers object unchanged", async () => {
    const route = defineApiRoute({
      GET: (ctx) => new Response(ctx.url.pathname),
      POST: async () => new Response("posted", { status: 201 }),
    });

    const ctx = {
      request: new Request("http://localhost/api/x"),
      params: {},
      locals: {},
      get url() {
        return new URL("http://localhost/api/x");
      },
    };

    const getRes = await route.GET!(ctx);
    expect(getRes).toBeInstanceOf(Response);
    if (getRes instanceof Response) {
      expect(await getRes.text()).toBe("/api/x");
    }

    const postRes = await route.POST!(ctx);
    expect(postRes).toBeInstanceOf(Response);
    if (postRes instanceof Response) {
      expect(postRes.status).toBe(201);
    }
  });
});
