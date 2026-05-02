import { createConnection, createServer, createTypeScriptProject } from '@volar/language-server/node';
import { create as createTypeScriptService } from 'volar-service-typescript';
import { create as createCssService } from 'volar-service-css';
import { create as createEmmetService } from 'volar-service-emmet';
import { lizLanguagePlugin } from './languagePlugin';
import * as ts from 'typescript';

const connection = createConnection();
const server = createServer(connection);

connection.onInitialize(params => {
    return server.initialize(
        params,
        createTypeScriptProject(ts, undefined, () => ({
            languagePlugins: [lizLanguagePlugin]
        })),
        [
            ...createTypeScriptService(ts),
            createCssService(),
            createEmmetService(),
        ]
    );
});

connection.onInitialized(server.initialized);

connection.listen();
