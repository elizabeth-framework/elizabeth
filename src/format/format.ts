/**
 * .liz formatter. Intentionally conservative — does not parse or reformat
 * JS / TS / JSX / CSS inside components. It only normalizes whitespace,
 * line endings, and trailing-newline conventions so files stay tidy in
 * version control without fighting the surrounding tooling.
 *
 * Transformations applied:
 *
 * 1. CRLF / CR → LF line endings.
 * 2. Trim trailing whitespace on every line.
 * 3. Collapse runs of 3+ consecutive blank lines to exactly 2 blank lines.
 * 4. Ensure exactly one trailing newline (no trailing blank lines).
 *
 * The formatter is intentionally idempotent — running it twice on a file
 * yields the same output.
 */

export interface FormatOptions {
  /**
   * Maximum number of consecutive blank lines allowed inside a file.
   * Defaults to 2 (which keeps a single blank line between blocks but
   * allows for a "section break" pattern with one extra blank line).
   */
  maxConsecutiveBlankLines?: number;
}

const DEFAULT_MAX_BLANK_LINES = 2;

export function formatLiz(source: string, options: FormatOptions = {}): string {
  const maxBlank = options.maxConsecutiveBlankLines ?? DEFAULT_MAX_BLANK_LINES;

  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  const trimmed = lines.map((line) => line.replace(/[ \t]+$/u, ""));

  const collapsed: string[] = [];
  let blankRun = 0;
  for (const line of trimmed) {
    if (line === "") {
      blankRun += 1;
      if (blankRun <= maxBlank) {
        collapsed.push(line);
      }
    } else {
      blankRun = 0;
      collapsed.push(line);
    }
  }

  while (collapsed.length > 0 && collapsed.at(-1) === "") {
    collapsed.pop();
  }

  if (collapsed.length === 0) {
    return "";
  }

  return `${collapsed.join("\n")}\n`;
}

export interface CheckResult {
  /** True when the file content already matches the formatted output. */
  formatted: boolean;
  /** The formatted text (always the canonical version, regardless of `formatted`). */
  output: string;
}

export function checkLiz(source: string, options: FormatOptions = {}): CheckResult {
  const output = formatLiz(source, options);
  return { formatted: output === source, output };
}
