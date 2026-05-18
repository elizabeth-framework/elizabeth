import type { CodeMapping, LanguagePlugin, VirtualCode } from "@volar/language-core";
import type * as ts from "typescript";
import type { URI } from "vscode-uri";

export class LizVirtualCode implements VirtualCode {
  id = "root";
  languageId = "typescriptreact";
  mappings!: CodeMapping[];
  embeddedCodes: VirtualCode[] = [];

  constructor(public sourceSnapshot: ts.IScriptSnapshot) {
    this.onSnapshotUpdated();
  }

  public update(newSnapshot: ts.IScriptSnapshot) {
    this.sourceSnapshot = newSnapshot;
    this.onSnapshotUpdated();
  }

  get snapshot() {
    return this.generatedSnapshot;
  }

  private generatedSnapshot!: ts.IScriptSnapshot;

  private onSnapshotUpdated() {
    const text = this.sourceSnapshot.getText(0, this.sourceSnapshot.getLength());

    const jsxTypes = `/// <reference lib="esnext" />
/// <reference lib="dom" />
type ElizabethComponentProps = Record<string, any> & { children?: any };
type ElizabethComponentContext = {
    params: Record<string, string>;
    error?: any;
    locals: Record<string, any>;
    pathname?: string;
    request?: Request;
    url?: URL;
};
declare module "elizabeth/client" {
    export function clientState<T>(initialValue: T): [T, (value: T | ((current: T) => T)) => void];
    export function clientReady(callback: () => void | (() => void)): void;
    export function onReady(callback: () => void | (() => void)): void;
    export function clientMemo<T>(callback: () => T, deps?: readonly unknown[]): T;
    export interface ClientContext<T> {
        use(): T;
        provide<R>(value: T, render: () => R): R;
    }
    export function clientContext<T>(defaultValue: T): ClientContext<T>;
    export interface ClientRef<T extends Element = Element> { current: T | null; }
    export function clientRef<T extends Element = Element>(): ClientRef<T>;
}
declare module "elizabeth/route" {
    export type RedirectResult = any;
    export type NotFoundResult = any;
    export function redirect(location: string, status?: number): RedirectResult;
    export function notFound(): NotFoundResult;
    export function isRedirectResult(value: unknown): value is RedirectResult;
    export function isNotFoundResult(value: unknown): value is NotFoundResult;
}
declare global {
namespace JSX {
    type Element = any;

    interface IntrinsicElements {
    div: ElizabethHTMLAttributes;
    span: ElizabethHTMLAttributes;
    p: ElizabethHTMLAttributes;
    h1: ElizabethHTMLAttributes;
    h2: ElizabethHTMLAttributes;
    h3: ElizabethHTMLAttributes;
    button: ElizabethHTMLAttributes;
    input: ElizabethHTMLAttributes;
    a: ElizabethHTMLAttributes;
    img: ElizabethHTMLAttributes;
    code: ElizabethHTMLAttributes;
    style: ElizabethHTMLAttributes;
    [name: string]: ElizabethHTMLAttributes;
    }

    interface ElizabethHTMLAttributes {
    class?: string;
    className?: string;
    id?: string;
    style?: any;
    href?: string;
    src?: string;
    alt?: string;
    type?: string;
    value?: any;
    placeholder?: string;
    disabled?: boolean;
    onClick?: any;
    onInput?: any;
    onChange?: any;
    children?: any;
    }
}
}
export {};
`;

    let generatedText = jsxTypes;
    this.mappings = [];

    const capabilities = {
      verification: true,
      completion: true,
      semantic: true,
      navigation: true,
      structure: true,
      format: true,
    };

    const tagCapabilities = {
      ...capabilities,
      semantic: false,
      semanticTokens: false,
    };

    const htmlCapabilities = {
      ...capabilities,
      verification: false,
      semantic: true,
      semanticTokens: true,
    };

    const addMappedText = (sourceStart: number, content: string, data = capabilities) => {
      if (!content.length) return;

      this.mappings.push({
        sourceOffsets: [sourceStart],
        generatedOffsets: [generatedText.length],
        lengths: [content.length],
        data,
      });

      generatedText += content;
    };

    let processedText = text;
    const decoratorRegex = /@(public|default|declare|private|client)\b/g;
    processedText = processedText.replace(decoratorRegex, (match) => " ".repeat(match.length));

    const componentRegex = /<([A-Z][a-zA-Z0-9_]*)\b[^>]*>/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = componentRegex.exec(processedText)) !== null) {
      const componentName = match[1]!;
      const startTagIndex = match.index;
      const startTagEndIndex = startTagIndex + match[0].length;

      if (match[0].endsWith("/>")) {
        continue;
      }

      const closeTag = `</${componentName}>`;
      const closeTagIndex = processedText.indexOf(closeTag, startTagEndIndex);

      if (closeTagIndex === -1) {
        continue;
      }

      addMappedText(cursor, processedText.substring(cursor, startTagIndex));

      const beforeComponent = text.slice(Math.max(0, startTagIndex - 80), startTagIndex);

      const hasDefault = /@default\b/.test(beforeComponent);
      const hasPublic = /@public\b/.test(beforeComponent);
      const hasDeclare = /@declare\b/.test(beforeComponent);

      if (hasDefault) {
        generatedText += "export default function ";
      } else if (hasPublic || hasDeclare) {
        generatedText += "export function ";
      } else {
        generatedText += "function ";
      }

      const nameStart = startTagIndex + 1;
      this.mappings.push({
        sourceOffsets: [nameStart],
        generatedOffsets: [generatedText.length],
        lengths: [componentName.length],
        data: tagCapabilities,
      });

      generatedText += componentName;
      generatedText += "(props: ElizabethComponentProps = {}, ctx: ElizabethComponentContext = { params: {} }) {";
      generatedText += this.componentPropsStatement(match[0]);

      const body = processedText.substring(startTagEndIndex, closeTagIndex);
      const renderStart = this.findRenderStart(body);

      if (renderStart !== -1) {
        const logic = body.substring(0, renderStart);
        addMappedText(startTagEndIndex, logic);

        const render = body.substring(renderStart);
        addMappedText(startTagEndIndex + renderStart, render, htmlCapabilities);
      } else {
        addMappedText(startTagEndIndex, body);
      }

      generatedText += "}";

      cursor = closeTagIndex + closeTag.length;
      componentRegex.lastIndex = cursor;
    }

    addMappedText(cursor, processedText.substring(cursor));

    this.embeddedCodes = [];

    const styleRegex = /(^[ \t]*<style\b[^>]*>)([\s\S]*?)(^[ \t]*<\/style>)/gm;
    let styleMatch;
    let styleIndex = 0;

    while ((styleMatch = styleRegex.exec(text)) !== null) {
      const styleContent = styleMatch[2]!;
      const startOffset = styleMatch.index + styleMatch[1]!.length;

      this.embeddedCodes.push({
        id: `style_${styleIndex++}`,
        languageId: "css",
        snapshot: {
          getText: (start, end) => styleContent.substring(start, end),
          getLength: () => styleContent.length,
          getChangeRange: () => undefined,
        },
        mappings: [
          {
            sourceOffsets: [startOffset],
            generatedOffsets: [0],
            lengths: [styleContent.length],
            data: {
              verification: true,
              completion: true,
              semantic: true,
              navigation: true,
              structure: true,
              format: true,
            },
          },
        ],
        embeddedCodes: [],
      });
    }

    const finalGeneratedText = generatedText.replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g,
      (_full, open, css, close) => `${open}${" ".repeat(css.length)}${close}`,
    );

    this.generatedSnapshot = {
      getText: (start, end) => finalGeneratedText.substring(start, end),
      getLength: () => finalGeneratedText.length,
      getChangeRange: () => undefined,
    };
  }

  private componentPropsStatement(openTag: string): string {
    const attrs = openTag.replace(/^<[A-Z][a-zA-Z0-9_]*/, "").replace(/\/?>$/, "");
    const props: string[] = [];
    const propPattern = /\s([A-Za-z_$][\w$]*)(?=$|\s|=)/g;
    let propMatch: RegExpExecArray | null;

    while ((propMatch = propPattern.exec(attrs)) !== null) {
      const name = propMatch[1]!;

      if (!props.includes(name)) {
        props.push(name);
      }
    }

    if (!props.includes("children")) {
      props.push("children");
    }

    return props.length > 0 ? `const { ${props.join(", ")} } = props;` : "";
  }

  private findRenderStart(body: string): number {
    let index = 0;
    let braceDepth = 0;
    let parenDepth = 0;
    let bracketDepth = 0;

    while (index < body.length) {
      const char = body[index];
      const next = body[index + 1];

      if (char === '"' || char === "'" || char === "`") {
        index = this.skipString(body, index);
        continue;
      }

      if (char === "/" && next === "/") {
        index = this.skipLineComment(body, index);
        continue;
      }

      if (char === "/" && next === "*") {
        index = this.skipBlockComment(body, index);
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
        this.isTopLevelRenderMarkupStart(body, index)
      ) {
        if (this.isStyleMarkupStart(body, index)) {
          const close = body.indexOf("</style>", index);
          if (close !== -1) {
            index = close + "</style>".length;
            continue;
          }
        }

        return index;
      } else if (
        braceDepth === 0 &&
        parenDepth === 0 &&
        bracketDepth === 0 &&
        this.isRenderControlBlockStart(body, index)
      ) {
        return index;
      }

      index++;
    }

    return -1;
  }

  private isOpeningMarkupStart(source: string, index: number): boolean {
    return source.startsWith("<>", index) || /^<[A-Za-z][A-Za-z0-9_.-]*/.test(source.slice(index));
  }

  private isTopLevelRenderMarkupStart(source: string, index: number): boolean {
    if (!this.isOpeningMarkupStart(source, index)) {
      return false;
    }

    const lineStart = source.lastIndexOf("\n", index - 1) + 1;
    return source.slice(lineStart, index).trim().length === 0;
  }

  private isStyleMarkupStart(source: string, index: number): boolean {
    return /^<style\b/i.test(source.slice(index));
  }

  private isRenderControlBlockStart(source: string, index: number): boolean {
    const lineStart = source.lastIndexOf("\n", index - 1) + 1;

    if (source.slice(lineStart, index).trim().length > 0) {
      return false;
    }

    const statementStart = this.skipWhitespace(source, index);
    if (statementStart !== index) {
      return false;
    }

    const brace = this.findJsBlockOpen(source, statementStart);
    if (brace === -1) {
      return false;
    }

    return /^(?:if|for|while|switch|try)\b/.test(source.slice(statementStart, brace).trim());
  }

  private findJsBlockOpen(source: string, start: number): number {
    let index = start;
    let parenDepth = 0;
    let bracketDepth = 0;

    while (index < source.length) {
      const char = source[index];
      const next = source[index + 1];

      if (char === '"' || char === "'" || char === "`") {
        index = this.skipString(source, index);
        continue;
      }

      if (char === "/" && next === "/") {
        index = this.skipLineComment(source, index);
        continue;
      }

      if (char === "/" && next === "*") {
        index = this.skipBlockComment(source, index);
        continue;
      }

      if (char === "\n") {
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

  private skipWhitespace(source: string, start: number): number {
    let index = start;

    while (index < source.length && /\s/.test(source[index]!)) {
      index++;
    }

    return index;
  }

  private skipString(source: string, start: number): number {
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

  private skipLineComment(source: string, start: number): number {
    const end = source.indexOf("\n", start + 2);
    return end === -1 ? source.length : end + 1;
  }

  private skipBlockComment(source: string, start: number): number {
    const end = source.indexOf("*/", start + 2);
    return end === -1 ? source.length : end + 2;
  }
}

export const lizLanguagePlugin: LanguagePlugin<URI, LizVirtualCode> = {
  getLanguageId(uri: URI) {
    if (uri.path.endsWith(".liz") || uri.fsPath.endsWith(".liz")) return "elizabeth";
  },
  createVirtualCode(fileId, languageId, snapshot) {
    if (languageId === "elizabeth") {
      return new LizVirtualCode(snapshot);
    }
  },
  updateVirtualCode(fileId, virtualCode, snapshot) {
    virtualCode.update(snapshot);
    return virtualCode;
  },
  typescript: {
    extraFileExtensions: [{ extension: "liz", isMixedContent: true, scriptKind: 4 }],
    getServiceScript(root) {
      return {
        code: root,
        extension: ".tsx",
        scriptKind: 4,
      };
    },
  },
};
