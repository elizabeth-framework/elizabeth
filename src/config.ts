import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface RouteRoot {
  dir: string;
  basePath: string;
}

export interface ElizabethConfig {
  pageRoutes: RouteRoot[];
  apiRoutes: RouteRoot[];
}

type RouteConfigValue = string | string[] | Record<string, string> | undefined;

export async function loadElizabethConfig(root: string): Promise<ElizabethConfig> {
  const configPath = findConfigPath(root);
  const userConfig = configPath
    ? (await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`)).default
    : {};

  return {
    pageRoutes: normalizeRouteRoots(root, userConfig.pageRoutes, { "src/pages": "/" }),
    apiRoutes: normalizeRouteRoots(root, userConfig.apiRoutes, { "src/api": "/api" }),
  };
}

function findConfigPath(root: string): string | null {
  for (const name of ["elizabeth.config.ts", "elizabeth.config.js", "elizabeth.config.mjs"]) {
    const path = resolve(root, name);
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
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
