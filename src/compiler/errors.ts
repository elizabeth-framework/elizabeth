/**
 * Compile-time error helpers. The goal is to keep the existing
 * `file:line:col: message` shape on `error.message` (used by the dev
 * server HTML error page) while also exposing a richer terminal-friendly
 * code-frame representation via `formatCompileError()`.
 */

export interface CompileSourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface CodeFrameLine {
  line: number;
  content: string;
  active: boolean;
}

export interface CodeFrame {
  /** Lines around the error, including line numbers. */
  lines: CodeFrameLine[];
  /** 1-based column of the caret within the active line. */
  column: number;
}

export class ElizabethCompileError extends Error {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /** Full source text the error was reported against. Used to render code frames. */
  readonly source: string;

  constructor(location: CompileSourceLocation, reason: string, source: string) {
    super(`${location.file}:${location.line}:${location.column}: ${reason}`);
    this.name = "ElizabethCompileError";
    this.file = location.file;
    this.line = location.line;
    this.column = location.column;
    this.source = source;
  }
}

/**
 * Build a `ElizabethCompileError` from a 0-based character index into the source.
 * The message is kept on a single line so callers that scrape `error.message`
 * with a regex (e.g. the dev HTML error renderer) keep working.
 */
export function syntaxError(
  sourceName: string,
  source: string,
  index: number,
  reason: string,
): ElizabethCompileError {
  const safeIndex = Math.max(0, Math.min(index, source.length));
  const before = source.slice(0, safeIndex);
  const lines = before.split("\n");
  const line = lines.length;
  const column = lines.at(-1)!.length + 1;
  return new ElizabethCompileError({ file: sourceName, line, column }, reason, source);
}

/**
 * Extract `file`, `line`, `column`, and reason from any error. Falls back to
 * parsing `error.message` if it already follows the `file:line:col: text`
 * shape produced by `syntaxError()`.
 */
export function locateError(error: unknown): {
  location: CompileSourceLocation | null;
  reason: string;
  source: string | null;
} {
  if (error instanceof ElizabethCompileError) {
    return {
      location: { file: error.file, line: error.line, column: error.column },
      reason: stripLocationPrefix(error.message, error.file, error.line, error.column),
      source: error.source,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const match = /^(.+?\.liz):(\d+):(\d+):\s*([\s\S]+)$/.exec(message);

  if (!match) {
    return { location: null, reason: message, source: null };
  }

  return {
    location: { file: match[1], line: Number(match[2]), column: Number(match[3]) },
    reason: match[4],
    source: null,
  };
}

function stripLocationPrefix(message: string, file: string, line: number, column: number): string {
  const prefix = `${file}:${line}:${column}: `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

/**
 * Compute a code frame around the given line. The 1-based `line` argument
 * points to the line with the error; surrounding context lines are included.
 */
export function codeFrame(source: string, line: number, column: number, context = 2): CodeFrame {
  const lines = source.split(/\r?\n/);
  const start = Math.max(1, line - context);
  const end = Math.min(lines.length, line + context);
  const frame: CodeFrameLine[] = [];

  for (let current = start; current <= end; current++) {
    frame.push({
      line: current,
      content: lines[current - 1] ?? "",
      active: current === line,
    });
  }

  return { lines: frame, column };
}

export interface FormatCompileErrorOptions {
  /** Number of context lines above/below the active line. Default 2. */
  context?: number;
  /** ANSI colors. Off by default; CLIs pass `true` when stderr is a TTY. */
  color?: boolean;
}

/**
 * Format an error as a multi-line terminal string with a code frame.
 * When the error has no embedded source, the caller's terminal will still
 * see a useful `file:line:col: message` line — just without the frame.
 */
export function formatCompileError(error: unknown, options: FormatCompileErrorOptions = {}): string {
  const { location, reason, source } = locateError(error);
  const context = options.context ?? 2;

  if (!location) {
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
  }

  const header = `${location.file}:${location.line}:${location.column}: ${reason}`;

  if (!source) {
    return header;
  }

  const frame = codeFrame(source, location.line, location.column, context);
  const gutterWidth = String(frame.lines.at(-1)?.line ?? location.line).length;
  const lines: string[] = [header, ""];
  const caretGutter = `${" ".repeat(gutterWidth)} | `;

  for (const entry of frame.lines) {
    const gutter = `${String(entry.line).padStart(gutterWidth)} | `;
    const marker = entry.active ? "> " : "  ";
    lines.push(`${marker}${gutter}${entry.content}`);
    if (entry.active) {
      const pad = " ".repeat(Math.max(0, location.column - 1));
      lines.push(`  ${caretGutter}${pad}^`);
    }
  }

  return lines.join("\n");
}
