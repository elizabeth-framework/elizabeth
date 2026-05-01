import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { escapeHtml } from "../runtime/html.ts";

interface TraceFrame {
  functionName: string;
  file: string;
  displayFile: string;
  line: number;
  column: number;
  sourceLine: number | null;
  sourceColumn: number | null;
  codeFrame: CodeFrameLine[];
  internal: boolean;
}

interface CodeFrameLine {
  line: number;
  content: string;
  active: boolean;
}



// TODO: improve error page more modern and more beautiful :)
export function renderDevError(error: unknown, pathname: string): string {
  const normalized = normalizeError(error);
  const messageFrame = frameFromLizLocationMessage(normalized.message);
  const frames = [
    ...(messageFrame ? [messageFrame] : []),
    ...parseStackFrames(normalized.stack),
  ];
  const visibleFrames = frames.filter((frame) => !frame.internal);
  const primary = visibleFrames[0] ?? frames[0] ?? null;

  return `<!doctype html><html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Elizabeth Error</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #101012;
        color: #f6f3ee;
      }
      main { width: min(1080px, calc(100vw - 40px)); margin: 0 auto; padding: 42px 0 56px; }
      header { border-bottom: 1px solid #2b2a2a; padding-bottom: 22px; margin-bottom: 22px; }
      .eyebrow { margin: 0 0 10px; color: #f87171; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(28px, 4vw, 44px); line-height: 1.05; letter-spacing: 0; }
      .route { margin: 14px 0 0; color: #c9c3ba; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .message {
        margin: 20px 0;
        padding: 16px 18px;
        border: 1px solid #7f1d1d;
        background: #2a1214;
        color: #fecaca;
        border-radius: 8px;
        font-size: 15px;
        line-height: 1.5;
      }
      .primary {
        display: grid;
        gap: 12px;
        margin: 18px 0 24px;
        padding: 16px 18px;
        border: 1px solid #3b3a37;
        background: #181817;
        border-radius: 8px;
      }
      .label { color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
      .file { color: #fef3c7; overflow-wrap: anywhere; }
      .trace { display: grid; gap: 14px; }
      details {
        border: 1px solid #30302f;
        background: #161615;
        border-radius: 8px;
        overflow: hidden;
      }
      summary {
        cursor: pointer;
        padding: 13px 15px;
        color: #e8e2d8;
      }
      summary span { color: #a8a29e; }
      pre {
        margin: 0;
        overflow: auto;
        padding: 6px 0 8px;
        background: #0c0c0d;
        border-top: 1px solid #30302f;
        font-size: 13px;
        line-height: 1.2;
      }
      .line { display: grid; grid-template-columns: 58px minmax(0, 1fr); gap: 12px; padding: 1px 14px; }
      .line-number { color: #78716c; text-align: right; user-select: none; }
      .line.active { background: #3a181a; color: #fee2e2; }
      .empty { color: #a8a29e; padding: 16px 0; }
    </style>
  </head>
  <body>
    <main>
      <header>
        <p class="eyebrow">Elizabeth Trace</p>
        <h1>${escapeHtml(normalized.name)}</h1>
        <p class="route">Route <code>${escapeHtml(pathname)}</code> failed while rendering.</p>
      </header>
      <section class="message">${escapeHtml(normalized.message)}</section>
      ${primary ? renderPrimary(primary) : ""}
      <section class="trace">
        ${visibleFrames.length > 0 ? visibleFrames.map(renderFrame).join("") : `<p class="empty">No Elizabeth application frames were found.</p>`}
      </section>
    </main>
  </body>
</html>`;
}

function renderPrimary(frame: TraceFrame): string {
  return `<section class="primary">
    <div class="label">First application frame</div>
    <div class="file">${escapeHtml(formatFrameLocation(frame))}</div>
  </section>`;
}

function renderFrame(frame: TraceFrame): string {
  const location = formatFrameLocation(frame);
  const code = frame.codeFrame.length > 0
    ? frame.codeFrame.map((line) => `<span class="line${line.active ? " active" : ""}"><span class="line-number">${line.line}</span><span>${escapeHtml(line.content || " ")}</span></span>`).join("\n")
    : `<span class="line"><span class="line-number"></span><span>No source preview available.</span></span>`;

  return `<details open>
    <summary>${escapeHtml(frame.functionName)} <span>${escapeHtml(location)}</span></summary>
    <pre>${code}</pre>
  </details>`;
}

function formatFrameLocation(frame: TraceFrame): string {
  const line = frame.sourceLine ?? frame.line;
  const column = frame.sourceColumn ?? frame.column;
  return `${frame.displayFile}:${line}:${column}`;
}

function normalizeError(error: unknown): { name: string; message: string; stack: string } {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message,
      stack: error.stack ?? error.message,
    };
  }

  return {
    name: "Error",
    message: String(error),
    stack: String(error),
  };
}

