# Contributing to Elizabeth

Thanks for taking an interest. This file covers how the monorepo is laid out, how to run tests locally, and how releases are cut.

## Repo layout

- `src/` — the framework core (compiler, dev server, router, runtime).
- `packages/<name>/` — individual `@elizabeth-js/<name>` packages (`crypto`, `cookies`, `http`, …). Each has its own `package.json`, `src/index.ts`, `tests/`, and `README.md`.
- `packages/create-elizabeth-app/` — the `bun create elizabeth-app` scaffolder (published as `create-elizabeth-app`).
- `packages/language-server/`, `packages/vscode-elizabeth/` — editor tooling. `language-server` is private; `vscode-elizabeth-language-extension` ships to the VS Code marketplace, not npm.
- `tests/` — unit + integration tests for the core framework.
- `bench/` — local performance benchmarks (not run in CI).

## Setup

```bash
bun install
```

## Useful scripts

| Script | What it does |
| --- | --- |
| `bun run check` | Typecheck (`tsc --noEmit`) |
| `bun run test` | Run unit + integration tests (`./tests`) and every package's tests (`./packages/*/tests`) |
| `bun run test:packages` | Run only the per-package tests |
| `bun run biome` | Apply Biome formatter + linter (`biome check --write`) |
| `bun run biome:ci` | Read-only Biome check (used in CI) |
| `bun run format` / `bun run format:check` | Formatter only |
| `bun run lint` / `bun run lint:fix` | Linter only |

CI runs `bun run check` and `bun run test` on every PR — see `.github/workflows/ci.yml`.

## Changesets — versioning and releases

This repo uses [Changesets](https://github.com/changesets/changesets) to manage versions and changelogs for the `@elizabeth-js/*` packages.

### When you make a user-visible change

Run:

```bash
bun run changeset
```

You'll be asked which packages changed and whether the change is `patch`, `minor`, or `major`. A markdown file gets written under `.changeset/`. Commit it alongside your code change in the same PR.

Tips:
- One changeset can cover multiple packages — pick the ones whose semver actually changes.
- Internal-only changes (CI tweaks, doc fixes, refactors with no API impact) don't need a changeset.
- The `language-server` and `vscode-elizabeth-language-extension` packages are ignored by changesets — they have their own release flows.

### Checking what's pending

```bash
bun run changeset:status
```

Shows which packages have queued changes and what the next version of each will be.

### Cutting a release (maintainers)

1. Run `bun run changeset:version` — this consumes all pending changesets, bumps each affected package's `package.json`, and updates `CHANGELOG.md`. Commit the result.
2. Run `bun run release` — this runs `changeset publish`, which publishes each package whose version is newer than what's on npm.
3. The existing tag-triggered `.github/workflows/publish.yml` is still in place for the root `@elizabeth-js/elizabeth` and `create-elizabeth-app` packages. Long-term we'll likely consolidate everything behind `changeset publish`; for now, both paths coexist.

## Style

- **Biome** handles formatting and a curated set of lint rules. Run `bun run biome` before pushing. CI calls `bun run biome:ci` so a PR with formatting drift will fail.
- Match the surrounding code style. The project leans on plain TypeScript, Web Standards (`Request`/`Response`), and minimal dependencies.
- Tests use `bun:test`. Each package has its own `tests/<name>.test.ts`.

## Opening a PR

- Branch naming is flexible; `devin/<timestamp>-<topic>` is what the automation here uses.
- Make sure `bun run check`, `bun run test`, and `bun run biome:ci` are all green locally.
- Include a changeset if your PR touches anything that affects published packages.
