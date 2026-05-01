import { resolve } from "node:path";
import { startElizabethDevServer } from "./app.ts";

const root = resolve(import.meta.dir, "../..");

startElizabethDevServer({
  root,
  frameworkRoot: root,
  pagesDir: resolve(root, "examples/basic/src/pages"),
  outDir: resolve(root, ".elizabeth"),
  port: Number(Bun.env.PORT ?? 3000),
});
