import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ProjectCache } from "./cache";

export async function scanProjectSrc(root: string, cache: ProjectCache) {
  const srcRoot = join(root, "src");

  cache.addDir(srcRoot, null);

  await scanDir(srcRoot, cache);
}

async function scanDir(dirPath: string, cache: ProjectCache) {
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const childPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      cache.addDir(childPath, dirPath);
      await scanDir(childPath, cache);
    } else if (entry.isFile()) {
      cache.addFile(childPath, dirPath);
    }
  }
}
