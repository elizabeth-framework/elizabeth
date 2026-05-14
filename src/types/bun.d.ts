interface BunFile {
  text(): Promise<string>;
}

interface BunServerOptions {
  port: number;
  idleTimeout?: number;
  fetch(request: Request): Response | Promise<Response>;
}

interface BunServer {
  readonly port: number;
}

declare const Bun: {
  nanoseconds(): unknown;
  sleep(ms: number): Promise<void>;
  readonly argv: string[];
  readonly env: Record<string, string | undefined>;
  file(path: string): BunFile;
  escapeHTML(value: string): string;
  serve(options: BunServerOptions): BunServer;
};

interface ImportMeta {
  readonly dir: string;
}

declare function setInterval(callback: () => void | Promise<void>, ms: number): unknown;

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  export function copyFile(source: string, destination: string): Promise<void>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function readdir(path: string): Promise<string[]>;
  export function readdir(path: string, options: { withFileTypes: true }): Promise<Array<{
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }>>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  export function stat(path: string): Promise<{
    mtimeMs: number;
    isDirectory(): boolean;
    isFile(): boolean;
  }>;
  export function symlink(target: string, path: string, type?: string): Promise<void>;
  export function unlink(path: string): Promise<void>;
  export function writeFile(path: string, data: string): Promise<void>;
}

declare module "node:path" {
  export function basename(path: string): string;
  export function dirname(path: string): string;
  export function relative(from: string, to: string): string;
  export function resolve(...paths: string[]): string;
}

declare module "node:url" {
  export function pathToFileURL(path: string): URL;
}
