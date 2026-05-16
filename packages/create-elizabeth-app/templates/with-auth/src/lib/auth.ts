import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 16) {
    throw new Error(
      "SESSION_SECRET environment variable is missing or too short (need >=16 chars). Copy .env.example to .env and set one.",
    );
  }

  return secret;
}

export interface SessionData {
  userId: string;
  username: string;
}

export function readSession(request: Request): SessionData | null {
  const cookie = request.headers.get("cookie");

  if (!cookie) {
    return null;
  }

  const match = new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`).exec(cookie);

  if (!match) {
    return null;
  }

  const raw = decodeURIComponent(match[1]);
  const [payload, signature] = raw.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expected = sign(payload);

  if (!safeCompare(signature, expected)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as SessionData;
    return decoded;
  } catch {
    return null;
  }
}

export function createSessionCookie(data: SessionData): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const signature = sign(payload);
  const value = `${payload}.${signature}`;

  return [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE}`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64);
  return `${salt.toString("base64url")}.${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [saltB64, derivedB64] = hash.split(".");

  if (!saltB64 || !derivedB64) {
    return false;
  }

  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(derivedB64, "base64url");
  const actual = await scryptAsync(password, salt, expected.length);

  return safeCompareBuffers(actual, expected);
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

function safeCompareBuffers(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

function scryptAsync(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, (error, derived) => {
      if (error) {
        reject(error);
      } else {
        resolve(derived);
      }
    });
  });
}
