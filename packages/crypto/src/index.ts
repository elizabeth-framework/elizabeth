import { createHmac, randomBytes, scrypt, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

export interface ScryptOptions {
  N?: number;
  r?: number;
  p?: number;
  keyLength?: number;
}

const DEFAULT_SCRYPT: Required<Omit<ScryptOptions, never>> = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 64,
};

const SCRYPT_PREFIX = "scrypt";

export async function hashPassword(password: string, options: ScryptOptions = {}): Promise<string> {
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("hashPassword: password must be a non-empty string");
  }

  const config = { ...DEFAULT_SCRYPT, ...options };
  const salt = randomBytes(16);
  const derived = await deriveScrypt(password, salt, config);

  return [
    SCRYPT_PREFIX,
    config.N,
    config.r,
    config.p,
    base64UrlEncode(salt),
    base64UrlEncode(derived),
  ].join("$");
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0) {
    return false;
  }
  if (typeof hash !== "string" || hash.length === 0) {
    return false;
  }

  const parts = hash.split("$");
  if (parts.length !== 6 || parts[0] !== SCRYPT_PREFIX) {
    return false;
  }

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = base64UrlDecode(parts[4]);
  const expected = base64UrlDecode(parts[5]);

  if (
    !Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) ||
    !salt || !expected || expected.byteLength === 0
  ) {
    return false;
  }

  try {
    const derived = await deriveScrypt(password, salt, {
      N,
      r,
      p,
      keyLength: expected.byteLength,
    });
    return derived.byteLength === expected.byteLength && nodeTimingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function randomToken(bytes: number = 32): string {
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new RangeError("randomToken: bytes must be a positive integer");
  }

  return base64UrlEncode(randomBytes(bytes));
}

export function signValue(value: string, secret: string): string {
  if (typeof value !== "string") {
    throw new TypeError("signValue: value must be a string");
  }
  if (typeof secret !== "string" || secret.length === 0) {
    throw new TypeError("signValue: secret must be a non-empty string");
  }

  const signature = createHmac("sha256", secret).update(value).digest();
  return `${value}.${base64UrlEncode(signature)}`;
}

export function unsignValue(signed: string, secret: string): string | null {
  if (typeof signed !== "string" || typeof secret !== "string" || secret.length === 0) {
    return null;
  }

  const dot = signed.lastIndexOf(".");
  if (dot <= 0 || dot === signed.length - 1) {
    return null;
  }

  const value = signed.slice(0, dot);
  const provided = base64UrlDecode(signed.slice(dot + 1));
  if (!provided) {
    return null;
  }

  const expected = createHmac("sha256", secret).update(value).digest();
  if (provided.byteLength !== expected.byteLength) {
    return null;
  }

  if (!nodeTimingSafeEqual(provided, expected)) {
    return null;
  }

  return value;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);

  if (aBytes.byteLength !== bBytes.byteLength) {
    return false;
  }

  return nodeTimingSafeEqual(aBytes, bBytes);
}

export function hmac(value: string, secret: string, algorithm: "sha256" | "sha384" | "sha512" = "sha256"): string {
  return base64UrlEncode(createHmac(algorithm, secret).update(value).digest());
}

function deriveScrypt(
  password: string,
  salt: Buffer | Uint8Array,
  options: Required<ScryptOptions>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      options.keyLength,
      { N: options.N, r: options.r, p: options.p },
      (err, derived) => {
        if (err) {
          reject(err);
        } else {
          resolve(derived);
        }
      },
    );
  });
}

function base64UrlEncode(bytes: Buffer | Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlDecode(str: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+=*$/.test(str)) {
    return null;
  }
  try {
    return Buffer.from(str, "base64url");
  } catch {
    return null;
  }
}
