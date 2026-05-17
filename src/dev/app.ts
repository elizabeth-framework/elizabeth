import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatCompileError } from "../compiler/errors.ts";
import { type CompileGraphContext, createCompileGraphContext } from "../compiler/file.ts";
import { createProjectContext } from "../compiler/project.ts";
import { type ElizabethConfig, loadElizabethConfig } from "../config.ts";
import {
  clearViteConfigCache,
  defaultTailwindPlugins,
  findViteConfig,
  importVite,
  type ViteDevServerLike,
} from "../css/global.ts";
import { isNotFoundResult, isRedirectResult } from "../route.ts";
import { type ApiRoute, buildApiRoutes, describeApiRouteBuildError, matchApiRoute } from "../router/api.ts";
import type { PageRouteManifest } from "../router/pages.ts";
import { buildPageRoutes, matchPageRoute, matchSpecialPageRoute } from "../router/pages.ts";
import { type RenderModuleCache, renderPageRoute } from "../router/render.ts";
import { renderDevError } from "./error.ts";
import { createHmrRuntime } from "./hmr.ts";

export interface ElizabethDevOptions {
  root: string;
  frameworkRoot: string;
  pagesDir?: string;
  outDir?: string;
  port?: number;
}

type DevRouteKind = "page" | "api" | "asset" | "error";

interface DevRenderResult {
  response: Response;
  kind: DevRouteKind;
}

export interface RouteSummary {
  pages: { path: string; sourcePath: string }[];
  apis: { path: string; methods: string[]; sourcePath: string }[];
  specials: {
    notFound: number;
    error: number;
    loading: number;
  };
}

export interface ElizabethDevHandler {
  fetch(request: Request): Promise<Response>;
  getRouteSummary(): Promise<RouteSummary>;
}

