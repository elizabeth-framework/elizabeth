export type HtmlChunk = string | number | boolean | null | undefined;

export function escapeHtml(value: HtmlChunk): string {
  if (value === null || value === undefined || value === false) {
    return "";
  }

  return Bun.escapeHTML(String(value));
}

export function escapeAttribute(value: HtmlChunk): string {
  return escapeHtml(value);
}
