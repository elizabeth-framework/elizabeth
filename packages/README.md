# Elizabeth packages

This monorepo publishes each helper as an individual npm package under the `@elizabeth-js` scope. Add only the packages you actually use.

| Package | What it does |
| --- | --- |
| [`@elizabeth-js/http`](./http) | `json`, `text`, `html`, `noContent`, `created`, `error`, `badRequest`, `unauthorized`, `forbidden`, `notFoundResponse`, `conflict`, `unprocessable`, `internalServerError`, `methodNotAllowed` |
| [`@elizabeth-js/request`](./request) | `readJson`, `readForm`, `readText`, `formValue`, `formValues`, `formFile`, `searchParams`, `queryParam`, `queryParams`, `BodyParseError` |
| [`@elizabeth-js/redirect`](./redirect) | `redirect`, `permanentRedirect`, `temporaryRedirect`, `seeOther`, `redirectBack`, `notFound` — symbol-tagged for the Elizabeth router |
| [`@elizabeth-js/cookies`](./cookies) | `parseCookies`, `getCookie`, `serializeCookie`, `setCookie`, `deleteCookie` |
| [`@elizabeth-js/env`](./env) | `env`, `requireEnv`, `envFlag`, `envInt`, `isDev`, `isProduction`, `isTest` |
| [`@elizabeth-js/config`](./config) | `defineConfig`, `defineApiRoute`, shared route type re-exports |
| [`@elizabeth-js/html`](./html) | `classNames`, `escapeHtml`, `safeHtml`, `isSafeHtml` |
| [`@elizabeth-js/async`](./async) | `sleep`, `withTimeout`, `retry`, `TimeoutError` |
| [`@elizabeth-js/logger`](./logger) | `createLogger` — namespaced logger with level filtering |
| [`@elizabeth-js/stream`](./stream) | `streamResponse`, `sse`, `formatSseMessage` |
| [`@elizabeth-js/crypto`](./crypto) | `hashPassword` / `verifyPassword` (scrypt), `signValue` / `unsignValue` (HMAC-SHA256), `randomToken`, `timingSafeEqual`, `hmac` |
| [`@elizabeth-js/sessions`](./sessions) | `createSessionStore` — signed cookie sessions on top of `crypto` + `cookies` |
| [`@elizabeth-js/cors`](./cors) | `cors({ origin, methods, allowedHeaders, credentials, … })` — preflight + actual-response handler |
| [`@elizabeth-js/csrf`](./csrf) | `generateCsrfToken`, `verifyCsrfToken` |
| [`@elizabeth-js/rate-limit`](./rate-limit) | `rateLimit`, `createMemoryStore` — token-bucket limiter |
| [`@elizabeth-js/etag`](./etag) | `etag`, `ifNoneMatch`, `notModified` |
| [`@elizabeth-js/serve-file`](./serve-file) | `serveFile` — static file serving with ETag, Last-Modified, Range, HEAD |
| [`@elizabeth-js/schema`](./schema) | Standard Schema V1 adapter — `validate`, `safeValidate`, `validateBody`, `validateSearchParams` |
| [`@elizabeth-js/time`](./time) | `parseDuration`, `formatDuration`, `formatRelative` |
| [`@elizabeth-js/id`](./id) | `generateId` (sortable Crockford-base32), `parseIdTime`, `randomId` |

## Examples

### API responses

```ts
import { json, badRequest, methodNotAllowed } from "@elizabeth-js/http";
import { readJson, BodyParseError } from "@elizabeth-js/request";

export async function POST(ctx) {
  try {
    const body = await readJson<{ name: string }>(ctx.request);
    return json({ ok: true, name: body.name }, { status: 201 });
  } catch (error) {
    if (error instanceof BodyParseError) return badRequest(error.message);
    throw error;
  }
}

export function GET() {
  return methodNotAllowed(["POST"]);
}
```

### Router-compatible redirects

`redirect()` / `notFound()` use the same `Symbol.for("elizabeth.redirect")` / `Symbol.for("elizabeth.notFound")` markers the core router checks for, so returning them from a route works without any extra wiring.

```ts
import { permanentRedirect, redirectBack, seeOther } from "@elizabeth-js/redirect";

export function GET(ctx) {
  if (ctx.url.pathname === "/old") return permanentRedirect("/new");
  return seeOther("/dashboard");
}

export async function POST(ctx) {
  await save(await ctx.request.formData());
  return redirectBack(ctx.request, "/home");
}
```

### Signed sessions

```ts
import { createSessionStore } from "@elizabeth-js/sessions";
import { json } from "@elizabeth-js/http";

const session = createSessionStore<{ userId: number }>({
  secret: process.env.SESSION_SECRET!,
});

export function GET(ctx) {
  const data = session.read(ctx.request);
  return json({ data });
}

export async function POST(ctx) {
  const res = json({ ok: true });
  session.write(res, { userId: 42 });
  return res;
}
```

### Validation via Standard Schema

```ts
import { z } from "zod";
import { validateBody, SchemaValidationError } from "@elizabeth-js/schema";
import { json, badRequest } from "@elizabeth-js/http";

const createUser = z.object({ name: z.string().min(1), age: z.number().int() });

export async function POST(ctx) {
  try {
    const user = await validateBody(ctx.request, createUser);
    return json({ ok: true, user }, { status: 201 });
  } catch (error) {
    if (error instanceof SchemaValidationError) return badRequest(error.message);
    throw error;
  }
}
```

### Static file serving

```ts
import { serveFile } from "@elizabeth-js/serve-file";

export function GET(ctx) {
  return serveFile(`./public${new URL(ctx.request.url).pathname}`, ctx.request, {
    cacheControl: "public, max-age=3600",
  });
}
```

## Cross-package usage in this repo

Packages that depend on each other (e.g. `sessions` → `crypto` + `cookies`) declare those dependencies with `"workspace:*"` so Bun resolves them from this monorepo during development. They are published to npm as ordinary version pins.

## License

Apache 2.0 (see [LICENSE.md](../LICENSE.md) in the monorepo root).
