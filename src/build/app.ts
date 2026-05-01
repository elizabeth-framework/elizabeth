import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { buildGlobalCssWithVite, defaultTailwindPlugins, findViteConfig, importVite } from "../css/global.ts";
import { loadElizabethConfig } from "../config.ts";
import { isNotFoundResult, isRedirectResult } from "../route.ts";
import { buildApiRoutes, type ApiRoute } from "../router/api.ts";
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
    pageRoots: options.pagesDir ? [{ dir: pagesDir, basePath: "/" }] : config.pageRoutes,
    outDir,
  });
  const apiRoutes = await buildApiRoutes({
    root,
    frameworkRoot,
    apiRoots: config.apiRoutes,
    outDir,
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
    islands: manifest.clientComponents.map((component) => ({
      name: component.name,
      moduleId: component.moduleId,
      url: clientAssets.get(component.moduleId) ?? islandPublicPath(component.moduleId),
    })),
  });
  await writeServerEntry(distDir, manifest, apiRoutes, {
    globalCssHrefs,
    cssModuleHrefs: manifest.cssModules.map((module) => module.href),
    hasIslands: manifest.clientComponents.length > 0,
  });

  for (const route of manifest.routes) {
    if (route.paramNames.length > 0) {
      continue;
    }

    const result = await renderPageRoute({
      route,
      params: {},
    });

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
    configFile: findViteConfig(root) ?? false,
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
  options: { globalCssHrefs: string[]; cssModuleHrefs: string[]; hasIslands: boolean },
): Promise<void> {
  const serverRoutes = manifest.routes.map((route) => serializeServerRoute(route, distDir));
  const serverApiRoutes = apiRoutes.map((route) => serializeServerApiRoute(route, distDir));
  const notFound = manifest.notFound ? serializeServerRoute(manifest.notFound, distDir) : null;
  const code = `#!/usr/bin/env bun
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = dirname(fileURLToPath(import.meta.url));
const routes = ${JSON.stringify(serverRoutes, null, 2)};
const apiRoutes = ${JSON.stringify(serverApiRoutes, null, 2)};
const notFoundRoute = ${JSON.stringify(notFound, null, 2)};
const cssHrefs = ${JSON.stringify([...options.globalCssHrefs, ...options.cssModuleHrefs])};
const hasIslands = ${JSON.stringify(options.hasIslands)};
const redirectMarker = Symbol.for("elizabeth.redirect");
const notFoundMarker = Symbol.for("elizabeth.notFound");

const port = Number(Bun.env.PORT ?? 3000);

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/_elizabeth/")) {
      return serveStatic(url.pathname);
    }

    const apiMatch = matchRoute(apiRoutes, url.pathname);
    if (apiMatch && apiMatch.route.methods.includes(request.method.toUpperCase())) {
      return renderApiRoute(apiMatch, request);
    }

    if (apiMatch && !["GET", "HEAD"].includes(request.method.toUpperCase())) {
      return methodNotAllowedResponse(apiMatch.route.methods);
    }

    const match = matchRoute(routes, url.pathname);
    if (!match) {
      return renderNotFound();
    }

    return renderMatchedRoute(match, 200);
  },
});

console.log(\`Elizabeth production server listening on http://localhost:\${port}\`);

async function renderMatchedRoute(match, status) {
  const result = await renderRoute(match);

  if (isRedirectResult(result)) {
    return new Response(null, {
      status: result.status,
      headers: { location: result.location },
    });
  }

  if (isNotFoundResult(result)) {
    return renderNotFound();
  }

  return htmlResponse(withBuildBootstrap(withCssLinks(result, cssHrefs), hasIslands), status);
}

async function renderApiRoute(match, request) {
  const module = await import(new URL(match.route.module, import.meta.url).href);
  const method = request.method.toUpperCase();
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
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return Response.json(result);
}

function methodNotAllowedResponse(methods) {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: {
      allow: methods.join(", "),
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

async function renderNotFound() {
  if (!notFoundRoute) {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const result = await renderRoute({ route: notFoundRoute, params: {} });
  if (isRedirectResult(result)) {
    return new Response(null, {
      status: result.status,
      headers: { location: result.location },
    });
  }

  return htmlResponse(isNotFoundResult(result) ? "" : withBuildBootstrap(withCssLinks(result, cssHrefs), hasIslands), 404);
}

async function renderRoute(match) {
  const ctx = { params: match.params };
  const page = await import(new URL(match.route.module, import.meta.url).href);
  let html = await page.default({}, ctx);

  if (isRedirectResult(html) || isNotFoundResult(html)) {
    return html;
  }

  for (let index = match.route.layouts.length - 1; index >= 0; index--) {
    const layout = match.route.layouts[index];
    const module = await import(new URL(layout.module, import.meta.url).href);
    html = await module.default({ children: html }, ctx);

    if (isRedirectResult(html) || isNotFoundResult(html)) {
      return html;
    }
  }

  return dedupeElizabethStyles(html);
}

function matchRoute(routes, pathname) {
  for (const route of routes) {
    const match = new RegExp(route.pattern).exec(pathname);
    if (!match) continue;

    const params = {};
    for (const [index, name] of route.paramNames.entries()) {
      params[name] = decodeURIComponent(match[index + 1]);
    }

    return { route, params };
  }

  return null;
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
  if (hrefs.length === 0) {
    return html;
  }

  const links = [...new Set(hrefs)].map((href) => \`<link rel="stylesheet" href="\${href}" />\`).join("");

  if (html.includes("</head>")) {
    return html.replace("</head>", \`\${links}</head>\`);
  }

  return \`\${links}\${html}\`;
}

function withBuildBootstrap(html, enabled) {
  if (!enabled) {
    return html;
  }

  const script = \`<script type="module">
const registry = new Map();
globalThis.__elizabethRegisterIsland = (name, hydrate) => registry.set(name, hydrate);
const manifest = await fetch("/_elizabeth/client-manifest.json").then((response) => response.json());
await Promise.all(manifest.islands.map((island) => import(island.url)));
for (const island of document.querySelectorAll("el-island[data-elizabeth-client]")) {
  registry.get(island.getAttribute("data-elizabeth-client"))?.(island);
}
</script>\`;

  if (html.includes("</body>")) {
    return html.replace("</body>", \`\${script}</body>\`);
  }

  return \`\${html}\${script}\`;
}

function dedupeElizabethStyles(html) {
  const seen = new Set();

  return html.replace(/<style\\b([^>]*\\sdata-elizabeth-style=(["'])(.*?)\\2[^>]*)>[\\s\\S]*?<\\/style>/g, (style, _attrs, _quote, id) => {
    if (seen.has(id)) {
      return "";
    }

    seen.add(id);
    return style;
  });
}

function isRedirectResult(value) {
  return Boolean(value && typeof value === "object" && value[redirectMarker] === true);
}

function isNotFoundResult(value) {
  return Boolean(value && typeof value === "object" && value[notFoundMarker] === true);
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
    module: toServerImportPath(route.outputPath, distDir),
    layouts: route.layouts.map((layout) => ({
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
    module: toServerImportPath(route.outputPath, distDir),
  };
}

function toServerImportPath(path: string, distDir: string): string {
  const normalized = relative(distDir, path).replaceAll("\\", "/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
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
  if (!hasIslands) {
    return html;
  }

  const script = `<script type="module">
const registry = new Map();
globalThis.__elizabethRegisterIsland = (name, hydrate) => registry.set(name, hydrate);
const manifest = await fetch("/_elizabeth/client-manifest.json").then((response) => response.json());
await Promise.all(manifest.islands.map((island) => import(island.url)));
for (const island of document.querySelectorAll("el-island[data-elizabeth-client]")) {
  registry.get(island.getAttribute("data-elizabeth-client"))?.(island);
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
