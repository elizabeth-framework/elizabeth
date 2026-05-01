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
    html = await module.default({ children: html }, ctx);

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
