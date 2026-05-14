import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { parseSync } from "oxc-parser";
import { compileElizabeth, compileElizabethEndpoint } from "./compile.ts";
import type { ClientComponent } from "./types.ts";

export interface CompileFileOptions {
  root: string;
  frameworkRoot?: string;
  outDir: string;
  context?: CompileGraphContext;
}

export interface CompileFileResult {
  outputPath: string;
  clientManifestPath: string;
  clientComponents: ClientManifestEntry[];
  cssModules: CssModuleEntry[];
}

export interface CompileEndpointFileResult {
  outputPath: string;
  methods: string[];
}

export interface ClientManifestEntry extends ClientComponent {
  sourcePath: string;
  outputPath: string;
  clientOutputPath: string;
  moduleId: string;
}

export interface CompileGraphContext {
  seen: Map<string, string>;
  clientComponents: Map<string, ClientManifestEntry>;
  cssModules: Map<string, CssModuleEntry>;
}

export interface CssModuleEntry {
  sourcePath: string;
  outputPath: string;
  cssOutputPath: string;
  cssMapOutputPath: string;
  href: string;
  mapHref: string;
  classes: Record<string, string>;
}

export function createCompileGraphContext(): CompileGraphContext {
  return {
    seen: new Map(),
    clientComponents: new Map(),
    cssModules: new Map(),
  };
}

function readTopLevelComponentTagName(source: string, index: number): string | null {
  const match = /^<([A-Z][A-Za-z0-9_]*)(?:\s[^>]*)?\/?>/.exec(source.slice(index));
  return match?.[1] ?? null;
}

export async function compileElizabethFile(inputPath: string, options: CompileFileOptions): Promise<CompileFileResult> {
  const normalizedInput = resolve(inputPath);
  const root = resolve(options.root);
  const frameworkRoot = resolve(options.frameworkRoot ?? root);
  const outDir = resolve(options.outDir);
  const context = options.context ?? createCompileGraphContext();

  const outputPath = await compileOne(normalizedInput);
  const clientManifestPath = await writeClientManifest(outDir, [...context.clientComponents.values()]);

  return {
    outputPath,
    clientManifestPath,
    clientComponents: [...context.clientComponents.values()],
    cssModules: [...context.cssModules.values()],
  };

  async function compileOne(filePath: string): Promise<string> {
    const cached = context.seen.get(filePath);
    if (cached) {
      return cached;
    }

    const source = await Bun.file(filePath).text();
    const imports = findLizImports(source, filePath);
    const cssImports = findCssModuleImports(source, filePath);

    for (const specifier of imports) {
      await compileOne(resolveAppImportSpecifier(root, filePath, specifier));
    }

    for (const specifier of cssImports) {
      await compileCssModule(resolveAppImportSpecifier(root, filePath, specifier));
    }

    const outputBasePath = outputBasePathFor(filePath, root, outDir);
    const runtimePath = toImportSpecifier(relative(dirname(outputBasePath), resolve(frameworkRoot, "src/runtime/html.ts")));
    const result = compileElizabeth(source, filePath, {
      runtimeImport: `import { escapeHtml, escapeAttribute } from ${JSON.stringify(runtimePath)};`,
      rewriteImport(statement) {
        return rewriteServerImportStatement(statement, root, filePath, outputBasePath, frameworkRoot, context);
      },
    });
    const outputPath = outputPathFor(filePath, root, outDir, hashString(result.code));
    context.seen.set(filePath, outputPath);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, result.code);
    await cleanupGeneratedModuleVariants(outputPath, outputBasePath);

    const clientOutputPath = result.clientComponents.length > 0
      ? await writeClientModule(filePath, root, outDir, result.clientComponents)
      : null;

    for (const component of result.clientComponents) {
      const moduleId = relative(root, filePath).replaceAll("\\", "/");
      context.clientComponents.set(`${moduleId}#${component.name}`, {
        ...component,
        sourcePath: filePath,
        outputPath,
        clientOutputPath: clientOutputPath!,
        moduleId,
      });
    }

    return outputPath;
  }

  async function compileCssModule(filePath: string): Promise<CssModuleEntry> {
    const cached = context.cssModules.get(filePath);
    if (cached) {
      return cached;
    }

    const source = await Bun.file(filePath).text();
    const compiled = compileCssModuleSource(filePath, root, source);
    const cssHash = hashString(compiled.css);
    const cssOutputPath = cssModuleCssOutputPathFor(filePath, root, outDir);
    const cssMapOutputPath = cssModuleCssMapOutputPathFor(filePath, root, outDir);
    const outputBasePath = cssModuleJsOutputBasePathFor(filePath, root, outDir);
    const outputPath = cssModuleJsOutputPathFor(filePath, root, outDir, cssHash);
    const moduleId = relative(root, filePath).replaceAll("\\", "/");
    const href = `/_elizabeth/css/${encodeURIComponent(moduleId)}?v=${cssHash}`;
    const mapHref = `/_elizabeth/css/${encodeURIComponent(`${moduleId}.map`)}?v=${cssHash}`;
    const entry = {
      sourcePath: filePath,
      outputPath,
      cssOutputPath,
      cssMapOutputPath,
      href,
      mapHref,
      classes: compiled.classes,
    };

    context.cssModules.set(filePath, entry);
    await mkdir(dirname(cssOutputPath), { recursive: true });
    await mkdir(dirname(cssMapOutputPath), { recursive: true });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(cssOutputPath, `${compiled.css}\n/*# sourceMappingURL=${mapHref} */\n`);
    await writeFile(cssMapOutputPath, JSON.stringify(cssSourceMapFor(filePath, root, source, compiled.map), null, 2));
    await writeFile(outputPath, `const styles = ${JSON.stringify(compiled.classes, null, 2)};
export default styles;
export const href = ${JSON.stringify(href)};
export const sourceMap = ${JSON.stringify(mapHref)};
${Object.entries(compiled.classes).map(([name, value]) => safeExportStatement(name, value)).filter(Boolean).join("\n")}
`);
    await cleanupGeneratedModuleVariants(outputPath, outputBasePath);

    return entry;
  }
}

