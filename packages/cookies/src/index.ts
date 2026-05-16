export interface CookieOptions {
  domain?: string;
  path?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None" | "strict" | "lax" | "none";
  partitioned?: boolean;
  encode?: (value: string) => string;
}

const cookieNameRegex = /^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/;

export function parseCookies(input: Request | Headers | string): Record<string, string> {
  const header = typeof input === "string"
    ? input
    : input instanceof Headers
      ? input.get("cookie") ?? ""
      : input.headers.get("cookie") ?? "";

  if (!header) {
    return {};
  }

  const result: Record<string, string> = {};

  for (const segment of header.split(";")) {
    const trimmed = segment.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const eq = trimmed.indexOf("=");
    const name = eq === -1 ? trimmed : trimmed.slice(0, eq).trim();

    if (name.length === 0 || name in result) {
      continue;
    }

    let value = eq === -1 ? "" : trimmed.slice(eq + 1).trim();

    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    try {
      result[name] = decodeURIComponent(value);
    } catch {
      result[name] = value;
    }
  }

  return result;
}

export function getCookie(input: Request | Headers | string, name: string): string | null {
  return parseCookies(input)[name] ?? null;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (!cookieNameRegex.test(name)) {
    throw new TypeError(`Invalid cookie name: ${JSON.stringify(name)}`);
  }

  const encode = options.encode ?? encodeURIComponent;
  const parts = [`${name}=${encode(value)}`];

  if (options.maxAge !== undefined) {
    if (!Number.isFinite(options.maxAge) || !Number.isInteger(options.maxAge)) {
      throw new TypeError("Cookie maxAge must be an integer number of seconds");
    }
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  if (options.path) {
    parts.push(`Path=${options.path}`);
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  if (options.partitioned) {
    parts.push("Partitioned");
  }

  if (options.sameSite) {
    const normalized = options.sameSite[0].toUpperCase() + options.sameSite.slice(1).toLowerCase();
    parts.push(`SameSite=${normalized}`);
  }

  return parts.join("; ");
}

export function setCookie(response: Response, name: string, value: string, options: CookieOptions = {}): Response {
  response.headers.append("set-cookie", serializeCookie(name, value, options));
  return response;
}

export function deleteCookie(response: Response, name: string, options: CookieOptions = {}): Response {
  return setCookie(response, name, "", {
    ...options,
    expires: new Date(0),
    maxAge: 0,
  });
}
