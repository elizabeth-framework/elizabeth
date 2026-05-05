import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stat } from "node:fs/promises";
import { join } from "node:path";

export interface RouteRoot {
  dir: string;
  basePath: string;
}

export interface ElizabethConfig {
  pageRoutes: RouteRoot[];
  apiRoutes: RouteRoot[];
}

type RouteConfigValue = string | string[] | Record<string, string> | undefined;

let cachedResult: ElizabethConfig | null = null;
let cachedMtime = 0;

export async function loadElizabethConfig(root: string): Promise<ElizabethConfig> {
  const configPath = join(root, "elizabeth.config.ts");
  const s = await stat(configPath);
  const mtime = s.mtimeMs;

  if (cachedResult && cachedMtime === mtime) {
    return cachedResult;
  }

  const userConfig = (
    await import(`${pathToFileURL(configPath).href}?t=${mtime}`)
  ).default;

  cachedMtime = mtime;
  cachedResult = {
    pageRoutes: normalizeRouteRoots(root, userConfig.pageRoutes, { "src/pages": "/" }),
    apiRoutes: normalizeRouteRoots(root, userConfig.apiRoutes, { "src/api": "/api" }),
  };

  return cachedResult;
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
