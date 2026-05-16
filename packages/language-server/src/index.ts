import { dirname, join } from "node:path";
import { createConnection, createServer, createTypeScriptProject } from "@volar/language-server/node";
import * as ts from "typescript";
import { create as createCssService } from "volar-service-css";
import { create as createEmmetService } from "volar-service-emmet";
import { create as createTypeScriptService } from "volar-service-typescript";
import { lizLanguagePlugin } from "./languagePlugin";

const connection = createConnection();
const server = createServer(connection);

connection.onInitialize((params) => {
  return server.initialize(
    params,
    createTypeScriptProject(ts, undefined, (projectContext) => {
      const getCompilationSettings = projectContext.projectHost.getCompilationSettings.bind(projectContext.projectHost);
      const getScriptFileNames = projectContext.projectHost.getScriptFileNames.bind(projectContext.projectHost);

      const getProjectRoot = () =>
        projectContext.configFileName
          ? dirname(projectContext.configFileName)
          : projectContext.projectHost.getCurrentDirectory();

      projectContext.projectHost.getCompilationSettings = () => {
        const options = getCompilationSettings();
        const projectRoot = getProjectRoot();
        const paths = {
          ...(options.paths ?? {}),
          "@/*": options.paths?.["@/*"] ?? ["src/*"],
        };

        return {
          ...options,
          target: options.target ?? ts.ScriptTarget.ESNext,
          module: options.module ?? ts.ModuleKind.ESNext,
          moduleResolution: options.moduleResolution ?? ts.ModuleResolutionKind.Bundler,
          jsx: options.jsx ?? ts.JsxEmit.ReactJSX,
          lib: options.lib ?? ["lib.esnext.d.ts", "lib.dom.d.ts"],
          allowJs: options.allowJs ?? true,
          checkJs: options.checkJs ?? true,
          allowImportingTsExtensions: true,
          noEmit: true,
          allowSyntheticDefaultImports: options.allowSyntheticDefaultImports ?? true,
          esModuleInterop: options.esModuleInterop ?? true,
          baseUrl: options.baseUrl ?? projectRoot,
          paths,
        };
      };
      projectContext.projectHost.getScriptFileNames = () => {
        const files = getScriptFileNames();
        let srcFiles: string[] = [];

        try {
          srcFiles = projectContext.sys.readDirectory(
            join(getProjectRoot(), "src"),
            [".ts", ".tsx", ".js", ".jsx", ".liz"],
            undefined,
            undefined,
          );
        } catch {
          // Not every workspace folder has Elizabeth's conventional src directory.
        }

        return [...new Set([...files, ...srcFiles])];
      };

      return {
        languagePlugins: [lizLanguagePlugin],
      };
    }),
    [...createTypeScriptService(ts), createCssService(), createEmmetService()],
  );
});

connection.onInitialized(server.initialized);

connection.listen();