export async function compileElizabethEndpointFile(inputPath: string, options: CompileFileOptions): Promise<CompileEndpointFileResult> {
  const normalizedInput = resolve(inputPath);
  const root = resolve(options.root);
  const frameworkRoot = resolve(options.frameworkRoot ?? root);
  const outDir = resolve(options.outDir);
  const context = options.context ?? createCompileGraphContext();
  const extension = normalizedInput.split(".").at(-1);

  if (extension === "ts" || extension === "js") {
    const outputPath = endpointOutputPathFor(normalizedInput, root, outDir);
    const source = await Bun.file(normalizedInput).text();
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, rewriteServerModuleImports(source, root, normalizedInput, outputPath, frameworkRoot));
    return {
      outputPath,
      methods: findEndpointMethodExports(source),
    };
  }

  const source = await Bun.file(normalizedInput).text();
  const imports = findLizImports(source, normalizedInput);

  for (const specifier of imports) {
    await compileElizabethFile(resolveAppImportSpecifier(root, normalizedInput, specifier), {
      root,
      frameworkRoot,
      outDir,
      context,
    });
  }

  const outputBasePath = outputBasePathFor(normalizedInput, root, outDir);
  const runtimePath = toImportSpecifier(relative(dirname(outputBasePath), resolve(frameworkRoot, "src/runtime/html.ts")));
  const result = compileElizabethEndpoint(source, normalizedInput, {
    runtimeImport: `import { escapeHtml, escapeAttribute } from ${JSON.stringify(runtimePath)};`,
    rewriteImport(statement) {
      return rewriteServerImportStatement(statement, root, normalizedInput, outputBasePath, frameworkRoot, context);
    },
  });
  const outputPath = outputPathFor(normalizedInput, root, outDir, hashString(result.code));

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.code);
  await cleanupGeneratedModuleVariants(outputPath, outputBasePath);

  return {
    outputPath,
    methods: result.methods,
  };
}