export function createElizabethDevHandler(options: ElizabethDevOptions): ElizabethDevHandler {
  const root = resolve(options.root);
  const frameworkRoot = resolve(options.frameworkRoot);
  const pagesDir = resolve(options.pagesDir ?? resolve(root, "src/pages"));
  const outDir = resolve(options.outDir ?? resolve(root, ".elizabeth"));
  let cachedManifest: PageRouteManifest | null = null;
  let cachedApiRoutes: ApiRoute[] | null = null;
  let cachedConfig: ElizabethConfig | null = null;
  let routeConflictChecked = false;
  let viteDevServer: Promise<ViteDevServerLike | null> | null = null;
  let pendingProjectCacheUpdate: Promise<void> | null = null;
  let pageCompileContext: CompileGraphContext = createCompileGraphContext();
  let apiCompileContext: CompileGraphContext = createCompileGraphContext();
  const renderModuleCache: RenderModuleCache = new Map();
  const apiModuleCache = new Map<string, Promise<Record<string, unknown>>>();
  const projectContextPromise = createProjectContext(root);
  const hmr = createHmrRuntime({
    root,
    frameworkRoot,
    watchDirs: [
      resolve(root, "elizabeth.config.ts"),
      resolve(root, "vite.config.ts"),
      resolve(root, "vite.config.js"),
      resolve(root, "vite.config.mjs"),
      resolve(root, "vite.config.cjs"),
      dirname(pagesDir),
      resolve(frameworkRoot, "src"),
    ],
  });
  hmr.onChange((event) => {
    pendingProjectCacheUpdate = handleProjectChange(event.type, event.path);
  });
  hmr.start();

  async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_elizabeth/hmr") {
      return hmr.handle(request);
    }

    let result: DevRenderResult;
    const startedAt = Number(Bun.nanoseconds());

    try {
      result = await render(url.pathname, request);
    } catch (error) {
      result = {
        response: devErrorResponse(error, url.pathname),
        kind: "error",
      };
    }

    if (shouldLogDevRequest(url.pathname, result.kind)) {
      logDevRequest({
        method: request.method.toUpperCase(),
        pathname: url.pathname,
        status: result.response.status,
        durationMs: Number(Bun.nanoseconds()) - startedAt,
        kind: result.kind,
      });
    }

    return result.response;
  }

  async function getRouteSummary(): Promise<RouteSummary> {
    const [manifest, apis] = await Promise.all([getManifest(), getApiRoutes()]);

    return {
      pages: manifest.routes.map((route) => ({
        path: route.path,
        sourcePath: route.sourcePath,
      })),
      apis: apis.map((route) => ({
        path: route.path,
        methods: route.methods,
        sourcePath: route.sourcePath,
      })),
      specials: {
        notFound: manifest.notFoundRoutes.length,
        error: manifest.errorRoutes.length,
        loading: manifest.loadingRoutes.length,
      },
    };
  }

  return { fetch, getRouteSummary };

  async function render(pathname: string, request: Request): Promise<DevRenderResult> {
    if (pathname.startsWith("/.well-known/appspecific/")) {
      return devResult(new Response(null, { status: 204 }), "asset");
    }

    if (!(await pathExistsInProjectCache(pagesDir, "dir"))) {
      return devResult(
        new Response(`Elizabeth pages directory not found: ${pagesDir}`, {
          status: 500,
          headers: {
            "content-type": "text/plain; charset=utf-8",
          },
        }),
        "error",
      );
    }

    if (pathname === "/_elizabeth/client-manifest.json") {
      return devResult(
        Response.json({
          islands: (await getManifest()).clientComponents,
        }),
        "asset",
      );
    }

    if (pathname.startsWith("/_elizabeth/islands/")) {
      return devResult(await renderIslandModuleFromManifest(pathname, await getManifest()), "asset");
    }

    if (pathname.startsWith("/_elizabeth/global/")) {
      return devResult(await renderViteTransformedModule(pathname), "asset");
    }

    if (isViteInternalRequest(pathname)) {
      return devResult(await renderViteInternalModule(pathname), "asset");
    }

    let manifest: PageRouteManifest;
    let apiRoutes: ApiRoute[];

    try {
      manifest = await getManifest();
      apiRoutes = await getApiRoutes();
      ensureNoRouteConflicts(manifest, apiRoutes);
    } catch (error) {
      return devResult(devErrorResponse(error, pathname), "error");
    }

    if (request.headers.get("x-elizabeth-loading") === "1") {
      return devResult(await renderLoading(manifest, pathname), "page");
    }

    if (pathname.startsWith("/_elizabeth/css/")) {
      return devResult(await renderCssModule(pathname, manifest), "asset");
    }

    const method = request.method;
    const apiMatch = matchApiRoute(apiRoutes, pathname);
    if (apiMatch && apiMatch.route.error) {
      return devResult(apiRouteBuildFailureResponse(apiMatch.route), "api");
    }
    if (apiMatch && apiMatch.route.methods.includes(method)) {
      return devResult(await renderApiRoute(apiMatch, method, request, apiModuleCache), "api");
    }

    if (apiMatch && !["GET", "HEAD"].includes(method)) {
      return devResult(methodNotAllowedResponse(apiMatch.route.methods), "api");
    }

    const match = matchPageRoute(manifest.routes, pathname);

    if (!match) {
      return devResult(await renderNotFound(manifest, pathname), "page");
    }

    let result: Awaited<ReturnType<typeof renderPageRoute>>;

    try {
      result = await renderPageRoute(match, { moduleCache: renderModuleCache });
    } catch (error) {
      return devResult(await renderError(manifest, pathname, error), "error");
    }

    if (isRedirectResult(result)) {
      return devResult(redirectResponse(result.location, result.status), "page");
    }

    if (isNotFoundResult(result)) {
      return devResult(await renderNotFound(manifest, pathname), "page");
    }

    const html = withCssLinks(result, [
      ...(await getGlobalCssHrefs()),
      ...manifest.cssModules.map((module) => module.href),
    ]);
    const hmrRefresh = request.headers.get("x-elizabeth-hmr") === "1";

    return devResult(
      htmlResponse(hmrRefresh ? html : withDevBootstrap(html, manifest.clientComponents.length > 0)),
      "page",
    );
  }

  async function renderNotFound(
    manifest: Awaited<ReturnType<typeof buildPageRoutes>>,
    pathname: string,
  ): Promise<Response> {
    const match = matchSpecialPageRoute(manifest.notFoundRoutes, pathname);

    if (!match) {
      return new Response("Not found", {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    const result = await renderPageRoute(match, { moduleCache: renderModuleCache });

    if (isRedirectResult(result)) {
      return redirectResponse(result.location, result.status);
    }

    if (isNotFoundResult(result)) {
      return htmlResponse("", 404);
    }

    const html = withCssLinks(result, [
      ...(await getGlobalCssHrefs()),
      ...(await getManifest()).cssModules.map((module) => module.href),
    ]);

    return htmlResponse(html, 404);
  }

  async function renderError(
    manifest: Awaited<ReturnType<typeof buildPageRoutes>>,
    pathname: string,
    error: unknown,
  ): Promise<Response> {
    const match = matchSpecialPageRoute(manifest.errorRoutes, pathname);

    if (!match) {
      return devErrorResponse(error, pathname);
    }

    const route = match.route;
    const result = await renderPageRoute(
      {
        route,
        params: match.params,
        error,
      },
      { moduleCache: renderModuleCache },
    );

    if (isRedirectResult(result)) {
      return redirectResponse(result.location, result.status);
    }

    if (isNotFoundResult(result)) {
      return await renderNotFound(manifest, pathname);
    }

    const html = withCssLinks(result, [
      ...(await getGlobalCssHrefs()),
      ...(await getManifest()).cssModules.map((module) => module.href),
    ]);

    return htmlResponse(withDevBootstrap(html, manifest.clientComponents.length > 0), 500);
  }

  async function renderLoading(
    manifest: Awaited<ReturnType<typeof buildPageRoutes>>,
    pathname: string,
  ): Promise<Response> {
    const match = matchSpecialPageRoute(manifest.loadingRoutes, pathname);

    if (!match) {
      return new Response(null, { status: 204 });
    }

    const result = await renderPageRoute(match, { moduleCache: renderModuleCache });

    if (isRedirectResult(result)) {
      return redirectResponse(result.location, result.status);
    }

    if (isNotFoundResult(result)) {
      return new Response(null, { status: 204 });
    }

    const html = withCssLinks(result, [
      ...(await getGlobalCssHrefs()),
      ...(await getManifest()).cssModules.map((module) => module.href),
    ]);

    return htmlResponse(withDevBootstrap(html, manifest.clientComponents.length > 0));
  }

  function devResult(response: Response, kind: DevRouteKind): DevRenderResult {
    return {
      response,
      kind,
    };
  }

  async function getManifest(): Promise<PageRouteManifest> {
    const config = await getConfig();
    await pendingProjectCacheUpdate;
    const project = await projectContextPromise;

    if (!cachedManifest) {
      cachedManifest = await buildPageRoutes({
        root,
        frameworkRoot,
        pageRoots: options.pagesDir ? [{ dir: pagesDir, basePath: "/" }] : config.pageRoutes,
        outDir,
        cache: project.cache,
        context: pageCompileContext,
      });
    }

    return cachedManifest;
  }

  async function handleProjectChange(
    eventType: "add" | "addDir" | "change" | "unlink" | "unlinkDir",
    path: string,
  ): Promise<void> {
    await updateProjectCache(eventType, path);
    await invalidateForChange(path);
  }

  async function updateProjectCache(
    eventType: "add" | "addDir" | "change" | "unlink" | "unlinkDir",
    path: string,
  ): Promise<void> {
    const project = await projectContextPromise;
    const normalizedPath = resolve(path);

    if (!isInsideProjectSrc(normalizedPath)) {
      return;
    }

    if (eventType === "add") {
      project.cache.addFile(normalizedPath, dirname(normalizedPath));
    } else if (eventType === "addDir") {
      project.cache.addDir(normalizedPath, dirname(normalizedPath));
    } else if (eventType === "change") {
      project.cache.markChanged(normalizedPath);
    } else {
      project.cache.removePath(normalizedPath);
    }
  }

  async function invalidateForChange(path: string): Promise<void> {
    const normalizedPath = resolve(path);
    const configPath = resolve(root, "elizabeth.config.ts");
    const viteConfigPaths = new Set(
      ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"].map((name) => resolve(root, name)),
    );

    if (normalizedPath === configPath) {
      cachedConfig = null;
      invalidatePages();
      invalidateApiRoutes();
      return;
    }

    if (viteConfigPaths.has(normalizedPath)) {
      clearViteConfigCache(root);
      viteDevServer = null;
      invalidatePages();
      return;
    }

    if (normalizedPath.startsWith(`${resolve(frameworkRoot, "src")}/`)) {
      invalidatePages();
      invalidateApiRoutes();
      return;
    }

    if (!isInsideProjectSrc(normalizedPath)) {
      return;
    }

    const config = await getConfig();
    const pageRoots = options.pagesDir ? [{ dir: pagesDir, basePath: "/" }] : config.pageRoutes;
    const inPageRoot = pageRoots.some((routeRoot) => isInsideDir(normalizedPath, routeRoot.dir));
    const inApiRoot = config.apiRoutes.some((routeRoot) => isInsideDir(normalizedPath, routeRoot.dir));

    if (inPageRoot) {
      invalidatePages();
    }

    if (inApiRoot) {
      invalidateApiRoutes();
    }

    if (!inPageRoot && !inApiRoot) {
      invalidatePages();
    }
  }

  function invalidatePages(): void {
    cachedManifest = null;
    routeConflictChecked = false;
    pageCompileContext = createCompileGraphContext();
    renderModuleCache.clear();
  }

  function invalidateApiRoutes(): void {
    cachedApiRoutes = null;
    routeConflictChecked = false;
    apiCompileContext = createCompileGraphContext();
    apiModuleCache.clear();
  }

  function isInsideProjectSrc(path: string): boolean {
    const srcRoot = resolve(root, "src");
    return path === srcRoot || path.startsWith(`${srcRoot}/`);
  }

  async function pathExistsInProjectCache(path: string, kind: "file" | "dir"): Promise<boolean> {
    const project = await projectContextPromise;
    const meta = project.cache.get(resolve(path));

    return kind === "file" ? meta?.isFile === true : meta?.isDir === true;
  }

  function isInsideDir(path: string, dir: string): boolean {
    const normalizedDir = resolve(dir);
    return path === normalizedDir || path.startsWith(`${normalizedDir}/`);
  }

  async function getApiRoutes(): Promise<ApiRoute[]> {
    const config = await getConfig();
    const project = await projectContextPromise;

    if (!cachedApiRoutes) {
      cachedApiRoutes = await buildApiRoutes({
        root,
        frameworkRoot,
        apiRoots: config.apiRoutes,
        outDir,
        cache: project.cache,
        context: apiCompileContext,
        onError(route, error) {
          console.warn(describeApiRouteBuildError(route, error));
          console.warn(formatCompileError(error));
        },
      });
    }

    return cachedApiRoutes;
  }

  async function getConfig(): Promise<ElizabethConfig> {
    cachedConfig ??= await loadElizabethConfig(root);
    return cachedConfig;
  }

  function ensureNoRouteConflicts(manifest: PageRouteManifest, apiRoutes: ApiRoute[]): void {
    if (routeConflictChecked) {
      return;
    }

    assertNoRouteConflicts(
      manifest.routes.map((route) => ({ path: route.path, methods: ["GET", "HEAD"], sourcePath: route.sourcePath })),
      apiRoutes,
    );
    routeConflictChecked = true;
  }

  async function renderViteTransformedModule(pathname: string): Promise<Response> {
    const server = await getViteDevServer();
    if (!server) {
      return new Response("Global CSS entry not found", {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    const vitePath = `/${decodeURIComponent(pathname.slice("/_elizabeth/global/".length))}`;
    const isCssRequest = vitePath.endsWith(".css");
    const result = await server.transformRequest(isCssRequest ? `${vitePath}?direct` : vitePath);

    if (!result) {
      return new Response("Vite module not found", {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    if (isCssRequest) {
      return new Response(result.code, {
        headers: {
          "content-type": "text/css; charset=utf-8",
        },
      });
    }

    return new Response(rewriteViteDevModule(result.code), {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
      },
    });
  }

  async function renderViteInternalModule(pathname: string): Promise<Response> {
    const server = await getViteDevServer();

    if (!server) {
      return new Response("Vite module not found", {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    const result = await server.transformRequest(pathname);

    if (!result) {
      return new Response("Vite module not found", {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    return new Response(rewriteViteDevModule(result.code), {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
      },
    });
  }

  async function getViteDevServer(): Promise<ViteDevServerLike | null> {
    if (!(await pathExistsInProjectCache(resolve(root, "src/styles.css"), "file"))) {
      return null;
    }

    viteDevServer ??= createViteDevServer(root);
    return viteDevServer;
  }

  async function getGlobalCssHrefs(): Promise<string[]> {
    return (await pathExistsInProjectCache(resolve(root, "src/styles.css"), "file"))
      ? ["/_elizabeth/global/src/styles.css"]
      : [];
  }
}

async function renderApiRoute(
  match: { route: ApiRoute; params: Record<string, string> },
  method: string,
  request: Request,
  moduleCache?: Map<string, Promise<Record<string, unknown>>>,
): Promise<Response> {
  if (match.route.error) {
    return apiRouteBuildFailureResponse(match.route);
  }

  const modulePath = match.route.outputPath!;
  let pending = moduleCache?.get(modulePath);

  if (!pending) {
    pending = import(pathToFileURL(modulePath).href) as Promise<Record<string, unknown>>;
    moduleCache?.set(modulePath, pending);
  }

  const module = await pending;
  const handler = module[method];

  if (typeof handler !== "function") {
    return methodNotAllowedResponse(match.route.methods);
  }

  const context = {
    request,
    params: match.params,
    locals: {},
    get url() {
      return new URL(request.url);
    },
  };

  const result = await handler(context);

  if (result instanceof Response) {
    return result;
  }

  if (isRedirectResult(result)) {
    return redirectResponse(result.location, result.status);
  }

  if (isNotFoundResult(result)) {
    return new Response("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
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

function apiRouteBuildFailureResponse(route: ApiRoute): Response {
  return new Response(`API route failed to build: ${route.path}\n${route.error ?? "Unknown error"}`, {
    status: 500,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function logDevRequest(entry: {
  method: string;
  pathname: string;
  status: number;
  durationMs: number;
  kind: DevRouteKind;
}): void {
  const method = color(entry.method.padEnd(6), "\x1b[36m");
  const status = color(String(entry.status).padStart(3), statusColor(entry.status));

  if (entry.durationMs > 1_000_000) {
    const duration = color(`${(entry.durationMs / 1_000_000).toFixed(0)}ms`.padStart(6), "\x1b[90m");
    console.log(`${method} ${status} ${duration} ${entry.pathname}`);
  } else if (entry.durationMs > 1_000) {
    const duration = color(`${(entry.durationMs / 1_000).toFixed(0)}μs`.padStart(6), "\x1b[90m");
    console.log(`${method} ${status} ${duration} ${entry.pathname}`);
  } else {
    const duration = color(`${(entry.durationMs).toFixed(0)}ns`.padStart(6), "\x1b[90m");
    console.log(`${method} ${status} ${duration} ${entry.pathname}`);
  }
}

function shouldLogDevRequest(pathname: string, kind: DevRouteKind): boolean {
  if (
    pathname.startsWith("/_elizabeth/") ||
    pathname.startsWith("/@fs/") ||
    pathname.startsWith("/@vite/") ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/.well-known/appspecific/") ||
    pathname === "/favicon.ico"
  ) {
    return false;
  }

  if (kind === "asset") {
    return false;
  }

  return true;
}

function isViteInternalRequest(pathname: string): boolean {
  return (
    pathname.startsWith("/@fs/") ||
    pathname.startsWith("/@vite/") ||
    pathname.startsWith("/node_modules/") ||
    pathname === "/__vite_ping"
  );
}

function statusColor(status: number): string {
  if (status >= 500) {
    return "\x1b[31m";
  }

  if (status >= 400) {
    return "\x1b[33m";
  }

  if (status >= 300) {
    return "\x1b[36m";
  }

  return "\x1b[32m";
}

function color(value: string, code: string): string {
  return `${code}${value}\x1b[0m`;
}

function methodNotAllowedResponse(methods: string[]): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: {
      allow: methods.join(", "),
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function assertNoRouteConflicts(
  pageRoutes: Array<{ path: string; methods: string[]; sourcePath: string }>,
  apiRoutes: ApiRoute[],
): void {
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

function rewriteViteDevModule(code: string): string {
  return code.replaceAll('from "/', 'from "/_elizabeth/global/').replaceAll('import("/', 'import("/_elizabeth/global/');
}

function devErrorResponse(error: unknown, pathname: string): Response {
  return new Response(withDevBootstrap(renderDevError(error, pathname), false), {
    status: 500,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

async function renderIslandModuleFromManifest(pathname: string, manifest: PageRouteManifest): Promise<Response> {
  const moduleId = decodeURIComponent(pathname.slice("/_elizabeth/islands/".length));
  const island = manifest.clientComponents.find((entry) => entry.moduleId === moduleId);

  if (!island) {
    return new Response("Island module not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  return new Response(await readFile(island.clientOutputPath, "utf8"), {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
    },
  });
}

async function renderCssModule(
  pathname: string,
  manifest: Awaited<ReturnType<typeof buildPageRoutes>>,
): Promise<Response> {
  const moduleId = decodeURIComponent(pathname.slice("/_elizabeth/css/".length));
  const isSourceMap = moduleId.endsWith(".map");
  const cssModuleId = isSourceMap ? moduleId.slice(0, -".map".length) : moduleId;
  const cssModule = manifest.cssModules.find((entry) =>
    entry.href.startsWith(`/_elizabeth/css/${encodeURIComponent(cssModuleId)}`),
  );

  if (!cssModule) {
    return new Response("CSS module not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  return new Response(await readFile(isSourceMap ? cssModule.cssMapOutputPath : cssModule.cssOutputPath, "utf8"), {
    headers: {
      "content-type": isSourceMap ? "application/json; charset=utf-8" : "text/css; charset=utf-8",
    },
  });
}

export function startElizabethDevServer(options: ElizabethDevOptions): ReturnType<typeof Bun.serve> {
  const requestedPort = options.port ?? 3712;
  const handler = createElizabethDevHandler(options);
  let port = requestedPort;

  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const server = Bun.serve({
        port,
        idleTimeout: 255,
        fetch: handler.fetch,
      });

      printDevServerReady({
        port: server.port,
        requestedPort,
        root: options.root,
      });

      handler
        .getRouteSummary()
        .then((summary) => {
          printRouteSummary(summary);
        })
        .catch((error) => {
          console.warn("Could not discover routes:", error instanceof Error ? error.message : error);
        });

      return server;
    } catch (error) {
      if (!isPortInUseError(error)) {
        throw error;
      }

      if (attempt === 19) {
        throw new Error(`Elizabeth could not find an available port from ${requestedPort} to ${port}.`);
      }

      port++;
    }
  }

  throw new Error("Elizabeth could not start the dev server.");
}

function isPortInUseError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const coded = error as Error & { code?: string };
  return (
    coded.code === "EADDRINUSE" ||
    error.message.includes("EADDRINUSE") ||
    (error.message.includes("port") && error.message.includes("use"))
  );
}

function printDevServerReady(options: { port: number; requestedPort: number; root: string }): void {
  const portNote =
    options.port === options.requestedPort
      ? ""
      : `\n  Port ${options.requestedPort} was busy, using ${options.port} instead.`;

  console.log(`
Elizabeth dev server

  Local:   http://localhost:${options.port}
           http://127.0.0.1:${options.port}${portNote}
`);
}

export interface FormatRouteSummaryOptions {
  /** Maximum number of pages and apis to list. `0` or negative means no limit. Default: 20. */
  limit?: number;
}

const DEFAULT_ROUTE_LIMIT = 20;

function resolveRouteLimit(option: number | undefined): number {
  if (typeof option === "number" && Number.isFinite(option)) {
    return option;
  }

  const envValue = Bun.env.ELIZABETH_DEV_ROUTE_LIMIT;
  if (envValue !== undefined && envValue !== "") {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return DEFAULT_ROUTE_LIMIT;
}

export function formatRouteSummary(summary: RouteSummary, options: FormatRouteSummaryOptions = {}): string {
  const lines: string[] = [];
  const pageCount = summary.pages.length;
  const apiCount = summary.apis.length;
  const limit = resolveRouteLimit(options.limit);
  const applyLimit = limit > 0;

  lines.push(
    `Routes (${pageCount} ${pageCount === 1 ? "page" : "pages"}, ${apiCount} ${apiCount === 1 ? "api" : "apis"})`,
  );
  lines.push("");

  if (summary.pages.length > 0) {
    lines.push("  Pages");
    const visiblePages = applyLimit ? summary.pages.slice(0, limit) : summary.pages;
    for (const page of visiblePages) {
      lines.push(`    ${page.path}`);
    }
    const hiddenPages = summary.pages.length - visiblePages.length;
    if (hiddenPages > 0) {
      lines.push(`    … and ${hiddenPages} more (set ELIZABETH_DEV_ROUTE_LIMIT to adjust)`);
    }
    lines.push("");
  }

  if (summary.apis.length > 0) {
    lines.push("  API");
    const visibleApis = applyLimit ? summary.apis.slice(0, limit) : summary.apis;
    for (const api of visibleApis) {
      const methods = api.methods.length > 0 ? api.methods.join(",") : "*";
      lines.push(`    ${methods.padEnd(20)} ${api.path}`);
    }
    const hiddenApis = summary.apis.length - visibleApis.length;
    if (hiddenApis > 0) {
      lines.push(`    … and ${hiddenApis} more (set ELIZABETH_DEV_ROUTE_LIMIT to adjust)`);
    }
    lines.push("");
  }

  const specials: string[] = [];
  if (summary.specials.notFound > 0) specials.push(`${summary.specials.notFound} 404`);
  if (summary.specials.error > 0) specials.push(`${summary.specials.error} error`);
  if (summary.specials.loading > 0) specials.push(`${summary.specials.loading} loading`);

  if (specials.length > 0) {
    lines.push(`  Boundaries: ${specials.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

function printRouteSummary(summary: RouteSummary): void {
  if (summary.pages.length === 0 && summary.apis.length === 0) {
    console.log("No routes discovered.\n");
    return;
  }

  console.log(formatRouteSummary(summary));
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(`<!doctype html>${html}`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function redirectResponse(location: string, status: number): Response {
  return new Response(null, {
    status,
    headers: {
      location,
    },
  });
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

async function createViteDevServer(root: string): Promise<ViteDevServerLike> {
  const vite = await importVite();

  if (!vite.createServer) {
    throw new Error("Installed Vite version does not expose createServer.");
  }

  return await vite.createServer({
    root,
    configFile: (await findViteConfig(root)) ?? false,
    plugins: await defaultTailwindPlugins(root),
    appType: "custom",
    server: {
      middlewareMode: true,
      hmr: {
        port: 24678,
      },
    },
  });
}

function withDevBootstrap(html: string, hasIslands: boolean): string {
  const islandScript = hasIslands
    ? `
const registry = new Map();
globalThis.__elizabethRegisterIsland = (name, hydrate) => registry.set(name, hydrate);
let manifest = await fetch("/_elizabeth/client-manifest.json").then((response) => response.json());
const islandUrl = (moduleId) => "/_elizabeth/islands/" + encodeURIComponent(moduleId);
await Promise.all(manifest.islands.map((island) => import(islandUrl(island.moduleId))));
function hydrateElizabethIslands(root = document) {
  for (const island of root.querySelectorAll("el-island[data-elizabeth-client]")) {
    registry.get(island.getAttribute("data-elizabeth-client"))?.(island);
  }
}
hydrateElizabethIslands();
`
    : "";
  const script = `<script type="module">
${islandScript}
const hydrateElizabethAfterSwap = ${hasIslands ? "hydrateElizabethIslands" : "() => {}"};
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
  const currentBoundary = deepestSharedBoundary(document, document);
  if (!currentBoundary) {
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
const hmr = new EventSource("/_elizabeth/hmr");
hmr.onmessage = async (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "css") {
    const html = await fetch(location.href, {
      headers: {
        "x-elizabeth-hmr": "1",
      },
    }).then((response) => response.text());
    const nextDocument = new DOMParser().parseFromString(html, "text/html");
    for (const nextLink of nextDocument.querySelectorAll('link[rel="stylesheet"][href^="/_elizabeth/"]')) {
      if (!nextLink.getAttribute("href").startsWith("/_elizabeth/css/") && !nextLink.getAttribute("href").startsWith("/_elizabeth/global/")) {
        continue;
      }
      const modulePath = nextLink.getAttribute("href").split("?")[0];
      const current = document.querySelector(\`link[rel="stylesheet"][href^="\${modulePath}"]\`);
      const href = nextLink.getAttribute("href").includes("?")
        ? nextLink.getAttribute("href")
        : modulePath + "?t=" + Date.now();
      if (current) {
        current.setAttribute("href", href);
      } else {
        const fresh = nextLink.cloneNode(true);
        fresh.setAttribute("href", href);
        document.head.append(fresh);
      }
    }
    return;
  }
  if (message.type === "reload") {
    location.reload();
    return;
  }
  if (message.type !== "island") {
    return;
  }
  ${
    hasIslands
      ? `try {
    const manifestResponse = await fetch("/_elizabeth/client-manifest.json?t=" + Date.now());
    if (!manifestResponse.ok) {
      location.reload();
      return;
    }
    manifest = await manifestResponse.json();
    const islands = manifest.islands.filter((island) => island.moduleId === message.moduleId);
    if (islands.length === 0) {
      location.reload();
      return;
    }
    await import(islandUrl(message.moduleId) + "?t=" + Date.now());
    const html = await fetch(location.href, {
      headers: {
        "x-elizabeth-hmr": "1",
      },
    }).then((response) => response.text());
    const nextDocument = new DOMParser().parseFromString(html, "text/html");
    for (const island of islands) {
      const currentNodes = [...document.querySelectorAll(\`el-island[data-elizabeth-client="\${island.name}"]\`)];
      const freshNodes = [...nextDocument.querySelectorAll(\`el-island[data-elizabeth-client="\${island.name}"]\`)];
      if (currentNodes.length !== freshNodes.length) {
        location.reload();
        return;
      }
      for (const [index, node] of currentNodes.entries()) {
        const fresh = freshNodes[index].cloneNode(true);
        node.replaceWith(fresh);
        registry.get(island.name)?.(fresh);
      }
    }
  } catch {
    location.reload();
  }`
      : "location.reload();"
  }
};
</script>`;

  if (html.includes("</body>")) {
    return html.replace("</body>", `${script}</body>`);
  }

  return `${html}${script}`;
}
