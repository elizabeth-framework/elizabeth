import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatCompileError } from "../compiler/errors.ts";
import { buildGlobalCssWithVite, defaultTailwindPlugins, findViteConfig, importVite } from "../css/global.ts";
import { loadElizabethConfig } from "../config.ts";
import { isNotFoundResult, isRedirectResult } from "../route.ts";
import { buildApiRoutes, describeApiRouteBuildError, type ApiRoute } from "../router/api.ts";
import { buildPageRoutes } from "../router/pages.ts";
import type { PageRoute, PageRouteManifest } from "../router/pages.ts";
import { renderPageRoute } from "../router/render.ts";

export interface ElizabethBuildOptions {
  root: string;
  frameworkRoot: string;
  pagesDir?: string;
  outDir?: string;
  distDir?: string;
}

export async function buildElizabethApp(options: ElizabethBuildOptions): Promise<void> {
  const root = resolve(options.root);
  const frameworkRoot = resolve(options.frameworkRoot);
  const pagesDir = resolve(options.pagesDir ?? resolve(root, "src/pages"));
  const distDir = resolve(options.distDir ?? resolve(root, "dist"));
  const outDir = resolve(options.outDir ?? resolve(distDir, "_elizabeth/server"));
  const config = await loadElizabethConfig(root);

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  const globalCssHrefs = await buildGlobalCssWithVite({
    root,
    outDir: resolve(distDir, "_elizabeth/global"),
    publicPrefix: "/_elizabeth/global",
  });

  const manifest = await buildPageRoutes({
    root,
    frameworkRoot,
    pageRoots: options.pagesDir
      ? [{ dir: pagesDir, basePath: "/", middleware: [], middlewareStart: config.middleware.length }]
      : config.pageRoutes,
    outDir,
  });
  const apiRoutes = await buildApiRoutes({
    root,
    frameworkRoot,
    apiRoots: config.apiRoutes,
    outDir,
    onError(route, error) {
      console.warn(describeApiRouteBuildError(route, error));
      console.warn(formatCompileError(error));
    },
  });
  assertNoRouteConflicts(manifest.routes.map((route) => ({ path: route.path, methods: ["GET", "HEAD"], sourcePath: route.sourcePath })), apiRoutes);

  await writeCssModules(distDir, manifest.cssModules);
  const clientAssets = await buildClientAssets(root, distDir, manifest.clientComponents);
  await writeClientManifest(distDir, manifest.clientComponents, clientAssets);
  await writeBuildManifest(distDir, {
    output: "server",
    routes: manifest.routes.map((route) => ({
      path: route.path,
      dynamic: route.paramNames.length > 0,
      params: route.paramNames,
    })),
    apiRoutes: apiRoutes.map((route) => ({
      path: route.path,
      methods: route.methods,
      dynamic: route.paramNames.length > 0,
      params: route.paramNames,
    })),
    notFound: Boolean(manifest.notFound),
    error: Boolean(manifest.error),
    loading: Boolean(manifest.loading),
    islands: manifest.clientComponents.map((component) => ({
      name: component.name,
      moduleId: component.moduleId,
      url: clientAssets.get(component.moduleId) ?? islandPublicPath(component.moduleId),
    })),
  });
  await writeServerEntry(distDir, manifest, apiRoutes, {
    root,
    globalCssHrefs,
    cssModuleHrefs: manifest.cssModules.map((module) => module.href),
    hasIslands: manifest.clientComponents.length > 0,
    globalMiddlewareCount: config.globalMiddlewareCount,
  });

  for (const route of manifest.routes) {
    if (route.paramNames.length > 0) {
      continue;
    }

    let result: Awaited<ReturnType<typeof renderPageRoute>>;

    try {
      result = await renderPageRoute({
        route,
        params: {},
      });
    } catch {
      continue;
    }

    if (isRedirectResult(result) || isNotFoundResult(result)) {
      continue;
    }

    await writeHtml(distDir, route.path, withBuildBootstrap(
      withCssLinks(result, [...globalCssHrefs, ...manifest.cssModules.map((module) => module.href)]),
      manifest.clientComponents.length > 0,
    ));
  }

  if (manifest.notFound) {
    const result = await renderPageRoute({
      route: manifest.notFound,
      params: {},
    });

    if (!isRedirectResult(result) && !isNotFoundResult(result)) {
      await writeHtml(distDir, "/404", withBuildBootstrap(
        withCssLinks(result, [...globalCssHrefs, ...manifest.cssModules.map((module) => module.href)]),
        manifest.clientComponents.length > 0,
      ));
    }
  }
}

