import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { ProjectCache } from "../compiler/cache.ts";
import { type CompileGraphContext, compileElizabethEndpointFile, createCompileGraphContext } from "../compiler/file.ts";
import type { RouteRoot } from "../config.ts";

export interface ApiRoute {
  path: string;
  pattern: RegExp;
  paramNames: string[];
  sourcePath: string;
  outputPath: string | null;
  methods: string[];
  error: string | null;
}

export interface ApiRouteMatch {
  route: ApiRoute;
  params: Record<string, string>;
}

export interface BuildApiRoutesOptions {
  root: string;
  frameworkRoot?: string;
  apiRoots: RouteRoot[];
  outDir: string;
  cache?: ProjectCache;
  context?: CompileGraphContext;
  onError?: (route: { path: string; sourcePath: string }, error: unknown) => void;
}

export function describeApiRouteBuildError(route: { path: string; sourcePath: string }, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `API route failed to build ${route.path} (${route.sourcePath}): ${reason}`;
}

export async function buildApiRoutes(options: BuildApiRoutesOptions): Promise<ApiRoute[]> {
  const routes: ApiRoute[] = [];
  const context = options.context ?? createCompileGraphContext();

  for (const apiRoot of options.apiRoots) {
    const sourcePaths = options.cache
      ? findApiFilesFromCache(options.cache, apiRoot.dir)
      : await findApiFiles(apiRoot.dir);

    if (sourcePaths.length === 0) {
      continue;
    }

    for (const sourcePath of sourcePaths) {
      const path = routePathFor(sourcePath, apiRoot.dir, apiRoot.basePath);
      try {
        const { outputPath, methods } = await compileElizabethEndpointFile(sourcePath, {
          root: options.root,
          frameworkRoot: options.frameworkRoot,
          outDir: options.outDir,
          context,
        });
        const matcher = routeMatcherFor(path);

        routes.push({
          path,
          pattern: matcher.pattern,
          paramNames: matcher.paramNames,
          sourcePath,
          outputPath,
          methods,
          error: null,
        });
      } catch (error) {
        const matcher = routeMatcherFor(path);
        options.onError?.({ path, sourcePath }, error);
        routes.push({
          path,
          pattern: matcher.pattern,
          paramNames: matcher.paramNames,
          sourcePath,
          outputPath: null,
          methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return routes.sort(compareApiRoutes);
}

export function matchApiRoute(routes: ApiRoute[], pathname: string): ApiRouteMatch | null {
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

async function findApiFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = resolve(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findApiFiles(path)));
      continue;
    }

    if (entry.isFile() && /\.(?:liz|ts|js)$/.test(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

function findApiFilesFromCache(cache: ProjectCache, dir: string): string[] {
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
      if (/\.(?:liz|ts|js)$/.test(file)) {
        files.push(file);
      }
    }

    for (const childDir of meta.dirs) {
      stack.push(childDir);
    }
  }

  return files;
}

function routePathFor(filePath: string, rootDir: string, basePath: string): string {
  const withoutExtension = relative(rootDir, filePath)
    .replaceAll("\\", "/")
    .replace(/\.(?:liz|ts|js)$/, "");
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

function compareApiRoutes(left: ApiRoute, right: ApiRoute): number {
  const leftDynamic = left.paramNames.length;
  const rightDynamic = right.paramNames.length;

  if (leftDynamic !== rightDynamic) {
    return leftDynamic - rightDynamic;
  }

  return left.path.localeCompare(right.path);
}

function joinRoutePath(basePath: string, childPath: string): string {
  const joined = `${basePath}/${childPath}`.replace(/\/+/g, "/").replace(/\/$/, "");
  return joined === "" ? "/" : joined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
