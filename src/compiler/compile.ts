import { parseSync } from "oxc-parser";
import type {
  ClientEvent,
  ClientAttributeBinding,
  ClientStateBinding,
  ClientTextBinding,
  CompileResult,
  ComponentBlock,
  ComponentProp,
  ComponentVisibility,
} from "./types.ts";

export interface CompileOptions {
  runtimeImport?: string;
  rewriteImport?: (statement: string) => string;
}

export interface EndpointCompileResult {
  code: string;
  methods: string[];
}

const decorators = new Set<ComponentVisibility>([
  "declare",
  "public",
  "default",
  "private",
]);

const componentModifiers = new Set([
  "client",
]);

export function compileElizabeth(source: string, sourceName = "anonymous.liz", options: CompileOptions = {}): CompileResult {
  const components: ComponentBlock[] = [];
  const moduleParts: string[] = [];
  const clientEvents = new Map<string, ClientEvent[]>();
  const clientStates = new Map<string, ClientStateBinding[]>();
  const clientTextBindings = new Map<string, ClientTextBinding[]>();
  const clientAttrBindings = new Map<string, ClientAttributeBinding[]>();
  const clientMetadata = {
    events: clientEvents,
    states: clientStates,
    textBindings: clientTextBindings,
    attrBindings: clientAttrBindings,
  };
  let index = 0;

  while (index < source.length) {
    index = skipWhitespace(source, index);

    if (isElizabethComponentStart(source, index)) {
      const parsed = readComponent(source, index, sourceName);
      components.push(parsed.block);
      moduleParts.push(emitComponent(parsed.block, clientMetadata));
      index = parsed.end;
      continue;
    }

    if (index < source.length) {
      const componentTagName = readTopLevelComponentTagName(source, index)
      if (componentTagName !== null) {
        throw syntaxError(sourceName, source, index, `Unexpected top-level component-like ${componentTagName} tag. If this is a component declaration, add @declare, @public, @default, or @private before it.`);
      }

      const end = readTopLevelModuleChunkEnd(source, index);
      const statement = source.slice(index, end).trim();

      if (statement.length > 0) {
        validateTopLevelModuleScript(statement, sourceName, source, index);
        moduleParts.push(rewriteTopLevelImports(statement, options));
      }

      index = end;
    }
  }

  const runtimeImport = options.runtimeImport ?? `import { escapeHtml, escapeAttribute } from "../src/runtime/html.ts";`;

  return {
    code: [runtimeImport, "", ...moduleParts, ""].join("\n"),
    clientComponents: components
      .filter((component) => component.client)
      .map((component) => ({
        name: component.name,
        exportName: exportNameFor(component),
        events: clientEvents.get(component.name) ?? [],
        states: clientStates.get(component.name) ?? [],
        textBindings: clientTextBindings.get(component.name) ?? [],
        attrBindings: clientAttrBindings.get(component.name) ?? [],
      })),
  };
}

export function compileElizabethEndpoint(source: string, sourceName = "anonymous.liz", options: CompileOptions = {}): EndpointCompileResult {
  const moduleParts: string[] = [];
  const handlers: string[] = [];
  const methods: string[] = [];
  let index = 0;

  while (index < source.length) {
    index = skipWhitespace(source, index);

    const method = readEndpointMethodBlock(source, index);
    if (method) {
      methods.push(method.method);
      handlers.push(emitEndpointMethod(method.method, method.body));
      index = method.end;
      continue;
    }

    if (index < source.length) {
      const componentTagName = readTopLevelComponentTagName(source, index)
      if (componentTagName !== null) {
        throw syntaxError(
          sourceName,
          source,
          index,
          `Unexpected top-level component-like <${componentTagName}> tag. If this is a component declaration, add @declare, @public, @default, or @private before it.`,
        );
      }

      const end = readEndpointTopLevelModuleChunkEnd(source, index);
      const statement = source.slice(index, end).trim();

      if (statement.length > 0) {
        validateTopLevelModuleScript(statement, sourceName, source, index);
        moduleParts.push(rewriteTopLevelImports(statement, options));
      }

      index = end;
    }
  }

  const runtimeImport = options.runtimeImport ?? `import { escapeHtml, escapeAttribute } from "../src/runtime/html.ts";`;

  return {
    code: [runtimeImport, "", ...moduleParts, "", ...handlers, ""].join("\n"),
    methods,
  };
}

interface ClientMetadataMaps {
  events: Map<string, ClientEvent[]>;
  states: Map<string, ClientStateBinding[]>;
  textBindings: Map<string, ClientTextBinding[]>;
  attrBindings: Map<string, ClientAttributeBinding[]>;
}

