# @elizabeth-js/utilities

Helper functions and types for building [Elizabeth](https://github.com/elizabeth-js/elizabeth) apps. They are framework-agnostic enough to use in plain Bun servers too.

This package is intentionally separate from the core compiler/runtime so it can evolve on its own release cycle.

## Install

```sh
bun add @elizabeth-js/utilities
```

## Sub-paths

Pick the slice you need, or import everything from the root.

| Import | Helpers |
| --- | --- |
| `@elizabeth-js/utilities/http` | `json`, `text`, `html`, `noContent`, `created`, `error`, `badRequest`, `unauthorized`, `forbidden`, `notFoundResponse`, `conflict`, `unprocessable`, `internalServerError`, `methodNotAllowed` |
| `@elizabeth-js/utilities/request` | `readJson`, `readForm`, `readText`, `formValue`, `formValues`, `formFile`, `searchParams`, `queryParam`, `queryParams`, `BodyParseError` |
| `@elizabeth-js/utilities/redirect` | `redirect`, `permanentRedirect`, `temporaryRedirect`, `seeOther`, `redirectBack`, `notFound`, `isRedirectResult`, `isNotFoundResult` |
| `@elizabeth-js/utilities/cookies` | `parseCookies`, `getCookie`, `serializeCookie`, `setCookie`, `deleteCookie` |
| `@elizabeth-js/utilities/env` | `env`, `requireEnv`, `envFlag`, `envInt`, `isDev`, `isProduction`, `isTest` |
| `@elizabeth-js/utilities/config` | `defineConfig`, `defineApiRoute`, `ApiContext`, `ApiHandler`, `HttpMethod` |
| `@elizabeth-js/utilities/html` | `classNames`, `escapeHtml`, `safeHtml`, `isSafeHtml` |
| `@elizabeth-js/utilities/async` | `sleep`, `withTimeout`, `retry`, `TimeoutError` |
| `@elizabeth-js/utilities/logger` | `createLogger` |
| `@elizabeth-js/utilities/stream` | `streamResponse`, `sse`, `formatSseMessage` |

## Examples

### API responses

```ts
import { json, badRequest, methodNotAllowed } from "@elizabeth-js/utilities/http";
import { readJson, BodyParseError } from "@elizabeth-js/utilities/request";

export async function POST(ctx) {
  try {
    const body = await readJson<{ name: string }>(ctx.request);
    return json({ ok: true, name: body.name }, { status: 201 });
  } catch (error) {
    if (error instanceof BodyParseError) {
      return badRequest(error.message);
    }
    throw error;
  }
}

export function GET() {
  return methodNotAllowed(["POST"]);
}
```

### Redirects compatible with the core runtime

`redirect()` and `notFound()` use `Symbol.for("elizabeth.redirect")` / `Symbol.for("elizabeth.notFound")`, the same registered symbols the core router checks for, so returning them from a route works without any extra wiring.

```ts
import { permanentRedirect, redirectBack, seeOther } from "@elizabeth-js/utilities/redirect";

export function GET(ctx) {
  if (ctx.url.pathname === "/old") return permanentRedirect("/new");
  return seeOther("/dashboard");
}

export async function POST(ctx) {
  await save(await ctx.request.formData());
  return redirectBack(ctx.request, "/home");
}
```

### Cookies

```ts
import { getCookie, setCookie, deleteCookie } from "@elizabeth-js/utilities/cookies";
import { json } from "@elizabeth-js/utilities/http";

export function GET(ctx) {
  const session = getCookie(ctx.request, "session");
  const res = json({ session });
  setCookie(res, "viewed", "1", { httpOnly: true, sameSite: "Lax", path: "/" });
  return res;
}

export function DELETE(ctx) {
  const res = json({ ok: true });
  deleteCookie(res, "session", { path: "/" });
  return res;
}
```

### Typed config

```ts
// elizabeth.config.ts
import { defineConfig } from "@elizabeth-js/utilities/config";

export default defineConfig({
  pageRoutes: {
    "src/pages": "/",
    "src/docs": "/docs",
  },
  apiRoutes: {
    "src/api": "/api",
  },
});
```

### `classNames` in components

```liz
import { classNames } from "@elizabeth-js/utilities/html"

@default
<Button>
  <button className={classNames("btn", { "btn-primary": true, disabled: false })}>
    Click
  </button>
</Button>
```

### Env helpers

```ts
import { env, requireEnv, isDev } from "@elizabeth-js/utilities/env";

const apiUrl = env("API_URL", "http://localhost:3000");
const secret = requireEnv("APP_SECRET");
if (isDev()) console.log("running in development");
```

### Server-sent events

```ts
import { sse } from "@elizabeth-js/utilities/stream";
import { sleep } from "@elizabeth-js/utilities/async";

export function GET() {
  return sse((async function* () {
    for (let i = 0; i < 5; i++) {
      yield { event: "tick", data: { i } };
      await sleep(1000);
    }
  })());
}
```

## License

MIT (see [LICENSE.md](../../LICENSE.md) in the monorepo root).