async function writeClientModule(
  sourcePath: string,
  root: string,
  outDir: string,
  components: ClientComponent[],
): Promise<string> {
  const path = clientOutputPathFor(sourcePath, root, outDir);
  const registrations = components.map((component) => {
    const hydrateName = `hydrate${component.name}`;
    const stateDeclarations = component.states.map((state) => {
      return `  let ${state.name} = ${state.initialValue};
  const ${state.setter} = (next) => {
    ${state.name} = typeof next === "function" ? next(${state.name}) : next;
    render();
  };`;
    }).join("\n");
    const clientFunctions = component.clientFunctions.map((fn) => indent(fn.source, 2)).join("\n");
    const staticTextUpdates = component.textBindings.filter((binding) => !binding.reactive).map((binding) => {
      return `    root.querySelector(${JSON.stringify(`[data-elizabeth-text="${binding.id}"]`)})?.replaceChildren(String(__elizabethValue(${binding.expression})));`;
    }).join("\n");
    const textUpdates = component.textBindings.filter((binding) => binding.reactive).map((binding) => {
      return `    root.querySelector(${JSON.stringify(`[data-elizabeth-text="${binding.id}"]`)})?.replaceChildren(String(__elizabethValue(${binding.expression})));`;
    }).join("\n");
    const staticHtmlUpdates = component.htmlBindings.filter((binding) => !binding.reactive).map((binding) => emitClientHtmlUpdate(binding)).join("\n");
    const htmlUpdates = component.htmlBindings.filter((binding) => binding.reactive).map((binding) => emitClientHtmlUpdate(binding)).join("\n");
    const staticAttrUpdates = component.attrBindings.filter((binding) => !binding.reactive).map((binding) => emitClientAttributeUpdate(binding)).join("\n");
    const attrUpdates = component.attrBindings.filter((binding) => binding.reactive).map((binding) => emitClientAttributeUpdate(binding)).join("\n");
    const listeners = component.events.map((event) => {
      return `  root.querySelector(${JSON.stringify(`[data-elizabeth-event-${event.eventName}="${event.id}"]`)})?.addEventListener(${JSON.stringify(event.eventName)}, (event) => (${event.handler})(event));`;
    }).join("\n");

    return `export function ${hydrateName}(root) {
  root.setAttribute("data-elizabeth-hydrated", ${JSON.stringify(component.name)});
${stateDeclarations}
${clientFunctions}
  const escapeHtml = (value) => value === null || value === undefined || value === false
    ? ""
    : String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
  const escapeAttribute = escapeHtml;
  const __elizabethValue = (value) => typeof value === "function" ? value() : value;
  const renderStatic = () => {
${staticTextUpdates}
${staticHtmlUpdates}
${staticAttrUpdates}
  };
  const render = () => {
${textUpdates}
${htmlUpdates}
${attrUpdates}
  };
${listeners}
  renderStatic();
  render();
}

globalThis.__elizabethRegisterIsland?.(${JSON.stringify(component.name)}, ${hydrateName});`;
  }).join("\n\n");

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${registrations}
`);

  return path;
}

function emitClientAttributeUpdate(binding: ClientComponent["attrBindings"][number]): string {
      const selector = JSON.stringify(`[data-elizabeth-attr-${binding.id}]`);
      const name = JSON.stringify(binding.name);

      if (binding.boolean) {
        return `    {
      const element = root.querySelector(${selector});
      if (element) {
        if (__elizabethValue(${binding.expression})) element.setAttribute(${name}, "");
        else element.removeAttribute(${name});
      }
    }`;
      }

      return `    {
      const element = root.querySelector(${selector});
      if (element) element.setAttribute(${name}, String(__elizabethValue(${binding.expression})));
    }`;
}

function emitClientHtmlUpdate(binding: ClientComponent["htmlBindings"][number]): string {
  const selector = JSON.stringify(`[data-elizabeth-html="${binding.id}"]`);
  return `    {
      const element = root.querySelector(${selector});
      if (element) element.innerHTML = ${binding.expression};
    }`;
}

async function writeClientManifest(outDir: string, entries: ClientManifestEntry[]): Promise<string> {
  const path = resolve(outDir, "client-manifest.json");

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({
    islands: entries.sort((left, right) => left.moduleId.localeCompare(right.moduleId) || left.name.localeCompare(right.name)),
  }, null, 2)}\n`);

  return path;
}

