const redirectMarker = Symbol.for("elizabeth.redirect");
const notFoundMarker = Symbol.for("elizabeth.notFound");

export interface RedirectResult {
  readonly [redirectMarker]: true;
  readonly location: string;
  readonly status: number;
}

export interface NotFoundResult {
  readonly [notFoundMarker]: true;
}

export function redirect(location: string, status = 302): RedirectResult {
  return {
    [redirectMarker]: true,
    location,
    status,
  };
}

export function isRedirectResult(value: unknown): value is RedirectResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { [redirectMarker]?: unknown })[redirectMarker] === true,
  );
}

export function notFound(): NotFoundResult {
  return {
    [notFoundMarker]: true,
  };
}

export function isNotFoundResult(value: unknown): value is NotFoundResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { [notFoundMarker]?: unknown })[notFoundMarker] === true,
  );
}
