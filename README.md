# Elizabeth

Elizabeth is a Bun-first full-stack web framework with `.liz` components, server rendering by default, file routes, API routes, scoped styles, CSS modules, client islands, and automatic same-layout navigation.

This is an early `0.0.x` release. Expect rough edges while the syntax and runtime settle.

## Create An App

```bash
bun create elizabeth app
cd app
bun run dev
```

The dev server starts on port `3712` by default.

## Component Syntax

```liz
@default
<HomePage>
  const items = [
    { text: "Fast" },
    { text: "Server first" },
    { text: "Scoped styles" },
  ];

  <style>
    .hero {
      padding: 32px;
      border: 1px solid rgba(0, 0, 0, .12);
      border-radius: 8px;
    }
  </style>

  <main className="hero">
    <h1>Elizabeth</h1>
    <ul>
      {for (const item of items) {
        <li>{item.text}</li>
      }}
    </ul>
  </main>
</HomePage>
```

`{...}` inside markup is JavaScript. To render text that looks like template syntax, use a string expression:

```liz
<code>{"#if"}</code>
```

## Routes

Pages live in `src/pages` by default:

```text
src/pages/index.liz       -> /
src/pages/about.liz       -> /about
src/pages/users/[id].liz  -> /users/:id
src/pages/404.liz         -> custom 404
```

API routes live in `src/api` by default:

```ts
export function GET() {
  return Response.json({ message: "Hello from Elizabeth" });
}
```

`.liz` endpoint files can return rendered HTML fragments:

```liz
<POST>
  const form = await ctx.request.formData();

  <p>{form.get("title")}</p>
</POST>
```

Route roots can be configured:

```ts
export default {
  pageRoutes: {
    "src/pages": "/",
  },
  apiRoutes: {
    "src/api": "/api",
  },
};
```

## Layouts

`layout.liz` wraps child routes:

```liz
@default
<RootLayout>
  <html>
    <body>
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
      {children}
    </body>
  </html>
</RootLayout>
```

When a shared layout exists, Elizabeth enhances same-origin link clicks by fetching the next page and swapping only the layout child boundary. There is no visual fade by default.

## Client Islands

Use `@client` for browser-interactive components:

```liz
import { clientState } from "elizabeth/client"

@client
@public
<Counter>
  const [count, setCount] = clientState(0);

  <button onClick={() => setCount(count + 1)}>{count}</button>
</Counter>
```

## Commands

```bash
elizabeth dev
elizabeth build
```

`elizabeth build` creates both static HTML for static routes and a production `dist/server.js`.
