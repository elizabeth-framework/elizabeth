# Elizabeth Tests

This directory is for functional correctness tests. Keep benchmark code in `bench/`.

## Structure

- `core.test.ts` covers compiler, config, and router behavior without starting a dev server.
- `index.test.ts` starts the sample app in `tests/test-app` and verifies dev-server behavior.
- `test-app/` is a small Elizabeth app used by integration tests.
- `expected/` stores HTML/text snippets used by integration tests.
- `results/` is generated during test runs for debugging output differences.

## Run

From the repository root:

```sh
bun test tests/core.test.ts tests/index.test.ts
```

or:

```sh
bun run check
bun test tests/core.test.ts tests/index.test.ts
```

`index.test.ts` starts local dev servers on random ports. If a sandbox blocks local TCP binding, run it in an environment that allows local server sockets.

## Notes

The integration tests mutate `tests/test-app/elizabeth.config.ts` to cover default config, normal config, duplicate route roots, and route conflict errors. If a test is interrupted, the config file may be left in the last scenario; the tests overwrite it as needed.

When adding new tests:

- Prefer `core.test.ts` for fast compiler/config/router coverage.
- Use `index.test.ts` only when behavior depends on the dev server response.
- Keep expected output small when possible; assert key behavior rather than full generated HTML unless a snapshot-like comparison is useful.
