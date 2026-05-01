import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

export interface GlobalCssBuildOptions {
  root: string;
  outDir: string;
  publicPrefix: string;
}

export interface ViteLike {
  build(options: object): Promise<void>;
  createServer?(options: object): Promise<ViteDevServerLike>;
}

export interface ViteDevServerLike {
  transformRequest(url: string): Promise<{ code: string; map?: unknown } | null>;
  close(): Promise<void>;
}

export async function importVite(): Promise<ViteLike> {
  const importModule = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  return await importModule("vite").catch((error) => {
    throw new Error(`Vite is not installed. Install vite first. ${error instanceof Error ? error.message : String(error)}`);
  }) as ViteLike;
}

export async function defaultTailwindPlugins(root: string): Promise<unknown[]> {
  if (findViteConfig(root)) {
    return [];
  }

  const importModule = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  return await importModule("@tailwindcss/vite")
    .then((module) => {
      const plugin = (module as { default?: () => unknown }).default;
      return plugin ? [plugin()] : [];
    })
    .catch(() => []);
}

export async function buildGlobalCssWithVite(options: GlobalCssBuildOptions): Promise<string[]> {
  const root = resolve(options.root);
  const outDir = resolve(options.outDir);
  const cssEntry = resolve(root, "src/styles.css");

  if (!existsSync(cssEntry)) {
    return [];
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const config = findViteConfig(root);
  const vite = await importVite();

  await vite.build({
    root,
    configFile: config ?? false,
    plugins: await defaultTailwindPlugins(root),
    build: {
      outDir,
      emptyOutDir: true,
      manifest: true,
      rollupOptions: {
        input: cssEntry,
      },
    },
  });

  return (await findBuiltCssFiles(resolve(outDir, "assets"), joinPublicPath(options.publicPrefix, "assets")))
    .map((path) => `/${path}`);
}

async function findBuiltCssFiles(dir: string, prefix: string): Promise<string[]> {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    const publicPath = joinPublicPath(prefix, entry.name);

    if (entry.isDirectory()) {
      files.push(...await findBuiltCssFiles(path, publicPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".css")) {
      files.push(publicPath.replaceAll("\\", "/"));
    }
  }

  return files.sort();
}

function joinPublicPath(left: string, right: string): string {
  return `${left.replace(/^\/+|\/+$/g, "")}/${right.replace(/^\/+/, "")}`;
}

export function findViteConfig(root: string): string | undefined {
  return ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"]
    .map((name) => resolve(root, name))
    .find((path) => existsSync(path));
}
