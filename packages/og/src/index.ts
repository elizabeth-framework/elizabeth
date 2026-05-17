/**
 * @elizabeth-js/og — Open Graph image rendering helper.
 *
 * Uses `satori` to render a JSX-shaped element tree to SVG, then
 * `@resvg/resvg-js` to rasterize the SVG to PNG. Both steps run in-process
 * with no headless browser.
 */

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

/**
 * Satori's input element shape, modeled as plain objects so callers don't
 * need a JSX runtime. Build trees with the exported `h()` helper or by
 * constructing object literals directly.
 */
export interface OgElement {
  type: string;
  props: {
    style?: Record<string, string | number>;
    children?: OgChildren;
    [key: string]: unknown;
  };
  key?: string | number | null;
}

export type OgChild = OgElement | string | number | null | undefined | false;
export type OgChildren = OgChild | OgChild[];

export interface OgFont {
  name: string;
  /** TTF / OTF font bytes. */
  data: ArrayBuffer | Uint8Array;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  style?: "normal" | "italic";
}

export interface RenderOgImageOptions {
  /** Image width in CSS pixels. Defaults to 1200 (standard OG card width). */
  width?: number;
  /** Image height in CSS pixels. Defaults to 630 (standard OG card height). */
  height?: number;
  fonts: OgFont[];
  /** Element tree to render. */
  template: OgElement;
  /** When true (default), returns PNG bytes. When false, returns the raw SVG string. */
  png?: boolean;
}

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 630;

/**
 * Convenience for building element trees without a JSX runtime.
 * Mirrors `React.createElement(type, props, ...children)`.
 */
export function h(
  type: string,
  props: OgElement["props"] | null = null,
  ...children: OgChild[]
): OgElement {
  const merged: OgElement["props"] = { ...(props ?? {}) };

  if (children.length === 1) {
    merged.children = children[0] as OgChildren;
  } else if (children.length > 1) {
    merged.children = children as OgChild[];
  }

  return { type, props: merged };
}

/**
 * Render the given template to a PNG buffer (default) or SVG string.
 */
export async function renderOgImage(options: RenderOgImageOptions): Promise<Uint8Array>;
export async function renderOgImage(options: RenderOgImageOptions & { png: false }): Promise<string>;
export async function renderOgImage(options: RenderOgImageOptions): Promise<Uint8Array | string> {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;

  if (!options.fonts || options.fonts.length === 0) {
    throw new Error("renderOgImage requires at least one font in `fonts`.");
  }

  const svg = await satori(options.template as never, {
    width,
    height,
    fonts: options.fonts.map((font) => ({
      name: font.name,
      data: font.data as never,
      weight: font.weight ?? 400,
      style: font.style ?? "normal",
    })),
  });

  if (options.png === false) {
    return svg;
  }

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
  });
  return resvg.render().asPng();
}