function isElizabethComponentStart(source: string, start: number): boolean {
  let index = start;
  let found = false;

  while (source[index] === "@") {
    const match = /^@([A-Za-z_]\w*)/.exec(source.slice(index));

    if (!match) {
      return false;
    }

    const name = match[1];

    if (!decorators.has(name as ComponentVisibility) && !componentModifiers.has(name)) {
      return false;
    }

    found = true;
    index += match[0].length;
    index = skipWhitespaceAndLineComments(source, index);
  }

  return found && /^<[A-Z][A-Za-z0-9_]*[^>]*>/.test(source.slice(index));
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
      index = skipString(source, index);
      continue;
    }

    if (char === "/" && next === "/") {
      index = skipLineComment(source, index);
      continue;
    }

    if (char === "/" && next === "*") {
      index = skipBlockComment(source, index);
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

function readEndpointTopLevelModuleChunkEnd(source: string, start: number): number {
  let index = start;
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "\"" || char === "'" || char === "`") {
      index = skipString(source, index);
      continue;
    }

    if (char === "/" && next === "/") {
      index = skipLineComment(source, index);
      continue;
    }

    if (char === "/" && next === "*") {
      index = skipBlockComment(source, index);
      continue;
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

function isEndpointMethodStart(source: string, index: number): boolean {
  return /^<(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)>/.test(source.slice(index));
}

function readEndpointMethodBlock(source: string, start: number): { method: string; body: string; end: number } | null {
  const open = /^<(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)>/.exec(source.slice(start));
  if (!open) {
    return null;
  }

  const method = open[1];
  const bodyStart = start + open[0].length;
  const close = `</${method}>`;
  const bodyEnd = source.indexOf(close, bodyStart);

  if (bodyEnd === -1) {
    throw new Error(`Missing closing endpoint method tag ${close}.`);
  }

  return {
    method,
    body: source.slice(bodyStart, bodyEnd),
    end: bodyEnd + close.length,
  };
}

function emitEndpointMethod(method: string, body: string): string {
  const renderStart = findRenderMarkupStart(body);

  if (renderStart === -1) {
    return `export async function ${method}(ctx) {
${indent(body.trim(), 2)}
}`;
  }

  const logic = body.slice(0, renderStart).trim();
  const markup = body.slice(renderStart).trim();

  return `export async function ${method}(ctx) {
${indent(logic, 2)}
  let __html = "";
${indent(emitMarkupStatements(markup, "__html"), 2)}
  return new Response(__html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}`;
}

function validateTopLevelModuleScript(source: string, sourceName: string, fullSource: string, offset: number): void {
  const errors = parseWithOxc(sourceName, source);

  if (errors.length === 0) {
    return;
  }

  throw syntaxError(sourceName, fullSource, offset, `Invalid module script: ${errors[0].message}`);
}

function rewriteTopLevelImports(source: string, options: CompileOptions): string {
  if (!options.rewriteImport) {
    return source;
  }

  const parsed = parseSync("module.liz.ts", source, {
    lang: "ts",
    sourceType: "module",
  });
  let rewritten = source;

  for (const importEntry of [...parsed.module.staticImports].reverse()) {
    const statement = source.slice(importEntry.start, importEntry.end);
    rewritten = `${rewritten.slice(0, importEntry.start)}${options.rewriteImport(statement)}${rewritten.slice(importEntry.end)}`;
  }

  return rewritten;
}

function emitComponent(component: ComponentBlock, clientMetadata: ClientMetadataMaps): string {
  const render = splitComponentBody(component.body);
  const renderStart = findRenderMarkupStart(component.body);
  let markup: string;
  try {
    markup = scopeComponentStyles(render.markup, component.name);
  } catch (error) {
    throw remapComponentError(error, component, renderStart);
  }
  const events: ClientEvent[] = [];
  const textBindings: ClientTextBinding[] = [];
  const attrBindings: ClientAttributeBinding[] = [];
  const states = component.client ? findClientStates(render.logic) : [];
  let htmlStatements: string;
  try {
    htmlStatements = component.client
      ? emitClientHtmlStatements(component, markup, "__html", events, textBindings, attrBindings, states)
      : emitMarkupStatements(markup, "__html");
  } catch (error) {
    throw remapComponentError(error, component, renderStart);
  }
  clientMetadata.events.set(component.name, events);
  clientMetadata.states.set(component.name, states);
  clientMetadata.textBindings.set(component.name, textBindings);
  clientMetadata.attrBindings.set(component.name, attrBindings);
  const propLocals = emitPropLocals(component);
  const logic = [propLocals, render.logic.trim()].filter(Boolean).join("\n");
  const isAsync = containsAwait(logic) || containsAwait(markup) || containsComponentTag(markup);
  const declaration = declarationFor(component, isAsync);

  return `${declaration} {
${indent(logic, 2)}
  let __html = "";
${indent(htmlStatements, 2)}
  return __html;
}`;
}

function remapComponentError(error: unknown, component: ComponentBlock, renderStart: number): Error {
  if (error instanceof MarkupSyntaxError) {
    return syntaxError(component.sourceName, component.source, component.bodyStart + renderStart + error.index, error.message);
  }

  return error instanceof Error ? error : new Error(String(error));
}

function emitClientHtmlStatements(
  component: ComponentBlock,
  markup: string,
  target: string,
  events: ClientEvent[],
  textBindings: ClientTextBinding[],
  attrBindings: ClientAttributeBinding[],
  states: ClientStateBinding[],
): string {
  const options = {
    events,
    textBindings,
    attrBindings,
    stateNames: new Set(states.map((state) => state.name)),
  };

  return [
    `${target} += ${JSON.stringify(`<el-island data-elizabeth-client="${component.name}">`)};`,
    emitMarkupStatements(markup, target, options),
    `${target} += ${JSON.stringify("</el-island>")};`,
  ].join("\n");
}

function emitPropLocals(component: ComponentBlock): string {
  const props = [...component.props];

  if (!props.some((prop) => prop.name === "children")) {
    props.push({ name: "children", defaultValue: "\"\"" });
  }

  if (props.length === 0) {
    return "";
  }

  const destructured = props.map((prop) => {
    if (prop.defaultValue !== null) {
      return `${prop.name} = ${prop.defaultValue}`;
    }

    return prop.name;
  }).join(", ");

  return `const { ${destructured} } = props;`;
}

function declarationFor(component: ComponentBlock, isAsync: boolean): string {
  const args = "props = {}, ctx = {}";
  const keyword = isAsync ? "async function" : "function";

  if (component.visibility === "public") {
    return `export ${keyword} ${component.name}(${args})`;
  }

  if (component.visibility === "default") {
    return `export default ${keyword} ${component.name}(${args})`;
  }

  return `${keyword} ${component.name}(${args})`;
}

function exportNameFor(component: ComponentBlock): string | null {
  if (component.visibility === "public") {
    return component.name;
  }

  if (component.visibility === "default") {
    return "default";
  }

  return null;
}

function splitComponentBody(body: string): { logic: string; markup: string } {
  const start = findRenderMarkupStart(body);

  if (start === -1) {
    throw new Error("Component must contain one render markup block.");
  }

  return {
    logic: body.slice(0, start),
    markup: body.slice(start).trim(),
  };
}

interface EmitHtmlOptions {
  events?: ClientEvent[];
  textBindings?: ClientTextBinding[];
  attrBindings?: ClientAttributeBinding[];
  stateNames?: Set<string>;
  sourceOffset?: number;
}

function emitMarkupStatements(markup: string, target: string, options: EmitHtmlOptions = {}): string {
  const statements: string[] = [];
  let text = "";
  let index = 0;
  const sourceOffset = options.sourceOffset ?? 0;

  while (index < markup.length) {
    const char = markup[index];

    if (char === "{") {
      const end = findMatching(markup, index, "{", "}");
      const expression = markup.slice(index + 1, end).trim();
      flushText();
      if (isExpressionScript(expression)) {
        statements.push(`${target} += ${emitInterpolatedExpressionWithOptions(expression, options)};`);
      } else {
        try {
          statements.push(emitScriptBlockStatements(expression, target, withSourceOffset(options, sourceOffset + index + 1)));
        } catch (error) {
          if (error instanceof MarkupSyntaxError) {
            throw error;
          }

          const literalHint = expression.startsWith("#")
            ? ` Elizabeth treats \`{...}\` as JavaScript in markup. To render this text, write \`{${JSON.stringify(expression)}}\`.`
            : "";
          throw new MarkupSyntaxError(
            `Invalid markup expression or script block {${expression}}.${literalHint} ${error instanceof Error ? error.message : String(error)}`.trim(),
            sourceOffset + index,
          );
        }
      }
      index = end + 1;
      continue;
    }

    if (char === "<") {
      if (sourceStartsWithHtmlComment(markup, index)) {
        const end = readHtmlCommentEnd(markup, index);
        flushText();
        statements.push(`${target} += ${JSON.stringify(markup.slice(index, end))};`);
        index = end;
        continue;
      }

      const tag = readMarkupTag(markup, index);

      if (tag.isComponent && !tag.closing) {
        flushText();

        if (tag.selfClosing) {
          statements.push(`${target} += await ${tag.name}(${emitPropsObject(tag.attributes)}, ctx);`);
          index = tag.end;
          continue;
        }

        const close = findComponentClose(markup, tag);
        const children = emitMarkupAsyncExpression(markup.slice(tag.end, close.start), options);
        statements.push(`${target} += await ${tag.name}(${emitPropsObject(tag.attributes, children)}, ctx);`);
        index = close.end;
        continue;
      }

      flushText();
      statements.push(`${target} += ${emitNativeTagExpression(tag, options)};`);

      if (!tag.closing && !tag.selfClosing && isRawTextElement(tag.name)) {
        const close = findRawTextClose(markup, tag);
        statements.push(`${target} += ${JSON.stringify(markup.slice(tag.end, close.start))};`);
        statements.push(`${target} += ${JSON.stringify(markup.slice(close.start, close.end))};`);
        index = close.end;
        continue;
      }

      index = tag.end;
      continue;
    }

    text += char;
    index++;
  }

  flushText();
  return statements.filter(Boolean).join("\n");

  function flushText(): void {
    if (text.length > 0) {
      statements.push(`${target} += ${JSON.stringify(text)};`);
      text = "";
    }
  }
}

function emitMarkupAsyncExpression(markup: string, options: EmitHtmlOptions): string {
  return `(await (async () => {
  let __children = "";
${indent(emitMarkupStatements(markup, "__children", options), 2)}
  return __children;
})())`;
}

function readJsBlockInMarkup(
  source: string,
  start: number,
  target: string,
  options: EmitHtmlOptions,
): { code: string; end: number } | null {
  const statementStart = skipWhitespace(source, start);

  if (statementStart >= source.length || source[statementStart] === "<" || source[statementStart] === "{") {
    return null;
  }

  const lineStart = source.lastIndexOf("\n", start - 1) + 1;

  if (source.slice(lineStart, statementStart).trim().length > 0) {
    return null;
  }

  const firstBrace = findJsBlockOpenInMarkup(source, statementStart);

  if (firstBrace === -1) {
    return null;
  }

  const pieces: string[] = [];
  let cursor = statementStart;
  let brace = firstBrace;

  while (true) {
    const header = source.slice(cursor, brace).trimEnd();
    validateScriptBlockHeader(header);
    const bodyEnd = findMatching(source, brace, "{", "}");
    const body = source.slice(brace + 1, bodyEnd);
    pieces.push(`${header} {`);
    pieces.push(indent(emitMarkupStatements(body, target, withSourceOffset(options, (options.sourceOffset ?? 0) + brace + 1)), 2));
    pieces.push("}");

    const continuationStart = bodyEnd + 1;
    const nextToken = skipWhitespace(source, continuationStart);
    const continuationBrace = findJsBlockOpenInMarkup(source, nextToken);

    if (
      continuationBrace === -1 ||
      source.slice(nextToken, continuationBrace).includes(";") ||
      !isJsBlockContinuation(source.slice(nextToken, continuationBrace).trim())
    ) {
      return {
        code: pieces.join("\n"),
        end: continuationStart,
      };
    }

    cursor = nextToken;
    brace = continuationBrace;
  }
}

function findJsBlockOpenInMarkup(source: string, start: number): number {
  let index = start;
  let parenDepth = 0;
  let bracketDepth = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "\"" || char === "'" || char === "`") {
      index = skipString(source, index);
      continue;
    }

    if (char === "/" && next === "/") {
      index = skipLineComment(source, index);
      continue;
    }

    if (char === "/" && next === "*") {
      index = skipBlockComment(source, index);
      continue;
    }

    if ((char === "<" && isMarkupStart(source, index)) || char === "\n") {
      return -1;
    }

    if (char === "(") parenDepth++;
    else if (char === ")") parenDepth--;
    else if (char === "[") bracketDepth++;
    else if (char === "]") bracketDepth--;
    else if (char === "{" && parenDepth === 0 && bracketDepth === 0) {
      return index;
    }

    index++;
  }

  return -1;
}

