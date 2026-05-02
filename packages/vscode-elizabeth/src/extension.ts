import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
    Trace
} from 'vscode-languageclient/node';
import * as path from 'path';
import { activateAutoInsertion } from '@volar/vscode';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {
    const serverModule = context.asAbsolutePath(
        path.join('out', 'language-server', 'src', 'index.js')
    );

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] }
        }
    };

    const documentSelector = [{ scheme: 'file', language: 'elizabeth' }];

    const outputChannel = vscode.window.createOutputChannel('Elizabeth Language Server');

    const clientOptions: LanguageClientOptions = {
        documentSelector,
        outputChannel,
        traceOutputChannel: outputChannel,
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.liz')
        }
    };

    client = new LanguageClient(
        'elizabethLanguageServer',
        'Elizabeth Language Server',
        serverOptions,
        clientOptions
    );

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