function rewritePackageImport(statement: string, outputPath: string, root: string): string {
  return statement.replace(/(["'])(elizabeth(?:\/(?:client|route))?)\1/g, (_match, quote: string, specifier: string) => {
    const target = specifier === "elizabeth/route"
      ? "src/route.ts"
      : specifier === "elizabeth/client"
        ? "src/client.ts"
        : "src/elizabeth.ts";
    const rewritten = toImportSpecifier(relative(dirname(outputPath), resolve(root, target)));
    return `${quote}${rewritten}${quote}`;
  });
}

function rewriteServerModuleImports(source: string, root: string, sourcePath: string, outputPath: string, frameworkRoot: string): string {
  const parsed = parseSync("server-module.ts", source, {
    lang: "ts",
    sourceType: "module",
  });
  let rewritten = source;

  for (const importEntry of [...parsed.module.staticImports].reverse()) {
    const statement = source.slice(importEntry.start, importEntry.end);
    rewritten = `${rewritten.slice(0, importEntry.start)}${rewriteServerImportStatement(statement, root, sourcePath, outputPath, frameworkRoot)}${rewritten.slice(importEntry.end)}`;
  }

  return rewritten;
}

function rewriteServerImportStatement(
  statement: string,
  root: string,
  sourcePath: string,
  outputPath: string,
  frameworkRoot: string,
  context?: CompileGraphContext,
): string {
  const sourceRelative = rewriteSourceImport(statement, root, sourcePath, outputPath);
  const rewritten = context
    ? rewriteCssModuleImport(
      rewriteLizImport(sourceRelative, root, sourcePath, outputPath, context),
      root,
      sourcePath,
      outputPath,
      context,
    )
    : sourceRelative;

  return rewritePackageImport(
    rewritten,
    outputPath,
    frameworkRoot,
  );
}

function rewriteSourceImport(statement: string, root: string, sourcePath: string, outputPath: string): string {
  return statement.replace(/(["'])(\.{1,2}\/[^"']*|@\/[^"']*)\1/g, (_match, quote: string, specifier: string) => {
    if (specifier.endsWith(".liz") || specifier.endsWith(".module.css")) {
      return `${quote}${specifier}${quote}`;
    }

    const importedSourcePath = resolveAppImportSpecifier(root, sourcePath, specifier);
    const rewritten = toImportSpecifier(relative(dirname(outputPath), importedSourcePath));
    return `${quote}${rewritten}${quote}`;
  });
}

function findLizImports(source: string, sourceName = "anonymous.liz"): string[] {
  return findStaticImports(source, sourceName).filter((specifier) => specifier.endsWith(".liz"));
}

function findCssModuleImports(source: string, sourceName = "anonymous.liz"): string[] {
  return findStaticImports(source, sourceName).filter((specifier) => specifier.endsWith(".module.css"));
}

function findStaticImports(source: string, sourceName = "anonymous.liz"): string[] {
  
  const missingDecorator = findMissingComponentDecorator(source, sourceName);

  if (missingDecorator) {
    throw new Error(
      `${missingDecorator.sourceName}:${missingDecorator.line}:${missingDecorator.column}: ` +
      `Unexpected top-level component-like <${missingDecorator.componentName}> tag. ` +
      `If this is a component declaration, add @declare, @public, @default, or @private before it.`
    );
  }

  const moduleSource = readTopLevelModuleSource(source);

  if (moduleSource.trim().length === 0) {
    return [];
  }

  const result = parseSync("module.liz.ts", moduleSource, {
    lang: "ts",
    sourceType: "module",
  });

  if (result.errors.length > 0) {
    const error = result.errors[0];
    const location = parseModuleSourceLocation(error.codeframe ?? "");

    if (location) {
      const originalIndex = indexFromLineColumn(source, location.line, location.column);
      const position = sourcePosition(source, originalIndex);
      throw new Error(`${sourceName}:${position.line + 1}:${position.column + 1}: Invalid import syntax: ${error.message}`);
    }

    throw new Error(`Invalid import syntax: ${error.message}`);
  }

  return result.module.staticImports.map((entry) => entry.moduleRequest.value);
}

function findMissingComponentDecorator(
  source: string,
  sourceName: string,
): { sourceName: string; line: number; column: number; componentName: string } | null {
  let index = 0;

  while (index < source.length) {
    index = skipImportWhitespaceAndComments(source, index);

    if (isEndpointMethodStart(source, index)) {
      index = readEndpointMethodEnd(source, index);
      continue;
    }

    const componentName = readTopLevelComponentTagName(source, index);

    if (componentName !== null) {
      const position = sourcePosition(source, index);
      return {
        sourceName,
        line: position.line + 1,
        column: position.column + 1,
        componentName,
      };
    }

    const end = readTopLevelModuleChunkEnd(source, index);
    if (end <= index) {
      break;
    }
    index = end;
  }

  return null;
}

function readTopLevelModuleSource(source: string): string {
  let index = 0;
  let output = "";

  while (index < source.length) {
    index = skipImportWhitespaceAndComments(source, index);

    if (isElizabethComponentStart(source, index)) {
      const end = readElizabethComponentEnd(source, index);
      output += "\n".repeat(source.slice(index, end).split("\n").length - 1);
      index = end;
      continue;
    }

    if (isEndpointMethodStart(source, index)) {
      const end = readEndpointMethodEnd(source, index);
      output += "\n".repeat(source.slice(index, end).split("\n").length - 1);
      index = end;
      continue;
    }

    const end = readTopLevelModuleChunkEnd(source, index);
    output += source.slice(index, end);
    index = end;
  }

  return output;
}

function readTopLevelModuleChunkEnd(source: string, start: number): number {
  let index = start;
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "\"" || char === "'" || char === "`") {
      index = skipImportString(source, index);
      continue;
    }

    if (char === "/" && next === "/") {
      index = skipImportLineComment(source, index);
      continue;
    }

    if (char === "/" && next === "*") {
      index = skipImportBlockComment(source, index);
      continue;
    }

    if (
      char === "@" &&
      braceDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      isElizabethComponentStart(source, index)
    ) {
      return index;
    }

    if (
      char === "<" &&
      braceDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      isEndpointMethodStart(source, index)
    ) {
      return index;
    }

    if (
      char === "<" &&
      braceDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      readTopLevelComponentTagName(source, index) !== null
    ) {
      return index;
    }

    if (char === "{") braceDepth++;
    else if (char === "}") braceDepth--;
    else if (char === "(") parenDepth++;
    else if (char === ")") parenDepth--;
    else if (char === "[") bracketDepth++;
    else if (char === "]") bracketDepth--;

    index++;
  }

  return index;
}

