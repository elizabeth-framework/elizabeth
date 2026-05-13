const port = Number(Bun.env.PORT ?? 3811);

const html = "<!doctype html><main>Hello, Elizabeth</main>";
const userHtml = "<!doctype html><main>User profile</main>";
const json = JSON.stringify({
  hello: "world",
  framework: "native-bun",
});

Bun.serve({
  port,
  fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === "/") {
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    if (/^\/users\/[^/]+$/.test(pathname)) {
      return new Response(userHtml, {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    if (pathname === "/plain") {
      return new Response("Hello, Elizabeth", {
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    if (pathname === "/json") {
      return new Response(json, {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`native-bun listening on http://127.0.0.1:${port}`);
