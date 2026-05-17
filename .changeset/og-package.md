---
"@elizabeth-js/og": minor
---

New package `@elizabeth-js/og` — a tiny Open Graph image helper that renders a satori-style JSX tree to PNG bytes via `satori` + `@resvg/resvg-js`. No headless browser; runs in-process and works in `/api/og` routes.

Exports:

- `renderOgImage({ width, height, fonts, template, png? })` — returns PNG bytes (default) or the raw SVG string when `png: false`.
- `h(type, props, ...children)` — a small JSX-runtime-free element builder, mirroring `React.createElement`.

See `packages/og/README.md` for full usage.