function isElizabethComponentStart(source: string, start: number): boolean {
  let index = start;
  let found = false;

  while (source[index] === "@") {
    const match = /^@([A-Za-z_]\w*)/.exec(source.slice(index));

    if (!match || !componentDecoratorNames.has(match[1])) {
      return false;
    }

    found = true;
    index += match[0].length;
    index = skipImportWhitespaceAndComments(source, index);
  }

  return found && /^<[A-Z][A-Za-z0-9_]*[^>]*>/.test(source.slice(index));
}

function readElizabethComponentEnd(source: string, start: number): number {
  let index = start;

  while (source[index] === "@") {
    const match = /^@([A-Za-z_]\w*)/.exec(source.slice(index));

    if (!match) {
      throw new Error("Expected component decorator.");
    }

    index += match[0].length;
    index = skipImportWhitespaceAndComments(source, index);
  }

  const openMatch = /^<([A-Z][A-Za-z0-9_]*)([^>]*)>/.exec(source.slice(index));

  if (!openMatch) {
    throw new Error("Expected component declaration tag.");
  }

  const name = openMatch[1];
  const bodyStart = index + openMatch[0].length;
  const close = `</${name}>`;
  const bodyEnd = source.indexOf(close, bodyStart);

  if (bodyEnd === -1) {
    throw new Error(`Missing closing component tag ${close}.`);
  }

  return bodyEnd + close.length;
}

const componentDecoratorNames = new Set(["declare", "public", "default", "private", "client"]);

function isEndpointMethodStart(source: string, index: number): boolean {
  return /^<(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)>/.test(source.slice(index));
}

function readEndpointMethodEnd(source: string, start: number): number {
  const open = /^<(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)>/.exec(source.slice(start));

  if (!open) {
    throw new Error("Expected endpoint method tag.");
  }

  const close = `</${open[1]}>`;
  const end = source.indexOf(close, start + open[0].length);

  if (end === -1) {
    throw new Error(`Missing closing endpoint method tag ${close}.`);
  }

  return end + close.length;
}

function skipImportWhitespaceAndComments(source: string, index: number): number {
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) {
      index++;
    }

    if (source[index] === "/" && source[index + 1] === "/") {
      index = skipImportLineComment(source, index);
      continue;
    }

    if (source[index] === "/" && source[index + 1] === "*") {
      index = skipImportBlockComment(source, index);
      continue;
    }

    return index;
  }

  return index;
}

function skipImportString(source: string, start: number): number {
  const quote = source[start];
  let index = start + 1;

  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }

    if (source[index] === quote) {
      return index + 1;
    }

    index++;
  }

  return index;
}

function skipImportLineComment(source: string, start: number): number {
  const end = source.indexOf("\n", start + 2);
  return end === -1 ? source.length : end + 1;
}

