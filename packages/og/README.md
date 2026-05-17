# @elizabeth-js/og

Tiny Open Graph image helper. Renders a satori-style JSX tree to PNG bytes (or raw SVG), so you can ship `/api/og` routes without a headless browser.

## Install

```sh
bun add @elizabeth-js/og
```

## Usage

```ts
import { readFile } from "node:fs/promises";
import { h, renderOgImage } from "@elizabeth-js/og";

const interRegular = await readFile("./fonts/Inter-Regular.ttf");

const png = await renderOgImage({
  width: 1200,
  height: 630,
  fonts: [{ name: "Inter", data: interRegular, weight: 400 }],
  template: h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background: "linear-gradient(135deg, #1e1b4b, #7c3aed)",
        color: "white",
        fontFamily: "Inter",
      },
    },
    h("div", { style: { fontSize: 64, fontWeight: 700 } }, "Hello, Elizabeth"),
    h("div", { style: { fontSize: 28, opacity: 0.8 } }, "A Bun-native framework"),
  ),
});

// In an Elizabeth API route:
//   export function GET() { return new Response(png, { headers: { "content-type": "image/png" }}); }
```

If you prefer the SVG output (e.g. to embed in a page), pass `png: false`:

```ts
const svg = await renderOgImage({ ..., png: false });
```

## Notes

- The `template` argument is satori's React-style element tree. You can construct it with the bundled `h()` helper, with `React.createElement(...)`, or any JSX runtime configured to produce React-compatible elements.
- At least one font is required. Satori does not bundle any.
- Layout is **flex-only** — satori does not implement the full CSS spec. See the [satori docs](https://github.com/vercel/satori) for the supported subset.

## License

Apache 2.0 (see [LICENSE.md](../../LICENSE.md) in the monorepo root).
