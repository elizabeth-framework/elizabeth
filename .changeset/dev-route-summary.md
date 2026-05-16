---
"@elizabeth-js/elizabeth": minor
---

Print a discovered-routes summary on `elizabeth dev` startup. The dev server now eagerly builds the page and API route manifests and prints them under the existing "Local: …" banner so you can see exactly what got picked up. Adds `getRouteSummary()` to the value returned by `createElizabethDevHandler()` and exports a `formatRouteSummary()` helper for tooling that wants to render the summary itself.
