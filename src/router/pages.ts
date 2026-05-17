import { readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { ProjectCache } from "../compiler/cache.ts";
import {
  type ClientManifestEntry,
  type CompileGraphContext,
  type CssModuleEntry,
  compileMiddlewareFile,
  compileElizabethFile,
  createCompileGraphContext,
} from "../compiler/file.ts";
import type { RouteRoot } from "../config.ts";
import type { MiddlewareReference } from "./middleware.ts";

type BuildRouteRoot = RouteRoot | { dir: string; basePath: string };

export interface PageRoute {
  path: string;
  pattern: RegExp;
  paramNames: string[];
  sourcePath: string;
  outputPath: string;
  layouts: PageLayout[];
  middleware: MiddlewareReference[];
}

export interface PageSpecialRoute extends PageRoute {
  special: "notFound" | "error" | "loading";
  prefix: string;
  depth: number;
}

export interface PageLayout {
  sourcePath: string;
  outputPath: string;
}

export interface PageRouteMatch {
  route: PageRoute;
  params: Record<string, string>;
  error?: unknown;
}

export interface PageRouteManifest {
  routes: PageRoute[];
  notFound: PageRoute | null;
  error: PageSpecialRoute | null;
  loading: PageSpecialRoute | null;
  notFoundRoutes: PageSpecialRoute[];
  errorRoutes: PageSpecialRoute[];
  loadingRoutes: PageSpecialRoute[];
  clientComponents: ClientManifestEntry[];
  cssModules: CssModuleEntry[];
}

export interface BuildPageRoutesOptions {
  root: string;
  frameworkRoot?: string;
  pagesDir?: string;
  pageRoots?: BuildRouteRoot[];
  outDir: string;
  cache?: ProjectCache;
  context?: CompileGraphContext;
}

export async function buildPageRoutes(options: BuildPageRoutesOptions): Promise<PageRouteManifest> {
  const pageRoots = (options.pageRoots ?? [{ dir: resolve(options.pagesDir!), basePath: "/" }]).map(
    normalizeBuildRouteRoot,
  );
  const context = options.context ?? createCompileGraphContext();
  const routes: PageRoute[] = [];
  const notFoundRoutes: PageSpecialRoute[] = [];
  const errorRoutes: PageSpecialRoute[] = [];
  const loadingRoutes: PageSpecialRoute[] = [];

  for (const pageRoot of pageRoots) {
    const files = options.cache ? findLizFilesFromCache(options.cache, pageRoot.dir) : await findLizFiles(pageRoot.dir);

    if (files.length === 0) {
      continue;
    }

    const layoutFiles = new Set(files.filter(isLayoutFile));
    const pageFiles = files.filter((file) => !isLayoutFile(file) && !isSpecialFile(file));
    const specialFiles = files.filter(isSpecialFile);

    for (const sourcePath of pageFiles) {
      const { outputPath } = await compileElizabethFile(sourcePath, {
        root: options.root,
        frameworkRoot: options.frameworkRoot,
        outDir: options.outDir,
        context,
      });
      const layouts = await layoutFilesFor(sourcePath, pageRoot.dir, layoutFiles, options, context);
      const middleware = await middlewareFor(sourcePath, pageRoot, options, context);

      const path = routePathFor(sourcePath, pageRoot.dir, pageRoot.basePath);
      const matcher = routeMatcherFor(path);

      routes.push({
        path,
        pattern: matcher.pattern,
        paramNames: matcher.paramNames,
        sourcePath,
        outputPath,
        layouts,
        middleware,
      });
    }

    for (const sourcePath of specialFiles) {
      const special = specialKindForFile(sourcePath);

      if (!special) {
        continue;
      }

      const route = await buildSpecialRoute(
        sourcePath,
        pageRoot,
        layoutFiles,
        special,
        options,
        context,
      );

      if (special === "notFound") {
        notFoundRoutes.push(route);
      } else if (special === "error") {
        errorRoutes.push(route);
      } else {
        loadingRoutes.push(route);
      }
    }
  }

  notFoundRoutes.sort(compareSpecialRoutes);
  errorRoutes.sort(compareSpecialRoutes);
  loadingRoutes.sort(compareSpecialRoutes);

  return {
    routes: routes.sort(compareRoutes),
    notFound: fallbackSpecialRoute(notFoundRoutes),
    error: fallbackSpecialRoute(errorRoutes),
    loading: fallbackSpecialRoute(loadingRoutes),
    notFoundRoutes,
    errorRoutes,
    loadingRoutes,
    clientComponents: [...context.clientComponents.values()].sort(
      (left, right) => left.moduleId.localeCompare(right.moduleId) || left.name.localeCompare(right.name),
    ),
    cssModules: [...context.cssModules.values()].sort((left, right) => left.href.localeCompare(right.href)),
  };

  async function buildRoute(
    sourcePath: string,
    pagesDir: string,
    layoutFiles: Set<string>,
    basePath: string,
    options: BuildPageRoutesOptions,
    context: CompileGraphContext,
  ): Promise<PageRoute> {
    const { outputPath } = await compileElizabethFile(sourcePath, {
      root: options.root,
      frameworkRoot: options.frameworkRoot,
      outDir: options.outDir,
      context,
    });
    const layouts = await layoutFilesFor(sourcePath, pagesDir, layoutFiles, options, context);
    const middleware = await middlewareFor(sourcePath, { dir: pagesDir, basePath, middleware: [], middlewareStart: 0 }, options, context);

    const path = routePathFor(sourcePath, pagesDir, basePath);
    const matcher = routeMatcherFor(path);

    return {
      path,
      pattern: matcher.pattern,
      paramNames: matcher.paramNames,
      sourcePath,
      outputPath,
      layouts,
      middleware,
    };
  }

  async function buildSpecialRoute(
    sourcePath: string,
    pageRoot: RouteRoot,
    layoutFiles: Set<string>,
    special: PageSpecialRoute["special"],
    options: BuildPageRoutesOptions,
    context: CompileGraphContext,
  ): Promise<PageSpecialRoute> {
    const { outputPath } = await compileElizabethFile(sourcePath, {
      root: options.root,
      frameworkRoot: options.frameworkRoot,
      outDir: options.outDir,
      context,
    });
    const layouts = await layoutFilesFor(sourcePath, pageRoot.dir, layoutFiles, options, context);
    const middleware = await middlewareFor(sourcePath, pageRoot, options, context);
    const prefix = specialRoutePrefixFor(sourcePath, pageRoot.dir, pageRoot.basePath);
    const matcher = specialRouteMatcherFor(prefix);

    return {
      path: prefix,
      pattern: matcher.pattern,
      paramNames: matcher.paramNames,
      sourcePath,
      outputPath,
      layouts,
      middleware,
      special,
      prefix,
      depth: routeDepth(prefix),
    };
  }
}

export function matchPageRoute(routes: PageRoute[], pathname: string): PageRouteMatch | null {
  for (const route of routes) {
    const match = route.pattern.exec(pathname);

    if (!match) {
      continue;
    }

    const params: Record<string, string> = {};

    for (const [index, name] of route.paramNames.entries()) {
      params[name] = decodeURIComponent(match[index + 1]);
    }

    return { route, params };
  }

  return null;
}

export function matchSpecialPageRoute(routes: PageSpecialRoute[], pathname: string): PageRouteMatch | null {
  for (const route of routes) {
    const match = route.pattern.exec(pathname);

    if (!match) {
      continue;
    }

    const params: Record<string, string> = {};

    for (const [index, name] of route.paramNames.entries()) {
      params[name] = decodeURIComponent(match[index + 1]);
    }

    return { route, params };
  }

  return null;
}

async function layoutFilesFor(
  pagePath: string,
  pagesDir: string,
  layoutFiles: Set<string>,
  options: BuildPageRoutesOptions,
  context: CompileGraphContext,
): Promise<PageLayout[]> {
  const pageRelative = relative(pagesDir, pagePath).replaceAll("\\", "/");
  const pageSegments = pageRelative.split("/");
  const layouts: PageLayout[] = [];

  for (let depth = 0; depth < pageSegments.length; depth++) {
    const layoutPath = resolve(pagesDir, ...pageSegments.slice(0, depth), "layout.liz");

    if (!layoutFiles.has(layoutPath)) {
      continue;
    }

    const { outputPath } = await compileElizabethFile(layoutPath, {
      root: options.root,
      frameworkRoot: options.frameworkRoot,
      outDir: options.outDir,
      context,
    });

    layouts.push({
      sourcePath: layoutPath,
      outputPath,
    });
  }

  return layouts;
}

async function middlewareFor(
  sourcePath: string,
  routeRoot: RouteRoot,
  options: BuildPageRoutesOptions,
  context: CompileGraphContext,
): Promise<MiddlewareReference[]> {
  const references: MiddlewareReference[] = routeRoot.middleware.map((_entry, index) => ({
    kind: "config",
    index: routeRoot.middlewareStart + index,
  }));
  const files = await middlewareFilesFor(sourcePath, routeRoot.dir, options.cache);

  for (const file of files) {
    const { outputPath } = await compileMiddlewareFile(file, {
      root: options.root,
      frameworkRoot: options.frameworkRoot,
      outDir: options.outDir,
      context,
    });

    references.push({
      kind: "module",
      sourcePath: file,
      outputPath,
    });
  }

  return references;
}

async function middlewareFilesFor(
  sourcePath: string,
  rootDir: string,
  cache?: ProjectCache,
): Promise<string[]> {
  const routeDir = dirname(sourcePath);
  const relativeDir = relative(rootDir, routeDir).replaceAll("\\", "/");
  const segments = relativeDir === "" ? [] : relativeDir.split("/");
  const files: string[] = [];

  for (let depth = 0; depth <= segments.length; depth++) {
    const dir = resolve(rootDir, ...segments.slice(0, depth));
    const file = await existingMiddlewareFile(dir, cache);

    if (file) {
      files.push(file);
    }
  }

  return files;
}

async function existingMiddlewareFile(dir: string, cache?: ProjectCache): Promise<string | null> {
  for (const name of ["middleware.ts", "middleware.js"]) {
    const path = resolve(dir, name);

    if (cache) {
      const meta = cache.get(path);
      if (meta?.isFile) {
        return path;
      }
      continue;
    }

    try {
      if ((await stat(path)).isFile()) {
        return path;
      }
    } catch {
      // Continue checking the next middleware filename.
    }
  }

  return null;
}

function normalizeBuildRouteRoot(root: BuildRouteRoot): RouteRoot {
  return {
    ...root,
    middleware: "middleware" in root ? root.middleware : [],
    middlewareStart: "middlewareStart" in root ? root.middlewareStart : 0,
  };
}

async function findLizFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = resolve(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findLizFiles(path)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".liz")) {
      files.push(path);
    }
  }

  return files;
}

