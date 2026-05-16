import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";

const appDir = new URL("./test-app/", import.meta.url).pathname;
const expectedDir = new URL("./expected/", import.meta.url).pathname;
const resultsDir = new URL("./results/", import.meta.url).pathname;

async function waitForServer(url: string) {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status > 0) return;
    } catch {
      // server not ready yet
    }

    await Bun.sleep(50);
  }

  throw new Error(`Server did not start: ${url}`);
}

async function withDevServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const port = 4100 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://localhost:${port}`;

  const proc = Bun.spawn(["bun", "run", "dev"], {
    cwd: appDir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
    },
    stdout: "ignore",
    stderr: "ignore",
  });

  try {
    await waitForServer(baseUrl);
    return await run(baseUrl);
  } finally {
    proc.kill("SIGTERM");
    await proc.exited;
  }
}

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

function normalizeOutput(html: string) {
  return html
    .replace(/data-elizabeth-boundary="layout:[^"]+"/g, 'data-elizabeth-boundary="layout:<hash>"')
    .replaceAll(ROOT, "<root>")
    .replace(/<script type="module">[\s\S]*?<\/script>/g, '<script type="module"></script>');
}

const NORMAL_CONFIG = `
export default {
  pageRoutes: {
    "src/pages": "/",
    "src/another-pages": "/another-pages",
  },
  apiRoutes: {
    "src/api": "/api",
    "src/another-api": "/another-api",
  },
};
`;

async function testCase(prefix: string, endpoints: string, outFile?: string) {
  if (!outFile) {
    outFile = prefix;
  }

  await withDevServer(async (baseUrl) => {
    const expected = await Bun.file(`${expectedDir}/${prefix}`).text();

    const res = await fetch(`${baseUrl}${endpoints}`);
    const result = await res.text();

    await Bun.write(`${resultsDir}/${outFile}`, result);

    expect(normalizeOutput(result)).toContain(normalizeOutput(expected));
  });
}

async function fetchCase(
  endpoints: string,
  run: (response: Response, body: string) => Promise<void> | void,
): Promise<void> {
  await withDevServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}${endpoints}`);
    const body = await response.text();
    await run(response, body);
  });
}

test("should return pages index as expected if there is no config", async () => {
  const endpoints = ``;
  const prefix = "n-config-pages.txt";
  const outFile = "no-config-pages.txt";

  await rm(`${appDir}/elizabeth.config.ts`, { force: true });

  await testCase(prefix, endpoints, outFile);
});

test("normal config: pages should render as expected", async () => {
  const endpoints = ``;
  const prefix = "n-config-pages.txt";

  await Bun.write(`${appDir}/elizabeth.config.ts`, NORMAL_CONFIG);

  await testCase(prefix, endpoints);
});

test("normal config: another pages should render as expected", async () => {
  const endpoints = `/another-pages`;
  const prefix = "n-config-another-pages.txt";

  await Bun.write(`${appDir}/elizabeth.config.ts`, NORMAL_CONFIG);

  await testCase(prefix, endpoints);
});

test("normal config: typescript api should response as expected", async () => {
  const endpoints = `/api/hello`;
  const prefix = "n-config-api-ts.txt";

  await Bun.write(`${appDir}/elizabeth.config.ts`, NORMAL_CONFIG);

  await testCase(prefix, endpoints);
});

test("normal config: elizabeth api should response as expected", async () => {
  const endpoints = `/api/hello-elizabeth`;
  const prefix = "n-config-api-elizabeth.txt";

  await Bun.write(`${appDir}/elizabeth.config.ts`, NORMAL_CONFIG);

  await testCase(prefix, endpoints);
});

test("normal config: missing page should render custom 404 page", async () => {
  await Bun.write(`${appDir}/elizabeth.config.ts`, NORMAL_CONFIG);

  await fetchCase("/missing-page", async (response, body) => {
    const expected = await Bun.file(`${expectedDir}/404.txt`).text();

    expect(response.status).toBe(404);
    expect(normalizeOutput(body)).toContain(normalizeOutput(expected));
  });
});

test("normal config: nested missing page should render nearest 404 page", async () => {
  await Bun.write(`${appDir}/elizabeth.config.ts`, NORMAL_CONFIG);

  await fetchCase("/docs/missing-page", async (response, body) => {
    expect(response.status).toBe(404);
    expect(body).toContain('data-not-found="docs"');
    expect(body).toContain("Docs 404");
  });
});

test("normal config: nested render error should render nearest error page", async () => {
  await Bun.write(`${appDir}/elizabeth.config.ts`, NORMAL_CONFIG);

  await fetchCase("/docs/crash", async (response, body) => {
    expect(response.status).toBe(500);
    expect(body).toContain('data-error="docs"');
    expect(body).toContain("Docs page crashed");
  });
});

test("normal config: loading request should render nearest loading page", async () => {
  await Bun.write(`${appDir}/elizabeth.config.ts`, NORMAL_CONFIG);

  await withDevServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/docs/anything`, {
      headers: {
        "x-elizabeth-loading": "1",
      },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('data-loading="docs"');
    expect(body).toContain("Docs loading");
  });
});