function emitScriptBlockStatements(source: string, target: string, options: EmitHtmlOptions): string {
  const statements: string[] = [];
  let index = 0;

  while (index < source.length) {
    index = skipWhitespace(source, index);

    if (index >= source.length) {
      break;
    }

    const jsBlock = readJsBlockInMarkup(source, index, target, options);

    if (jsBlock) {
      statements.push(jsBlock.code);
      index = jsBlock.end;
      continue;
    }

    if (source[index] === "<") {
      const markupEnd = readMarkupRunEnd(source, index);
      statements.push(emitMarkupStatements(source.slice(index, markupEnd), target, withSourceOffset(options, (options.sourceOffset ?? 0) + index)));
      index = markupEnd;
      continue;
    }

    if (source[index] === "{") {
      const end = findMatching(source, index, "{", "}");
      const inner = source.slice(index + 1, end).trim();
      statements.push(
        isExpressionScript(inner)
          ? `${target} += ${emitInterpolatedExpressionWithOptions(inner, options)};`
          : emitScriptBlockStatements(inner, target, options),
      );
      index = end + 1;
      continue;
    }

    const end = readScriptStatementEnd(source, index);
    const statement = source.slice(index, end).trim();

    if (statement.length > 0) {
      try {
        validateScriptSyntax(statement, "markup script statement");
      } catch (error) {
        const message = statement.startsWith("#")
          ? `Invalid markup expression {${statement}}. Elizabeth treats \`{...}\` as JavaScript in markup. To render this text, write \`{${JSON.stringify(statement)}}\`.`
          : error instanceof Error ? error.message : String(error);
        throw new MarkupSyntaxError(message, (options.sourceOffset ?? 0) + index);
      }
      statements.push(statement.endsWith(";") ? statement : `${statement};`);
    }

    index = end;
  }

  return statements.filter(Boolean).join("\n");
}

