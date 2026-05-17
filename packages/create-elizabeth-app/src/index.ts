#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const AVAILABLE_TEMPLATES = ["default", "tailwind"] as const;
type TemplateName = (typeof AVAILABLE_TEMPLATES)[number];

interface CreateOptions {
  targetDir: string;
  packageName: string;
  elizabethSpecifier: string;
  template: TemplateName;
  force: boolean;
}

interface TemplateExtras {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  postInstallNotes?: string[];
}

const TEMPLATE_EXTRAS: Record<TemplateName, TemplateExtras> = {
  default: {},
  tailwind: {
    devDependencies: {
      "@tailwindcss/vite": "^4.2.4",
      tailwindcss: "^4.2.4",
    },
  },
};

const options = parseArgs(Bun.argv.slice(2));
await createApp(options);

async function createApp(options: CreateOptions): Promise<void> {
  const target = resolve(process.cwd(), options.targetDir);
  const template = resolve(import.meta.dir, `../templates/${options.template}`);

  if (!existsSync(template)) {
    console.error(`Template not found at ${template}.`);
    console.error(`Available templates: ${AVAILABLE_TEMPLATES.join(", ")}`);
    process.exit(1);
  }

  await assertWritableTarget(target, options.force);
  await copyTemplate(template, target);
  await writeGeneratedPackageJson(target, options);

  console.log(`Created Elizabeth app in ${target} (template: ${options.template})`);
  console.log("");
  console.log("Installing dependencies...");

  // @ts-expect-error - Bun types in CI might be outdated and missing spawn
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
  for (const command of nextCommands(options.targetDir)) {
    console.log(`  ${command}`);
  }

  const notes = TEMPLATE_EXTRAS[options.template].postInstallNotes;

  if (notes?.length) {
    console.log("");
    console.log("Before you start:");
    for (const note of notes) {
      console.log(`  ${note}`);
    }
  }
}

function nextCommands(targetDir: string): string[] {
  if (resolve(process.cwd(), targetDir) === process.cwd()) {
    return ["bun run dev"];
  }

  return [`cd ${targetDir}`, "bun run dev"];
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
  const extras = TEMPLATE_EXTRAS[options.template];

  const generated = {
    name: options.packageName,
    version: "0.0.1",
    type: "module",
    scripts: {
      dev: "elizabeth dev",
      build: "elizabeth build",
      start: "bun dist/server.js",
      check: "tsc --noEmit",
    },
    dependencies: {
      elizabeth: options.elizabethSpecifier,
      ...(extras.dependencies ?? {}),
    },
    devDependencies: {
      typescript: "^6.0.3",
      vite: "^8.0.10",
      ...(extras.devDependencies ?? {}),
    },
  };

  await writeFile(resolve(target, "package.json"), `${JSON.stringify(generated, null, 2)}\n`);
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

  const requestedTemplate = readOption(args, "--template") ?? "default";
  const template = parseTemplate(requestedTemplate);

  return {
    targetDir,
    packageName: packageNameFor(targetDir, process.cwd()),
    elizabethSpecifier: readOption(args, "--elizabeth") ?? defaultElizabethSpecifier(),
    template,
    force: args.includes("--force"),
  };
}

function parseTemplate(value: string): TemplateName {
  if ((AVAILABLE_TEMPLATES as readonly string[]).includes(value)) {
    return value as TemplateName;
  }

  console.error(`Unknown template: ${value}`);
  console.error(`Available templates: ${AVAILABLE_TEMPLATES.join(", ")}`);
  process.exit(1);
}

function readOption(args: string[], name: string): string | null {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));

  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
}

function packageNameFor(targetDir: string, cwd: string): string {
  return (
    basename(resolve(cwd, targetDir))
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[._-]+|[._-]+$/g, "") || "elizabeth-app"
  );
}

function defaultElizabethSpecifier(): string {
  return "npm:@elizabeth-js/elizabeth@latest";
}

function printHelp(): void {
  console.log(`create-elizabeth-app

Usage:
  bun create @elizabeth-js/elizabeth-app my-app
  bunx @elizabeth-js/create-elizabeth-app my-app

Options:
  --template <name>        Project template. One of: ${AVAILABLE_TEMPLATES.join(", ")} (default: default).
  --elizabeth <specifier>  Override the elizabeth dependency specifier.
  --force                  Allow writing into a non-empty target directory.

Templates:
  default     Minimal starter with scoped styles and a client island counter.
  tailwind    Same starter wired up with Tailwind CSS v4 via @tailwindcss/vite.
`);
}