async function writeCssModules(distDir: string, modules: Array<{ href: string; cssOutputPath: string; cssMapOutputPath: string; mapHref: string }>): Promise<void> {
  for (const module of modules) {
    await writePublicAsset(distDir, module.href, await readFile(module.cssOutputPath, "utf8"));
    await writePublicAsset(distDir, module.mapHref, await readFile(module.cssMapOutputPath, "utf8"));
  }
}

async function buildClientAssets(root: string, distDir: string, components: Array<{ moduleId: string; clientOutputPath: string }>): Promise<Map<string, string>> {
  const entries = new Map<string, string>();

  for (const component of components) {
    entries.set(component.moduleId, component.clientOutputPath);
  }

  if (entries.size === 0) {
    return new Map();
  }

  const islandOutDir = resolve(distDir, "_elizabeth/islands");
  const input = Object.fromEntries([...entries].map(([moduleId, clientOutputPath]) => [islandEntryName(moduleId), clientOutputPath]));
  const vite = await importVite();

  await vite.build({
    root,
    configFile: await findViteConfig(root) ?? false,
    plugins: await defaultTailwindPlugins(root),
    build: {
      outDir: islandOutDir,
      emptyOutDir: true,
      manifest: true,
      rollupOptions: {
        input,
        output: {
          entryFileNames: "[name]-[hash].js",
        },
      },
    },
  });

  const manifest = JSON.parse(await readFile(resolve(islandOutDir, ".vite/manifest.json"), "utf8")) as Record<string, { file: string }>;
  const assets = new Map<string, string>();

  for (const [moduleId] of entries) {
    const entryName = islandEntryName(moduleId);
    const entry = Object.values(manifest).find((candidate) => candidate.file.startsWith(`${entryName}-`));
    if (!entry) {
      throw new Error(`Vite did not emit island client module: ${moduleId}`);
    }

    assets.set(moduleId, `/_elizabeth/islands/${entry.file}`);
  }

  return assets;
}

async function writeClientManifest(distDir: string, components: Array<{ name: string; moduleId: string }>, assets: Map<string, string>): Promise<void> {
  if (components.length === 0) {
    return;
  }

  await writePublicAsset(distDir, "/_elizabeth/client-manifest.json", `${JSON.stringify({
    islands: components.map((component) => ({
      name: component.name,
      moduleId: component.moduleId,
      url: assets.get(component.moduleId) ?? islandPublicPath(component.moduleId),
    })),
  }, null, 2)}\n`);
}

