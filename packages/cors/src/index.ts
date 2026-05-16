export type CorsOrigin =
  | "*"
  | string
  | string[]
  | RegExp
  | ((origin: string | null) => boolean | string | null);

export interface CorsOptions {
  origin?: CorsOrigin;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
  allowPrivateNetwork?: boolean;
}

export interface CorsHandler {
  preflight(request: Request): Response | null;
  apply(request: Request, response: Response): Response;
  headers(request: Request): Headers;
  isAllowed(request: Request): boolean;
}

const defaultMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

export function cors(options: CorsOptions = {}): CorsHandler {
  const origin = options.origin ?? "*";
  const methods = (options.methods ?? defaultMethods).map((m) => m.toUpperCase());
  const exposedHeaders = options.exposedHeaders;
  const credentials = options.credentials ?? false;
  const maxAge = options.maxAge;
  const allowPrivateNetwork = options.allowPrivateNetwork ?? false;

  function resolveOrigin(requestOrigin: string | null): string | null {
    if (typeof origin === "function") {
      const result = origin(requestOrigin);
      if (result === true) return requestOrigin;
      if (result === false || result === null) return null;
      return result;
    }
    if (origin === "*") {
      return "*";
    }
    if (origin instanceof RegExp) {
      return requestOrigin && origin.test(requestOrigin) ? requestOrigin : null;
    }
    if (Array.isArray(origin)) {
      return requestOrigin && origin.includes(requestOrigin) ? requestOrigin : null;
    }
    if (typeof origin === "string") {
      return origin === requestOrigin ? requestOrigin : origin;
    }
    return null;
  }

  function buildHeaders(request: Request): Headers {
    const headers = new Headers();
    const requestOrigin = request.headers.get("origin");
    const allowed = resolveOrigin(requestOrigin);

    if (allowed === null) {
      return headers;
    }

    headers.set("access-control-allow-origin", allowed);

    if (allowed !== "*" || credentials) {
      headers.append("vary", "Origin");
    }

    if (credentials) {
      headers.set("access-control-allow-credentials", "true");
    }

    if (exposedHeaders && exposedHeaders.length > 0) {
      headers.set("access-control-expose-headers", exposedHeaders.join(", "));
    }

    return headers;
  }

  function preflight(request: Request): Response | null {
    if (request.method !== "OPTIONS") {
      return null;
    }

    if (!request.headers.has("access-control-request-method")) {
      return null;
    }

    const headers = buildHeaders(request);

    if (!headers.has("access-control-allow-origin")) {
      return new Response(null, { status: 403 });
    }

    headers.set("access-control-allow-methods", methods.join(", "));

    const requestedHeaders = options.allowedHeaders
      ? options.allowedHeaders.join(", ")
      : request.headers.get("access-control-request-headers");

    if (requestedHeaders) {
      headers.set("access-control-allow-headers", requestedHeaders);
      if (!options.allowedHeaders) {
        headers.append("vary", "Access-Control-Request-Headers");
      }
    }

    if (maxAge !== undefined) {
      headers.set("access-control-max-age", String(maxAge));
    }

    if (allowPrivateNetwork && request.headers.get("access-control-request-private-network") === "true") {
      headers.set("access-control-allow-private-network", "true");
    }

    return new Response(null, { status: 204, headers });
  }

  function apply(request: Request, response: Response): Response {
    const headers = buildHeaders(request);
    for (const [key, value] of headers.entries()) {
      if (key === "vary") {
        response.headers.append("vary", value);
      } else {
        response.headers.set(key, value);
      }
    }
    return response;
  }

  function isAllowed(request: Request): boolean {
    const requestOrigin = request.headers.get("origin");
    return resolveOrigin(requestOrigin) !== null;
  }

  return { preflight, apply, headers: buildHeaders, isAllowed };
}
