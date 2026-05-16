import { dirname, join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { ProjectCache } from "./cache";

export function startWatcher(root: string, cache: ProjectCache): FSWatcher {
  const srcRoot = join(root, "src");

  const watcher = chokidar.watch(srcRoot, {
    ignoreInitial: true,
    persistent: true,
  });

  watcher
    .on("add", (path) => {
      cache.addFile(path, dirname(path));
    })
    .on("addDir", (path) => {
      cache.addDir(path, dirname(path));
    })
    .on("change", (path) => {
      cache.markChanged(path);
    })
    .on("unlink", (path) => {
      cache.removePath(path);
    })
    .on("unlinkDir", (path) => {
      cache.removePath(path);
    });

  return watcher;
}
