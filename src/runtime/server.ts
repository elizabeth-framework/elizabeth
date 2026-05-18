import { isNotFoundResult, isRedirectResult, type NotFoundResult, type RedirectResult } from "../route.ts";
export { isNotFoundResult, isRedirectResult, type NotFoundResult, type RedirectResult };
export { runMiddleware } from "../router/middleware.ts";
export type { ElizabethMiddleware, ElizabethRequestContext, MiddlewareReference } from "../router/middleware.ts";

export function methodNotAllowedResponse(methods: string[]): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: {
      allow: methods.join(", "),
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export function apiRouteBuildFailureResponse(route: { path: string; error?: string | null }): Response {
  return new Response(`API route failed to build: ${route.path}\n${route.error ?? "Unknown error"}`, {
    status: 500,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export function responseFromResult(
  result: unknown,
  pathname: string,
  renderNotFound: () => Response | Promise<Response>
): Response | Promise<Response> {
  if (result instanceof Response) {
    return result;
  }

  if (isRedirectResult(result)) {
    return new Response(null, {
      status: result.status,
      headers: { location: result.location },
    });
  }

  if (isNotFoundResult(result)) {
    return renderNotFound();
  }

  if (typeof result === "string") {
    return new Response(result, {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
  }

  return Response.json(result);
}

export async function renderApiRoute(
  match: any,
  method: string,
  request: Request,
  resolveModule: (route: any) => any,
  context?: any,
  renderNotFound?: () => Response | Promise<Response>
): Promise<Response> {
  if (match.route.error) {
    return apiRouteBuildFailureResponse(match.route);
  }

  const module = await resolveModule(match.route);
  let handler = match.route.handlers?.[method] ?? module[method];

  if (!handler) {
    return methodNotAllowedResponse(match.route.methods);
  }

  const result = await handler(
    context ?? {
      request,
      pathname: new URL(request.url).pathname,
      params: match.params,
      locals: {},
      get url() {
        return new URL(request.url);
      },
    }
  );

  return responseFromResult(result, new URL(request.url).pathname, renderNotFound ?? (() => {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  })) as Response;
}

export function escapeAttribute(value: string): string {
  return Bun.escapeHTML(value);
}

export function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function routeBoundary(key: string, html: string): string {
  return `<elizabeth-route-boundary data-elizabeth-boundary="${escapeAttribute(key)}" style="display: contents">${html}</elizabeth-route-boundary>`;
}

export function boundaryKey(sourcePath: string, params: Record<string, string>, layoutIndex: number): string {
  if (layoutIndex === 0) return `layout:${hashString(sourcePath)}:`;
  let key = "";
  for (const name in params) key += name + "=" + params[name] + "&";
  return `layout:${hashString(sourcePath)}:${key}`;
}

export function dedupeElizabethStyles(html: string): string {
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

export function renderPageRoute(
  match: any,
  resolveModule: (path: string) => any,
  context?: any
): any {
  const ctx = context ? { ...context, params: match.params, error: match.error } : { params: match.params, error: match.error, locals: {} };
  const moduleIdentifier = match.route.module || match.route.outputPath;
  const page = resolveModule(moduleIdentifier);
  
  if (page instanceof Promise) {
    return page.then((resolvedPage) => {
      const html = resolvedPage.default({}, ctx);
      if (html instanceof Promise) {
        return html.then((resolvedHtml) => renderRouteLayouts(match, resolveModule, ctx, resolvedHtml, match.route.layouts.length - 1));
      }
      return renderRouteLayouts(match, resolveModule, ctx, html, match.route.layouts.length - 1);
    });
  }

  const html = page.default({}, ctx);
  if (html instanceof Promise) {
    return html.then((resolvedHtml) => renderRouteLayouts(match, resolveModule, ctx, resolvedHtml, match.route.layouts.length - 1));
  }

  return renderRouteLayouts(match, resolveModule, ctx, html, match.route.layouts.length - 1);
}

function renderRouteLayouts(match: any, resolveModule: (path: string) => any, ctx: any, html: any, layoutIndex: number): any {
  if (isRedirectResult(html) || isNotFoundResult(html)) {
    return html;
  }

  let current = html;

  for (let index = layoutIndex; index >= 0; index--) {
    const layout = match.route.layouts[index];
    const moduleIdentifier = layout.module || layout.outputPath;
    const modulePromise = resolveModule(moduleIdentifier);
    
    if (modulePromise instanceof Promise) {
      return modulePromise.then((module) => {
        const result = module.default({
          children: routeBoundary(boundaryKey(layout.hash || layout.sourcePath, match.params, index), current)
        }, ctx);
        
        if (result instanceof Promise) {
          return result.then((resolved) => renderRouteLayouts(match, resolveModule, ctx, resolved, index - 1));
        }
        return renderRouteLayouts(match, resolveModule, ctx, result, index - 1);
      });
    }

    const result = modulePromise.default({
      children: routeBoundary(boundaryKey(layout.hash || layout.sourcePath, match.params, index), current)
    }, ctx);

    if (result instanceof Promise) {
      return result.then((resolved) => renderRouteLayouts(match, resolveModule, ctx, resolved, index - 1));
    }
    
    current = result;
    if (isRedirectResult(current) || isNotFoundResult(current)) {
      return current;
    }
  }

  return typeof current === "string" && current.includes("data-elizabeth-style=") ? dedupeElizabethStyles(current) : current;
}


export function createRequestContext(
  request: Request,
  pathname: string,
  params: Record<string, string>,
  error?: unknown,
) {
  return {
    request,
    pathname,
    params,
    locals: {},
    error,
    get url() {
      return new URL(request.url);
    },
  };
}

export function resolveMiddleware(
  references: any[] = [],
  globalMiddlewareCount: number,
  getConfigMiddleware: (index: number) => any,
  resolveModule: (path: string) => any
): any {
  const middleware: any[] = [];

  for (let index = 0; index < globalMiddlewareCount; index++) {
    const entry = getConfigMiddleware(index);
    if (entry) middleware.push(entry);
  }

  for (const reference of references) {
    if (reference.kind === "config") {
      const entry = getConfigMiddleware(reference.index);
      if (entry) middleware.push(entry);
      continue;
    }

    const modulePromise = resolveModule(reference.module || reference.outputPath);
    if (modulePromise instanceof Promise) {
      middleware.push(modulePromise.then((module) => {
        const entry = module?.default ?? module?.middleware;
        if (typeof entry !== "function") {
          throw new Error("Middleware module must export a default function or named middleware: " + reference.sourcePath);
        }
        return entry;
      }));
    } else {
      const entry = modulePromise?.default ?? modulePromise?.middleware;
      if (typeof entry !== "function") {
        throw new Error("Middleware module must export a default function or named middleware: " + reference.sourcePath);
      }
      middleware.push(entry);
    }
  }

  if (middleware.some((m) => m instanceof Promise)) {
    return Promise.all(middleware);
  }
  return middleware;
}
