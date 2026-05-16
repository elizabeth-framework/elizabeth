import type { ResponseOptions } from "@elizabeth-js/http";

export type StreamChunk = string | Uint8Array | ArrayBuffer | ArrayBufferView;

export interface SseMessage {
  event?: string;
  data: string | unknown;
  id?: string | number;
  retry?: number;
  comment?: string;
}

export function streamResponse(iterable: AsyncIterable<StreamChunk>, init: ResponseOptions = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of iterable) {
          controller.enqueue(toUint8Array(chunk, encoder));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const headers = new Headers(init.headers);

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/octet-stream");
  }

  return new Response(stream, {
    ...init,
    status: init.status ?? 200,
    headers,
  });
}

export function sse(iterable: AsyncIterable<SseMessage>, init: ResponseOptions = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const message of iterable) {
          controller.enqueue(encoder.encode(formatSseMessage(message)));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const headers = new Headers(init.headers);

  if (!headers.has("content-type")) {
    headers.set("content-type", "text/event-stream");
  }
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "no-cache");
  }
  if (!headers.has("connection")) {
    headers.set("connection", "keep-alive");
  }

  return new Response(stream, {
    ...init,
    status: init.status ?? 200,
    headers,
  });
}

function toUint8Array(chunk: StreamChunk, encoder: TextEncoder): Uint8Array {
  if (typeof chunk === "string") {
    return encoder.encode(chunk);
  }

  if (chunk instanceof Uint8Array) {
    return chunk;
  }

  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk);
  }

  return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

export function formatSseMessage(message: SseMessage): string {
  const lines: string[] = [];

  if (message.comment !== undefined) {
    for (const line of String(message.comment).split(/\r?\n/)) {
      lines.push(`: ${line}`);
    }
  }

  if (message.event !== undefined) {
    lines.push(`event: ${String(message.event)}`);
  }

  if (message.id !== undefined) {
    lines.push(`id: ${String(message.id)}`);
  }

  if (message.retry !== undefined) {
    lines.push(`retry: ${Math.trunc(message.retry)}`);
  }

  const data = typeof message.data === "string" ? message.data : JSON.stringify(message.data);

  for (const line of data.split(/\r?\n/)) {
    lines.push(`data: ${line}`);
  }

  return `${lines.join("\n")}\n\n`;
}