function findLizFilesFromCache(cache: ProjectCache, dir: string): string[] {
  const root = cache.get(dir);

  if (!root?.isDir) {
    return [];
  }

  const files: string[] = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const meta = cache.get(current);

    if (!meta?.isDir) {
      continue;
    }

    for (const file of meta.files) {
      if (file.endsWith(".liz")) {
        files.push(file);
      }
    }

    for (const childDir of meta.dirs) {
      stack.push(childDir);
    }
  }

  return files;
}

function isLayoutFile(path: string): boolean {
  return path.replaceAll("\\", "/").endsWith("/layout.liz");
}

function isNotFoundFile(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized.endsWith("/404.liz");
}

function isErrorFile(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized.endsWith("/error.liz");
}

function isLoadingFile(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized.endsWith("/loading.liz");
}

function isSpecialFile(path: string): boolean {
  return isNotFoundFile(path) || isErrorFile(path) || isLoadingFile(path);
}

function specialKindForFile(path: string): PageSpecialRoute["special"] | null {
  if (isNotFoundFile(path)) {
    return "notFound";
  }

  if (isErrorFile(path)) {
    return "error";
  }

  if (isLoadingFile(path)) {
    return "loading";
  }

  return null;
}

function routePathFor(filePath: string, pagesDir: string, basePath: string): string {
  const withoutExtension = relative(pagesDir, filePath)
    .replaceAll("\\", "/")
    .replace(/\.liz$/, "");

  const segments = withoutExtension.split("/").filter((segment) => segment !== "index");
  return joinRoutePath(basePath, segments.join("/"));
}

