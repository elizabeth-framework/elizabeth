import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mimeTypeFor, serveFile } from "../src/index.ts";

const tmpDir = join(import.meta.dir, ".tmp-serve-file");
const textPath = join(tmpDir, "hello.txt");
const binaryPath = join(tmpDir, "bytes.bin");
const binaryContent = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

beforeAll(async () => {
  await mkdir(tmpDir, { recursive: true });
  await writeFile(textPath, "hello world");
  await writeFile(binaryPath, binaryContent as unknown as string);
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("serveFile()", () => {
  test("returns 404 for missing files", async () => {
    const res = await serveFile(join(tmpDir, "nope.txt"), new Request("http://x/"));
    expect(res.status).toBe(404);
  });

  test("serves text with correct content-type and length", async () => {
    const res = await serveFile(textPath, new Request("http://x/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("content-length")).toBe("11");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(await res.text()).toBe("hello world");
  });

  test("HEAD returns headers without body", async () => {
    const res = await serveFile(textPath, new Request("http://x/", { method: "HEAD" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("11");
    expect(await res.text()).toBe("");
  });

  test("etag triggers 304 on matching If-None-Match", async () => {
    const first = await serveFile(textPath, new Request("http://x/"));
    const tag = first.headers.get("etag")!;
    expect(tag).toBeTruthy();
    const second = await serveFile(textPath, new Request("http://x/", { headers: { "if-none-match": tag } }));
    expect(second.status).toBe(304);
  });

  test("Range request returns 206 with the requested slice", async () => {
    const res = await serveFile(binaryPath, new Request("http://x/", { headers: { range: "bytes=2-5" } }));
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(res.headers.get("content-length")).toBe("4");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual([2, 3, 4, 5]);
  });

  test("suffix Range returns the last N bytes", async () => {
    const res = await serveFile(binaryPath, new Request("http://x/", { headers: { range: "bytes=-3" } }));
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 7-9/10");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual([7, 8, 9]);
  });

  test("invalid Range returns 416 with content-range", async () => {
    const res = await serveFile(binaryPath, new Request("http://x/", { headers: { range: "bytes=99-200" } }));
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */10");
  });

  test("cacheControl option is forwarded", async () => {
    const res = await serveFile(textPath, new Request("http://x/"), { cacheControl: "public, max-age=60" });
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
  });
});

describe("mimeTypeFor()", () => {
  test("maps known extensions", () => {
    expect(mimeTypeFor("/x/y.png")).toBe("image/png");
    expect(mimeTypeFor("a.JS")).toBe("application/javascript; charset=utf-8");
    expect(mimeTypeFor("a.woff2")).toBe("font/woff2");
  });

  test("falls back to octet-stream", () => {
    expect(mimeTypeFor("a.weirdext")).toBe("application/octet-stream");
    expect(mimeTypeFor("no-ext")).toBe("application/octet-stream");
  });
});