function readMarkupRunEnd(source: string, start: number): number {
  let index = start;

  while (index < source.length) {
    const char = source[index];

    if (char === "<") {
      if (sourceStartsWithHtmlComment(source, index)) {
        index = readHtmlCommentEnd(source, index);
        continue;
      }

      const tag = readMarkupTag(source, index);
      index = tag.end;

      if (!tag.closing && !tag.selfClosing && isRawTextElement(tag.name)) {
        index = findRawTextClose(source, tag).end;
      }

      continue;
    }

    if (char === "{") {
      index = findMatching(source, index, "{", "}") + 1;
      continue;
    }

    if (isLineStartJsBlock(source, index)) {
      return index;
    }

    index++;
  }

  return index;
}

function isLineStartJsBlock(source: string, index: number): boolean {
  if (index > 0 && source[index - 1] !== "\n") {
    return false;
  }

  const statementStart = skipWhitespace(source, index);
  if (statementStart >= source.length || source[statementStart] === "<" || source[statementStart] === "{") {
    return false;
  }

  return findJsBlockOpenInMarkup(source, statementStart) !== -1;
}

function readScriptStatementEnd(source: string, start: number): number {
  let index = start;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "\"" || char === "'" || char === "`") {
      index = skipString(source, index);
      continue;
    }

    if (char === "/" && next === "/") {
      index = skipLineComment(source, index);
      continue;
    }

    if (char === "/" && next === "*") {
      index = skipBlockComment(source, index);
      continue;
    }

    if (char === "(") parenDepth++;
    else if (char === ")") parenDepth--;
    else if (char === "[") bracketDepth++;
    else if (char === "]") bracketDepth--;
    else if (char === "{") braceDepth++;
    else if (char === "}") braceDepth--;
    else if (char === ";" && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      return index + 1;
    } else if (char === "<" && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && isMarkupStart(source, index)) {
      return index;
    } else if (char === "\n" && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      const nextToken = skipWhitespace(source, index + 1);

      if (source[nextToken] === "<" || findJsBlockOpenInMarkup(source, nextToken) !== -1) {
        return index;
      }
    }

    index++;
  }

  return index;
}

function isJsBlockContinuation(header: string): boolean {
  return /^(?:else\b|catch\b|finally\b|while\b)/.test(header);
}

function withSourceOffset(options: EmitHtmlOptions, sourceOffset: number): EmitHtmlOptions {
  return {
    ...options,
    sourceOffset,
  };
}

function isMarkupStart(source: string, index: number): boolean {
  return source.startsWith("<!--", index) || /^<\/?[A-Za-z][A-Za-z0-9_.-]*/.test(source.slice(index));
}

function validateScriptBlockHeader(header: string): void {
  const trimmed = header.trim();

  if (trimmed.startsWith("else if")) {
    validateScriptSyntax(`if (true) {} ${trimmed} {}`, "markup script header");
    return;
  }

  if (trimmed === "else") {
    validateScriptSyntax("if (true) {} else {}", "markup script header");
    return;
  }

  if (trimmed.startsWith("catch")) {
    validateScriptSyntax(`try {} ${trimmed} {}`, "markup script header");
    return;
  }

  if (trimmed === "finally") {
    validateScriptSyntax("try {} finally {}", "markup script header");
    return;
  }

  if (trimmed.startsWith("while")) {
    validateScriptSyntax(`do {} ${trimmed};`, "markup script header");
    return;
  }

  validateScriptSyntax(`${trimmed} {}`, "markup script header");
}

function isExpressionScript(source: string): boolean {
  if (source.length === 0) {
    return true;
  }

  return parseWithOxc("__elizabeth_expression.ts", `const __elizabeth_expression = (${source});`).length === 0;
}

function validateScriptSyntax(source: string, label: string): void {
  const errors = parseWithOxc(`${label.replace(/\s+/g, "-")}.ts`, source);

  if (errors.length > 0) {
    throw new Error(`${label} is not valid JavaScript: ${errors[0].message}`);
  }
}

function parseWithOxc(filename: string, source: string): Array<{ message: string }> {
  try {
    return parseSync(filename, source, {
      lang: "ts",
      sourceType: "module",
    }).errors;
  } catch (error) {
    return [{ message: error instanceof Error ? error.message : String(error) }];
  }
}

function emitHtmlExpression(markup: string, options: EmitHtmlOptions = {}): string {
  const tokens: string[] = [];
  let text = "";
  let index = 0;

  while (index < markup.length) {
    const char = markup[index];

    if (char === "{") {
      const end = findMatching(markup, index, "{", "}");
      const expression = markup.slice(index + 1, end).trim();
      flushText();
      tokens.push(emitInterpolatedExpressionWithOptions(expression, options));
      index = end + 1;
      continue;
    }

    if (char === "<") {
      if (sourceStartsWithHtmlComment(markup, index)) {
        const end = readHtmlCommentEnd(markup, index);
        flushText();
        tokens.push(JSON.stringify(markup.slice(index, end)));
        index = end;
        continue;
      }

      const tag = readMarkupTag(markup, index);

      if (tag.isComponent && !tag.closing) {
        flushText();

        if (tag.selfClosing) {
          tokens.push(`await ${tag.name}(${emitPropsObject(tag.attributes)}, ctx)`);
          index = tag.end;
          continue;
        }

        const close = findComponentClose(markup, tag);
        const children = emitHtmlExpression(markup.slice(tag.end, close.start), options);
        tokens.push(`await ${tag.name}(${emitPropsObject(tag.attributes, children)}, ctx)`);
        index = close.end;
        continue;
      }

      flushText();
      tokens.push(emitNativeTagExpression(tag, options));

      if (!tag.closing && !tag.selfClosing && isRawTextElement(tag.name)) {
        const close = findRawTextClose(markup, tag);
        tokens.push(JSON.stringify(markup.slice(tag.end, close.start)));
        tokens.push(JSON.stringify(markup.slice(close.start, close.end)));
        index = close.end;
        continue;
      }

      index = tag.end;
      continue;
    }

    text += char;
    index++;
  }

  flushText();

  if (tokens.length === 0) {
    return "\"\"";
  }

  return tokens.join(" + ");

  function flushText(): void {
    if (text.length > 0) {
      tokens.push(JSON.stringify(text));
      text = "";
    }
  }
}

function emitInterpolatedExpression(expression: string): string {
  if (expression === "children") {
    return "children";
  }

  return `escapeHtml(${expression})`;
}