function parseStackFrames(stack: string): TraceFrame[] {
  return stack.split("\n").flatMap((line) => {
    const parsed = parseStackLine(line);

    if (!parsed) {
      return [];
    }

    const source = sourceForGeneratedFrame(parsed.file, parsed.line, parsed.column);
    const displayFile = source ? source.displayFile : compactPath(parsed.file);
    const sourceLine = source?.line ?? null;
    const sourceColumn = source?.column ?? null;
    const previewFile = source?.file ?? parsed.file;

    return [{
      ...parsed,
      displayFile,
      sourceLine,
      sourceColumn,
      codeFrame: codeFrameFor(previewFile, sourceLine ?? parsed.line),
      internal: isInternalFrame(parsed.file),
    }];
  });
}

function frameFromLizLocationMessage(message: string): TraceFrame | null {
  const match = /^(.+?\.liz):(\d+):(\d+):\s*(.+)$/.exec(message);

  if (!match) {
    return null;
  }

  const file = resolve(match[1]);
  const line = Number(match[2]);
  const column = Number(match[3]);

  return {
    functionName: "Elizabeth compiler",
    file,
    displayFile: compactPath(file),
    line,
    column,
    sourceLine: line,
    sourceColumn: column,
    codeFrame: codeFrameFor(file, line),
    internal: false,
  };
}

function parseStackLine(line: string): Omit<TraceFrame, "displayFile" | "sourceLine" | "sourceColumn" | "codeFrame" | "internal"> | null {
  const withFunction = /^\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/.exec(line);

  if (withFunction) {
    return {
      functionName: withFunction[1],
      file: withFunction[2],
      line: Number(withFunction[3]),
      column: Number(withFunction[4]),
    };
  }

  const bare = /^\s*at\s+(.+):(\d+):(\d+)$/.exec(line);

  if (!bare) {
    return null;
  }

  return {
    functionName: "(anonymous)",
    file: bare[1],
    line: Number(bare[2]),
    column: Number(bare[3]),
  };
}

function sourceForGeneratedFrame(file: string, line: number, column: number): { file: string; displayFile: string; line: number; column: number } | null {
  const normalized = file.replaceAll("\\", "/");
  const marker = "/.elizabeth/";
  const markerIndex = normalized.indexOf(marker);

  if (markerIndex === -1 || !/\.liz\.[A-Za-z0-9]+\.ts$/.test(normalized)) {
    return null;
  }

  const root = normalized.slice(0, markerIndex);
  const generatedRelative = normalized.slice(markerIndex + marker.length);
  const sourceRelative = generatedRelative.replace(/\.liz\.[A-Za-z0-9]+\.ts$/, ".liz");
  const sourceFile = resolve(root, sourceRelative);

  if (!existsSync(sourceFile)) {
    return null;
  }

  return {
    file: sourceFile,
    displayFile: compactPath(sourceFile),
    line: mapGeneratedLineToLizSource(file, sourceFile, line),
    column,
  };
}

function mapGeneratedLineToLizSource(generatedFile: string, sourceFile: string, generatedLine: number): number {
  const generated = readLines(generatedFile);
  const source = readLines(sourceFile);
  const generatedText = generated[generatedLine - 1]?.trim();

  if (generatedText) {
    const match = source.findIndex((line) => line.trim() === generatedText);

    if (match !== -1) {
      return match + 1;
    }
  }

  return Math.max(1, generatedLine - generatedPreambleLineCount(generated));
}

function generatedPreambleLineCount(lines: string[]): number {
  const functionIndex = lines.findIndex((line) => /\bfunction\s+[A-Z]/.test(line));

  if (functionIndex === -1) {
    return 0;
  }

  return functionIndex + 2;
}

function codeFrameFor(file: string, line: number): CodeFrameLine[] {
  const lines = readLines(file);

  if (lines.length === 0) {
    return [];
  }

  const start = Math.max(1, line - 3);
  const end = Math.min(lines.length, line + 3);
  const frame: CodeFrameLine[] = [];

  for (let current = start; current <= end; current++) {
    frame.push({
      line: current,
      content: lines[current - 1] ?? "",
      active: current === line,
    });
  }

  return frame;
}

function readLines(file: string): string[] {
  try {
    return readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
}

function compactPath(file: string): string {
  const cwdRelative = relative(process.cwd(), file).replaceAll("\\", "/");

  if (!cwdRelative.startsWith("..")) {
    return cwdRelative;
  }

  return relative(dirname(process.cwd()), file).replaceAll("\\", "/");
}

function isInternalFrame(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");

  return normalized.includes("/node_modules/")
    || normalized.includes("/src/compiler/")
    || normalized.includes("/src/router/")
    || normalized.includes("/src/dev/")
    || normalized.includes("/src/runtime/");
}
