import { signValue, unsignValue } from "@elizabeth-js/crypto";
import { getCookie, serializeCookie, type CookieOptions } from "@elizabeth-js/cookies";

export interface SessionStoreOptions {
  secret: string;
  cookieName?: string;
  maxAge?: number;
  cookieOptions?: Omit<CookieOptions, "maxAge" | "expires">;
}

export interface SessionStore<T> {
  read(input: Request | Headers | string): T | null;
  write(response: Response, data: T): Response;
  destroy(response: Response): Response;
  serialize(data: T): string;
  parse(signed: string): T | null;
}

export function createSessionStore<T = Record<string, unknown>>(options: SessionStoreOptions): SessionStore<T> {
  if (!options.secret || options.secret.length < 16) {
    throw new TypeError("createSessionStore: secret must be at least 16 characters");
  }

  const cookieName = options.cookieName ?? "session";
  const maxAge = options.maxAge ?? 60 * 60 * 24 * 7;
  const baseCookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    ...options.cookieOptions,
    maxAge,
  };

  function parse(signed: string): T | null {
    const raw = unsignValue(signed, options.secret);
    if (raw === null) {
      return null;
    }

    try {
      return JSON.parse(decodeURIComponent(raw)) as T;
    } catch {
      return null;
    }
  }

  function serialize(data: T): string {
    const encoded = encodeURIComponent(JSON.stringify(data));
    return signValue(encoded, options.secret);
  }

  function read(input: Request | Headers | string): T | null {
    const raw = getCookie(input, cookieName);
    if (raw === null) {
      return null;
    }
    return parse(raw);
  }

  function write(response: Response, data: T): Response {
    response.headers.append(
      "set-cookie",
      serializeCookie(cookieName, serialize(data), baseCookieOptions),
    );
    return response;
  }

  function destroy(response: Response): Response {
    response.headers.append(
      "set-cookie",
      serializeCookie(cookieName, "", {
        ...baseCookieOptions,
        maxAge: 0,
        expires: new Date(0),
      }),
    );
    return response;
  }

  return { read, write, destroy, serialize, parse };
}
