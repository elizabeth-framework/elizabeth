import { pathToFileURL } from "node:url";
import { isNotFoundResult, isRedirectResult, type NotFoundResult, type RedirectResult } from "../route.ts";
import type { PageRouteMatch } from "./pages.ts";

export type RenderRouteResult = string | RedirectResult | NotFoundResult;

export async function renderPageRoute(match: PageRouteMatch): Promise<RenderRouteResult> {
  const ctx = { params: match.params };
  const page = await import(pathToFileURL(match.route.outputPath).href);
  let html = await page.default({}, ctx);

  if (isRedirectResult(html) || isNotFoundResult(html)) {
    return html;
  }

  for (let index = match.route.layouts.length - 1; index >= 0; index--) {
    const layout = match.route.layouts[index];
    const module = await import(pathToFileURL(layout.outputPath).href);
    html = await module.default({
      children: routeBoundary(boundaryKey(layout.sourcePath, match.params, index), html),
    }, ctx);

    if (isRedirectResult(html) || isNotFoundResult(html)) {
      return html;
    }
  }

  return dedupeElizabethStyles(html);
}

function dedupeElizabethStyles(html: string): string {
  const seen = new Set<string>();

  return html.replace(/<style\b([^>]*\sdata-elizabeth-style=(["'])(.*?)\2[^>]*)>[\s\S]*?<\/style>/g, (style, _attrs: string, _quote: string, id: string) => {
    if (seen.has(id)) {
      return "";
    }

    seen.add(id);
    return style;
  });
}

function routeBoundary(key: string, html: string): string {
  return `<elizabeth-route-boundary data-elizabeth-boundary="${escapeAttribute(key)}" style="display: contents">${html}</elizabeth-route-boundary>`;
}

function boundaryKey(sourcePath: string, params: Record<string, string>, layoutIndex: number): string {
  const paramsKey = layoutIndex === 0 ? "" : JSON.stringify(Object.entries(params).sort(([left], [right]) => left.localeCompare(right)));
  return `layout:${hashString(sourcePath)}:${paramsKey}`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hashString(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}