function emitInterpolatedExpressionWithOptions(expression: string, options: EmitHtmlOptions): string {
  if (!options.textBindings || !expressionReferencesState(expression, options.stateNames)) {
    return emitInterpolatedExpression(expression);
  }

  const id = options.textBindings.length;
  options.textBindings.push({ id, expression });
  return `${JSON.stringify(`<span data-elizabeth-text="${id}">`)} + ${emitInterpolatedExpression(expression)} + ${JSON.stringify("</span>")}`;
}

function expressionReferencesState(expression: string, stateNames?: Set<string>): boolean {
  if (!stateNames || stateNames.size === 0) {
    return false;
  }

  let index = 0;

  while (index < expression.length) {
    const char = expression[index];
    const next = expression[index + 1];

    if (char === "\"" || char === "'" || char === "`") {
      index = skipString(expression, index);
      continue;
    }

    if (char === "/" && next === "/") {
      index = skipLineComment(expression, index);
      continue;
    }

    if (char === "/" && next === "*") {
      index = skipBlockComment(expression, index);
      continue;
    }

    const match = /^[A-Za-z_$][\w$]*/.exec(expression.slice(index));
    if (match) {
      if (stateNames.has(match[0])) {
        return true;
      }

      index += match[0].length;
      continue;
    }

    index++;
  }

  return false;
}

function findClientStates(logic: string): ClientStateBinding[] {
  const states: ClientStateBinding[] = [];
  const callees = findClientStateCallees(logic);
  const pattern = /\b(?:const|let)\s+\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(logic)) !== null) {
    const callee = match[3];

    if (!callees.has(callee) && !callee.endsWith(".clientState")) {
      continue;
    }

    const initialStart = pattern.lastIndex;
    const initialEnd = findMatching(logic, initialStart - 1, "(", ")");

    states.push({
      name: match[1],
      setter: match[2],
      initialValue: logic.slice(initialStart, initialEnd).trim(),
    });

    pattern.lastIndex = initialEnd + 1;
  }

  return states;
}

function findClientStateCallees(logic: string): Set<string> {
  const callees = new Set(["clientState"]);
  const aliasPattern = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;?/g;
  let changed = true;

  while (changed) {
    changed = false;
    aliasPattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = aliasPattern.exec(logic)) !== null) {
      const alias = match[1];
      const target = match[2];

      if ((callees.has(target) || target.endsWith(".clientState")) && !callees.has(alias)) {
        callees.add(alias);
        changed = true;
      }
    }
  }

  return callees;
}

interface MarkupAttribute {
  name: string;
  value: string | null;
  kind: "boolean" | "expression" | "string";
}

class MarkupSyntaxError extends Error {
  constructor(message: string, readonly index: number) {
    super(message);
  }
}

interface MarkupTag {
  raw: string;
  name: string;
  attributes: MarkupAttribute[];
  closing: boolean;
  selfClosing: boolean;
  isComponent: boolean;
  start: number;
  end: number;
}

function emitNativeTagExpression(tag: MarkupTag, options: EmitHtmlOptions = {}): string {
  if (tag.closing) {
    return JSON.stringify(tag.raw);
  }

  const parts: string[] = [JSON.stringify(`<${tag.name}`)];

  for (const attribute of tag.attributes) {
    if (/^on[A-Z]/.test(attribute.name)) {
      if (options.events && attribute.kind === "expression") {
        const id = options.events.length;
        const eventName = attribute.name.slice(2).toLowerCase();
        options.events.push({
          id,
          eventName,
          handler: attribute.value ?? "",
        });
        parts.push(JSON.stringify(` data-elizabeth-event-${eventName}="${id}"`));
      }
      continue;
    }

    const name = normalizeHtmlAttributeName(attribute.name);

    if (attribute.kind === "boolean") {
      parts.push(JSON.stringify(` ${name}`));
      continue;
    }

    if (attribute.kind === "string") {
      parts.push(JSON.stringify(` ${name}="${escapeStaticAttribute(attribute.value ?? "")}"`));
      continue;
    }

    if (isBooleanHtmlAttribute(name)) {
      emitAttributeBindingMarker(parts, name, attribute.value ?? "", true, options);
      parts.push(`(${attribute.value} ? ${JSON.stringify(` ${name}`)} : "")`);
      continue;
    }

    emitAttributeBindingMarker(parts, name, attribute.value ?? "", false, options);
    parts.push(JSON.stringify(` ${name}="`));
    parts.push(`escapeAttribute(${attribute.value})`);
    parts.push(JSON.stringify("\""));
  }

  parts.push(JSON.stringify(tag.selfClosing ? " />" : ">"));
  return parts.join(" + ");
}

function emitAttributeBindingMarker(
  parts: string[],
  name: string,
  expression: string,
  isBoolean: boolean,
  options: EmitHtmlOptions,
): void {
  if (!options.attrBindings || !expressionReferencesState(expression, options.stateNames)) {
    return;
  }

  const id = options.attrBindings.length;
  options.attrBindings.push({
    id,
    name,
    expression,
    boolean: isBoolean,
  });
  parts.push(JSON.stringify(` data-elizabeth-attr-${id}=""`));
}

function emitPropsObject(attributes: MarkupAttribute[], children?: string): string {
  const entries: string[] = [];

  for (const attribute of attributes) {
    const key = /^[A-Za-z_$][\w$]*$/.test(attribute.name) ? attribute.name : JSON.stringify(attribute.name);

    if (attribute.kind === "boolean") {
      entries.push(`${key}: true`);
      continue;
    }

    if (attribute.kind === "string") {
      entries.push(`${key}: ${JSON.stringify(attribute.value ?? "")}`);
      continue;
    }

    entries.push(`${key}: ${attribute.value}`);
  }

  if (children !== undefined) {
    entries.push(`children: ${children}`);
  }

  return `{ ${entries.join(", ")} }`;
}

function readMarkupTag(source: string, start: number): MarkupTag {
  const tagEnd = findTagEnd(source, start);
  const raw = source.slice(start, tagEnd + 1);
  const closing = raw.startsWith("</");
  const nameMatch = /^<\/?\s*([A-Za-z][A-Za-z0-9_.-]*)/.exec(raw);

  if (!nameMatch) {
    throw new Error(`Invalid markup tag: ${raw}`);
  }

  const name = nameMatch[1];
  const selfClosing = !closing && /\/\s*>$/.test(raw);
  const attributesStart = nameMatch[0].length;
  const attributesEnd = raw.length - (selfClosing ? 2 : 1);
  const attributesSource = closing ? "" : raw.slice(attributesStart, attributesEnd);

  return {
    raw,
    name,
    attributes: parseAttributes(attributesSource, start + attributesStart),
    closing,
    selfClosing,
    isComponent: /^[A-Z]/.test(name),
    start,
    end: tagEnd + 1,
  };
}

