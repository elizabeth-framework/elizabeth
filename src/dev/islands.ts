import { buildPageRoutes } from "../router/pages.ts";

export interface IslandDevOptions {
  root: string;
  frameworkRoot?: string;
  pagesDir: string;
  outDir: string;
}

export async function renderClientManifest(options: IslandDevOptions): Promise<Response> {
  const manifest = await buildPageRoutes(options);

  return Response.json({
    islands: manifest.clientComponents,
  });
}

export async function renderIslandModule(pathname: string, options: IslandDevOptions): Promise<Response> {
  const manifest = await buildPageRoutes(options);
  const moduleId = decodeURIComponent(pathname.slice("/_elizabeth/islands/".length));
  const island = manifest.clientComponents.find((entry) => entry.moduleId === moduleId);

  if (!island) {
    return new Response("Island module not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  return new Response(await Bun.file(island.clientOutputPath).text(), {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
    },
  });
}