function routeMatcherFor(path: string): { pattern: RegExp; paramNames: string[] } {
  if (path === "/") {
    return { pattern: /^\/$/, paramNames: [] };
  }

  const paramNames: string[] = [];
  const pattern = path
    .split("/")
    .map((segment) => {
      const match = /^\[([A-Za-z_$][\w$]*)\]$/.exec(segment);

      if (match) {
        paramNames.push(match[1]);
        return "([^/]+)";
      }

      return escapeRegExp(segment);
    })
    .join("/");

  return {
    pattern: new RegExp(`^${pattern}$`),
    paramNames,
  };
}

function specialRoutePrefixFor(filePath: string, pagesDir: string, basePath: string): string {
  const relativePath = relative(pagesDir, filePath).replaceAll("\\", "/");
  const segments = relativePath.split("/").slice(0, -1);
  return joinRoutePath(basePath, segments.join("/"));
}

function specialRouteMatcherFor(prefix: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];

  if (prefix === "/") {
    return { pattern: /^\/(?:.*)?$/, paramNames };
  }

  const pattern = prefix
    .split("/")
    .map((segment) => {
      const match = /^\[([A-Za-z_$][\w$]*)\]$/.exec(segment);

      if (match) {
        paramNames.push(match[1]);
        return "([^/]+)";
      }

      return escapeRegExp(segment);
    })
    .join("/");

  return {
    pattern: new RegExp(`^${pattern}(?:/.*)?$`),
    paramNames,
  };
}

function compareRoutes(left: PageRoute, right: PageRoute): number {
  const leftDynamic = left.paramNames.length;
  const rightDynamic = right.paramNames.length;

  if (leftDynamic !== rightDynamic) {
    return leftDynamic - rightDynamic;
  }

  return left.path.localeCompare(right.path);
}

function compareSpecialRoutes(left: PageSpecialRoute, right: PageSpecialRoute): number {
  if (left.depth !== right.depth) {
    return right.depth - left.depth;
  }

  const leftDynamic = left.paramNames.length;
  const rightDynamic = right.paramNames.length;

  if (leftDynamic !== rightDynamic) {
    return leftDynamic - rightDynamic;
  }

  return left.path.localeCompare(right.path);
}

function routeDepth(path: string): number {
  return path === "/" ? 0 : path.split("/").filter(Boolean).length;
}

function fallbackSpecialRoute(routes: PageSpecialRoute[]): PageSpecialRoute | null {
  return routes.find((route) => route.path === "/") ?? routes[0] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function joinRoutePath(basePath: string, childPath: string): string {
  const joined = `${basePath}/${childPath}`.replace(/\/+/g, "/").replace(/\/$/, "");
  return joined === "" ? "/" : joined;
}