function sourceStartsWithHtmlComment(source: string, index: number): boolean {
  return source.startsWith("<!--", index);
}

function readHtmlCommentEnd(source: string, start: number): number {
  const end = source.indexOf("-->", start + "<!--".length);

  if (end === -1) {
    throw new Error("Unterminated HTML comment.");
  }

  return end + "-->".length;
}

function parseAttributes(source: string, offset = 0): MarkupAttribute[] {
  const attributes: MarkupAttribute[] = [];
  let index = 0;

  while (index < source.length) {
    index = skipWhitespace(source, index);
    if (index >= source.length) {
      break;
    }

    const nameMatch = /^[A-Za-z_:][\w:.-]*/.exec(source.slice(index));
    if (!nameMatch) {
      throw new MarkupSyntaxError(`Invalid attribute near: ${source.slice(index)}`, offset + index);
    }

    const name = nameMatch[0];
    index += name.length;
    index = skipWhitespace(source, index);

    if (source[index] !== "=") {
      attributes.push({ name, value: null, kind: "boolean" });
      continue;
    }

    index++;
    index = skipWhitespace(source, index);

    if (source[index] === "\"" || source[index] === "'") {
      const end = skipString(source, index);
      attributes.push({
        name,
        value: source.slice(index + 1, end - 1),
        kind: "string",
      });
      index = end;
      continue;
    }

    if (source[index] === "{") {
      const end = findMatching(source, index, "{", "}");
      attributes.push({
        name,
        value: source.slice(index + 1, end).trim(),
        kind: "expression",
      });
      index = end + 1;
      continue;
    }

    if (source[index] === "`") {
      const end = skipString(source, index);
      const value = source.slice(index + 1, end - 1);
      throw new MarkupSyntaxError(`Attribute ${name} uses a backtick template without braces. Use ${name}={\`${value}\`} for a JavaScript expression, or ${name}="${value}" for a string.`, offset + index);
    }

    const end = readBareAttributeEnd(source, index);
    attributes.push({
      name,
      value: source.slice(index, end),
      kind: "string",
    });
    index = end;
  }

  return attributes;
}

function scopeComponentStyles(markup: string, componentName: string): string {
  const styleBlocks = readStyleBlocks(markup);

  if (styleBlocks.length === 0) {
    return markup;
  }

  const scope = hashString(componentName);
  const classMap = new Map<string, string>();

  for (const block of styleBlocks) {
    for (const className of findCssClassNames(block.css)) {
      classMap.set(className, `${className}_${scope}`);
    }
  }

  if (classMap.size === 0) {
    return markup;
  }

  let output = "";
  let cursor = 0;

  for (const block of styleBlocks) {
    output += rewriteStaticClassAttributes(markup.slice(cursor, block.start), classMap);
    output += addStyleScopeAttribute(rewriteCssClassNames(markup.slice(block.start, block.contentStart), classMap), componentName, scope);
    output += rewriteCssClassNames(block.css, classMap);
    output += markup.slice(block.contentEnd, block.end);
    cursor = block.end;
  }

  output += rewriteStaticClassAttributes(markup.slice(cursor), classMap);
  return output;
}

interface StyleBlock {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  css: string;
}

function readStyleBlocks(markup: string): StyleBlock[] {
  const blocks: StyleBlock[] = [];
  let index = 0;

  while (index < markup.length) {
    if (markup[index] !== "<" || !isMarkupStart(markup, index)) {
      index++;
      continue;
    }

    if (sourceStartsWithHtmlComment(markup, index)) {
      index = readHtmlCommentEnd(markup, index);
      continue;
    }

    const tag = readMarkupTag(markup, index);

    if (tag.name.toLowerCase() !== "style" || tag.closing || tag.selfClosing) {
      index = tag.end;
      continue;
    }

    const close = findRawTextClose(markup, tag);
    blocks.push({
      start: tag.start,
      end: close.end,
      contentStart: tag.end,
      contentEnd: close.start,
      css: markup.slice(tag.end, close.start),
    });
    index = close.end;
  }

  return blocks;
}

function findCssClassNames(css: string): Set<string> {
  const classes = new Set<string>();
  let index = 0;

  while (index < css.length) {
    const char = css[index];
    const next = css[index + 1];

    if (char === "\"" || char === "'") {
      index = skipString(css, index);
      continue;
    }

    if (char === "/" && next === "*") {
      index = skipBlockComment(css, index);
      continue;
    }

    if (css.startsWith(":global(", index)) {
      index = skipCssGlobal(css, index);
      continue;
    }

    if (char === "." && isCssIdentStart(next ?? "")) {
      const start = index + 1;
      const end = readCssIdentEnd(css, start);
      classes.add(css.slice(start, end));
      index = end;
      continue;
    }

    index++;
  }

  return classes;
}

function rewriteCssClassNames(css: string, classMap: Map<string, string>): string {
  let output = "";
  let index = 0;

  while (index < css.length) {
    const char = css[index];
    const next = css[index + 1];

    if (char === "\"" || char === "'") {
      const end = skipString(css, index);
      output += css.slice(index, end);
      index = end;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = skipBlockComment(css, index);
      output += css.slice(index, end);
      index = end;
      continue;
    }

    if (css.startsWith(":global(", index)) {
      const end = skipCssGlobal(css, index);
      output += css.slice(index, end);
      index = end;
      continue;
    }

    if (char === "." && isCssIdentStart(next ?? "")) {
      const start = index + 1;
      const end = readCssIdentEnd(css, start);
      const local = css.slice(start, end);
      output += `.${classMap.get(local) ?? local}`;
      index = end;
      continue;
    }

    output += char;
    index++;
  }

  return output;
}

function rewriteStaticClassAttributes(markup: string, classMap: Map<string, string>): string {
  let output = "";
  let index = 0;

  while (index < markup.length) {
    const match = /\b(className|class)\s*=/.exec(markup.slice(index));

    if (!match) {
      output += markup.slice(index);
      break;
    }

    const attrStart = index + match.index;
    const valueStart = skipWhitespace(markup, attrStart + match[0].length);
    output += markup.slice(index, attrStart);

    if (markup[valueStart] === "\"" || markup[valueStart] === "'") {
      const end = skipString(markup, valueStart);
      const quote = markup[valueStart];
      output += `${match[1]}=${quote}${rewriteClassTokenString(markup.slice(valueStart + 1, end - 1), classMap)}${quote}`;
      index = end;
      continue;
    }

    if (markup[valueStart] === "{") {
      const end = findMatching(markup, valueStart, "{", "}");
      output += `${match[1]}={${rewriteClassExpression(markup.slice(valueStart + 1, end), classMap)}}`;
      index = end + 1;
      continue;
    }

    output += markup.slice(attrStart, valueStart + 1);
    index = valueStart + 1;
  }

  return output;
}

