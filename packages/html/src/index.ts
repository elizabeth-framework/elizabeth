export type ClassValue = string | number | null | undefined | false | true | ClassValue[] | { [key: string]: unknown };

const safeHtmlMarker = Symbol.for("elizabeth.safeHtml");

export interface SafeHtml {
  readonly [safeHtmlMarker]: true;
  readonly value: string;
}

export function classNames(...inputs: ClassValue[]): string {
  const classes: string[] = [];

  for (const input of inputs) {
    appendClass(input, classes);
  }

  return classes.join(" ");
}

function appendClass(input: ClassValue, classes: string[]): void {
  if (input === null || input === undefined || input === false || input === true) {
    return;
  }

  if (typeof input === "string") {
    if (input.length > 0) {
      classes.push(input);
    }
    return;
  }

  if (typeof input === "number") {
    classes.push(String(input));
    return;
  }

  if (Array.isArray(input)) {
    for (const entry of input) {
      appendClass(entry, classes);
    }
    return;
  }

  if (typeof input === "object") {
    for (const [key, value] of Object.entries(input)) {
      if (value) {
        classes.push(key);
      }
    }
  }
}

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined || value === false) {
    return "";
  }

  if (isSafeHtml(value)) {
    return value.value;
  }

  if (typeof Bun !== "undefined" && typeof Bun.escapeHTML === "function") {
    return Bun.escapeHTML(String(value));
  }

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeHtml(value: string): SafeHtml {
  return {
    [safeHtmlMarker]: true,
    value,
  };
}

export function isSafeHtml(value: unknown): value is SafeHtml {
  return Boolean(
    value && typeof value === "object" && (value as { [safeHtmlMarker]?: unknown })[safeHtmlMarker] === true,
  );
}
