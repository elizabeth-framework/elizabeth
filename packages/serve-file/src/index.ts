import { stat as fsStat } from "node:fs/promises";
import { extname } from "node:path";
import { ifNoneMatch, notModified } from "@elizabeth-js/etag";

interface FileStatInfo {
  isFile(): boolean;
  size: number;
  mtime: Date;
}

const mimeTypes: Record<string, string> = {
  ".aac": "audio/aac",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
  ".zip": "application/zip",
};

export interface ServeFileOptions {
  contentType?: string;
  cacheControl?: string;
  etag?: boolean;
  lastModified?: boolean;
  headers?: HeadersInit;
}

export async function serveFile(path: string, request: Request, options: ServeFileOptions = {}): Promise<Response> {
  let info: FileStatInfo;
  try {
    info = (await fsStat(path)) as unknown as FileStatInfo;
  } catch {
    return new Response("Not Found", { status: 404 });
  }

  if (!info.isFile()) {
    return new Response("Not Found", { status: 404 });
  }

  const contentType = options.contentType ?? mimeTypeFor(path);
  const headers = new Headers(options.headers);
  headers.set("content-type", contentType);

  if (options.cacheControl) {
    headers.set("cache-control", options.cacheControl);
  }

  const mtime = info.mtime;
  const size = info.size;

  if (options.lastModified !== false) {
    headers.set("last-modified", mtime.toUTCString());
    const ifModifiedSince = request.headers.get("if-modified-since");
    if (ifModifiedSince) {
      const since = Date.parse(ifModifiedSince);
      if (!Number.isNaN(since) && Math.floor(mtime.getTime() / 1000) <= Math.floor(since / 1000)) {
        return new Response(null, { status: 304, headers });
      }
    }
  }

  if (options.etag !== false) {
    const tag = `W/"${size.toString(16)}-${Math.floor(mtime.getTime()).toString(16)}"`;
    headers.set("etag", tag);
    if (ifNoneMatch(request, tag)) {
      return notModified(tag);
    }
  }

  if (request.method === "HEAD") {
    headers.set("content-length", String(size));
    headers.set("accept-ranges", "bytes");
    return new Response(null, { status: 200, headers });
  }

  const file = Bun.file(path) as unknown as Blob;
  const range = request.headers.get("range");

  if (range) {
    const parsed = parseSingleRange(range, size);
    if (parsed === "invalid") {
      headers.set("content-range", `bytes */${size}`);
      return new Response("Range Not Satisfiable", { status: 416, headers });
    }
    if (parsed !== null) {
      const { start, end } = parsed;
      const length = end - start + 1;
      headers.set("content-range", `bytes ${start}-${end}/${size}`);
      headers.set("content-length", String(length));
      headers.set("accept-ranges", "bytes");
      const slice = file.slice(start, end + 1, contentType);
      return new Response(slice, { status: 206, headers });
    }
  }

  headers.set("accept-ranges", "bytes");
  headers.set("content-length", String(size));
  return new Response(file, { status: 200, headers });
}

type ParsedRange = { start: number; end: number };

function parseSingleRange(header: string, totalSize: number): ParsedRange | null | "invalid" {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) {
    return null;
  }

  const startRaw = match[1];
  const endRaw = match[2];

  if (startRaw === "" && endRaw === "") {
    return "invalid";
  }

  let start: number;
  let end: number;

  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === "" ? totalSize - 1 : Number(endRaw);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= totalSize || start > end) {
    return "invalid";
  }

  return { start, end };
}

export function mimeTypeFor(path: string): string {
  return mimeTypes[extname(path).toLowerCase()] ?? "application/octet-stream";
}
