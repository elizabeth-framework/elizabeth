import { Elysia } from "elysia";

const port = Number(Bun.env.PORT ?? 3811);

new Elysia()
  .get("/", () => new Response("<!doctype html><main>Hello, Elizabeth</main>", {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  }))
  .get("/users/:id", () => new Response("<!doctype html><main>User profile</main>", {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  }))
  .get("/plain", () => new Response("Hello, Elizabeth", {
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  }))
  .get("/json", () => ({
    hello: "world",
    framework: "elysia",
  }))
  .listen(port);

console.log(`elysia listening on http://127.0.0.1:${port}`);
