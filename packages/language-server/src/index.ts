import { createConnection, createServer, createSimpleProject } from '@volar/language-server/node';
import { create as createTypeScriptService } from 'volar-service-typescript';
import { create as createCssService } from 'volar-service-css';
import { lizLanguagePlugin } from './languagePlugin';

const connection = createConnection();
const server = createServer(connection);

connection.onInitialize(params => {
    return server.initialize(
        params,
        createSimpleProject([lizLanguagePlugin]),
        [
            createTypeScriptService(),
            createCssService(),
        ]
    );
});

connection.onInitialized(server.initialized);

connection.listen();
