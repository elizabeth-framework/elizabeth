---
"@elizabeth-js/elizabeth": minor
---

Print a discovered-routes summary on `elizabeth dev` startup. The dev server now eagerly builds the page and API route manifests and prints them under the existing "Local: …" banner so you can see exactly what got picked up.

The list is capped at 20 entries per section by default to keep the banner readable in large projects, with an "… and N more" footer when truncated. Override with the `ELIZABETH_DEV_ROUTE_LIMIT` environment variable (set to `0` to disable the cap entirely).

Also adds `getRouteSummary()` to the value returned by `createElizabethDevHandler()` and exports a `formatRouteSummary(summary, { limit })` helper for tooling that wants to render the summary itself.
