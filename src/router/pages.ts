import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { compileElizabethFile, createCompileGraphContext, type ClientManifestEntry, type CompileGraphContext, type CssModuleEntry } from "../compiler/file.ts";
import type { RouteRoot } from "../config.ts";
import type { ProjectCache } from "../compiler/cache.ts";


export interface PageRoute {
  path: string;
  pattern: RegExp;
  paramNames: string[];
  sourcePath: string;
  outputPath: string;
  layouts: PageLayout[];
}

export interface PageLayout {
  sourcePath: string;
  outputPath: string;
}

export interface PageRouteMatch {
  route: PageRoute;
  params: Record<string, string>;
}

export interface PageRouteManifest {
  routes: PageRoute[];
  notFound: PageRoute | null;
  clientComponents: ClientManifestEntry[];
  cssModules: CssModuleEntry[];
}

export interface BuildPageRoutesOptions {
  root: string;
  frameworkRoot?: string;
  pagesDir?: string;
  pageRoots?: RouteRoot[];
  outDir: string;
  cache?: ProjectCache;
  context?: CompileGraphContext;
}

export async function buildPageRoutes(options: BuildPageRoutesOptions): Promise<PageRouteManifest> {
  const pageRoots = options.pageRoots ?? [{ dir: resolve(options.pagesDir!), basePath: "/" }];
  const context = options.context ?? createCompileGraphContext();
  const routes: PageRoute[] = [];
  let notFound: PageRoute | null = null;

  for (const pageRoot of pageRoots) {
    const files = options.cache
      ? findLizFilesFromCache(options.cache, pageRoot.dir)
      : await findLizFiles(pageRoot.dir);

    if (files.length === 0) {
      continue;
    }

    const layoutFiles = new Set(files.filter(isLayoutFile));
    const notFoundPath = findNotFoundFile(files);
    const pageFiles = files.filter((file) => !isLayoutFile(file) && !isNotFoundFile(file));

    for (const sourcePath of pageFiles) {
      const { outputPath } = await compileElizabethFile(sourcePath, {
        root: options.root,
        frameworkRoot: options.frameworkRoot,
        outDir: options.outDir,
        context,
      });
      const layouts = await layoutFilesFor(sourcePath, pageRoot.dir, layoutFiles, options, context);

      const path = routePathFor(sourcePath, pageRoot.dir, pageRoot.basePath);
      const matcher = routeMatcherFor(path);

      routes.push({
        path,
        pattern: matcher.pattern,
        paramNames: matcher.paramNames,
        sourcePath,
        outputPath,
        layouts,
      });
    }

    if (!notFound && notFoundPath) {
      notFound = await buildRoute(notFoundPath, pageRoot.dir, layoutFiles, pageRoot.basePath, options, context);
    }
  }

  return {
    routes: routes.sort(compareRoutes),
    notFound,
    clientComponents: [...context.clientComponents.values()].sort((left, right) => left.moduleId.localeCompare(right.moduleId) || left.name.localeCompare(right.name)),
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

    const path = routePathFor(sourcePath, pagesDir, basePath);
    const matcher = routeMatcherFor(path);

    return {
      path,
      pattern: matcher.pattern,
      paramNames: matcher.paramNames,
      sourcePath,
      outputPath,
      layouts,
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

async function findLizFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = resolve(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await findLizFiles(path));
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

function findNotFoundFile(files: string[]): string | null {
  return files.find(isNotFoundFile) ?? null;
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
  const pattern = path.split("/").map((segment) => {
    const match = /^\[([A-Za-z_$][\w$]*)\]$/.exec(segment);

    if (match) {
      paramNames.push(match[1]);
      return "([^/]+)";
    }

    return escapeRegExp(segment);
  }).join("/");

  return {
    pattern: new RegExp(`^${pattern}$`),
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function joinRoutePath(basePath: string, childPath: string): string {
  const joined = `${basePath}/${childPath}`.replace(/\/+/g, "/").replace(/\/$/, "");
  return joined === "" ? "/" : joined;
}
