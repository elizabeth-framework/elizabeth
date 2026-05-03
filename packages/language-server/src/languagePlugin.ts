import type { LanguagePlugin, VirtualCode, CodeMapping } from '@volar/language-core';
import { URI } from 'vscode-uri';
import type * as ts from 'typescript';

export class LizVirtualCode implements VirtualCode {
    id = 'root';
    languageId = 'typescriptreact';
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

        const addMappedText = (sourceStart: number, content: string) => {
            if (!content.length) return;

            this.mappings.push({
                sourceOffsets: [sourceStart],
                generatedOffsets: [generatedText.length],
                lengths: [content.length],
                data: capabilities,
            });

            generatedText += content;
        };

        let processedText = text;
        const decoratorRegex = /@(public|default|declare|private|client)\b/g;
        processedText = processedText.replace(decoratorRegex, match => ' '.repeat(match.length));

        const componentRegex = /<([A-Z][a-zA-Z0-9_]*)\b[^>]*>/g;
        let cursor = 0;
        let match: RegExpExecArray | null;

        while ((match = componentRegex.exec(processedText)) !== null) {
            const componentName = match[1];
            const startTagIndex = match.index;
            const startTagEndIndex = startTagIndex + match[0].length;

            if (match[0].endsWith('/>')) {
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
                generatedText += 'export default function ';
            } else if (hasPublic || hasDeclare) {
                generatedText += 'export function ';
            } else {
                generatedText += 'function ';
            }

            const nameStart = startTagIndex + 1;
            this.mappings.push({
                sourceOffsets: [nameStart],
                generatedOffsets: [generatedText.length],
                lengths: [componentName.length],
                data: capabilities,
            });

            generatedText += componentName;
            generatedText += '() {';

            const body = processedText.substring(startTagEndIndex, closeTagIndex);
            const firstHtmlMatch = /<[a-z]/.exec(body);

            if (firstHtmlMatch) {
                const logic = body.substring(0, firstHtmlMatch.index);
                addMappedText(startTagEndIndex, logic);

                generatedText += 'return (<>';

                const html = body.substring(firstHtmlMatch.index);
                addMappedText(startTagEndIndex + firstHtmlMatch.index, html);

                generatedText += '</>);';
            } else {
                addMappedText(startTagEndIndex, body);
            }

            generatedText += '}';

            cursor = closeTagIndex + closeTag.length;
            componentRegex.lastIndex = cursor;
        }

        addMappedText(cursor, processedText.substring(cursor));

        this.embeddedCodes = [];

        const styleRegex = /(^[ \t]*<style\b[^>]*>)([\s\S]*?)(^[ \t]*<\/style>)/gm;
        let styleMatch;
        let styleIndex = 0;

        while ((styleMatch = styleRegex.exec(text)) !== null) {
            const styleContent = styleMatch[2];
            const startOffset = styleMatch.index + styleMatch[1].length;

            this.embeddedCodes.push({
                id: `style_${styleIndex++}`,
                languageId: 'css',
                snapshot: {
                    getText: (start, end) => styleContent.substring(start, end),
                    getLength: () => styleContent.length,
                    getChangeRange: () => undefined,
                },
                mappings: [{
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
                }],
                embeddedCodes: [],
            });
        }

        const finalGeneratedText = generatedText.replace(
            /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g,
            (_full, open, css, close) => `${open}${' '.repeat(css.length)}${close}`
        );

        this.generatedSnapshot = {
            getText: (start, end) => finalGeneratedText.substring(start, end),
            getLength: () => finalGeneratedText.length,
            getChangeRange: () => undefined,
        };
    }
}

export const lizLanguagePlugin: LanguagePlugin<URI, LizVirtualCode> = {
    getLanguageId(uri: URI) {
        if (uri.path.endsWith('.liz') || uri.fsPath.endsWith('.liz')) return 'elizabeth';
    },
    createVirtualCode(fileId, languageId, snapshot) {
        if (languageId === 'elizabeth') {
            return new LizVirtualCode(snapshot);
        }
    },
    updateVirtualCode(fileId, virtualCode, snapshot) {
        virtualCode.update(snapshot);
        return virtualCode;
    },
    typescript: {
        extraFileExtensions: [{ extension: 'liz', isMixedContent: true, scriptKind: 4 }],
        getServiceScript(root) {
            return {
                code: root,
                extension: '.tsx',
                scriptKind: 4,
            };
        },
    },
};