function skipImportBlockComment(source: string, start: number): number {
  const end = source.indexOf("*/", start + 2);
  return end === -1 ? source.length : end + 2;
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

function rewriteLizImport(
  statement: string,
  root: string,
  sourcePath: string,
  outputPath: string,
  context: CompileGraphContext,
): string {
  return statement.replace(/(["'])([^"']+\.liz)\1/g, (_match, quote: string, specifier: string) => {
    const importedSourcePath = resolveAppImportSpecifier(root, sourcePath, specifier);
    const importedOutputPath = context.seen.get(importedSourcePath);

    if (!importedOutputPath) {
      throw new Error(`Elizabeth module was not compiled: ${importedSourcePath}`);
    }

    const rewritten = toImportSpecifier(relative(dirname(outputPath), importedOutputPath));
    return `${quote}${rewritten}${quote}`;
  });
}

function rewriteCssModuleImport(
  statement: string,
  root: string,
  sourcePath: string,
  outputPath: string,
  context: CompileGraphContext,
): string {
  return statement.replace(/(["'])([^"']+\.module\.css)\1/g, (_match, quote: string, specifier: string) => {
    const importedSourcePath = resolveAppImportSpecifier(root, sourcePath, specifier);
    const imported = context.cssModules.get(importedSourcePath);

    if (!imported) {
      throw new Error(`CSS module was not compiled: ${importedSourcePath}`);
    }

    const rewritten = toImportSpecifier(relative(dirname(outputPath), imported.outputPath));
    return `${quote}${rewritten}${quote}`;
  });
}

function resolveAppImportSpecifier(root: string, sourcePath: string, specifier: string): string {
  if (specifier.startsWith("@/")) {
    return resolve(root, "src", specifier.slice(2));
  }

  return resolve(dirname(sourcePath), specifier);
}

interface CssMapping {
  generatedLine: number;
  generatedColumn: number;
  sourceIndex: number;
  originalLine: number;
  originalColumn: number;
}

function compileCssModuleSource(filePath: string, root: string, source: string): { css: string; classes: Record<string, string>; map: CssMapping[] } {
  const classes: Record<string, string> = {};
  const fileHash = hashString(relative(root, filePath).replaceAll("\\", "/"));
  const compiled = transformCssModuleCss(source, classes, fileHash);

  for (const [name, scoped] of Object.entries(classes)) {
    const composed = composedClassesFor(source, name, classes);

    if (composed.length > 0) {
      classes[name] = [scoped, ...composed].join(" ");
    }
  }

  return { css: compiled.css, classes, map: compiled.map };
}

function cssSourceMapFor(filePath: string, root: string, source: string, mappings: CssMapping[]): object {
  return {
    version: 3,
    file: relative(root, filePath).replaceAll("\\", "/"),
    sources: [relative(root, filePath).replaceAll("\\", "/")],
    sourcesContent: [source],
    names: [],
    mappings: encodeSourceMapMappings(mappings),
  };
}

function composedClassesFor(source: string, className: string, classes: Record<string, string>): string[] {
  const composed: string[] = [];
  const blockPattern = new RegExp(`\\.${escapeRegExp(className)}\\s*\\{([\\s\\S]*?)\\}`, "g");
  let block: RegExpExecArray | null;

  while ((block = blockPattern.exec(source)) !== null) {
    const composePattern = /\bcomposes\s*:\s*([^;]+);/g;
    let compose: RegExpExecArray | null;

    while ((compose = composePattern.exec(block[1])) !== null) {
      for (const name of compose[1].split(/\s+/).filter(Boolean)) {
        if (classes[name] && !composed.includes(classes[name])) {
          composed.push(classes[name]);
        }
      }
    }
  }

  return composed;
}

function transformCssModuleCss(source: string, classes: Record<string, string>, fileHash: string): { css: string; map: CssMapping[] } {
  let output = "";
  let index = 0;
  let generatedLine = 0;
  let generatedColumn = 0;
  const map: CssMapping[] = [];
  const originalPositions = sourcePositions(source);

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "\"" || char === "'") {
      const end = skipCssString(source, index);
      appendOriginal(source.slice(index, end), index);
      index = end;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = skipCssComment(source, index);
      appendOriginal(source.slice(index, end), index);
      index = end;
      continue;
    }

    if (isComposesDeclarationLine(source, index)) {
      index = skipCssLine(source, index);
      continue;
    }

    if (source.startsWith(":global(", index)) {
      const start = index + ":global(".length;
      const end = findMatchingCssParen(source, start - 1);
      appendOriginal(source.slice(start, end), start);
      index = end + 1;
      continue;
    }

    if (char === "." && isCssIdentStart(next ?? "")) {
      const nameStart = index + 1;
      const nameEnd = readCssIdentEnd(source, nameStart);
      const local = source.slice(nameStart, nameEnd);
      const scoped = scopedClassName(local, fileHash);
      classes[local] ??= scoped;
      appendGenerated(`.${scoped}`, index);
      index = nameEnd;
      continue;
    }

    appendOriginal(char, index);
    index++;
  }

  return { css: output, map };

  function appendOriginal(value: string, originalIndex: number): void {
    for (let offset = 0; offset < value.length; offset++) {
      appendGeneratedChar(value[offset], originalIndex + offset);
    }
  }

  function appendGenerated(value: string, originalIndex: number): void {
    for (const char of value) {
      appendGeneratedChar(char, originalIndex);
    }
  }

  function appendGeneratedChar(char: string, originalIndex: number): void {
    addMapping(originalIndex);
    output += char;

    if (char === "\n") {
      generatedLine++;
      generatedColumn = 0;
    } else {
      generatedColumn++;
    }
  }

  function addMapping(originalIndex: number): void {
    const original = originalPositions[originalIndex];
    const previous = map.at(-1);

    if (
      previous &&
      previous.generatedLine === generatedLine &&
      previous.generatedColumn === generatedColumn &&
      previous.originalLine === original.line &&
      previous.originalColumn === original.column
    ) {
      return;
    }

    map.push({
      generatedLine,
      generatedColumn,
      sourceIndex: 0,
      originalLine: original.line,
      originalColumn: original.column,
    });
  }
}

function sourcePositions(source: string): Array<{ line: number; column: number }> {
  const positions: Array<{ line: number; column: number }> = [];
  let line = 0;
  let column = 0;

  for (let index = 0; index <= source.length; index++) {
    positions[index] = { line, column };

    if (source[index] === "\n") {
      line++;
      column = 0;
    } else {
      column++;
    }
  }

  return positions;
}

function isComposesDeclarationLine(source: string, index: number): boolean {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;

  if (index !== lineStart) {
    return false;
  }

  return /^\s*composes\s*:/.test(source.slice(index));
}

function skipCssLine(source: string, index: number): number {
  const end = source.indexOf("\n", index);
  return end === -1 ? source.length : end + 1;
}

function encodeSourceMapMappings(mappings: CssMapping[]): string {
  const lines = new Map<number, CssMapping[]>();

  for (const mapping of mappings) {
    const line = lines.get(mapping.generatedLine);

    if (line) {
      line.push(mapping);
    } else {
      lines.set(mapping.generatedLine, [mapping]);
    }
  }

  const maxLine = mappings.reduce((max, mapping) => Math.max(max, mapping.generatedLine), 0);
  let previousSource = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  const encodedLines: string[] = [];

  for (let line = 0; line <= maxLine; line++) {
    const segments = lines.get(line) ?? [];
    let previousGeneratedColumn = 0;

    encodedLines.push(segments.map((segment) => {
      const encoded = [
        encodeVlq(segment.generatedColumn - previousGeneratedColumn),
        encodeVlq(segment.sourceIndex - previousSource),
        encodeVlq(segment.originalLine - previousOriginalLine),
        encodeVlq(segment.originalColumn - previousOriginalColumn),
      ].join("");

      previousGeneratedColumn = segment.generatedColumn;
      previousSource = segment.sourceIndex;
      previousOriginalLine = segment.originalLine;
      previousOriginalColumn = segment.originalColumn;
      return encoded;
    }).join(","));
  }

  return encodedLines.join(";");
}

function encodeVlq(value: number): string {
  let vlq = value < 0 ? ((-value) << 1) + 1 : value << 1;
  let encoded = "";

  do {
    let digit = vlq & 31;
    vlq >>>= 5;

    if (vlq > 0) {
      digit |= 32;
    }

    encoded += base64Digits[digit];
  } while (vlq > 0);

  return encoded;
}

const base64Digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function scopedClassName(local: string, fileHash: string): string {
  return `${local}_${fileHash}`;
}

function safeExportStatement(name: string, value: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? `export const ${name} = ${JSON.stringify(value)};` : "";
}

function isCssIdentStart(char: string): boolean {
  return /[A-Za-z_-]/.test(char);
}

function isCssIdentPart(char: string): boolean {
  return /[A-Za-z0-9_-]/.test(char);
}

function readCssIdentEnd(source: string, start: number): number {
  let index = start;

  while (index < source.length && isCssIdentPart(source[index])) {
    index++;
  }

  return index;
}

function skipCssString(source: string, start: number): number {
  const quote = source[start];
  let index = start + 1;

  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }

    if (source[index] === quote) {
      return index + 1;
    }

    index++;
  }

  return index;
}

