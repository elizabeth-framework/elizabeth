---
"@elizabeth-js/elizabeth": minor
---

Add `elizabeth format` — a tiny built-in formatter for `.liz` files. It's intentionally conservative: it does **not** parse or reformat JS / TS / JSX / CSS inside components. It only normalizes whitespace, line endings, and trailing newlines so files stay tidy in version control without fighting whatever JS or CSS formatter your project already uses.

Transformations applied:

- CRLF / CR line endings converted to LF.
- Trailing whitespace stripped from every line.
- Runs of 3+ consecutive blank lines collapsed to 2.
- File ends with exactly one trailing newline.

Usage:

```bash
elizabeth format                  # format all .liz files under cwd
elizabeth format src/             # format every .liz file under src/
elizabeth format file.liz         # format a single file
elizabeth format --check          # exit non-zero if anything would change
elizabeth format --stdout file.liz   # print to stdout instead of writing
```

Also exports `formatLiz(source)` and `runFormatCli(options)` from the package internals for tooling that wants to plug the formatter into editors / pre-commit hooks.