test("normal config: src/styles.css should load as global css in dev", async () => {
  await Bun.write(`${appDir}/elizabeth.config.ts`, NORMAL_CONFIG);
  await Bun.write(`${appDir}/src/styles.css`, "body { background: rgb(1, 2, 3); }\n");

  try {
    await withDevServer(async (baseUrl) => {
      const page = await fetch(`${baseUrl}/`).then((response) => response.text());

      expect(page).toContain('<link rel="stylesheet" href="/_elizabeth/global/src/styles.css" />');

      const cssResponse = await fetch(`${baseUrl}/_elizabeth/global/src/styles.css`);
      const css = await cssResponse.text();

      expect(cssResponse.headers.get("content-type")).toContain("text/css");
      expect(css).toContain("rgb(1, 2, 3)");
      expect(css).not.toContain("__vite__updateStyle");
    });
  } finally {
    await rm(`${appDir}/src/styles.css`, { force: true });
  }
});

test("normal config: unsupported api method should return method not allowed", async () => {
  await Bun.write(`${appDir}/elizabeth.config.ts`, NORMAL_CONFIG);

  await withDevServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/hello`, { method: "POST" });
    const body = await response.text();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(body).toContain("Method Not Allowed");
  });
});

test("duplicated route field config should rendered as expected", async () => {
  // src/another-pages map to / which same as src/pages
  // src/pages is before src/another-pages
  // thus / will be src/pages
  const endpoints = `/`;
  const prefix = "n-config-pages.txt";
  const outFile = "dup-config-pages.txt";

  await Bun.write(
    `${appDir}/elizabeth.config.ts`,
    `
export default {
  pageRoutes: {
    "src/pages": "/",
    "src/another-pages": "/",
  },
  apiRoutes: {
    "src/api": "/api",
    "src/another-api": "/another-api",
  },
};
`,
  );

  await testCase(prefix, endpoints, outFile);
});

test("duplicated route field config should rendered as expected", async () => {
  // src/another-pages map to / which same as src/pages
  // src/another-pages is after src/pages
  // thus / will be the same as src/pages
  const endpoints = `/`;
  const prefix = "n-config-pages.txt";
  const outFile = "dup-config-another-pages-second.txt";

  await Bun.write(
    `${appDir}/elizabeth.config.ts`,
    `
export default {
  pageRoutes: {
    "src/pages": "/",
    "src/another-pages": "/",
  },
  apiRoutes: {
    "src/api": "/api",
    "src/another-api": "/another-api",
  },
};
`,
  );

  await testCase(prefix, endpoints, outFile);
});

test("duplicated route field config should rendered as expected", async () => {
  // src/another-pages map to / which same as src/pages
  // src/another-pages is before src/pages
  // thus / will be the same as src/another-pages
  const endpoints = `/`;
  const prefix = "n-config-another-pages.txt";
  const outFile = "dup-config-another-pages-first.txt";

  await Bun.write(
    `${appDir}/elizabeth.config.ts`,
    `
export default {
  pageRoutes: {
    "src/another-pages": "/",
    "src/pages": "/",
  },
  apiRoutes: {
    "src/api": "/api",
    "src/another-api": "/another-api",
  },
};
`,
  );

  await testCase(prefix, endpoints, outFile);
});

test("duplicated api route should error as expected", async () => {
  const endpoints = `/api/hello`;
  const prefix = "route-conflict-hello.txt";
  const outFile = "dup-config-api.txt";

  await Bun.write(
    `${appDir}/elizabeth.config.ts`,
    `
export default {
  pageRoutes: {
    "src/another-pages": "/",
    "src/pages": "/",
  },
  apiRoutes: {
    "src/api": "/api",
    "src/another-api": "/api",
  },
};
`,
  );

  await testCase(prefix, endpoints, outFile);
});

test("duplicated api route should render dev error page with conflict details", async () => {
  await Bun.write(
    `${appDir}/elizabeth.config.ts`,
    `
export default {
  pageRoutes: {
    "src/another-pages": "/",
    "src/pages": "/",
  },
  apiRoutes: {
    "src/api": "/api",
    "src/another-api": "/api",
  },
};
`,
  );

  await fetchCase("/api/hello", (response, body) => {
    expect(response.status).toBe(500);
    expect(body).toContain("<title>Elizabeth Error</title>");
    expect(body).toContain("Route <code>/api/hello</code> failed while rendering.");
    expect(body).toContain("Route conflict: GET /api/hello");
    expect(body).toContain("src/api/hello.ts");
    expect(body).toContain("src/another-api/hello.ts");
  });
});
