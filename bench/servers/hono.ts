import { Hono } from "hono";

const port = Number(Bun.env.PORT ?? 3811);
const app = new Hono();

app.get("/", (c) => c.html("<!doctype html><main>Hello, Elizabeth</main>"));
app.get("/users/:id", (c) => c.html("<!doctype html><main>User profile</main>"));
app.get("/plain", (c) => c.text("Hello, Elizabeth"));
app.get("/json", (c) =>
  c.json({
    hello: "world",
    framework: "hono",
  }),
);

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`hono listening on http://127.0.0.1:${port}`);
