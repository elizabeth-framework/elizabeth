import { activateAutoInsertion } from "@volar/vscode";
import * as path from "path";
import * as vscode from "vscode";
import type { LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import { LanguageClient, Trace, TransportKind } from "vscode-languageclient/node";

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {
  const serverModule = context.asAbsolutePath(path.join("out", "language-server", "src", "index.js"));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const documentSelector = [{ scheme: "file", language: "elizabeth" }];

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || event.document !== editor.document) return;
      if (event.document.languageId !== "elizabeth") return;

      const change = event.contentChanges[0];
      if (!change || change.text !== ">") return;

      const position = change.range.start.translate(0, 1);
      const line = event.document.lineAt(position.line);
      const beforeCursor = line.text.slice(0, position.character);
      const afterCursor = line.text.slice(position.character);

      const match = beforeCursor.match(/<([A-Za-z][\w.-]*)(?:\s[^<>]*)?>$/);
      if (!match) return;

      const tagName = match[1];

      if (beforeCursor.endsWith("/>")) return;
      if (afterCursor.startsWith(`</${tagName}>`)) return;

      editor.insertSnippet(new vscode.SnippetString(`$0</${tagName}>`), position);
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      documentSelector,
      {
        provideCompletionItems(document, position) {
          const line = document.lineAt(position.line);
          const beforeCursor = line.text.slice(0, position.character);
          const match = beforeCursor.match(/@\w*$/);

          if (!match) {
            return undefined;
          }

          const start = position.translate(0, -match[0].length);
          const range = new vscode.Range(start, position);

          const makeSnippet = (label: string, detail: string, snippet: string) => {
            const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);

            item.detail = detail;
            item.insertText = new vscode.SnippetString(snippet);
            item.range = range;

            return item;
          };

          return [
            makeSnippet("@default", "Elizabeth default component", "@default\n<${1:HomePage}>\n\t$0\n</${1:HomePage}>"),
            makeSnippet(
              "@public",
              "Elizabeth public/exported component",
              "@public\n<${1:Component}>\n\t$0\n</${1:Component}>",
            ),
            makeSnippet("@client", "Elizabeth client component", "@client"),
            makeSnippet(
              "@client component",
              "Elizabeth client component scaffold",
              "@client\n<${1:ClientComponent}>\n\t$0\n</${1:ClientComponent}>",
            ),
            makeSnippet(
              "@declare",
              "Elizabeth declared component",
              "@declare\n<${1:Component}>\n\t$0\n</${1:Component}>",
            ),
            makeSnippet(
              "@private",
              "Elizabeth private component",
              "@private\n<${1:Component}>\n\t$0\n</${1:Component}>",
            ),
          ];
        },
      },
      "@",
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || event.document !== editor.document) return;
      if (event.document.languageId !== "elizabeth") return;

      const change = event.contentChanges[0];
      if (!change || change.text !== "/") return;

      const position = change.range.start.translate(0, 1);
      const line = event.document.lineAt(position.line);
      const beforeCursor = line.text.slice(0, position.character);
      const afterCursor = line.text.slice(position.character);

      // Trigger only for: <Component /
      // Not for: </Component>
      const match = beforeCursor.match(/<([A-Za-z][\w.-]*)(?:\s[^<>]*)?\s\/$/);
      if (!match) return;
      if (beforeCursor.includes("</")) return;
      if (afterCursor.startsWith(">")) return;

      editor.insertSnippet(new vscode.SnippetString(">$0"), position);
    }),
  );

  const outputChannel = vscode.window.createOutputChannel("Elizabeth Language Server");

  const clientOptions: LanguageClientOptions = {
    documentSelector,
    outputChannel,
    traceOutputChannel: outputChannel,
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.liz"),
    },
  };

  client = new LanguageClient("elizabethLanguageServer", "Elizabeth Language Server", serverOptions, clientOptions);

  client.setTrace(Trace.Verbose);

  client.start();
  activateAutoInsertion(documentSelector, client);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
