import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
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
  onChange(callback: () => void): void;
  start(): void;
}

type HmrClient = ReadableStreamDefaultController<Uint8Array>;

const encoder = new TextEncoder();

export function createHmrRuntime(options: HmrOptions): HmrRuntime {
  const clients = new Set<HmrClient>();
  const snapshots = new Map<string, number>();
  const changeCallbacks = new Set<() => void>();
  const root = resolve(options.root);
  const watchDirs = [...new Set(options.watchDirs.map((dir) => resolve(dir)))];
  let started = false;

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
      void scan();
      const timer = setInterval(scan, 350);
      (timer as { unref?: () => void }).unref?.();
    },
  };

  async function scan(): Promise<void> {
    const files = (await Promise.all(watchDirs.map(listWatchFiles))).flat();
    const seen = new Set(files);

    for (const path of files) {
      const info = await stat(path);
      const previous = snapshots.get(path);
      snapshots.set(path, info.mtimeMs);

      if (previous !== undefined && previous !== info.mtimeMs) {
        broadcast(messageFor(path));
      }
    }

    for (const path of snapshots.keys()) {
      if (!seen.has(path)) {
        snapshots.delete(path);
        broadcast(messageFor(path));
      }
    }
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

  function broadcast(message: HmrMessage): void {
    for (const callback of changeCallbacks) {
      callback();
    }

    for (const client of clients) {
      try {
        send(client, message);
      } catch {
        clients.delete(client);
      }
    }
  }
}

async function listWatchFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = resolve(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".elizabeth") {
        continue;
      }

      files.push(...await listWatchFiles(path));
      continue;
    }

    if (entry.isFile() && isWatchFile(path)) {
      files.push(path);
    }
  }

  return files;
}

function isWatchFile(path: string): boolean {
  return path.endsWith(".liz") || path.endsWith(".ts") || path.endsWith(".css");
}

function send(client: HmrClient, message: HmrMessage): void {
  client.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
}
