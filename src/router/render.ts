import { pathToFileURL } from "node:url";
import { isNotFoundResult, isRedirectResult, type NotFoundResult, type RedirectResult } from "../route.ts";
import type { PageRouteMatch } from "./pages.ts";

export type RenderRouteResult = string | RedirectResult | NotFoundResult;
export interface RenderPageContext {
  params: Record<string, string>;
  error?: unknown;
}
type RenderModule = {
  default(props?: Record<string, unknown>, ctx?: RenderPageContext): Promise<RenderRouteResult> | RenderRouteResult;
};

export type RenderModuleCache = Map<string, Promise<RenderModule>>;

export interface RenderPageRouteOptions {
  moduleCache?: RenderModuleCache;
}

export async function renderPageRoute(
  match: PageRouteMatch,
  options: RenderPageRouteOptions = {},
): Promise<RenderRouteResult> {
  const ctx = { params: match.params, error: match.error };
  const page = await importRenderModule(match.route.outputPath, options.moduleCache);
  let html = await page.default({}, ctx);

  if (isRedirectResult(html) || isNotFoundResult(html)) {
    return html;
  }

  for (let index = match.route.layouts.length - 1; index >= 0; index--) {
    const layout = match.route.layouts[index];
    const module = await importRenderModule(layout.outputPath, options.moduleCache);
    html = await module.default(
      {
        children: routeBoundary(boundaryKey(layout.sourcePath, match.params, index), html),
      },
      ctx,
    );

    if (isRedirectResult(html) || isNotFoundResult(html)) {
      return html;
    }
  }

  return dedupeElizabethStyles(html);
}

async function importRenderModule(path: string, cache?: RenderModuleCache): Promise<RenderModule> {
  const href = pathToFileURL(path).href;

  if (!cache) {
    return (await import(href)) as RenderModule;
  }

  let pending = cache.get(path);

  if (!pending) {
    pending = import(href) as Promise<RenderModule>;
    cache.set(path, pending);
  }

  return await pending;
}

function dedupeElizabethStyles(html: string): string {
  const seen = new Set<string>();

  return html.replace(
    /<style\b([^>]*\sdata-elizabeth-style=(["'])(.*?)\2[^>]*)>[\s\S]*?<\/style>/g,
    (style, _attrs: string, _quote: string, id: string) => {
      if (seen.has(id)) {
        return "";
      }

      seen.add(id);
      return style;
    },
  );
}

function routeBoundary(key: string, html: string): string {
  return `<elizabeth-route-boundary data-elizabeth-boundary="${escapeAttribute(key)}" style="display: contents">${html}</elizabeth-route-boundary>`;
}

function boundaryKey(sourcePath: string, params: Record<string, string>, layoutIndex: number): string {
  if (layoutIndex === 0) return `layout:${hashString(sourcePath)}:`;
  let key = "";
  for (const name in params) key += name + "=" + params[name] + "&";
  return `layout:${hashString(sourcePath)}:${key}`;
}

function escapeAttribute(value: string): string {
  return Bun.escapeHTML(value);
}

function hashString(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}
