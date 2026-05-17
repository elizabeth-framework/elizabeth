---
"@elizabeth-js/elizabeth": minor
---

Compile errors now carry a structured `ElizabethCompileError` with `file`, `line`, `column`, and the original source attached. The dev and build CLIs use this to print a code-framed terminal message (with a caret pointing at the offending column) when an API route fails to compile, instead of a bare stack trace.

Adds a `formatCompileError(error, options?)` helper for tooling that wants to render its own code frames in terminal output. The `.message` shape remains `file:line:col: text` so existing log scrapers and the dev HTML error page continue to work unchanged.
