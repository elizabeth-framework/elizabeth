import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildElizabethApp } from "../build/app.ts";
import { compileElizabeth } from "../compiler/compile.ts";

await testInlineStyleClassMangling();
await testAttributeErrorLocation();
await testStaticBuildClientAssets();
await testViteGlobalCssBuild();

console.log("Elizabeth focused tests passed");

async function testInlineStyleClassMangling(): Promise<void> {
  const source = `@default
<TestPage>
  const active = true;
  const extra = "mt-2";

  <style>
    .card { color: red; }
    .active { color: green; }
  </style>
  <div className={cn("card p-4", active && "active", { card: active }, [\`card flex \${extra}\`].join(" "))}>Hi</div>
</TestPage>`;
  const code = compileElizabeth(source, "class-test.liz").code;

  assert(/\bcard_[a-z0-9]+ p-4\b/.test(code), "string class token should be scoped");
  assert(/\bactive_[a-z0-9]+\b/.test(code), "conditional string class token should be scoped");
  assert(/"card_[a-z0-9]+": active/.test(code), "object class helper key should be scoped");
  assert(/\bcard_[a-z0-9]+ flex\b/.test(code), "template class token should be scoped");
  assert(code.includes("p-4"), "unknown utility class should remain global");
}

async function testAttributeErrorLocation(): Promise<void> {
  try {
    compileElizabeth(`@default
<TestPage>
  <div>
    <span className=\`bad\`>x</span>
  </div>
</TestPage>`, "bad-attr.liz");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.startsWith("bad-attr.liz:4:21:"), "backtick attribute error should point at the .liz attribute value");
    return;
  }

  throw new Error("Expected backtick attribute error.");
}

async function testStaticBuildClientAssets(): Promise<void> {
  const root = "/tmp/elizabeth-focused-build";
  const frameworkRoot = resolve(".");

  await rm(root, { recursive: true, force: true });
  await mkdir(resolve(root, "src/components"), { recursive: true });
  await mkdir(resolve(root, "src/pages"), { recursive: true });
  await mkdir(resolve(root, "src/actions"), { recursive: true });
  await writeFile(resolve(root, "elizabeth.config.ts"), `export default {
  pageRoutes: {
    "src/pages": "/",
  },
  apiRoutes: {
    "src/actions": "/",
  },
};
`);
  await writeFile(resolve(root, "src/components/Counter.liz"), `import { clientState } from "elizabeth/client"

@client
@public
<Counter>
  const [count, setCount] = clientState(0);

  <button onClick={() => setCount(count + 1)}>{count}</button>
</Counter>
`);
  await writeFile(resolve(root, "src/pages/index.liz"), `import { Counter } from "../components/Counter.liz"

@default
<HomePage>
  <html>
    <head><title>Build</title></head>
    <body><Counter /></body>
  </html>
</HomePage>
`);
  await mkdir(resolve(root, "src/pages/users"), { recursive: true });
  await writeFile(resolve(root, "src/pages/users/[id].liz"), `@default
<UserPage>
  const id = ctx.params.id;

  <html>
    <head><title>User</title></head>
    <body><main>User {id}</main></body>
  </html>
</UserPage>
`);
  await writeFile(resolve(root, "src/actions/index.ts"), `export async function POST(ctx) {
  const form = await ctx.request.formData();
  return Response.json({ title: form.get("title") });
}
`);
  await writeFile(resolve(root, "src/actions/fragment.liz"), `<POST>
  const form = await ctx.request.formData();

  <p>{form.get("title")}</p>
</POST>
`);

  await buildElizabethApp({
    root,
    frameworkRoot,
    distDir: resolve(root, "dist"),
  });

  const html = await readFile(resolve(root, "dist/index.html"), "utf8");
  const manifest = JSON.parse(await readFile(resolve(root, "dist/_elizabeth/client-manifest.json"), "utf8")) as {
    islands: Array<{ moduleId: string; url: string }>;
  };
  const buildManifest = await readFile(resolve(root, "dist/_elizabeth/build-manifest.json"), "utf8");
  const islandUrl = manifest.islands.find((island) => island.moduleId === "src/components/Counter.liz")?.url;

  assert((await readFile(resolve(root, "dist/server.js"), "utf8")).includes("Bun.serve"), "build should emit a production server");
  assert(html.includes("/_elizabeth/client-manifest.json"), "build should inject island bootstrap");
  assert(islandUrl, "build should write a client manifest");
  assert(/\/_elizabeth\/islands\/.+-[A-Za-z0-9_-]+\.js$/.test(islandUrl), "island should be a hashed Vite bundle");
  assert((await readFile(resolve(root, "dist", islandUrl.replace(/^\//, "")), "utf8")).includes("__elizabethRegisterIsland"), "build should emit browser island bundle");
  assert(buildManifest.includes("\"output\": \"server\""), "build should write server build metadata");
  assert(buildManifest.includes("\"path\": \"/users/[id]\""), "build manifest should include dynamic routes");
  assert(buildManifest.includes("\"path\": \"/fragment\""), "build manifest should include API routes");
}

async function testViteGlobalCssBuild(): Promise<void> {
  const root = "/tmp/elizabeth-focused-css-build";
  const frameworkRoot = resolve(".");

  await rm(root, { recursive: true, force: true });
  await mkdir(resolve(root, "src/pages"), { recursive: true });
  await symlink(resolve("node_modules"), resolve(root, "node_modules"), "dir");
  await writeFile(resolve(root, "vite.config.ts"), `import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [tailwindcss()] });
`);
  await writeFile(resolve(root, "src/styles.css"), `@import "tailwindcss";
`);
  await writeFile(resolve(root, "src/pages/index.liz"), `@default
<HomePage>
  <html>
    <head><title>CSS</title></head>
    <body><main className="p-4 text-red-500">Hello</main></body>
  </html>
</HomePage>
`);

  await buildElizabethApp({
    root,
    frameworkRoot,
    distDir: resolve(root, "dist"),
  });

  const html = await readFile(resolve(root, "dist/index.html"), "utf8");
  const href = html.match(/href="([^"]+\.css)"/)?.[1];

  assert(href, "build should link Vite global CSS");
  const css = await readFile(resolve(root, "dist", href.replace(/^\//, "")), "utf8");
  assert(css.includes(".p-4"), "Vite global CSS should contain Tailwind utilities");
  assert(css.includes(".text-red-500"), "Vite global CSS should include used Tailwind color utility");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
