import { pathToFileURL } from "node:url";
import { type NotFoundResult, type RedirectResult } from "../route.ts";
import type { ElizabethRequestContext } from "./middleware.ts";
import type { PageRouteMatch } from "./pages.ts";
import { renderPageRoute as sharedRenderPageRoute } from "../runtime/server.ts";

export type RenderRouteResult = string | RedirectResult | NotFoundResult;
export interface RenderPageContext {
  params: Record<string, string>;
  error?: unknown;
  locals: Record<string, unknown>;
  request?: Request;
  pathname?: string;
  readonly url?: URL;
}
type RenderModule = {
  default(props?: Record<string, unknown>, ctx?: RenderPageContext): Promise<RenderRouteResult> | RenderRouteResult;
};

export type RenderModuleCache = Map<string, Promise<RenderModule>>;

export interface RenderPageRouteOptions {
  moduleCache?: RenderModuleCache;
  context?: ElizabethRequestContext;
}

export async function renderPageRoute(
  match: PageRouteMatch,
  options: RenderPageRouteOptions = {},
): Promise<RenderRouteResult> {
  const result = sharedRenderPageRoute(
    match,
    (path: string) => importRenderModule(path, options.moduleCache),
    options.context
  );

  if (result instanceof Promise) {
    return await result;
  }
  return result;
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
