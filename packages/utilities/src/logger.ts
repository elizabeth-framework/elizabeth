import { env, envFlag, isProduction } from "./env.ts";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(namespace: string): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  output?: Pick<Console, "debug" | "info" | "warn" | "error">;
  timestamp?: boolean;
}

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

function defaultLevel(): LogLevel {
  const explicit = env("ELIZABETH_LOG");

  if (explicit && (explicit in levelOrder)) {
    return explicit as LogLevel;
  }

  if (envFlag("ELIZABETH_DEBUG")) {
    return "debug";
  }

  return isProduction() ? "info" : "debug";
}

export function createLogger(namespace: string, options: LoggerOptions = {}): Logger {
  const level = options.level ?? defaultLevel();
  const output = options.output ?? console;
  const useTimestamp = options.timestamp ?? false;
  const threshold = levelOrder[level];

  function format(args: unknown[]): unknown[] {
    const prefix = useTimestamp
      ? `[${new Date().toISOString()}] [${namespace}]`
      : `[${namespace}]`;
    return [prefix, ...args];
  }

  return {
    debug(...args: unknown[]): void {
      if (threshold <= levelOrder.debug) {
        output.debug(...format(args));
      }
    },
    info(...args: unknown[]): void {
      if (threshold <= levelOrder.info) {
        output.info(...format(args));
      }
    },
    warn(...args: unknown[]): void {
      if (threshold <= levelOrder.warn) {
        output.warn(...format(args));
      }
    },
    error(...args: unknown[]): void {
      if (threshold <= levelOrder.error) {
        output.error(...format(args));
      }
    },
    child(child: string): Logger {
      return createLogger(`${namespace}:${child}`, { ...options, level });
    },
  };
}