function rewriteClassExpression(expression: string, classMap: Map<string, string>): string {
  let output = "";
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];

    if (char === "\"" || char === "'") {
      const end = skipString(expression, index);
      output += `${char}${rewriteClassTokenString(expression.slice(index + 1, end - 1), classMap)}${char}`;
      index = end;
      continue;
    }

    if (char === "`") {
      const end = skipString(expression, index);
      output += `\`${rewriteClassTemplate(expression.slice(index + 1, end - 1), classMap)}\``;
      index = end;
      continue;
    }

    const identifier = /^[A-Za-z_$][\w$]*/.exec(expression.slice(index));
    if (identifier && isClassHelperObjectKey(expression, index, identifier[0].length) && classMap.has(identifier[0])) {
      output += JSON.stringify(classMap.get(identifier[0]));
      index += identifier[0].length;
      continue;
    }

    output += char;
    index++;
  }

  return output;
}

function isClassHelperObjectKey(source: string, start: number, length: number): boolean {
  const previous = previousSignificantChar(source, start);
  if (previous !== "{" && previous !== ",") {
    return false;
  }

  const next = skipWhitespace(source, start + length);
  return source[next] === ":";
}

function previousSignificantChar(source: string, index: number): string | null {
  let cursor = index - 1;

  while (cursor >= 0 && /\s/.test(source[cursor])) {
    cursor--;
  }

  return cursor >= 0 ? source[cursor] : null;
}

function rewriteClassTemplate(value: string, classMap: Map<string, string>): string {
  return value.replace(/(^|[\s])([A-Za-z_-][A-Za-z0-9_-]*)(?=$|[\s])/g, (_match, prefix: string, token: string) => {
    return `${prefix}${classMap.get(token) ?? token}`;
  });
}

function rewriteClassTokenString(value: string, classMap: Map<string, string>): string {
  return value.split(/(\s+)/).map((part) => classMap.get(part) ?? part).join("");
}

function addStyleScopeAttribute(openTag: string, componentName: string, scope: string): string {
  if (/\sdata-elizabeth-style=/.test(openTag)) {
    return openTag;
  }

  return openTag.replace(/<style\b/, `<style data-elizabeth-style="${componentName}_${scope}"`);
}

function skipCssGlobal(css: string, start: number): number {
  const open = start + ":global".length;
  return findMatching(css, open, "(", ")") + 1;
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

function findComponentClose(source: string, open: MarkupTag): { start: number; end: number } {
  let depth = 1;
  let index = open.end;

  while (index < source.length) {
    if (source[index] === "{") {
      index = findMatching(source, index, "{", "}") + 1;
      continue;
    }

    if (source[index] !== "<") {
      index++;
      continue;
    }

    if (sourceStartsWithHtmlComment(source, index)) {
      index = readHtmlCommentEnd(source, index);
      continue;
    }

    const tag = readMarkupTag(source, index);

    if (tag.name === open.name && tag.isComponent) {
      if (tag.closing) {
        depth--;

        if (depth === 0) {
          return { start: tag.start, end: tag.end };
        }
      } else if (!tag.selfClosing) {
        depth++;
      }
    }

    index = tag.end;
  }

  throw new Error(`Missing closing component tag </${open.name}>.`);
}

function findRawTextClose(source: string, open: MarkupTag): { start: number; end: number } {
  const closePattern = new RegExp(`</\\s*${escapeRegExp(open.name)}\\s*>`, "i");
  const match = closePattern.exec(source.slice(open.end));

  if (!match) {
    throw new Error(`Missing closing tag </${open.name}>.`);
  }

  const start = open.end + match.index;
  return {
    start,
    end: start + match[0].length,
  };
}

function isRawTextElement(name: string): boolean {
  return name.toLowerCase() === "script" || name.toLowerCase() === "style";
}

function readBareAttributeEnd(source: string, start: number): number {
  let index = start;

  while (index < source.length && !/\s/.test(source[index])) {
    index++;
  }

  return index;
}

function normalizeHtmlAttributeName(name: string): string {
  if (name === "className") {
    return "class";
  }

  if (name === "htmlFor") {
    return "for";
  }

  return name;
}

function isBooleanHtmlAttribute(name: string): boolean {
  return booleanHtmlAttributes.has(name);
}

const booleanHtmlAttributes = new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected",
]);

function escapeStaticAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;");
}

function readComponent(source: string, start: number, sourceName: string): { block: ComponentBlock; end: number } {
  const parsed = readComponentDecorators(source, start, sourceName);
  let index = parsed.end;

  const openMatch = /^<([A-Z][A-Za-z0-9_]*)([^>]*)>/.exec(source.slice(index));
  if (!openMatch) {
    throw syntaxError(sourceName, source, index, "Expected component declaration tag like <HomePage>.");
  }

  const name = openMatch[1];
  const props = parseComponentDeclarationProps(openMatch[2], sourceName, source, index);
  const bodyStart = index + openMatch[0].length;
  const close = `</${name}>`;
  const bodyEnd = source.indexOf(close, bodyStart);

  if (bodyEnd === -1) {
    throw syntaxError(sourceName, source, bodyStart, `Missing closing component tag ${close}.`);
  }

  return {
    block: {
      visibility: parsed.visibility,
      client: parsed.client,
      name,
      props,
      body: source.slice(bodyStart, bodyEnd),
      sourceName,
      source,
      bodyStart,
    },
    end: bodyEnd + close.length,
  };
}

function readComponentDecorators(
  source: string,
  start: number,
  sourceName: string,
): { visibility: ComponentVisibility; client: boolean; end: number } {
  let index = start;
  let visibility: ComponentVisibility | null = null;
  let client = false;
  let found = false;

  while (source[index] === "@") {
    const decoratorMatch = /^@([A-Za-z_]\w*)/.exec(source.slice(index));
    if (!decoratorMatch) {
      throw syntaxError(sourceName, source, index, "Expected component decorator.");
    }

    found = true;
    const name = decoratorMatch[1];

    if (decorators.has(name as ComponentVisibility)) {
      if (visibility) {
        throw syntaxError(sourceName, source, index, "Component can only have one visibility decorator.");
      }

      visibility = name as ComponentVisibility;
    } else if (componentModifiers.has(name)) {
      if (name === "client") {
        client = true;
      }
    } else {
      throw syntaxError(sourceName, source, index, `Unknown decorator @${name}.`);
    }

    index += decoratorMatch[0].length;
    index = skipWhitespaceAndLineComments(source, index);
  }

  if (!found) {
    throw syntaxError(sourceName, source, start, "Expected component decorator.");
  }

  if (!visibility) {
    throw syntaxError(sourceName, source, index, "Expected @declare, @public, @default, or @private after component modifiers.");
  }

  return { visibility, client, end: index };
}

