import { expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { compileElizabeth } from "../src/compiler/compile.ts";
import { compileElizabethEndpointFile } from "../src/compiler/file.ts";
import { loadElizabethConfig } from "../src/config.ts";
import { buildApiRoutes, matchApiRoute } from "../src/router/api.ts";
import { buildPageRoutes, matchPageRoute } from "../src/router/pages.ts";

async function tempProject(name: string): Promise<string> {
  const root = join("/tmp", `elizabeth-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
  return root;
}

test("loadElizabethConfig falls back to default routes when config is missing", async () => {
  const root = await tempProject("missing-config");

  try {
    const config = await loadElizabethConfig(root);

    expect(config).toEqual({
      pageRoutes: [{ dir: join(root, "src/pages"), basePath: "/" }],
      apiRoutes: [{ dir: join(root, "src/api"), basePath: "/api" }],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadElizabethConfig warns for duplicate page and api base paths", async () => {
  const root = await tempProject("duplicate-config");
  const warnings: string[] = [];
  const originalWarn = console.warn;

  try {
    await Bun.write(join(root, "elizabeth.config.ts"), `
export default {
  pageRoutes: {
    "src/pages": "/",
    "src/another-pages": "/",
  },
  apiRoutes: {
    "src/api": "/api",
    "src/another-api": "/api",
  },
};
`);

    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };

    await loadElizabethConfig(root);

    expect(warnings.some((warning) => warning.includes('duplicate pageRoutes basePath "/"'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('duplicate apiRoutes basePath "/api"'))).toBe(true);
  } finally {
    console.warn = originalWarn;
    await rm(root, { recursive: true, force: true });
  }
});

test("loadElizabethConfig normalizes string, array, and object route config", async () => {
  const root = await tempProject("route-normalization");
  const originalWarn = console.warn;

  try {
    await Bun.write(join(root, "elizabeth.config.ts"), `
export default {
  pageRoutes: {
    "src/pages": "",
    "src/docs": "docs/",
  },
  apiRoutes: ["src/api", "src/internal-api"],
};
`);

    console.warn = () => {};
    const config = await loadElizabethConfig(root);

    expect(config.pageRoutes).toEqual([
      { dir: join(root, "src/pages"), basePath: "/" },
      { dir: join(root, "src/docs"), basePath: "/docs" },
    ]);
    expect(config.apiRoutes).toEqual([
      { dir: join(root, "src/api"), basePath: "/" },
      { dir: join(root, "src/internal-api"), basePath: "/" },
    ]);
  } finally {
    console.warn = originalWarn;
    await rm(root, { recursive: true, force: true });
  }
});

test("loadElizabethConfig warns when the same route directory is configured twice", async () => {
  const root = await tempProject("duplicate-dir-config");
  const warnings: string[] = [];
  const originalWarn = console.warn;

  try {
    await Bun.write(join(root, "elizabeth.config.ts"), `
export default {
  pageRoutes: ["src/pages", "src/pages"],
  apiRoutes: ["src/api", "src/api"],
};
`);

    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };

    await loadElizabethConfig(root);

    expect(warnings.some((warning) => warning.includes("duplicate pageRoutes dir"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("duplicate apiRoutes dir"))).toBe(true);
  } finally {
    console.warn = originalWarn;
    await rm(root, { recursive: true, force: true });
  }
});

test("compileElizabethEndpointFile supports undecorated method tags", async () => {
  const root = await tempProject("endpoint-method-tag");
  const sourcePath = join(root, "src/api/hello-elizabeth.liz");

  try {
    await mkdir(join(root, "src/api"), { recursive: true });
    await Bun.write(sourcePath, `
<GET>
  <p>Hello from Elizabeth</p>
</GET>
`);

    const result = await compileElizabethEndpointFile(sourcePath, {
      root,
      frameworkRoot: process.cwd(),
      outDir: join(root, ".elizabeth"),
    });
    const code = await Bun.file(result.outputPath).text();

    expect(result.methods).toEqual(["GET"]);
    expect(code).toContain("export async function GET(ctx)");
    expect(code).toContain("Hello from Elizabeth");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compileElizabethEndpointFile preserves imports before method tags", async () => {
  const root = await tempProject("endpoint-imports");
  const sourcePath = join(root, "src/api/hello-elizabeth.liz");

  try {
    await mkdir(join(root, "src/api"), { recursive: true });
    await Bun.write(sourcePath, `
const message = "Hello from imported module scope";

<GET>
  <p>{message}</p>
</GET>
`);

    const result = await compileElizabethEndpointFile(sourcePath, {
      root,
      frameworkRoot: process.cwd(),
      outDir: join(root, ".elizabeth"),
    });
    const code = await Bun.file(result.outputPath).text();

    expect(result.methods).toEqual(["GET"]);
    expect(code).toContain('const message = "Hello from imported module scope";');
    expect(code).toContain("escapeHtml");
    expect(code).toContain("message");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compileElizabeth tracks only client helpers referenced by an island", () => {
  const result = compileElizabeth(`
const used = () => {
  console.log("client helper");
  return 5;
};
const unused = () => {
  console.log("unused helper");
  return 10;
};

@client
@public
<Widget>
  <span>{used}</span>
</Widget>
`);

  expect(result.clientComponents).toHaveLength(1);
  expect(result.clientComponents[0].clientFunctions.map((fn) => fn.name)).toEqual(["used"]);
  expect(result.clientComponents[0].clientFunctions[0].source).toContain("client helper");
});

test("compileElizabeth marks state-dependent helper text bindings as reactive", () => {
  const result = compileElizabeth(`
import { clientState } from "elizabeth/client";

@client
@public
<Counter>
  const [count, setCount] = clientState(0);
  const label = () => count + 1;

  <button onClick={() => setCount(count + 1)}>{label}</button>
</Counter>
`);

  const counter = result.clientComponents[0];

  expect(counter.states).toEqual([{ name: "count", setter: "setCount", initialValue: "0" }]);
  expect(counter.textBindings).toEqual([{ id: 0, expression: "label", reactive: true }]);
  expect(counter.events).toEqual([{ id: 0, eventName: "click", handler: "() => setCount(count + 1)" }]);
});

test("buildApiRoutes and matchApiRoute support dynamic params", async () => {
  const root = await tempProject("api-dynamic-route");

  try {
    await mkdir(join(root, "src/api/users"), { recursive: true });
    await Bun.write(join(root, "src/api/users/[id].ts"), `
export function GET() {
  return Response.json({ ok: true });
}
`);

    const routes = await buildApiRoutes({
      root,
      frameworkRoot: process.cwd(),
      apiRoots: [{ dir: join(root, "src/api"), basePath: "/api" }],
      outDir: join(root, ".elizabeth"),
    });
    const match = matchApiRoute(routes, "/api/users/ada");

    expect(routes.map((route) => route.path)).toEqual(["/api/users/[id]"]);
    expect(match?.params).toEqual({ id: "ada" });
    expect(matchApiRoute(routes, "/api/users")).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildPageRoutes and matchPageRoute support index and dynamic pages", async () => {
  const root = await tempProject("page-dynamic-route");

  try {
    await mkdir(join(root, "src/pages/users"), { recursive: true });
    await Bun.write(join(root, "src/pages/index.liz"), `
@default
<Home>
  <main>Home</main>
</Home>
`);
    await Bun.write(join(root, "src/pages/users/[id].liz"), `
@default
<UserPage>
  <main>User page</main>
</UserPage>
`);

    const manifest = await buildPageRoutes({
      root,
      frameworkRoot: process.cwd(),
      pageRoots: [{ dir: join(root, "src/pages"), basePath: "/" }],
      outDir: join(root, ".elizabeth"),
    });
    const homeMatch = matchPageRoute(manifest.routes, "/");
    const userMatch = matchPageRoute(manifest.routes, "/users/ada");

    expect(manifest.routes.map((route) => route.path)).toEqual(["/", "/users/[id]"]);
    expect(homeMatch?.params).toEqual({});
    expect(userMatch?.params).toEqual({ id: "ada" });
    expect(matchPageRoute(manifest.routes, "/users")).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
