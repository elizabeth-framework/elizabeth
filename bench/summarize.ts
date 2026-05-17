#!/usr/bin/env bun
/**
 * Parses the textual output of `run-frameworks.sh` (or `run-bombardier.sh`)
 * piped to this script and produces a Markdown summary table with the
 * headline numbers (req/s, p50/p99 latency) per framework × route.
 *
 * Usage:
 *
 *   bench/run-frameworks.sh | bun bench/summarize.ts
 *   bun bench/summarize.ts results.txt
 *
 * The parser understands the format bombardier prints when invoked with
 * `-l` (latency distribution). It looks for these line shapes:
 *
 *     == <framework>: <case name> ==
 *     == <case name> ==                       (single-framework mode)
 *     Reqs/sec      12345.67
 *       50%       1.23ms
 *       99%      45.67ms
 */

import { readFile } from "node:fs/promises";

interface BenchEntry {
  framework: string;
  route: string;
  reqsPerSec: number | null;
  p50: string | null;
  p99: string | null;
}

async function main(): Promise<void> {
  const text = await readInput();
  const entries = parseBenchOutput(text);

  if (entries.length === 0) {
    process.stderr.write("No benchmark cases parsed from input.\n");
    process.exit(1);
  }

  process.stdout.write(`${renderMarkdown(entries)}\n`);
}

async function readInput(): Promise<string> {
  const argFile = process.argv[2];
  if (argFile) {
    return await readFile(argFile, "utf8");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function parseBenchOutput(text: string): BenchEntry[] {
  const entries: BenchEntry[] = [];
  const lines = text.split(/\r?\n/);
  let currentFramework: string | null = null;
  let currentRoute: string | null = null;
  let reqsPerSec: number | null = null;
  let p50: string | null = null;
  let p99: string | null = null;

  const flush = () => {
    if (currentRoute) {
      entries.push({
        framework: currentFramework ?? "elizabeth",
        route: currentRoute,
        reqsPerSec,
        p50,
        p99,
      });
    }
    reqsPerSec = null;
    p50 = null;
    p99 = null;
    currentRoute = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    const sectionMatch = /^==\s*(.+?)\s*==$/u.exec(line);
    if (sectionMatch) {
      flush();
      const inner = sectionMatch[1];
      const split = inner.split(":");
      if (split.length >= 2) {
        currentFramework = split[0].trim();
        currentRoute = split.slice(1).join(":").trim();
      } else {
        currentRoute = inner;
      }
      continue;
    }

    if (line.startsWith("## ")) {
      flush();
      currentFramework = line.slice(3).trim();
      continue;
    }

    const reqsMatch = /^Reqs\/sec\s+([\d.,]+)/iu.exec(line);
    if (reqsMatch) {
      reqsPerSec = Number(reqsMatch[1].replace(/,/g, ""));
      continue;
    }

    const pctMatch = /^(\d+)%\s+(.+?)$/u.exec(line);
    if (pctMatch) {
      const pct = pctMatch[1];
      const value = pctMatch[2].trim();
      if (pct === "50") p50 = value;
      if (pct === "99") p99 = value;
    }
  }

  flush();
  return entries;
}

function renderMarkdown(entries: BenchEntry[]): string {
  const routes = Array.from(new Set(entries.map((entry) => entry.route)));
  const frameworks = Array.from(new Set(entries.map((entry) => entry.framework)));
  const lookup = new Map<string, BenchEntry>();
  for (const entry of entries) {
    lookup.set(`${entry.framework}|${entry.route}`, entry);
  }

  const blocks: string[] = [];

  for (const route of routes) {
    blocks.push(`### ${route}`);
    blocks.push("");
    blocks.push("| Framework | Reqs/sec | p50 latency | p99 latency |");
    blocks.push("| --- | ---: | ---: | ---: |");
    for (const framework of frameworks) {
      const entry = lookup.get(`${framework}|${route}`);
      if (!entry) continue;
      blocks.push(
        `| ${framework} | ${entry.reqsPerSec === null ? "—" : entry.reqsPerSec.toLocaleString()} | ${entry.p50 ?? "—"} | ${entry.p99 ?? "—"} |`,
      );
    }
    blocks.push("");
  }

  return blocks.join("\n");
}

if (import.meta.main) {
  await main();
}
