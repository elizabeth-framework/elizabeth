const truthy = new Set(["1", "true", "yes", "on"]);
const falsy = new Set(["0", "false", "no", "off", ""]);

function source(): Record<string, string | undefined> {
  if (typeof Bun !== "undefined" && Bun.env) {
    return Bun.env as unknown as Record<string, string | undefined>;
  }

  return process.env;
}

export function env(name: string): string | undefined;
export function env(name: string, fallback: string): string;
export function env(name: string, fallback?: string): string | undefined {
  const value = source()[name];
  return value === undefined || value === "" ? fallback : value;
}

export function requireEnv(name: string): string {
  const value = source()[name];

  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function envFlag(name: string, fallback = false): boolean {
  const raw = source()[name];

  if (raw === undefined) {
    return fallback;
  }

  const lower = raw.toLowerCase();

  if (truthy.has(lower)) {
    return true;
  }

  if (falsy.has(lower)) {
    return false;
  }

  return fallback;
}

export function envInt(name: string, fallback?: number): number | undefined {
  const raw = source()[name];

  if (raw === undefined || raw === "") {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return fallback;
  }

  return parsed;
}

export function isDev(): boolean {
  return (source().NODE_ENV ?? "development") !== "production";
}

export function isProduction(): boolean {
  return source().NODE_ENV === "production";
}

export function isTest(): boolean {
  return source().NODE_ENV === "test";
}
