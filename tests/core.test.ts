import { expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { compileElizabeth } from "../src/compiler/compile.ts";
import { compileElizabethEndpointFile, compileElizabethFile } from "../src/compiler/file.ts";
import { loadElizabethConfig } from "../src/config.ts";
import { buildApiRoutes, matchApiRoute } from "../src/router/api.ts";
import { buildPageRoutes, matchPageRoute } from "../src/router/pages.ts";
import { renderPageRoute } from "../src/router/render.ts";

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

test("compileElizabethFile rewrites source-relative imports from generated server modules", async () => {
  const root = await tempProject("relative-page-import");
  const sourcePath = join(root, "src/pages/index.liz");

  try {
    await mkdir(join(root, "src/pages"), { recursive: true });
    await Bun.write(join(root, "src/db.ts"), "export const title = 'From db';\n");
    await Bun.write(sourcePath, `
import { title } from "../db.ts";

@default
<Home>
  <h1>{title}</h1>
</Home>
`);

    const result = await compileElizabethFile(sourcePath, {
      root,
      frameworkRoot: process.cwd(),
      outDir: join(root, ".elizabeth"),
    });
    const code = await Bun.file(result.outputPath).text();

    expect(code).toContain("/src/db.ts");
    expect(code).not.toContain('from "../db.ts"');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compileElizabethFile supports app alias imports from src", async () => {
  const root = await tempProject("alias-page-import");
  const sourcePath = join(root, "src/pages/index.liz");

  try {
    await mkdir(join(root, "src/pages"), { recursive: true });
    await mkdir(join(root, "src/components"), { recursive: true });
    await Bun.write(join(root, "src/components/Button.liz"), `
@public
<Button>
  <button>{children}</button>
</Button>
`);
    await Bun.write(join(root, "src/components/Button.module.css"), `
.primary {
  color: red;
}
`);
    await Bun.write(sourcePath, `
import { Button } from "@/components/Button.liz";
import styles from "@/components/Button.module.css";
import { title } from "@/db.ts";

@default
<Home>
  <h1 className={styles.primary}>{title}</h1>
  <Button>Save</Button>
</Home>
`);
    await Bun.write(join(root, "src/db.ts"), "export const title = 'Alias import';\n");

    const result = await compileElizabethFile(sourcePath, {
      root,
      frameworkRoot: process.cwd(),
      outDir: join(root, ".elizabeth"),
    });
    const code = await Bun.file(result.outputPath).text();

    expect(code).toContain("/src/db.ts");
    expect(code).not.toContain('"@/db.ts"');
    expect(code).not.toContain('"@/components/Button.liz"');
    expect(code).not.toContain('"@/components/Button.module.css"');
    expect(result.cssModules).toHaveLength(1);
    expect(result.cssModules[0].sourcePath).toBe(join(root, "src/components/Button.module.css"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compileElizabethEndpointFile rewrites ts endpoint source-relative and package imports", async () => {
  const root = await tempProject("relative-api-import");
  const sourcePath = join(root, "src/api/posts/index.ts");

  try {
    await mkdir(join(root, "src/api/posts"), { recursive: true });
    await Bun.write(join(root, "src/db.ts"), "export const slug = 'hello';\n");
    await Bun.write(sourcePath, `
import { redirect } from "elizabeth/route";
import { slug } from "../../db.ts";

export function POST() {
  return redirect("/posts/" + slug, 303);
}
`);

    const result = await compileElizabethEndpointFile(sourcePath, {
      root,
      frameworkRoot: process.cwd(),
      outDir: join(root, ".elizabeth"),
    });
    const code = await Bun.file(result.outputPath).text();

    expect(result.methods).toEqual(["POST"]);
    expect(code).toContain("/src/db.ts");
    expect(code).toContain("/src/route.ts");
    expect(code).not.toContain('from "../../db.ts"');
    expect(code).not.toContain('"elizabeth/route"');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compileElizabethEndpointFile supports app alias imports from ts endpoints", async () => {
  const root = await tempProject("alias-api-import");
  const sourcePath = join(root, "src/api/posts/index.ts");

  try {
    await mkdir(join(root, "src/api/posts"), { recursive: true });
    await Bun.write(join(root, "src/db.ts"), "export const slug = 'hello';\n");
    await Bun.write(sourcePath, `
import { slug } from "@/db.ts";

export function GET() {
  return Response.json({ slug });
}
`);

    const result = await compileElizabethEndpointFile(sourcePath, {
      root,
      frameworkRoot: process.cwd(),
      outDir: join(root, ".elizabeth"),
    });
    const code = await Bun.file(result.outputPath).text();

    expect(result.methods).toEqual(["GET"]);
    expect(code).toContain("/src/db.ts");
    expect(code).not.toContain('"@/db.ts"');
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

test("compileElizabeth marks state-dependent markup blocks as reactive html bindings", () => {
  const result = compileElizabeth(`
import { clientState } from "elizabeth/client";

@client
@public
<TodoList>
  const [todo, setTodo] = clientState(["test"]);

  <div>
    {for (const item of todo) {
      <span>{item}</span>
    }}
    <button onClick={() => setTodo([...todo, "next"])}>Add</button>
  </div>
</TodoList>
`);

  const todoList = result.clientComponents[0];

  expect(todoList.states).toEqual([{ name: "todo", setter: "setTodo", initialValue: "[\"test\"]" }]);
  expect(todoList.htmlBindings).toHaveLength(1);
  expect(todoList.htmlBindings[0].reactive).toBe(true);
  expect(todoList.htmlBindings[0].source).toContain("for (const item of todo)");
  expect(todoList.htmlBindings[0].expression).toContain("for (const item of todo)");
  expect(todoList.events).toEqual([{ id: 0, eventName: "click", handler: "() => setTodo([...todo, \"next\"])" }]);
});

test("compileElizabeth wires local child components inside client islands", () => {
  const result = compileElizabeth(`
import { clientState } from "elizabeth/client";

@private
<CounterValue value>
  <strong>{value}</strong>
</CounterValue>

@private
<CounterButton label onPress>
  <button onClick={onPress}>{label}</button>
</CounterButton>

@client
@public
<CounterShell>
  const [count, setCount] = clientState(0);

  <div>
    <CounterValue value={count} />
    <CounterButton label="Add" onPress={() => setCount(count + 1)} />
  </div>
</CounterShell>
`);

  const counter = result.clientComponents[0];

  expect(counter.states).toEqual([{ name: "count", setter: "setCount", initialValue: "0" }]);
  expect(counter.textBindings).toEqual([{ id: 0, expression: "count", reactive: true }]);
  expect(counter.events).toEqual([{ id: 0, eventName: "click", handler: "() => setCount(count + 1)" }]);
});

test("compileElizabeth tracks complex state through local child components", () => {
  const result = compileElizabeth(`
import { clientState } from "elizabeth/client";

@private
<Summary total filter>
  <section>
    <strong>{total}</strong>
    <em>{filter}</em>
  </section>
</Summary>

@private
<FilterTabs active setActive>
  <nav>
    <button disabled={active === "all"} onClick={() => setActive("all")}>All</button>
    <button disabled={active === "open"} onClick={() => setActive("open")}>Open</button>
    <button disabled={active === "done"} onClick={() => setActive("done")}>Done</button>
  </nav>
</FilterTabs>

@private
<AddItem onAdd>
  <button onClick={onAdd}>Add generated task</button>
</AddItem>

@private
<TodoList items>
  <ul>
    {for (const item of items) {
      <li>
        <span>{item.title}</span>
        <small>{item.done ? "done" : "open"}</small>
      </li>
    }}
  </ul>
</TodoList>

@client
@public
<Dashboard>
  const [items, setItems] = clientState([
    { id: 1, title: "Write tests", done: false },
    { id: 2, title: "Ship example", done: true },
  ]);
  const [filter, setFilter] = clientState("all");
  const visible = filter === "all" ? items : items.filter((item) => filter === "done" ? item.done : !item.done);
  const addItem = () => setItems([...items, { id: items.length + 1, title: "Generated task", done: false }]);

  <main>
    <Summary total={visible.length} filter={filter} />
    <FilterTabs active={filter} setActive={setFilter} />
    <AddItem onAdd={addItem} />
    <TodoList items={visible} />
  </main>
</Dashboard>
`);

  const dashboard = result.clientComponents[0];

  expect(dashboard.states).toEqual([
    {
      name: "items",
      setter: "setItems",
      initialValue: `[
    { id: 1, title: "Write tests", done: false },
    { id: 2, title: "Ship example", done: true },
  ]`,
    },
    { name: "filter", setter: "setFilter", initialValue: "\"all\"" },
  ]);
  expect(dashboard.textBindings.map((binding) => binding.expression)).toEqual([
    '(filter === "all" ? items : items.filter((item) => filter === "done" ? item.done : !item.done)).length',
    "filter",
  ]);
  expect(dashboard.attrBindings.map((binding) => binding.expression)).toEqual([
    '(filter) === "all"',
    '(filter) === "open"',
    '(filter) === "done"',
  ]);
  expect(dashboard.events.map((event) => event.handler)).toEqual([
    '() => (setFilter)("all")',
    '() => (setFilter)("open")',
    '() => (setFilter)("done")',
    "addItem",
  ]);
  expect(dashboard.htmlBindings).toHaveLength(1);
  expect(dashboard.htmlBindings[0].source).toContain("for (const item of (visible))");
  expect(dashboard.htmlBindings[0].expression).toContain("item.done ? \"done\" : \"open\"");
  expect(dashboard.htmlBindings[0].reactive).toBe(true);
  expect(dashboard.clientFunctions.map((fn) => fn.name)).toEqual(["addItem"]);
});

test("compileElizabeth supports inline style blocks in client islands", () => {
  const result = compileElizabeth(`
import { clientState } from "elizabeth/client";

@client
@public
<StyledCounter>
  const [count, setCount] = clientState(0);

  <style>
    .board {
      display: grid;
      gap: 12px;
      border-radius: 8px;
    }
  </style>

  <section className="board">
    <strong>{count}</strong>
    <button onClick={() => setCount(count + 1)}>Add</button>
  </section>
</StyledCounter>
`);

  const counter = result.clientComponents[0];

  expect(result.code).toContain("<style");
  expect(counter.states).toEqual([{ name: "count", setter: "setCount", initialValue: "0" }]);
  expect(counter.textBindings).toEqual([{ id: 0, expression: "count", reactive: true }]);
  expect(counter.events).toEqual([{ id: 0, eventName: "click", handler: "() => setCount(count + 1)" }]);
});

test("compileElizabeth keeps later component siblings after native elements in client islands", () => {
  const result = compileElizabeth(`
import { clientState } from "elizabeth/client";

@private
<Action label onPress>
  <button onClick={onPress}>{label}</button>
</Action>

@client
@public
<Toolbar>
  const [count, setCount] = clientState(0);
  const add = () => setCount(count + 1);
  const reset = () => setCount(0);

  <section>
    <strong>{count}</strong>
    <div>
      <Action label="Add" onPress={add} />
      <Action label="Reset" onPress={reset} />
    </div>
  </section>
</Toolbar>
`);

  const toolbar = result.clientComponents[0];

  expect(toolbar.textBindings).toEqual([{ id: 0, expression: "count", reactive: true }]);
  expect(toolbar.events.map((event) => event.handler)).toEqual(["add", "reset"]);
  expect(toolbar.clientFunctions.map((fn) => fn.name)).toEqual(["add", "reset"]);
});

test("compileElizabeth supports practical client islands with style, handlers, and nested child components", () => {
  const result = compileElizabeth(`
import { clientState } from "elizabeth/client";

@private
<Metric label value>
  <span><strong>{value}</strong>{label}</span>
</Metric>

@private
<Action label onPress>
  <button onClick={onPress}>{label}</button>
</Action>

@private
<Activity items>
  <ul>
    {for (const item of items) {
      <li>{item}</li>
    }}
  </ul>
</Activity>

@client
@public
<ProjectBoard>
  const [openCount, setOpenCount] = clientState(3);
  const [doneCount, setDoneCount] = clientState(1);
  const [activity, setActivity] = clientState(["Project loaded"]);
  const total = openCount + doneCount;

  function addTask() {
    setOpenCount(openCount + 1);
    setActivity([...activity, \`Added task \${total + 1}\`]);
  }

  function completeTask() {
    if (openCount === 0) {
      setActivity([...activity, "No open tasks"]);
      return;
    }

    setOpenCount(openCount - 1);
    setDoneCount(doneCount + 1);
    setActivity([...activity, \`Completed task \${doneCount + 1}\`]);
  }

  <style>
    .board {
      display: grid;
      gap: 16px;
      border-radius: 8px;
    }
  </style>

  <section className="board">
    <div>
      <Metric label="Total" value={total} />
      <Metric label="Open" value={openCount} />
      <Metric label="Done" value={doneCount} />
    </div>
    <div>
      <Action label="Add task" onPress={() => addTask()} />
      <Action label="Complete task" onPress={() => completeTask()} />
    </div>
    <Activity items={activity} />
  </section>
</ProjectBoard>
`);

  const board = result.clientComponents[0];

  expect(board.textBindings.map((binding) => binding.expression)).toEqual([
    "(openCount + doneCount)",
    "openCount",
    "doneCount",
  ]);
  expect(board.events.map((event) => event.handler)).toEqual([
    "() => addTask()",
    "() => completeTask()",
  ]);
  expect(board.htmlBindings).toHaveLength(1);
  expect(board.htmlBindings[0].reactive).toBe(true);
});

test("compileElizabeth supports stateful dashboard form with filters and derived lists", () => {
  const result = compileElizabeth(`
import { clientState } from "elizabeth/client";

@private
<StatusFilter active setActive>
  <div>
    <button className={active === "all" ? "active" : ""} onClick={() => setActive("all")}>All</button>
    <button className={active === "open" ? "active" : ""} onClick={() => setActive("open")}>Open</button>
    <button className={active === "done" ? "active" : ""} onClick={() => setActive("done")}>Done</button>
  </div>
</StatusFilter>

@private
<TaskSummary total open done>
  <div>
    <span><strong>{total}</strong>Total</span>
    <span><strong>{open}</strong>Open</span>
    <span><strong>{done}</strong>Done</span>
  </div>
</TaskSummary>

@private
<TaskList tasks>
  <ul>
    {for (const task of tasks) {
      <li className={task.done ? "done" : ""}>
        <strong>{task.title}</strong>
        <span>{task.done ? "done" : "open"}</span>
      </li>
    }}
  </ul>
</TaskList>

@client
@public
<ProjectTasksPage>
  const [filter, setFilter] = clientState("all");
  const [tasks, setTasks] = clientState([
    { id: 1, title: "Trace nested layout boundaries", done: true },
    { id: 2, title: "Pass state through child components", done: false },
    { id: 3, title: "Keep derived lists reactive", done: false },
  ]);
  const [draft, setDraft] = clientState("");
  const visible = filter === "all" ? tasks : tasks.filter((task) => filter === "done" ? task.done : !task.done);
  const open = tasks.filter((task) => !task.done).length;
  const done = tasks.length - open;

  function addTask() {
    const title = draft.trim();
    if (!title) {
      return;
    }
    setTasks([...tasks, { id: tasks.length + 1, title, done: false }]);
    setDraft("");
  }

  <style>
    .board {
      display: grid;
      gap: 16px;
      border-radius: 8px;
    }
  </style>

  <section className="board">
    <TaskSummary total={tasks.length} open={open} done={done} />
    <StatusFilter active={filter} setActive={setFilter} />
    <div>
      <input value={draft} onInput={(event) => setDraft(event.target.value)} placeholder="New task" />
      <button onClick={addTask}>Add</button>
    </div>
    <TaskList tasks={visible} />
  </section>
</ProjectTasksPage>
`);

  const page = result.clientComponents[0];

  expect(page.events.map((event) => event.handler)).toEqual([
    '() => (setFilter)("all")',
    '() => (setFilter)("open")',
    '() => (setFilter)("done")',
    "(event) => setDraft(event.target.value)",
    "addTask",
  ]);
  expect(page.htmlBindings).toHaveLength(1);
  expect(page.htmlBindings[0].reactive).toBe(true);
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

test("buildPageRoutes renders complex nested layouts with dynamic params", async () => {
  const root = await tempProject("nested-layouts");

  try {
    await mkdir(join(root, "src/pages/docs/[section]/articles"), { recursive: true });
    await Bun.write(join(root, "src/pages/layout.liz"), `
@default
<RootLayout>
  <html>
    <body>
      <div data-layout="root">{children}</div>
    </body>
  </html>
</RootLayout>
`);
    await Bun.write(join(root, "src/pages/docs/layout.liz"), `
@default
<DocsLayout>
  <section data-layout="docs">
    <nav>Docs nav</nav>
    {children}
  </section>
</DocsLayout>
`);
    await Bun.write(join(root, "src/pages/docs/[section]/layout.liz"), `
@default
<SectionLayout>
  <section data-layout="section">
    <h1>Section {ctx.params.section}</h1>
    {children}
  </section>
</SectionLayout>
`);
    await Bun.write(join(root, "src/pages/docs/[section]/articles/layout.liz"), `
@default
<ArticleLayout>
  <article data-layout="article-shell">
    {children}
  </article>
</ArticleLayout>
`);
    await Bun.write(join(root, "src/pages/docs/[section]/articles/[slug].liz"), `
@default
<ArticlePage>
  <main data-page="article">
    <p>{ctx.params.section}</p>
    <p>{ctx.params.slug}</p>
  </main>
</ArticlePage>
`);

    const manifest = await buildPageRoutes({
      root,
      frameworkRoot: process.cwd(),
      pageRoots: [{ dir: join(root, "src/pages"), basePath: "/" }],
      outDir: join(root, ".elizabeth"),
    });
    const match = matchPageRoute(manifest.routes, "/docs/guides/articles/routing");

    expect(manifest.routes.map((route) => route.path)).toEqual(["/docs/[section]/articles/[slug]"]);
    expect(match?.params).toEqual({ section: "guides", slug: "routing" });
    expect(match?.route.layouts.map((layout) => layout.sourcePath)).toEqual([
      join(root, "src/pages/layout.liz"),
      join(root, "src/pages/docs/layout.liz"),
      join(root, "src/pages/docs/[section]/layout.liz"),
      join(root, "src/pages/docs/[section]/articles/layout.liz"),
    ]);

    const html = await renderPageRoute(match!);

    expect(html).toContain('data-layout="root"');
    expect(html).toContain('data-layout="docs"');
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-layout="article-shell"');
    expect(html).toContain('data-page="article"');
    expect(html).toContain("Section guides");
    expect(html).toContain("<p>guides</p>");
    expect(html).toContain("<p>routing</p>");
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
