export type HeaderInit = HeadersInit | undefined;

export interface ResponseOptions extends Omit<ResponseInit, "status" | "headers"> {
  status?: number;
  headers?: HeaderInit;
}

export function json<T>(data: T, init: ResponseOptions = {}): Response {
  const headers = mergeHeaders(init.headers, {
    "content-type": "application/json; charset=utf-8",
  });

  return new Response(JSON.stringify(data), {
    ...init,
    status: init.status ?? 200,
    headers,
  });
}

export function text(body: string, init: ResponseOptions = {}): Response {
  const headers = mergeHeaders(init.headers, {
    "content-type": "text/plain; charset=utf-8",
  });

  return new Response(body, {
    ...init,
    status: init.status ?? 200,
    headers,
  });
}

export function html(body: string, init: ResponseOptions = {}): Response {
  const headers = mergeHeaders(init.headers, {
    "content-type": "text/html; charset=utf-8",
  });

  return new Response(body, {
    ...init,
    status: init.status ?? 200,
    headers,
  });
}

export function noContent(init: ResponseOptions = {}): Response {
  return new Response(null, {
    ...init,
    status: 204,
    headers: mergeHeaders(init.headers, {}),
  });
}

export function created(location: string, body?: unknown, init: ResponseOptions = {}): Response {
  const headers = mergeHeaders(init.headers, {
    location,
  });

  if (body === undefined) {
    return new Response(null, {
      ...init,
      status: 201,
      headers,
    });
  }

  if (typeof body === "string") {
    return new Response(body, {
      ...init,
      status: 201,
      headers: mergeHeaders(headers, {
        "content-type": "text/plain; charset=utf-8",
      }),
    });
  }

  return new Response(JSON.stringify(body), {
    ...init,
    status: 201,
    headers: mergeHeaders(headers, {
      "content-type": "application/json; charset=utf-8",
    }),
  });
}

export function error(status: number, message?: string, init: ResponseOptions = {}): Response {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new RangeError(`error() status must be a 4xx or 5xx integer (got ${status})`);
  }

  const body = message ?? defaultStatusText(status);
  return text(body, {
    ...init,
    status,
  });
}

export function badRequest(message?: string, init: ResponseOptions = {}): Response {
  return error(400, message, init);
}

export function unauthorized(message?: string, init: ResponseOptions = {}): Response {
  return error(401, message, init);
}

export function forbidden(message?: string, init: ResponseOptions = {}): Response {
  return error(403, message, init);
}

export function notFoundResponse(message?: string, init: ResponseOptions = {}): Response {
  return error(404, message, init);
}

export function conflict(message?: string, init: ResponseOptions = {}): Response {
  return error(409, message, init);
}

export function unprocessable(message?: string, init: ResponseOptions = {}): Response {
  return error(422, message, init);
}

export function internalServerError(message?: string, init: ResponseOptions = {}): Response {
  return error(500, message, init);
}

export function methodNotAllowed(allowed: string[], init: ResponseOptions = {}): Response {
  const normalized = allowed.map((method) => method.toUpperCase());
  const headers = mergeHeaders(init.headers, {
    allow: normalized.join(", "),
  });

  return text(defaultStatusText(405), {
    ...init,
    status: 405,
    headers,
  });
}

function mergeHeaders(base: HeaderInit, extra: Record<string, string>): Headers {
  const headers = new Headers(base);

  for (const [key, value] of Object.entries(extra)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  return headers;
}

function defaultStatusText(status: number): string {
  switch (status) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 405:
      return "Method Not Allowed";
    case 409:
      return "Conflict";
    case 422:
      return "Unprocessable Entity";
    case 429:
      return "Too Many Requests";
    case 500:
      return "Internal Server Error";
    case 502:
      return "Bad Gateway";
    case 503:
      return "Service Unavailable";
    case 504:
      return "Gateway Timeout";
    default:
      return `HTTP ${status}`;
  }
}