function parseComponentDeclarationProps(
  source: string,
  sourceName: string,
  fullSource: string,
  offset: number,
): ComponentProp[] {
  const props: ComponentProp[] = [];
  let index = 0;

  while (index < source.length) {
    index = skipWhitespace(source, index);
    if (index >= source.length) {
      break;
    }

    const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(index));
    if (!match) {
      throw syntaxError(sourceName, fullSource, offset + index, "Expected prop name in component declaration.");
    }

    const name = match[0];
    index += match[0].length;
    index = skipWhitespace(source, index);

    if (source[index] !== "=") {
      props.push({ name, defaultValue: null });
      continue;
    }

    index++;
    index = skipWhitespace(source, index);

    if (source[index] === "\"" || source[index] === "'") {
      const end = skipString(source, index);
      props.push({ name, defaultValue: source.slice(index, end) });
      index = end;
      continue;
    }

    if (source[index] === "{") {
      const end = findMatching(source, index, "{", "}");
      props.push({ name, defaultValue: source.slice(index + 1, end).trim() });
      index = end + 1;
      continue;
    }

    const end = readBareAttributeEnd(source, index);
    props.push({ name, defaultValue: JSON.stringify(source.slice(index, end)) });
    index = end;
  }

  return props;
}

function findRenderMarkupStart(body: string): number {
  let index = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  while (index < body.length) {
    const char = body[index];
    const next = body[index + 1];

    if (char === "\"" || char === "'" || char === "`") {
      index = skipString(body, index);
      continue;
    }

    if (char === "/" && next === "/") {
      index = skipLineComment(body, index);
      continue;
    }

    if (char === "/" && next === "*") {
      index = skipBlockComment(body, index);
      continue;
    }

    if (char === "{") braceDepth++;
    else if (char === "}") braceDepth--;
    else if (char === "(") parenDepth++;
    else if (char === ")") parenDepth--;
    else if (char === "[") bracketDepth++;
    else if (char === "]") bracketDepth--;
    else if (
      char === "<" &&
      braceDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      /^[A-Za-z][A-Za-z0-9-]*/.test(body.slice(index + 1))
    ) {
      return index;
    }

    index++;
  }

  return -1;
}

function findTagEnd(source: string, start: number): number {
  let index = start + 1;

  while (index < source.length) {
    const char = source[index];

    if (char === "\"" || char === "'") {
      index = skipString(source, index);
      continue;
    }

    if (char === "{") {
      index = findMatching(source, index, "{", "}") + 1;
      continue;
    }

    if (char === ">") {
      return index;
    }

    index++;
  }

  throw new Error("Unterminated HTML tag.");
}

function findMatching(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  let index = start;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "\"" || char === "'" || char === "`") {
      index = skipString(source, index);
      continue;
    }

    if (char === "/" && next === "/") {
      index = skipLineComment(source, index);
      continue;
    }

    if (char === "/" && next === "*") {
      index = skipBlockComment(source, index);
      continue;
    }

    if (char === open) depth++;
    if (char === close) depth--;
    if (depth === 0) return index;
    index++;
  }

  throw new Error(`Missing closing ${close}.`);
}

function readStatementEnd(source: string, start: number): number {
  let index = start;

  while (index < source.length && source[index] !== "\n") {
    if (source[index] === "\"" || source[index] === "'" || source[index] === "`") {
      index = skipString(source, index);
      continue;
    }
    index++;
  }

  return index;
}

function skipWhitespace(source: string, index: number): number {
  while (index < source.length && /\s/.test(source[index])) {
    index++;
  }

  return index;
}

function skipWhitespaceAndLineComments(source: string, index: number): number {
  while (index < source.length) {
    index = skipWhitespace(source, index);

    if (source[index] === "/" && source[index + 1] === "/") {
      index = skipLineComment(source, index);
      continue;
    }

    return index;
  }

  return index;
}

function skipString(source: string, start: number): number {
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

function skipLineComment(source: string, start: number): number {
  const end = source.indexOf("\n", start + 2);
  return end === -1 ? source.length : end + 1;
}

function skipBlockComment(source: string, start: number): number {
  const end = source.indexOf("*/", start + 2);
  return end === -1 ? source.length : end + 2;
}

function containsAwait(source: string): boolean {
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "\"" || char === "'" || char === "`") {
      index = skipString(source, index);
      continue;
    }

    if (char === "/" && next === "/") {
      index = skipLineComment(source, index);
      continue;
    }

    if (char === "/" && next === "*") {
      index = skipBlockComment(source, index);
      continue;
    }

    if (
      source.startsWith("await", index) &&
      !isIdentifierPart(source[index - 1] ?? "") &&
      !isIdentifierPart(source[index + 5] ?? "")
    ) {
      return true;
    }

    index++;
  }

  return false;
}

function containsComponentTag(source: string): boolean {
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char === "{") {
      index = findMatching(source, index, "{", "}") + 1;
      continue;
    }

    if (char === "<") {
      if (sourceStartsWithHtmlComment(source, index)) {
        index = readHtmlCommentEnd(source, index);
        continue;
      }

      const tag = readMarkupTag(source, index);

      if (tag.isComponent && !tag.closing) {
        return true;
      }

      index = tag.end;
      continue;
    }

    index++;
  }

  return false;
}

function readTopLevelComponentTagName(source: string, index: number): string | null {
  const match = /^<([A-Z][A-Za-z0-9_]*)(?:\s[^>]*)?\/?>/.exec(source.slice(index));
  return match?.[1] ?? null;
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
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

function indent(source: string, spaces: number): string {
  if (source.length === 0) {
    return "";
  }

  const prefix = " ".repeat(spaces);
  return source.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function syntaxError(sourceName: string, source: string, index: number, message: string): Error {
  const lines = source.slice(0, index).split("\n");
  const line = lines.length;
  const column = lines.at(-1)!.length + 1;
  return new Error(`${sourceName}:${line}:${column}: ${message}`);
}