async function writeBuildManifest(distDir: string, manifest: object): Promise<void> {
  await writePublicAsset(distDir, "/_elizabeth/build-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
}

async function writeServerEntry(
  distDir: string,
  manifest: PageRouteManifest,
  apiRoutes: ApiRoute[],
  options: {
    root: string;
    globalCssHrefs: string[];
    cssModuleHrefs: string[];
    hasIslands: boolean;
    globalMiddlewareCount: number;
  },
): Promise<void> {
  const serverRoutes = manifest.routes.map((route) => serializeServerRoute(route, distDir));
  const serverApiRoutes = apiRoutes.map((route) => serializeServerApiRoute(route, distDir));
  const notFoundRoutes = manifest.notFoundRoutes.map((route) => serializeServerRoute(route, distDir));
  const errorRoutes = manifest.errorRoutes.map((route) => serializeServerRoute(route, distDir));
  const loadingRoutes = manifest.loadingRoutes.map((route) => serializeServerRoute(route, distDir));
  const code = `#!/usr/bin/env bun
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  apiRouteBuildFailureResponse,
  methodNotAllowedResponse,
  renderApiRoute,
  renderPageRoute,
  responseFromResult,
  isRedirectResult,
  isNotFoundResult,
  runMiddleware,
  createRequestContext,
  resolveMiddleware
} from "elizabeth/server";

const distDir = dirname(fileURLToPath(import.meta.url));
const routes = ${JSON.stringify(serverRoutes, null, 2)};
const apiRoutes = ${JSON.stringify(serverApiRoutes, null, 2)};
const notFoundRoutes = ${JSON.stringify(notFoundRoutes, null, 2)};
const errorRoutes = ${JSON.stringify(errorRoutes, null, 2)};
const loadingRoutes = ${JSON.stringify(loadingRoutes, null, 2)};
const cssHrefs = ${JSON.stringify([...options.globalCssHrefs, ...options.cssModuleHrefs])};
const hasIslands = ${JSON.stringify(options.hasIslands)};
const configUrl = ${JSON.stringify(pathToFileURL(resolve(options.root, "elizabeth.config.ts")).href)};
const globalMiddlewareCount = ${JSON.stringify(options.globalMiddlewareCount)};
const redirectMarker = Symbol.for("elizabeth.redirect");
const notFoundMarker = Symbol.for("elizabeth.notFound");
const EMPTY_PARAMS = {};
const compiledRoutes = routes.map(compileServerRoute);
const compiledApiRoutes = apiRoutes.map(compileServerRoute);
const compiledNotFoundRoutes = notFoundRoutes.map(compileServerRoute);
const compiledErrorRoutes = errorRoutes.map(compileServerRoute);
const compiledLoadingRoutes = loadingRoutes.map(compileServerRoute);
const exactRoutes = exactRouteMap(compiledRoutes);
const exactApiRoutes = exactRouteMap(compiledApiRoutes);
const moduleCache = new Map();
const cssLinkMarkup = renderCssLinks(cssHrefs);
const buildBootstrapScript = renderBuildBootstrap(hasIslands);
const requestLoggingEnabled = Bun.env.ELIZABETH_REQUEST_LOGS !== "0";
const userConfig = await import(configUrl).then((module) => module.default ?? {}).catch(() => ({}));
const configMiddleware = collectConfigMiddleware(userConfig);

await preloadServerModules();

const port = Number(Bun.env.PORT ?? 3712);

Bun.serve({
  port,
  fetch(request) {
    const pathname = pathnameFromRequestUrl(request.url);
    const startedAt = Number(Bun.nanoseconds());

    try {
      const response = renderRequest(request, pathname);

      if (response instanceof Promise) {
        return response
          .then((resolved) => {
            logCompletedRequest(request, pathname, resolved, startedAt);
            return resolved;
          })
          .catch((error) => internalErrorResponse(error, pathname, request));
      }

      logCompletedRequest(request, pathname, response, startedAt);
      return response;
    } catch (error) {
      return internalErrorResponse(error, pathname, request);
    }
  },
});

console.log(\`
Elizabeth production server

  Local:   http://localhost:\${port}
           http://127.0.0.1:\${port}
\`);

function logCompletedRequest(request, pathname, response, startedAt) {
  if (requestLoggingEnabled && shouldLogRequest(pathname)) {
    logRequest({
      method: request.method.toUpperCase(),
      pathname,
      status: response.status,
      durationNs: Number(Bun.nanoseconds()) - startedAt,
    });
  }
}

function internalErrorResponse(error, pathname, request) {
  console.error(error);
  return renderError(pathname, error, request);
}

function renderRequest(request, pathname) {
    const method = request.method;

    if (pathname.startsWith("/.well-known/appspecific/")) {
      return new Response(null, { status: 204 });
    }

    if (pathname.startsWith("/_elizabeth/")) {
      return serveStatic(pathname);
    }

    if (request.headers.get("x-elizabeth-loading") === "1") {
      return renderLoading(pathname, request);
    }

const apiMatch = matchRoute(compiledApiRoutes, pathname, exactApiRoutes);
    if (apiMatch && apiMatch.route.error) {
      return apiRouteBuildFailureResponse(apiMatch.route);
    }

    if (apiMatch && apiMatch.route.methods.includes(method)) {
      const context = createRequestContext(request, pathname, apiMatch.params);
      return runMiddleware(resolveMiddlewareWrapper(apiMatch.route.middleware), context, () => renderApiRoute(apiMatch, method, request, (route) => getServerModule(route.module), context, () => renderNotFound(pathname, request)));
    }

    if (apiMatch && !["GET", "HEAD"].includes(method)) {
      return methodNotAllowedResponse(apiMatch.route.methods);
    }

    const match = matchRoute(compiledRoutes, pathname, exactRoutes);
    if (!match) {
      return renderNotFound(pathname, request);
    }

    return renderMatchedRoute(match, 200, pathname, request);
}

function renderMatchedRoute(match, status, pathname, request) {
  const context = createRequestContext(request, pathname, match.params, match.error);
  return runMiddleware(resolveMiddlewareWrapper(match.route.middleware), context, () => renderMatchedRouteWithoutMiddleware(match, status, pathname, context));
}

function renderMatchedRouteWithoutMiddleware(match, status, pathname, context) {
  let result;

  try {
    result = renderPageRoute(match, (module) => getServerModule(module), context);
  } catch (error) {
    return renderError(pathname, error, context.request);
  }

  if (result instanceof Promise) {
    return result
      .then((resolved) => renderRouteResult(resolved, status, pathname, context))
      .catch((error) => renderError(pathname, error, context.request));
  }

  return renderRouteResult(result, status, pathname, context);
}

function renderRouteResult(result, status, pathname, context) {
  if (isRedirectResult(result)) {
    return new Response(null, {
      status: result.status,
      headers: { location: result.location },
    });
  }

  if (isNotFoundResult(result)) {
    return renderNotFound(pathname, context.request);
  }

  return htmlResponse(withBuildBootstrap(withCssLinks(result, cssHrefs), hasIslands), status);
}



function renderNotFound(pathname, request) {
  const match = matchSpecialRoute(compiledNotFoundRoutes, pathname);

  if (!match) {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const context = request ? createRequestContext(request, pathname, match.params) : null;
  return runMaybeMiddleware(match.route, context, () => {
    const result = renderPageRoute(match, (module) => getServerModule(module), context);

    if (result instanceof Promise) {
      return result.then((resolved) => renderNotFoundResult(resolved));
    }

    return renderNotFoundResult(result);
  });
}

function renderError(pathname, error, request) {
  const match = matchSpecialRoute(compiledErrorRoutes, pathname);

  if (!match) {
    return new Response("Internal Server Error", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const context = request ? createRequestContext(request, pathname, match.params, error) : null;
  return runMaybeMiddleware(match.route, context, () => {
    const result = renderPageRoute({ ...match, error }, (module) => getServerModule(module), context);

    if (result instanceof Promise) {
      return result.then((resolved) => renderErrorResult(resolved, pathname, request));
    }

    return renderErrorResult(result, pathname, request);
  });
}

function renderErrorResult(result, pathname, request) {
  if (isRedirectResult(result)) {
    return new Response(null, {
      status: result.status,
      headers: { location: result.location },
    });
  }

  if (isNotFoundResult(result)) {
    return renderNotFound(pathname, request);
  }

  return htmlResponse(withBuildBootstrap(withCssLinks(result, cssHrefs), hasIslands), 500);
}

function renderLoading(pathname, request) {
  const match = matchSpecialRoute(compiledLoadingRoutes, pathname);

  if (!match) {
    return new Response(null, { status: 204 });
  }

  const context = request ? createRequestContext(request, pathname, match.params) : null;
  return runMaybeMiddleware(match.route, context, () => {
    const result = renderPageRoute(match, (module) => getServerModule(module), context);

    if (result instanceof Promise) {
      return result.then(renderLoadingResult);
    }

    return renderLoadingResult(result);
  });
}

function renderLoadingResult(result) {
  if (isRedirectResult(result)) {
    return new Response(null, {
      status: result.status,
      headers: { location: result.location },
    });
  }

  if (isNotFoundResult(result)) {
    return new Response(null, { status: 204 });
  }

  return htmlResponse(withBuildBootstrap(withCssLinks(result, cssHrefs), hasIslands), 200);
}

function renderNotFoundResult(result) {
  if (isRedirectResult(result)) {
    return new Response(null, {
      status: result.status,
      headers: { location: result.location },
    });
  }

  return htmlResponse(isNotFoundResult(result) ? "" : withBuildBootstrap(withCssLinks(result, cssHrefs), hasIslands), 404);
}

function runMaybeMiddleware(route, context, handler) {
  if (!context) {
    return handler();
  }

  return runMiddleware(resolveMiddlewareWrapper(route.middleware), context, handler);
}



function resolveMiddlewareWrapper(references) {
  return resolveMiddleware(references, globalMiddlewareCount, (index) => configMiddleware[index], getServerModule);
}

function hasMiddleware(route) {
  return globalMiddlewareCount > 0 || route.middleware?.length > 0;
}



function collectConfigMiddleware(config) {
  return [
    ...middlewareArray(config.middleware),
    ...routeRootMiddleware(config.pageRoutes),
    ...routeRootMiddleware(config.apiRoutes),
  ];
}

function routeRootMiddleware(value) {
  if (!value || typeof value === "string" || Array.isArray(value)) {
    return [];
  }

  return Object.values(value).flatMap((entry) => {
    if (!entry || typeof entry === "string") {
      return [];
    }

    return middlewareArray(entry.middleware);
  });
}

function middlewareArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "function") : [];
}


function renderRemainingRouteLayouts(match, ctx, html, startIndex) {
  if (isRedirectResult(html) || isNotFoundResult(html)) {
    return html;
  }

  let current = html;

  for (let index = startIndex; index >= 0; index--) {
    const layout = match.route.layouts[index];
    const module = getServerModule(layout.module);
    current = module.default({
      children: routeBoundary(boundaryKey(layout.hash, match.params, index), current),
    }, ctx);

    if (current instanceof Promise) {
      return current.then((resolved) => renderRemainingRouteLayouts(match, ctx, resolved, index - 1));
    }

    if (isRedirectResult(current) || isNotFoundResult(current)) {
      return current;
    }
  }

  return current.includes("data-elizabeth-style=") ? dedupeElizabethStyles(current) : current;
}

async function preloadServerModules() {
  const specifiers = new Set();

  for (const route of [...compiledRoutes, ...compiledApiRoutes, ...compiledNotFoundRoutes, ...compiledErrorRoutes, ...compiledLoadingRoutes].filter(Boolean)) {
    specifiers.add(route.module);

    for (const layout of route.layouts ?? []) {
      specifiers.add(layout.module);
    }

    for (const middleware of route.middleware ?? []) {
      if (middleware.kind === "module") {
        specifiers.add(middleware.module);
      }
    }
  }

  await Promise.all([...specifiers].map(async (specifier) => {
    moduleCache.set(specifier, await import(new URL(specifier, import.meta.url).href));
  }));
}

function getServerModule(specifier) {
  return moduleCache.get(specifier);
}

function compileServerRoute(route) {
  return {
    ...route,
    pattern: new RegExp(route.pattern),
    static: route.paramNames.length === 0,
    handlers: {},
  };
}

function exactRouteMap(routes) {
  const map = new Map();

  for (const route of routes) {
    if (route.static) {
      map.set(route.path, route);
    }
  }

  return map;
}





function matchRoute(routes, pathname, exact) {
  const exactRoute = exact.get(pathname);

  if (exactRoute) {
    return { route: exactRoute, params: EMPTY_PARAMS };
  }

  for (const route of routes) {
    if (route.static) continue;

    const match = route.pattern.exec(pathname);
    if (!match) continue;

    const params = {};
    for (const [index, name] of route.paramNames.entries()) {
      params[name] = decodeURIComponent(match[index + 1]);
    }

    return { route, params };
  }

  return null;
}

function matchSpecialRoute(routes, pathname) {
  for (const route of routes) {
    const match = route.pattern.exec(pathname);
    if (!match) continue;

    const params = {};
    for (const [index, name] of route.paramNames.entries()) {
      params[name] = decodeURIComponent(match[index + 1]);
    }

    return { route, params };
  }

  return null;
}

function pathnameFromRequestUrl(url) {
  const protocolIndex = url.indexOf("://");
  let start = protocolIndex === -1 ? 0 : url.indexOf("/", protocolIndex + 3);

  if (start === -1) {
    return "/";
  }

  const query = url.indexOf("?", start);
  const hash = url.indexOf("#", start);
  let end = url.length;

  if (query !== -1 && query < end) end = query;
  if (hash !== -1 && hash < end) end = hash;

  return url.slice(start, end) || "/";
}

async function serveStatic(pathname) {
  const filePath = resolve(distDir, pathname.replace(/^\\/+/, ""));

  if (!filePath.startsWith(distDir)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return new Response("Not found", { status: 404 });
    }
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(Bun.file(filePath), {
    headers: { "content-type": contentTypeFor(filePath) },
  });
}

function htmlResponse(html, status) {
  return new Response(\`<!doctype html>\${html}\`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function withCssLinks(html, hrefs) {
  if (!cssLinkMarkup) {
    return html;
  }

  if (html.includes("</head>")) {
    return html.replace("</head>", \`\${cssLinkMarkup}</head>\`);
  }

  return \`\${cssLinkMarkup}\${html}\`;
}

function renderCssLinks(hrefs) {
  return [...new Set(hrefs)].map((href) => \`<link rel="stylesheet" href="\${href}" />\`).join("");
}

function renderBuildBootstrap(enabled) {
  if (!enabled) {
    return "";
  }

  const islandScript = enabled ? \`
const registry = new Map();
globalThis.__elizabethRegisterIsland = (name, hydrate) => registry.set(name, hydrate);
const manifest = await fetch("/_elizabeth/client-manifest.json").then((response) => response.json());
await Promise.all(manifest.islands.map((island) => import(island.url)));
function hydrateElizabethIslands(root = document) {
  for (const island of root.querySelectorAll("el-island[data-elizabeth-client]")) {
    registry.get(island.getAttribute("data-elizabeth-client"))?.(island);
  }
}
function cleanupElizabethIslands(root = document) {
  for (const island of root.querySelectorAll("el-island[data-elizabeth-client]")) {
    island.__elizabethCleanup?.();
  }
  if (root.matches?.("el-island[data-elizabeth-client]")) {
    root.__elizabethCleanup?.();
  }
}
hydrateElizabethIslands();
\` : "";

const script = \`<script type="module">
\${islandScript}
const hydrateElizabethAfterSwap = \${enabled ? "hydrateElizabethIslands" : "() => {}"};
const cleanupElizabethBeforeSwap = \${enabled ? "cleanupElizabethIslands" : "() => {}"};
let elizabethNavigationId = 0;
let elizabethNavigationAbort = null;
document.addEventListener("click", async (event) => {
  const link = event.target.closest?.("a[href]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  if (link.target || link.hasAttribute("download")) {
    return;
  }
  const nextUrl = new URL(link.href, location.href);
  if (nextUrl.origin !== location.origin || nextUrl.pathname === location.pathname && nextUrl.search === location.search) {
    return;
  }
  if (!deepestSharedBoundary(document, document)) {
    return;
  }
  event.preventDefault();
  const navigationId = ++elizabethNavigationId;
  elizabethNavigationAbort?.abort();
  const controller = new AbortController();
  elizabethNavigationAbort = controller;
  try {
    const response = await fetch(nextUrl.href, {
      signal: controller.signal,
      headers: {
        "x-elizabeth-navigation": "1",
      },
    });
    if (navigationId !== elizabethNavigationId) {
      return;
    }
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
      location.href = nextUrl.href;
      return;
    }
    const html = await response.text();
    if (navigationId !== elizabethNavigationId) {
      return;
    }
    const nextDocument = new DOMParser().parseFromString(html, "text/html");
    const pair = deepestSharedBoundary(document, nextDocument);
    if (!pair) {
      location.href = nextUrl.href;
      return;
    }
    const swap = () => {
      if (navigationId !== elizabethNavigationId) {
        return;
      }
      document.title = nextDocument.title;
      const fresh = pair.next.cloneNode(true);
      cleanupElizabethBeforeSwap(pair.current);
      pair.current.replaceWith(fresh);
      history.pushState(null, "", nextUrl.href);
      hydrateElizabethAfterSwap(fresh);
    };
    swap();
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      return;
    }
    if (navigationId === elizabethNavigationId) {
      location.href = nextUrl.href;
    }
  } finally {
    if (navigationId === elizabethNavigationId) {
      elizabethNavigationAbort = null;
    }
  }
});
addEventListener("popstate", () => location.reload());
function deepestSharedBoundary(currentDocument, nextDocument) {
  const current = [...currentDocument.querySelectorAll("[data-elizabeth-boundary]")];
  const nextByKey = new Map([...nextDocument.querySelectorAll("[data-elizabeth-boundary]")].map((node) => [node.getAttribute("data-elizabeth-boundary"), node]));
  for (let index = current.length - 1; index >= 0; index--) {
    const key = current[index].getAttribute("data-elizabeth-boundary");
    const next = nextByKey.get(key);
    if (next) {
      return { current: current[index], next };
    }
  }
  return null;
}
</script>\`;

  return script;
}

function withBuildBootstrap(html, enabled) {
  const script = buildBootstrapScript;

  if (html.includes("</body>")) {
    return html.replace("</body>", \`\${script}</body>\`);
  }

  return \`\${html}\${script}\`;
}





function logRequest(entry) {
  const method = color(entry.method.padEnd(6), "\\x1b[36m");
  const status = color(String(entry.status).padStart(3), statusColor(entry.status));
  const duration = color(formatDuration(entry.durationNs).padStart(6), "\\x1b[90m");
  console.log(\`\${method} \${status} \${duration} \${entry.pathname}\`);
}

function shouldLogRequest(pathname) {
  return !(
    pathname.startsWith("/_elizabeth/") ||
    pathname.startsWith("/.well-known/appspecific/") ||
    pathname === "/favicon.ico"
  );
}

function formatDuration(durationNs) {
  if (durationNs > 1_000_000) {
    return \`\${(durationNs / 1_000_000).toFixed(0)}ms\`;
  }

  if (durationNs > 1_000) {
    return \`\${(durationNs / 1_000).toFixed(0)}μs\`;
  }

  return \`\${durationNs.toFixed(0)}ns\`;
}

function statusColor(status) {
  if (status >= 500) return "\\x1b[31m";
  if (status >= 400) return "\\x1b[33m";
  if (status >= 300) return "\\x1b[36m";
  return "\\x1b[32m";
}

function color(value, code) {
  return \`\${code}\${value}\\x1b[0m\`;
}

function contentTypeFor(path) {
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}
`;

  await writeFile(resolve(distDir, "server.js"), code);
}

function serializeServerRoute(route: PageRoute, distDir: string): object {
  return {
    path: route.path,
    pattern: route.pattern.source,
    paramNames: route.paramNames,
    sourcePath: route.sourcePath,
    module: toServerImportPath(route.outputPath, distDir),
    middleware: route.middleware.map((entry) => serializeMiddlewareReference(entry, distDir)),
    layouts: route.layouts.map((layout) => ({
      sourcePath: layout.sourcePath,
      hash: hashString(layout.sourcePath),
      module: toServerImportPath(layout.outputPath, distDir),
    })),
  };
}

function serializeServerApiRoute(route: ApiRoute, distDir: string): object {
  return {
    path: route.path,
    pattern: route.pattern.source,
    paramNames: route.paramNames,
    methods: route.methods,
    module: route.outputPath ? toServerImportPath(route.outputPath, distDir) : null,
    error: route.error,
    middleware: route.middleware.map((entry) => serializeMiddlewareReference(entry, distDir)),
  };
}

function serializeMiddlewareReference(
  reference: PageRoute["middleware"][number] | ApiRoute["middleware"][number],
  distDir: string,
): object {
  if (reference.kind === "config") {
    return reference;
  }

  return {
    kind: "module",
    sourcePath: reference.sourcePath,
    module: toServerImportPath(reference.outputPath, distDir),
  };
}

function toServerImportPath(path: string, distDir: string): string {
  const normalized = relative(distDir, path).replaceAll("\\", "/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function hashString(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}

function assertNoRouteConflicts(pageRoutes: Array<{ path: string; methods: string[]; sourcePath: string }>, apiRoutes: ApiRoute[]): void {
  const seen = new Map<string, string>();

  for (const route of pageRoutes) {
    for (const method of route.methods) {
      seen.set(`${method} ${route.path}`, route.sourcePath);
    }
  }

  for (const route of apiRoutes) {
    for (const method of route.methods) {
      const key = `${method} ${route.path}`;
      const previous = seen.get(key);

      if (previous) {
        throw new Error(`Route conflict: ${key}\n- page: ${previous}\n- api: ${route.sourcePath}`);
      }

      seen.set(key, route.sourcePath);
    }
  }
}

async function writePublicAsset(distDir: string, href: string, content: string): Promise<void> {
  const pathname = href.split("?")[0];
  const path = resolve(distDir, pathname.replace(/^\/+/, ""));

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function writeHtml(distDir: string, routePath: string, html: string): Promise<void> {
  const filePath = routePath === "/"
    ? resolve(distDir, "index.html")
    : resolve(distDir, routePath.replace(/^\/+/, ""), "index.html");

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `<!doctype html>${html}`);
}

function withCssLinks(html: string, hrefs: string[]): string {
  if (hrefs.length === 0) {
    return html;
  }

  const links = [...new Set(hrefs)].map((href) => `<link rel="stylesheet" href="${href}" />`).join("");

  if (html.includes("</head>")) {
    return html.replace("</head>", `${links}</head>`);
  }

  return `${links}${html}`;
}

function withBuildBootstrap(html: string, hasIslands: boolean): string {
  const islandScript = hasIslands ? `
const registry = new Map();
globalThis.__elizabethRegisterIsland = (name, hydrate) => registry.set(name, hydrate);
const manifest = await fetch("/_elizabeth/client-manifest.json").then((response) => response.json());
await Promise.all(manifest.islands.map((island) => import(island.url)));
function hydrateElizabethIslands(root = document) {
  for (const island of root.querySelectorAll("el-island[data-elizabeth-client]")) {
    registry.get(island.getAttribute("data-elizabeth-client"))?.(island);
  }
}
function cleanupElizabethIslands(root = document) {
  for (const island of root.querySelectorAll("el-island[data-elizabeth-client]")) {
    island.__elizabethCleanup?.();
  }
  if (root.matches?.("el-island[data-elizabeth-client]")) {
    root.__elizabethCleanup?.();
  }
}
hydrateElizabethIslands();
` : "";

const script = `<script type="module">
${islandScript}
const hydrateElizabethAfterSwap = ${hasIslands ? "hydrateElizabethIslands" : "() => {}"};
const cleanupElizabethBeforeSwap = ${hasIslands ? "cleanupElizabethIslands" : "() => {}"};
let elizabethNavigationId = 0;
let elizabethNavigationAbort = null;
document.addEventListener("click", async (event) => {
  const link = event.target.closest?.("a[href]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  if (link.target || link.hasAttribute("download")) {
    return;
  }
  const nextUrl = new URL(link.href, location.href);
  if (nextUrl.origin !== location.origin || nextUrl.pathname === location.pathname && nextUrl.search === location.search) {
    return;
  }
  if (!deepestSharedBoundary(document, document)) {
    return;
  }
  event.preventDefault();
  const navigationId = ++elizabethNavigationId;
  elizabethNavigationAbort?.abort();
  const controller = new AbortController();
  elizabethNavigationAbort = controller;
  try {
    const response = await fetch(nextUrl.href, {
      signal: controller.signal,
      headers: {
        "x-elizabeth-navigation": "1",
      },
    });
    if (navigationId !== elizabethNavigationId) {
      return;
    }
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
      location.href = nextUrl.href;
      return;
    }
    const html = await response.text();
    if (navigationId !== elizabethNavigationId) {
      return;
    }
    const nextDocument = new DOMParser().parseFromString(html, "text/html");
    const pair = deepestSharedBoundary(document, nextDocument);
    if (!pair) {
      location.href = nextUrl.href;
      return;
    }
    const swap = () => {
      if (navigationId !== elizabethNavigationId) {
        return;
      }
      document.title = nextDocument.title;
      const fresh = pair.next.cloneNode(true);
      cleanupElizabethBeforeSwap(pair.current);
      pair.current.replaceWith(fresh);
      history.pushState(null, "", nextUrl.href);
      hydrateElizabethAfterSwap(fresh);
    };
    swap();
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      return;
    }
    if (navigationId === elizabethNavigationId) {
      location.href = nextUrl.href;
    }
  } finally {
    if (navigationId === elizabethNavigationId) {
      elizabethNavigationAbort = null;
    }
  }
});
addEventListener("popstate", () => location.reload());
function deepestSharedBoundary(currentDocument, nextDocument) {
  const current = [...currentDocument.querySelectorAll("[data-elizabeth-boundary]")];
  const nextByKey = new Map([...nextDocument.querySelectorAll("[data-elizabeth-boundary]")].map((node) => [node.getAttribute("data-elizabeth-boundary"), node]));
  for (let index = current.length - 1; index >= 0; index--) {
    const key = current[index].getAttribute("data-elizabeth-boundary");
    const next = nextByKey.get(key);
    if (next) {
      return { current: current[index], next };
    }
  }
  return null;
}
</script>`;

  if (html.includes("</body>")) {
    return html.replace("</body>", `${script}</body>`);
  }

  return `${html}${script}`;
}

function islandPublicPath(moduleId: string): string {
  return `/_elizabeth/islands/${encodeURIComponent(moduleId)}.js`;
}

function islandEntryName(moduleId: string): string {
  return encodeURIComponent(moduleId).replace(/%/g, "_");
}
