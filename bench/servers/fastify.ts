import Fastify from "fastify";

const port = Number(Bun.env.PORT ?? 3811);

const app = Fastify({ logger: false });

app.get("/", async (_request, reply) => {
  reply.type("text/html; charset=utf-8");
  return "<!doctype html><main>Hello, Elizabeth</main>";
});

app.get("/users/:id", async (_request, reply) => {
  reply.type("text/html; charset=utf-8");
  return "<!doctype html><main>User profile</main>";
});

app.get("/plain", async (_request, reply) => {
  reply.type("text/plain; charset=utf-8");
  return "Hello, Elizabeth";
});

app.get("/json", async () => ({
  hello: "world",
  framework: "fastify",
}));

await app.listen({ port, host: "127.0.0.1" });

console.log(`fastify listening on http://127.0.0.1:${port}`);
