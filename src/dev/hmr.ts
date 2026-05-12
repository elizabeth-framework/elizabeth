import chokidar, { type FSWatcher } from "chokidar";
import { relative, resolve } from "node:path";

export type HmrMessage =
  | { type: "connected" }
  | { type: "css"; moduleId: string; path: string }
  | { type: "reload"; path: string }
  | { type: "island"; moduleId: string; path: string };

export interface HmrOptions {
  root: string;
  frameworkRoot: string;
  watchDirs: string[];
}

export interface HmrRuntime {
  handle(request: Request): Response;
  onChange(callback: (event: HmrChangeEvent) => void): void;
  start(): void;
  close(): Promise<void>;
}

type HmrClient = ReadableStreamDefaultController<Uint8Array>;
export type HmrChangeType = "add" | "addDir" | "change" | "unlink" | "unlinkDir";
export type HmrChangeEvent = {
  type: HmrChangeType;
  path: string;
  message: HmrMessage | null;
};

const encoder = new TextEncoder();

export function createHmrRuntime(options: HmrOptions): HmrRuntime {
  const clients = new Set<HmrClient>();
  const changeCallbacks = new Set<(event: HmrChangeEvent) => void>();
  const root = resolve(options.root);
  const watchDirs = [...new Set(options.watchDirs.map((dir) => resolve(dir)))];
  const pendingChanges = new Map<string, ReturnType<typeof setTimeout>>();
  let started = false;
  let watcher: FSWatcher | null = null;

  return {
    handle() {
      let current: HmrClient | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          current = controller;
          clients.add(controller);
          send(controller, { type: "connected" });
        },
        cancel() {
          if (current) {
            clients.delete(current);
          }
        },
      });

      return new Response(stream, {
        headers: {
          "cache-control": "no-cache",
          "content-type": "text/event-stream; charset=utf-8",
          connection: "keep-alive",
        },
      });
    },

    onChange(callback) {
      changeCallbacks.add(callback);
    },

    start() {
      if (started) {
        return;
      }

      started = true;
      watcher = chokidar.watch(watchDirs, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 50,
          pollInterval: 10,
        },
        ignored(path, stats) {
          const normalized = path.replaceAll("\\", "/");

          if (
            normalized.includes("/node_modules/") ||
            normalized.includes("/.elizabeth/") ||
            normalized.includes("/.git/") ||
            normalized.includes("/dist/") ||
            normalized.includes("/build/")
          ) {
            return true;
          }

          return stats?.isFile() === true && !isWatchFile(path);
        },
      });

      watcher
        .on("add", (path) => handleChange("add", path))
        .on("addDir", (path) => handleChange("addDir", path))
        .on("change", (path) => handleChange("change", path))
        .on("unlink", (path) => handleChange("unlink", path))
        .on("unlinkDir", (path) => handleChange("unlinkDir", path));
    },

    async close() {
      await watcher?.close();
      for (const timer of pendingChanges.values()) {
        clearTimeout(timer);
      }
      pendingChanges.clear();
      watcher = null;
      started = false;
    },
  };

  function handleChange(type: HmrChangeType, path: string): void {
    const key = resolve(path);
    const previous = pendingChanges.get(key);

    if (previous) {
      clearTimeout(previous);
    }

    pendingChanges.set(key, setTimeout(() => {
      pendingChanges.delete(key);
      const message = type === "addDir" || type === "unlinkDir" ? null : messageFor(path);
      broadcast({ type, path, message });
    }, 35));
  }

  function messageFor(path: string): HmrMessage {
    const normalized = path.replaceAll("\\", "/");

    if (normalized.endsWith(".liz") && normalized.includes("/src/components/")) {
      return {
        type: "island",
        moduleId: relative(root, path).replaceAll("\\", "/"),
        path: normalized,
      };
    }

    if (normalized.endsWith(".css")) {
      return {
        type: "css",
        moduleId: relative(root, path).replaceAll("\\", "/"),
        path: normalized,
      };
    }

    return {
      type: "reload",
      path: normalized,
    };
  }

  function broadcast(event: HmrChangeEvent): void {
    for (const callback of changeCallbacks) {
      callback(event);
    }

    if (!event.message) {
      return;
    }

    for (const client of clients) {
      try {
        send(client, event.message);
      } catch {
        clients.delete(client);
      }
    }
  }
}

function isWatchFile(path: string): boolean {
  return path.endsWith(".liz") || path.endsWith(".ts") || path.endsWith(".css");
}

function send(client: HmrClient, message: HmrMessage): void {
  client.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
}
