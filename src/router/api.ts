import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { compileElizabethEndpointFile, createCompileGraphContext, type CompileGraphContext } from "../compiler/file.ts";
import type { RouteRoot } from "../config.ts";

export interface ApiRoute {
  path: string;
  pattern: RegExp;
  paramNames: string[];
  sourcePath: string;
  outputPath: string;
  methods: string[];
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
  context?: CompileGraphContext;
}

export async function buildApiRoutes(options: BuildApiRoutesOptions): Promise<ApiRoute[]> {
  const routes: ApiRoute[] = [];
  const context = options.context ?? createCompileGraphContext();

  for (const apiRoot of options.apiRoots) {
    if (!existsSync(apiRoot.dir)) {
      continue;
    }

    for (const sourcePath of await findApiFiles(apiRoot.dir)) {
      const { outputPath, methods } = await compileElizabethEndpointFile(sourcePath, {
        root: options.root,
        frameworkRoot: options.frameworkRoot,
        outDir: options.outDir,
        context,
      });
      const path = routePathFor(sourcePath, apiRoot.dir, apiRoot.basePath);
      const matcher = routeMatcherFor(path);

      routes.push({
        path,
        pattern: matcher.pattern,
        paramNames: matcher.paramNames,
        sourcePath,
        outputPath,
        methods,
      });
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
      files.push(...await findApiFiles(path));
      continue;
    }

    if (entry.isFile() && /\.(?:liz|ts|js)$/.test(entry.name)) {
      files.push(path);
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
