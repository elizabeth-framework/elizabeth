import { describe, expect, test } from "bun:test";
import { formatSseMessage, sse, streamResponse } from "../src/stream.ts";

async function* gen<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

describe("streamResponse()", () => {
  test("streams string and Uint8Array chunks", async () => {
    const res = streamResponse(gen(["hello", new TextEncoder().encode(" world")]));
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(await res.text()).toBe("hello world");
  });

  test("respects custom headers and status", async () => {
    const res = streamResponse(gen(["x"]), { status: 202, headers: { "x-test": "yes" } });
    expect(res.status).toBe(202);
    expect(res.headers.get("x-test")).toBe("yes");
  });
});

describe("formatSseMessage()", () => {
  test("formats data only", () => {
    expect(formatSseMessage({ data: "hello" })).toBe("data: hello\n\n");
  });

  test("splits multi-line data across data: lines", () => {
    expect(formatSseMessage({ data: "a\nb" })).toBe("data: a\ndata: b\n\n");
  });

  test("serialises non-string data as JSON", () => {
    expect(formatSseMessage({ data: { a: 1 } })).toBe('data: {"a":1}\n\n');
  });

  test("includes event, id, retry and comment", () => {
    const formatted = formatSseMessage({ event: "tick", id: 7, retry: 1500, data: "x", comment: "hi" });
    expect(formatted).toContain(": hi");
    expect(formatted).toContain("event: tick");
    expect(formatted).toContain("id: 7");
    expect(formatted).toContain("retry: 1500");
    expect(formatted).toContain("data: x");
  });
});

describe("sse()", () => {
  test("sets text/event-stream headers and streams formatted events", async () => {
    const res = sse(gen([{ data: "a" }, { event: "b", data: "c" }]));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const body = await res.text();
    expect(body).toContain("data: a\n\n");
    expect(body).toContain("event: b");
    expect(body).toContain("data: c\n\n");
  });
});
