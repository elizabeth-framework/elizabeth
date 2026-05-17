import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ElizabethMiddleware } from "./router/middleware.ts";

export interface RouteRoot {
  dir: string;
  basePath: string;
  middleware: ElizabethMiddleware[];
  middlewareStart: number;
}

export interface ElizabethConfig {
  middleware: ElizabethMiddleware[];
  globalMiddlewareCount: number;
  pageRoutes: RouteRoot[];
  apiRoutes: RouteRoot[];
}

interface RouteRootObjectConfig {
  basePath?: string;
  middleware?: ElizabethMiddleware[];
}

type RouteConfigEntry = string | RouteRootObjectConfig;
type RouteConfigValue = string | string[] | Record<string, RouteConfigEntry> | undefined;

interface CachedConfig {
  mtime: number | null;
  result: ElizabethConfig;
}

const configCache = new Map<string, CachedConfig>();

export async function loadElizabethConfig(root: string): Promise<ElizabethConfig> {
  const normalizedRoot = resolve(root);
  const configPath = join(normalizedRoot, "elizabeth.config.ts");
  const mtime = await configMtime(configPath);
  const cached = configCache.get(normalizedRoot);

  if (cached && cached.mtime === mtime) {
    return cached.result;
  }

  const userConfig =
    mtime === null ? {} : ((await import(`${pathToFileURL(configPath).href}?t=${mtime}`)).default ?? {});

  const globalMiddleware = normalizeMiddleware(userConfig.middleware);
  const pageRoutes = normalizeRouteRoots(normalizedRoot, userConfig.pageRoutes, { "src/pages": "/" }, globalMiddleware);
  const apiRoutes = normalizeRouteRoots(normalizedRoot, userConfig.apiRoutes, { "src/api": "/api" }, [
    ...globalMiddleware,
    ...pageRoutes.flatMap((route) => route.middleware),
  ]);

  warnRouteRootDuplicates("pageRoutes", pageRoutes);
  warnRouteRootDuplicates("apiRoutes", apiRoutes);

  const result = {
    middleware: [
      ...globalMiddleware,
      ...pageRoutes.flatMap((route) => route.middleware),
      ...apiRoutes.flatMap((route) => route.middleware),
    ],
    globalMiddlewareCount: globalMiddleware.length,
    pageRoutes,
    apiRoutes,
  };

  configCache.set(normalizedRoot, { mtime, result });
  return result;
}

async function configMtime(configPath: string): Promise<number | null> {
  try {
    return (await stat(configPath)).mtimeMs;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function normalizeRouteRoots(
  root: string,
  value: RouteConfigValue,
  fallback: Record<string, string>,
  previousMiddleware: ElizabethMiddleware[],
): RouteRoot[] {
  const entries = routeEntries(value ?? fallback);
  let middlewareOffset = previousMiddleware.length;

  return entries.map(([dir, config]) => {
    const middleware = typeof config === "string" ? [] : normalizeMiddleware(config.middleware);
    const routeRoot = {
      dir: resolve(root, dir),
      basePath: normalizeBasePath(typeof config === "string" ? config : config.basePath ?? "/"),
      middleware,
      middlewareStart: middlewareOffset,
    };

    middlewareOffset += middleware.length;
    return routeRoot;
  });
}

function routeEntries(value: RouteConfigValue): Array<[string, RouteConfigEntry]> {
  if (!value) {
    return [];
  }

  if (typeof value === "string") {
    return [[value, "/"]];
  }

  if (Array.isArray(value)) {
    return value.map((entry) => [entry, "/"]);
  }

  return Object.entries(value);
}

function normalizeMiddleware(value: unknown): ElizabethMiddleware[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("Elizabeth config middleware must be an array.");
  }

  for (const entry of value) {
    if (typeof entry !== "function") {
      throw new Error("Elizabeth config middleware entries must be functions.");
    }
  }

  return value as ElizabethMiddleware[];
}

function normalizeBasePath(basePath: string): string {
  const normalized = `/${basePath}`.replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized === "" ? "/" : normalized;
}

function warnRouteRootDuplicates(name: "pageRoutes" | "apiRoutes", roots: RouteRoot[]): void {
  warnDuplicateRouteRootField(name, roots, "basePath", (root) => root.basePath);
  warnDuplicateRouteRootField(name, roots, "dir", (root) => root.dir);
}

function warnDuplicateRouteRootField(
  name: "pageRoutes" | "apiRoutes",
  roots: RouteRoot[],
  field: "basePath" | "dir",
  select: (root: RouteRoot) => string,
): void {
  const seen = new Map<string, RouteRoot>();

  for (const root of roots) {
    const value = select(root);
    const previous = seen.get(value);

    if (!previous) {
      seen.set(value, root);
      continue;
    }

    console.warn(
      `Elizabeth config warning: duplicate ${name} ${field} ${JSON.stringify(value)}.\n` +
        `  first:  ${formatRouteRoot(previous)}\n` +
        `  second: ${formatRouteRoot(root)}\n` +
        "  Route roots should map one directory to one unique base path; duplicate routes can shadow each other.",
    );
  }
}

function formatRouteRoot(root: RouteRoot): string {
  return `${root.dir} -> ${root.basePath}`;
}
