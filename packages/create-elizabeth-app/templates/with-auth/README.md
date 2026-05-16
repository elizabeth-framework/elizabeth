# Elizabeth App (Auth)

A reactive web application built with [Elizabeth](https://github.com/elizabeth-js/elizabeth) that ships a working signup / login / logout flow using signed cookie sessions.

## Getting Started

1. Copy `.env.example` to `.env` and set `SESSION_SECRET` to a long random string. You can generate one with:

   ```bash
   bun -e "console.log(crypto.getRandomValues(new Uint8Array(32)).reduce((acc, b) => acc + b.toString(16).padStart(2, '0'), ''))"
   ```

2. Start the dev server:

   ```bash
   bun run dev
   ```

3. Open `http://localhost:3712`, create an account, log out, log back in.

## How it works

- **`src/lib/auth.ts`** — session encoding (HMAC-signed, base64url-encoded JSON in an `HttpOnly` cookie) and password hashing (scrypt). Self-contained, depends only on `node:crypto`.
- **`src/lib/users.ts`** — in-memory user store. Replace this with your real database. Users live in a `Map<string, User>`, so they reset every time the server restarts.
- **`src/api/auth/login.ts` / `signup.ts` / `logout.ts`** — form-driven POST handlers. They return `303 See Other` to `/` for HTML form submissions, and JSON when called with `Accept: application/json`.
- **`src/api/auth/me.ts`** — returns the current session or `{ user: null }`.
- **`src/components/AuthStatus.liz`** — a client island that calls `/api/auth/me` on hydration and renders either the login/signup links or a "Signed in as …" row with a logout button.

## Why is auth checked client-side?

Elizabeth (`0.0.x`) doesn't yet expose the `Request` to page components, so a page can't read cookies during SSR. The pattern in this template is to render the page unconditionally and let a client island ask `/api/auth/me` whether the user is logged in. Once Elizabeth adds page-level loaders (a planned feature), this template will move the check to the server.

API routes, on the other hand, DO get the `Request` — so use `readSession(request)` in any protected endpoint to enforce auth server-side.

## Things to customise

- Swap `src/lib/users.ts` for your database (Postgres, SQLite, Bun's built-in SQL, etc.).
- Add CSRF protection if you serve cross-origin forms.
- Tighten the cookie attributes in `src/lib/auth.ts` (e.g. shorter `Max-Age`, `Secure` always, custom path).
- Add rate limiting on `POST /api/auth/login`.

## Building for Production

```bash
bun run build
bun run start
```
