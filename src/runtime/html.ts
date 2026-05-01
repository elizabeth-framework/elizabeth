export type HtmlChunk = string | number | boolean | null | undefined;

export function escapeHtml(value: HtmlChunk): string {
  if (value === null || value === undefined || value === false) {
    return "";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttribute(value: HtmlChunk): string {
  return escapeHtml(value);
}