function skipCssComment(source: string, start: number): number {
  const end = source.indexOf("*/", start + 2);
  return end === -1 ? source.length : end + 2;
}

function findMatchingCssParen(source: string, start: number): number {
  let depth = 0;
  let index = start;

  while (index < source.length) {
    const char = source[index];

    if (char === "\"" || char === "'") {
      index = skipCssString(source, index);
      continue;
    }

    if (char === "(") depth++;
    if (char === ")") depth--;
    if (depth === 0) return index;
    index++;
  }

  throw new Error("Missing closing ) in CSS module :global().");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function outputBasePathFor(inputPath: string, root: string, outDir: string): string {
  return resolve(outDir, `${relative(root, inputPath)}.ts`);
}

function outputPathFor(inputPath: string, root: string, outDir: string, hash: string): string {
  return resolve(outDir, `${relative(root, inputPath)}.${hash}.ts`);
}

function clientOutputPathFor(inputPath: string, root: string, outDir: string): string {
  return resolve(outDir, `${relative(root, inputPath)}.client.ts`);
}

function cssModuleJsOutputBasePathFor(inputPath: string, root: string, outDir: string): string {
  return resolve(outDir, `${relative(root, inputPath)}.ts`);
}

function cssModuleJsOutputPathFor(inputPath: string, root: string, outDir: string, hash: string): string {
  return resolve(outDir, `${relative(root, inputPath)}.${hash}.ts`);
}

function cssModuleCssOutputPathFor(inputPath: string, root: string, outDir: string): string {
  return resolve(outDir, `${relative(root, inputPath)}`);
}

function cssModuleCssMapOutputPathFor(inputPath: string, root: string, outDir: string): string {
  return resolve(outDir, `${relative(root, inputPath)}.map`);
}

function endpointOutputPathFor(inputPath: string, root: string, outDir: string): string {
  return resolve(outDir, `${relative(root, inputPath)}`);
}

function findEndpointMethodExports(source: string): string[] {
  const methods = new Set<string>();
  const pattern = /\bexport\s+(?:async\s+)?(?:function|const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    methods.add(match[1]);
  }

  return [...methods];
}

function toImportSpecifier(path: string): string {
  const normalized = path.replaceAll("\\", "/");

  if (normalized.startsWith(".")) {
    return normalized;
  }

  return `./${normalized}`;
}

async function cleanupGeneratedModuleVariants(currentPath: string, basePath: string): Promise<void> {
  const dir = dirname(basePath);
  const baseName = basename(basePath);
  const variantPrefix = `${baseName.slice(0, -".ts".length)}.`;

  let entries: string[];

  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  await Promise.all(entries.map(async (entry) => {
    if (entry !== baseName && !(entry.startsWith(variantPrefix) && entry.endsWith(".ts"))) {
      return;
    }

    const path = resolve(dir, entry);

    if (path === currentPath) {
      return;
    }

    await unlink(path).catch(() => {});
  }));
}

function sourcePosition(source: string, index: number): { line: number; column: number } {
  let line = 0;
  let column = 0;

  for (let i = 0; i < index; i++) {
    if (source[i] === "\n") {
      line++;
      column = 0;
    } else {
      column++;
    }
  }

  return { line, column };
}

function parseModuleSourceLocation(codeframe: string): { line: number; column: number } | null {
  const match = /\[(?:[^:\]]+:)?(\d+):(\d+)\]/.exec(codeframe);

  if (!match) {
    return null;
  }

  return {
    line: Number(match[1]),
    column: Number(match[2]),
  };
}

function indent(source: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return source.split("\n").map((line) => line.length > 0 ? `${prefix}${line}` : line).join("\n");
}

function indexFromLineColumn(source: string, line: number, column: number): number {
  let currentLine = 1;
  let currentColumn = 1;

  for (let index = 0; index < source.length; index++) {
    if (currentLine === line && currentColumn === column) {
      return index;
    }

    if (source[index] === "\n") {
      currentLine++;
      currentColumn = 1;
    } else {
      currentColumn++;
    }
  }

  return source.length;
}
