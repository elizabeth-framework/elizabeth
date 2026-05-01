import type { LanguagePlugin, VirtualCode, CodeMapping } from '@volar/language-core';
import type * as ts from 'typescript';

export class LizVirtualCode implements VirtualCode {
    id = 'root';
    languageId = 'typescriptreact';
    mappings: CodeMapping[];
    embeddedCodes: VirtualCode[] = [];

    constructor(public snapshot: ts.IScriptSnapshot) {
        this.onSnapshotUpdated();
    }

    public update(newSnapshot: ts.IScriptSnapshot) {
        this.snapshot = newSnapshot;
        this.onSnapshotUpdated();
    }

    private onSnapshotUpdated() {
        const text = this.snapshot.getText(0, this.snapshot.getLength());
        
        let generatedText = '';
        this.mappings = [];

        // Replace decorators with spaces to not break offsets
        let processedText = text;
        const decoratorRegex = /@(public|default|declare|private|client)\b/g;
        processedText = processedText.replace(decoratorRegex, (match) => ' '.repeat(match.length));

        // Now find the component
        const componentRegex = /<([A-Z][a-zA-Z0-9_]*)[^>]*>/;
        const componentMatch = componentRegex.exec(processedText);
        
        if (componentMatch) {
            const componentName = componentMatch[1];
            const startTagIndex = componentMatch.index;
            const startTagEndIndex = startTagIndex + componentMatch[0].length;
            
            const closeTag = `</${componentName}>`;
            const closeTagIndex = processedText.lastIndexOf(closeTag);
            
            if (closeTagIndex !== -1) {
                // 1. Text before component
                const pre = processedText.substring(0, startTagIndex);
                this.mappings.push({
                    sourceOffsets: [0], generatedOffsets: [0], lengths: [pre.length],
                    data: { verification: true, completion: true, semanticTokens: true, navigation: true, structure: true, format: true }
                });
                generatedText += pre;

                // 2. The opening tag (replace with function decl)
                const nameStart = startTagIndex + 1; // after <
                generatedText += 'function ';
                this.mappings.push({
                    sourceOffsets: [nameStart], generatedOffsets: [generatedText.length], lengths: [componentName.length],
                    data: { verification: true, completion: true, semanticTokens: true, navigation: true, structure: true, format: true }
                });
                generatedText += componentName;
                generatedText += '() {';

                // 3. The body logic
                const body = processedText.substring(startTagEndIndex, closeTagIndex);
                const firstHtmlMatch = /<[a-z]/.exec(body);
                
                if (firstHtmlMatch) {
                    const logic = body.substring(0, firstHtmlMatch.index);
                    this.mappings.push({
                        sourceOffsets: [startTagEndIndex], generatedOffsets: [generatedText.length], lengths: [logic.length],
                        data: { verification: true, completion: true, semanticTokens: true, navigation: true, structure: true, format: true }
                    });
                    generatedText += logic;

                    // 4. Inject return (<>
                    generatedText += 'return (<>';

                    // 5. The HTML body
                    const html = body.substring(firstHtmlMatch.index);
                    this.mappings.push({
                        sourceOffsets: [startTagEndIndex + firstHtmlMatch.index], generatedOffsets: [generatedText.length], lengths: [html.length],
                        data: { verification: true, completion: true, semanticTokens: true, navigation: true, structure: true, format: true }
                    });
                    generatedText += html;

                    // 6. Close return
                    generatedText += '</>); }';
                } else {
                    this.mappings.push({
                        sourceOffsets: [startTagEndIndex], generatedOffsets: [generatedText.length], lengths: [body.length],
                        data: { verification: true, completion: true, semanticTokens: true, navigation: true, structure: true, format: true }
                    });
                    generatedText += body;
                    generatedText += '}';
                }

                // 7. Text after component
                const post = processedText.substring(closeTagIndex + closeTag.length);
                this.mappings.push({
                    sourceOffsets: [closeTagIndex + closeTag.length], generatedOffsets: [generatedText.length], lengths: [post.length],
                    data: { verification: true, completion: true, semanticTokens: true, navigation: true, structure: true, format: true }
                });
                generatedText += post;
            } else {
                this.mappings.push({
                    sourceOffsets: [0], generatedOffsets: [0], lengths: [processedText.length],
                    data: { verification: true, completion: true, semanticTokens: true, navigation: true, structure: true, format: true }
                });
                generatedText = processedText;
            }
        } else {
            this.mappings.push({
                sourceOffsets: [0], generatedOffsets: [0], lengths: [processedText.length],
                data: { verification: true, completion: true, semanticTokens: true, navigation: true, structure: true, format: true }
            });
            generatedText = processedText;
        }

        this.embeddedCodes = [];
        
        // Extract <style> blocks
        const styleRegex = /<style>([\s\S]*?)<\/style>/g;
        let match;
        let styleIndex = 0;
        
        while ((match = styleRegex.exec(text)) !== null) {
            const styleContent = match[1];
            const startOffset = match.index + '<style>'.length;
            
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
                        semanticTokens: true,
                        navigation: true,
                        structure: true,
                        format: true,
                    },
                }],
                embeddedCodes: [],
            });
        }
        
        // Mask <style> contents in generated TSX so TS doesn't parse CSS
        const generatedStyleRegex = /<style>([\s\S]*?)<\/style>/g;
        generatedText = generatedText.replace(generatedStyleRegex, (m, p1) => {
            return `<style>${' '.repeat(p1.length)}</style>`;
        });

        this.snapshot = {
            getText: (start, end) => generatedText.substring(start, end),
            getLength: () => generatedText.length,
            getChangeRange: () => undefined
        };
    }
}

export const lizLanguagePlugin: LanguagePlugin<LizVirtualCode> = {
    getLanguageId(uri) {
        if (uri.endsWith('.liz')) {
            return 'elizabeth';
        }
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
