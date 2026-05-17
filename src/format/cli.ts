import type { Dirent } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { formatLiz } from "./format.ts";

export interface RunFormatOptions {
  cwd: string;
  args: string[];
}

export interface RunFormatResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runFormatCli(options: RunFormatOptions): Promise<RunFormatResult> {
  let mode: "write" | "check" | "stdout" = "write";
  const positional: string[] = [];

  for (let index = 0; index < options.args.length; index++) {
    const arg = options.args[index];

    if (arg === "--check") {
      mode = "check";
      continue;
    }

    if (arg === "--stdout") {
      mode = "stdout";
      continue;
    }

    if (arg === "--write") {
      mode = "write";
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return { exitCode: 0, stdout: helpText(), stderr: "" };
    }

    if (arg.startsWith("--")) {
      return { exitCode: 1, stdout: "", stderr: `Unknown flag: ${arg}\n${helpText()}` };
    }

    positional.push(arg);
  }

  const targets = positional.length > 0 ? positional : ["."];
  const files: string[] = [];

  for (const target of targets) {
    const resolved = resolve(options.cwd, target);
    try {
      const stats = await stat(resolved);
      if (stats.isDirectory()) {
        await collectLizFiles(resolved, files);
      } else if (stats.isFile()) {
        files.push(resolved);
      }
    } catch (error) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `Could not read ${target}: ${error instanceof Error ? error.message : String(error)}\n`,
      };
    }
  }

  const unique = Array.from(new Set(files)).sort();

  if (unique.length === 0) {
    return { exitCode: 0, stdout: "No .liz files found.\n", stderr: "" };
  }

  let changed = 0;
  let stdout = "";
  const stderr: string[] = [];

  for (const file of unique) {
    const source = await readFile(file, "utf8");
    const output = formatLiz(source);
    const rel = relative(options.cwd, file);
    const display = !rel || rel.startsWith("..") ? file : rel;

    if (output === source) {
      continue;
    }

    changed += 1;

    if (mode === "check") {
      stdout += `${display}\n`;
      continue;
    }

    if (mode === "stdout") {
      stdout += output;
      continue;
    }

    try {
      await writeFile(file, output, "utf8");
      stdout += `formatted ${display}\n`;
    } catch (error) {
      stderr.push(`Failed to write ${display}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (mode === "check") {
    if (changed > 0) {
      stderr.push(`${changed} file(s) need formatting`);
      return { exitCode: 1, stdout, stderr: `${stderr.join("\n")}\n` };
    }
    return { exitCode: 0, stdout: "All .liz files already formatted.\n", stderr: "" };
  }

  if (mode === "write" && changed === 0) {
    stdout = `Checked ${unique.length} file(s); nothing to format.\n`;
  }

  if (stderr.length > 0) {
    return { exitCode: 1, stdout, stderr: `${stderr.join("\n")}\n` };
  }

  return { exitCode: 0, stdout, stderr: "" };
}

async function collectLizFiles(dir: string, into: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectLizFiles(full, into);
    } else if (entry.isFile() && entry.name.endsWith(".liz")) {
      into.push(full);
    }
  }
}

function helpText(): string {
  return `Usage:
  elizabeth format [files-or-directories...]
  elizabeth format --check [files-or-directories...]
  elizabeth format --stdout <file>

Options:
  --check    Exit non-zero if any file would be reformatted. Prints the list
             of unformatted files to stdout. Does not write to disk.
  --stdout   Print the formatted output to stdout instead of writing to disk.
  --write    (default) Overwrite each file in place with the formatted output.

If no files are passed, the current directory is scanned recursively for
.liz files (skipping node_modules, .git, and dist).
`;
}
