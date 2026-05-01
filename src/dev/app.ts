import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultTailwindPlugins, findViteConfig, importVite, type ViteDevServerLike } from "../css/global.ts";
import { loadElizabethConfig } from "../config.ts";
import { renderDevError } from "./error.ts";
import { isNotFoundResult, isRedirectResult } from "../route.ts";
import { buildApiRoutes, matchApiRoute, type ApiRoute } from "../router/api.ts";
import { buildPageRoutes, matchPageRoute } from "../router/pages.ts";
import type { PageRouteManifest } from "../router/pages.ts";
import { renderPageRoute } from "../router/render.ts";
import { createHmrRuntime } from "./hmr.ts";

export interface ElizabethDevOptions {
  root: string;
  frameworkRoot: string;
  pagesDir?: string;
  outDir?: string;
  port?: number;
}

export function createElizabethDevHandler(options: ElizabethDevOptions): (request: Request) => Promise<Response> {
  const root = resolve(options.root);
  const frameworkRoot = resolve(options.frameworkRoot);
  const pagesDir = resolve(options.pagesDir ?? resolve(root, "src/pages"));
  const outDir = resolve(options.outDir ?? resolve(root, ".elizabeth"));
  let cachedManifest: PageRouteManifest | null = null;
  let cachedApiRoutes: ApiRoute[] | null = null;
  let viteDevServer: Promise<ViteDevServerLike | null> | null = null;
  const hmr = createHmrRuntime({
    root,
    frameworkRoot,
    watchDirs: [
      dirname(pagesDir),
      resolve(frameworkRoot, "src"),
    ],
  });
  hmr.onChange(() => {
    cachedManifest = null;
    cachedApiRoutes = null;
  });
  hmr.start();

  return async function handleElizabethDevRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/_elizabeth/hmr") {
      return hmr.handle(request);
    }

    return render(url.pathname, request);
  };

  async function render(pathname: string, request: Request): Promise<Response> {
    if (!existsSync(pagesDir)) {
      return new Response(`Elizabeth pages directory not found: ${pagesDir}`, {
        status: 500,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    if (pathname === "/_elizabeth/client-manifest.json") {
      return Response.json({
        islands: (await getManifest()).clientComponents,
      });
    }

    if (pathname.startsWith("/_elizabeth/islands/")) {
      return renderIslandModuleFromManifest(pathname, await getManifest());
    }

    if (pathname.startsWith("/_elizabeth/global/")) {
      return renderViteTransformedModule(pathname);
    }

    let manifest: PageRouteManifest;
    let apiRoutes: ApiRoute[];

    try {
      manifest = await getManifest();
      apiRoutes = await getApiRoutes();
      assertNoRouteConflicts(manifest.routes.map((route) => ({ path: route.path, methods: ["GET", "HEAD"], sourcePath: route.sourcePath })), apiRoutes);
    } catch (error) {
      return devErrorResponse(error, pathname);
    }

    if (pathname.startsWith("/_elizabeth/css/")) {
      return renderCssModule(pathname, manifest);
    }

    const method = request.method.toUpperCase();
    const apiMatch = matchApiRoute(apiRoutes, pathname);
    if (apiMatch && apiMatch.route.methods.includes(method)) {
      return renderApiRoute(apiMatch, method, request);
    }

    if (apiMatch && !["GET", "HEAD"].includes(method)) {
      return methodNotAllowedResponse(apiMatch.route.methods);
    }

    const match = matchPageRoute(manifest.routes, pathname);

    if (!match) {
      if (!manifest.notFound) {
        return new Response("Not found", {
          status: 404,
          headers: {
            "content-type": "text/plain; charset=utf-8",
          },
        });
      }

      return renderNotFound(manifest.notFound);
    }

    let result: Awaited<ReturnType<typeof renderPageRoute>>;

    try {
      result = await renderPageRoute(match);
    } catch (error) {
      return devErrorResponse(error, pathname);
    }

    if (isRedirectResult(result)) {
      return redirectResponse(result.location, result.status);
    }

    if (isNotFoundResult(result)) {
      return renderNotFound(manifest.notFound);
    }

    return htmlResponse(withCssLinks(
      withDevBootstrap(withGlobalCssBootstrap(result, existsSync(resolve(root, "src/styles.css"))), manifest.clientComponents.length > 0),
      manifest.cssModules.map((module) => module.href),
    ));
  }

  async function renderNotFound(route: Awaited<ReturnType<typeof buildPageRoutes>>["notFound"]): Promise<Response> {
    if (!route) {
      return new Response("Not found", {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    const result = await renderPageRoute({
      route,
      params: {},
    });

    if (isRedirectResult(result)) {
      return redirectResponse(result.location, result.status);
    }

    return htmlResponse(isNotFoundResult(result) ? "" : result, 404);
  }

  async function getManifest(): Promise<PageRouteManifest> {
    const config = await loadElizabethConfig(root);
    cachedManifest ??= await buildPageRoutes({
      root,
      frameworkRoot,
      pageRoots: options.pagesDir ? [{ dir: pagesDir, basePath: "/" }] : config.pageRoutes,
      outDir,
    });

    return cachedManifest;
  }

  async function getApiRoutes(): Promise<ApiRoute[]> {
    const config = await loadElizabethConfig(root);
    cachedApiRoutes ??= await buildApiRoutes({
      root,
      frameworkRoot,
      apiRoots: config.apiRoutes,
      outDir,
    });

    return cachedApiRoutes;
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
    const result = await server.transformRequest(vitePath);

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
    if (!existsSync(resolve(root, "src/styles.css"))) {
      return null;
    }

    viteDevServer ??= createViteDevServer(root);
    return viteDevServer;
  }
}

async function renderApiRoute(match: { route: ApiRoute; params: Record<string, string> }, method: string, request: Request): Promise<Response> {
  const module = await import(`${pathToFileURL(match.route.outputPath).href}?t=${Date.now()}`);
  const handler = module[method];

  if (typeof handler !== "function") {
    return methodNotAllowedResponse(match.route.methods);
  }

  const result = await handler({
    request,
    params: match.params,
    url: new URL(request.url),
    locals: {},
  });

  if (result instanceof Response) {
    return result;
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

function methodNotAllowedResponse(methods: string[]): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: {
      allow: methods.join(", "),
      "content-type": "text/plain; charset=utf-8",
    },
  });
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

function rewriteViteDevModule(code: string): string {
  return code
    .replaceAll("from \"/", "from \"/_elizabeth/global/")
    .replaceAll("import(\"/", "import(\"/_elizabeth/global/");
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

async function renderCssModule(pathname: string, manifest: Awaited<ReturnType<typeof buildPageRoutes>>): Promise<Response> {
  const moduleId = decodeURIComponent(pathname.slice("/_elizabeth/css/".length));
  const isSourceMap = moduleId.endsWith(".map");
  const cssModuleId = isSourceMap ? moduleId.slice(0, -".map".length) : moduleId;
  const cssModule = manifest.cssModules.find((entry) => entry.href.startsWith(`/_elizabeth/css/${encodeURIComponent(cssModuleId)}`));

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
  const port = options.port ?? 3000;
  const fetch = createElizabethDevHandler(options);

  const server = Bun.serve({
    port,
    idleTimeout: 255,
    fetch,
  });

  console.log(`Elizabeth dev server listening on http://localhost:${server.port}`);
  return server;
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

function withGlobalCssBootstrap(html: string, enabled: boolean): string {
  if (!enabled) {
    return html;
  }

  const script = `<script type="module" src="/_elizabeth/global/src/styles.css"></script>`;

  if (html.includes("</head>")) {
    return html.replace("</head>", `${script}</head>`);
  }

  return `${script}${html}`;
}

async function createViteDevServer(root: string): Promise<ViteDevServerLike> {
  const vite = await importVite();

  if (!vite.createServer) {
    throw new Error("Installed Vite version does not expose createServer.");
  }

  return await vite.createServer({
    root,
    configFile: findViteConfig(root) ?? false,
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
  const islandScript = hasIslands ? `
const registry = new Map();
globalThis.__elizabethRegisterIsland = (name, hydrate) => registry.set(name, hydrate);
let manifest = await fetch("/_elizabeth/client-manifest.json").then((response) => response.json());
const islandUrl = (moduleId) => "/_elizabeth/islands/" + encodeURIComponent(moduleId);
await Promise.all(manifest.islands.map((island) => import(islandUrl(island.moduleId))));
for (const island of document.querySelectorAll("el-island[data-elizabeth-client]")) {
  registry.get(island.getAttribute("data-elizabeth-client"))?.(island);
}
` : "";
  const script = `<script type="module">
${islandScript}
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
      if (current) {
        current.setAttribute("href", nextLink.getAttribute("href"));
      } else {
        document.head.append(nextLink.cloneNode(true));
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
  ${hasIslands ? `manifest = await fetch("/_elizabeth/client-manifest.json?t=" + Date.now()).then((response) => response.json());
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
  }` : "location.reload();"}
};
</script>`;

  if (html.includes("</body>")) {
    return html.replace("</body>", `${script}</body>`);
  }

  return `${html}${script}`;
}
