#!/usr/bin/env bun
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface CreateOptions {
  targetDir: string;
  packageName: string;
  elizabethSpecifier: string;
  force: boolean;
}

const options = parseArgs(Bun.argv.slice(2));
await createApp(options);

async function createApp(options: CreateOptions): Promise<void> {
  const target = resolve(process.cwd(), options.targetDir);
  const template = resolve(import.meta.dir, "../template");

  await assertWritableTarget(target, options.force);
  await copyTemplate(template, target);
  await writeGeneratedPackageJson(target, options);

  console.log(`Created Elizabeth app in ${target}`);
  console.log("");
  console.log("Installing dependencies...");
  
  const proc = Bun.spawn(["bun", "install"], {
    cwd: target,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error(`\nFailed to install dependencies (exit code ${exitCode}).`);
    console.log("Please run `bun install` manually.");
  } else {
    console.log("\nDependencies installed successfully.");
  }

  console.log("");
  console.log("Next:");
  console.log(`  cd ${options.targetDir}`);
  console.log("  bun run dev");
}

async function copyTemplate(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });

  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (shouldSkipTemplateEntry(entry.name)) {
      continue;
    }

    const sourcePath = resolve(source, entry.name);
    const targetPath = resolve(target, entry.name);

    if (entry.isDirectory()) {
      await copyTemplate(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile()) {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, await readFile(sourcePath, "utf8"));
    }
  }
}

function shouldSkipTemplateEntry(name: string): boolean {
  return name === "node_modules" || name === "dist" || name === ".elizabeth" || name === "bun.lock";
}

async function writeGeneratedPackageJson(target: string, options: CreateOptions): Promise<void> {
  await writeFile(resolve(target, "package.json"), `${JSON.stringify({
    name: options.packageName,
    version: "0.0.0",
    type: "module",
    scripts: {
      dev: "elizabeth dev",
      build: "elizabeth build",
      start: "bun dist/server.js",
      check: "tsc --noEmit",
    },
    dependencies: {
      elizabeth: options.elizabethSpecifier,
    },
    devDependencies: {
      typescript: "^6.0.3",
      vite: "^8.0.10",
    },
  }, null, 2)}\n`);
}

async function assertWritableTarget(target: string, force: boolean): Promise<void> {
  try {
    const entries = await readdir(target);

    if (entries.length > 0 && !force) {
      console.error(`Target directory is not empty: ${target}`);
      console.error("Use --force to write into it anyway.");
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

function parseArgs(args: string[]): CreateOptions {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const targetDir = args.find((arg) => !arg.startsWith("-"));

  if (!targetDir) {
    printHelp();
    process.exit(1);
  }

  return {
    targetDir,
    packageName: packageNameFor(targetDir),
    elizabethSpecifier: readOption(args, "--elizabeth") ?? defaultElizabethSpecifier(),
    force: args.includes("--force"),
  };
}

function readOption(args: string[], name: string): string | null {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));

  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
}

function packageNameFor(targetDir: string): string {
  return targetDir
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1)!
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "elizabeth-app";
}

function defaultElizabethSpecifier(): string {
  return "npm:@lizorigin/elizabeth@^0.0.1";
}

function printHelp(): void {
  console.log(`create-elizabeth-app

Usage:
  bun create @lizorigin/elizabeth-app my-app
  bunx @lizorigin/create-elizabeth-app my-app

Options:
  --elizabeth <specifier>  Override the elizabeth dependency specifier.
  --force                  Allow writing into a non-empty target directory.
`);
}
