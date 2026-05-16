# Contributing to Elizabeth

Thanks for your interest in contributing to Elizabeth 💜

Elizabeth is still early, so bug reports, ideas, documentation fixes, tests, and small improvements are all welcome.

## Ways to contribute

You can help by:

- Reporting bugs
- Suggesting features or design ideas
- Improving documentation
- Adding tests
- Improving examples
- Fixing issues
- Reviewing pull requests
- Sharing projects built with Elizabeth

## Before opening a pull request

Please try to keep pull requests focused and reviewable.

Good pull requests usually:

- Change one thing at a time
- Include tests when behavior changes
- Avoid unnecessary dependencies
- Preserve existing public APIs unless the change is intentional
- Explain why the change is useful

## Development setup

Elizabeth uses Bun.

```bash
bun install
bun run check
bun run test
````

For local development:

```bash
bun run dev
```

To build:

```bash
bun run build
```

## Pull request checklist

Before opening a pull request, please check:

* [ ] The change has a clear scope
* [ ] `bun run check` passes
* [ ] `bun run test` passes
* [ ] Tests were added or updated when useful
* [ ] Documentation was updated if public behavior changed
* [ ] No unnecessary dependencies were added

## Reporting bugs

When reporting a bug, please include:

* What you expected to happen
* What actually happened
* Steps to reproduce
* Your Bun version
* Your Elizabeth version
* Any relevant error messages or logs

Please open security reports privately instead of creating a public issue.
See [SECURITY.md](./SECURITY.md).

## Feature ideas

Feature ideas are welcome in GitHub Discussions.

For larger changes, please start with a short design discussion before opening a large pull request.

## Code of Conduct

Please be kind and respectful when participating in this project.

By contributing, you agree to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Maintainer note

Elizabeth is moving fast, so some APIs may change while the project is still in early development.

Thank you for helping build Elizabeth.
