import { mkdir, readdir, rm, stat } from "node:fs/promises";
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

const viteConfigCache = new Map<string, Promise<string | undefined>>();

export async function importVite(): Promise<ViteLike> {
  const importModule = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  return (await importModule("vite").catch((error) => {
    throw new Error(
      `Vite is not installed. Install vite first. ${error instanceof Error ? error.message : String(error)}`,
    );
  })) as ViteLike;
}

export async function defaultTailwindPlugins(root: string): Promise<unknown[]> {
  if (await findViteConfig(root)) {
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

  if (!(await isFile(cssEntry))) {
    return [];
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const config = await findViteConfig(root);
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

  return (await findBuiltCssFiles(resolve(outDir, "assets"), joinPublicPath(options.publicPrefix, "assets"))).map(
    (path) => `/${path}`,
  );
}

async function findBuiltCssFiles(dir: string, prefix: string): Promise<string[]> {
  if (!(await isDir(dir))) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    const publicPath = joinPublicPath(prefix, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findBuiltCssFiles(path, publicPath)));
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

export async function findViteConfig(root: string): Promise<string | undefined> {
  const normalizedRoot = resolve(root);
  let cached = viteConfigCache.get(normalizedRoot);

  if (!cached) {
    cached = findViteConfigUncached(normalizedRoot);
    viteConfigCache.set(normalizedRoot, cached);
  }

  return await cached;
}

export function clearViteConfigCache(root?: string): void {
  if (root) {
    viteConfigCache.delete(resolve(root));
    return;
  }

  viteConfigCache.clear();
}

async function findViteConfigUncached(root: string): Promise<string | undefined> {
  for (const name of ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"]) {
    const path = resolve(root, name);

    if (await isFile(path)) {
      return path;
    }
  }

  return undefined;
}

async function isFile(path: string): Promise<boolean> {
  return await stat(path)
    .then((info) => info.isFile())
    .catch(() => false);
}

async function isDir(path: string): Promise<boolean> {
  return await stat(path)
    .then((info) => info.isDirectory())
    .catch(() => false);
}
