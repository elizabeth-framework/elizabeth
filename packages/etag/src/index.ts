import { createHash } from "node:crypto";

export interface EtagOptions {
  weak?: boolean;
}

export function etag(content: string | Uint8Array | ArrayBuffer, options: EtagOptions = {}): string {
  const buffer = toBuffer(content);
  const hash = createHash("sha1").update(buffer).digest("base64").replace(/=+$/, "");
  const length = buffer.byteLength.toString(16);
  const tag = `"${length}-${hash}"`;
  return options.weak === false ? tag : `W/${tag}`;
}

export function ifNoneMatch(request: Request, etagValue: string): boolean {
  const header = request.headers.get("if-none-match");
  if (!header) {
    return false;
  }

  if (header === "*") {
    return true;
  }

  const normalized = stripWeakPrefix(etagValue);

  return header.split(",").some((entry) => {
    const candidate = stripWeakPrefix(entry.trim());
    return candidate === normalized;
  });
}

export function notModified(etagValue?: string): Response {
  const headers = new Headers();
  if (etagValue) {
    headers.set("etag", etagValue);
  }
  return new Response(null, { status: 304, headers });
}

function stripWeakPrefix(value: string): string {
  return value.startsWith("W/") ? value.slice(2) : value;
}

function toBuffer(content: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof content === "string") {
    return new TextEncoder().encode(content);
  }
  if (content instanceof ArrayBuffer) {
    return new Uint8Array(content);
  }
  return content;
}
