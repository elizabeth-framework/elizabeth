#!/usr/bin/env bun
import { resolve } from "node:path";
import { buildElizabethApp } from "./build/app.ts";
import { startElizabethDevServer } from "./dev/app.ts";
import { runFormatCli } from "./format/cli.ts";

const [command, ...args] = Bun.argv.slice(2);

if (!command || command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(command ? 0 : 1);
}

if (command === "format") {
  const result = await runFormatCli({ cwd: process.cwd(), args });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

if (command === "build") {
  const root = resolve(process.cwd());
  const frameworkRoot = resolve(import.meta.dir, "..");
  await buildElizabethApp({
    root,
    frameworkRoot,
    distDir: readOption(args, "--outDir") ?? readOption(args, "--out-dir") ?? resolve(root, "dist"),
  });
  process.exit(0);
}

if (command !== "dev") {
  console.error(`Unknown Elizabeth command: ${command}`);
  printHelp();
  process.exit(1);
}

const port = readPort(args);
const root = resolve(process.cwd());
const frameworkRoot = resolve(import.meta.dir, "..");

startElizabethDevServer({
  root,
  frameworkRoot,
  port,
});

function readPort(args: string[]): number {
  const raw = readOption(args, "--port") ?? readOption(args, "-p") ?? Bun.env.PORT;
  const port = Number(raw ?? 3712);

  if (!Number.isInteger(port) || port <= 0) {
    console.error(`Invalid port: ${raw}`);
    process.exit(1);
  }

  return port;
}

function readOption(args: string[], name: string): string | null {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));

  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.findIndex((arg) => arg === name);
  return index === -1 ? null : (args[index + 1] ?? null);
}

function printHelp(): void {
  console.log(`Elizabeth

Usage:
  elizabeth dev [--port 3712]
  elizabeth build [--outDir dist]
  elizabeth format [files...] [--check] [--stdout]
`);
}
