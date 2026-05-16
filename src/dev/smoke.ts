import { resolve } from "node:path";
import { isNotFoundResult, isRedirectResult } from "../route.ts";
import { buildPageRoutes, matchPageRoute } from "../router/pages.ts";
import { renderPageRoute } from "../router/render.ts";

const root = resolve(import.meta.dir, "../..");
const pagesDir = resolve(root, "examples/basic/src/pages");

const manifest = await buildPageRoutes({
  root,
  pagesDir,
  outDir: resolve(root, ".elizabeth"),
});

const smokePaths = ["/", "/about", "/users/ada", "/users/grace", "/old-about", "/missing", "/error"];

for (const pathname of smokePaths) {
  const match = matchPageRoute(manifest.routes, pathname);

  if (!match) {
    console.log(`--- ${pathname}`);
    if (!manifest.notFound) {
      console.log("Not found");
      continue;
    }

    const result = await renderPageRoute({ route: manifest.notFound, params: {} });
    console.log(formatResult(result));
    continue;
  }

  let html: string;

  try {
    const result = await renderPageRoute(match);
    html =
      isNotFoundResult(result) && manifest.notFound
        ? formatResult(await renderPageRoute({ route: manifest.notFound, params: {} }))
        : formatResult(result);
  } catch (error) {
    html = error instanceof Error ? `ERROR: ${error.message}` : `ERROR: ${String(error)}`;
  }

  console.log(`--- ${pathname}`);
  console.log(html);
}

function formatResult(result: Awaited<ReturnType<typeof renderPageRoute>>): string {
  if (isRedirectResult(result)) {
    return `REDIRECT ${result.status}: ${result.location}`;
  }

  if (isNotFoundResult(result)) {
    return "NOT_FOUND";
  }

  return result;
}
