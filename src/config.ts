import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stat } from "node:fs/promises";

export interface RouteRoot {
  dir: string;
  basePath: string;
}

export interface ElizabethConfig {
  pageRoutes: RouteRoot[];
  apiRoutes: RouteRoot[];
}

type RouteConfigValue = string | string[] | Record<string, string> | undefined;

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

  const userConfig = mtime === null
    ? {}
    : (await import(`${pathToFileURL(configPath).href}?t=${mtime}`)).default ?? {};

  const pageRoutes = normalizeRouteRoots(normalizedRoot, userConfig.pageRoutes, { "src/pages": "/" });
  const apiRoutes = normalizeRouteRoots(normalizedRoot, userConfig.apiRoutes, { "src/api": "/api" });

  warnRouteRootDuplicates("pageRoutes", pageRoutes);
  warnRouteRootDuplicates("apiRoutes", apiRoutes);

  const result = {
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

function normalizeRouteRoots(root: string, value: RouteConfigValue, fallback: Record<string, string>): RouteRoot[] {
  const entries = routeEntries(value ?? fallback);

  return entries.map(([dir, basePath]) => ({
    dir: resolve(root, dir),
    basePath: normalizeBasePath(basePath),
  }));
}

function routeEntries(value: RouteConfigValue): Array<[string, string]> {
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
