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

export function permanentRedirect(location: string): RedirectResult {
  return redirect(location, 308);
}

export function temporaryRedirect(location: string): RedirectResult {
  return redirect(location, 307);
}

export function seeOther(location: string): RedirectResult {
  return redirect(location, 303);
}

export function redirectBack(request: Request, fallback: string, status = 303): RedirectResult {
  const referer = request.headers.get("referer");
  return redirect(referer ?? fallback, status);
}

export function notFound(): NotFoundResult {
  return {
    [notFoundMarker]: true,
  };
}

export function isRedirectResult(value: unknown): value is RedirectResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { [redirectMarker]?: unknown })[redirectMarker] === true,
  );
}

export function isNotFoundResult(value: unknown): value is NotFoundResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { [notFoundMarker]?: unknown })[notFoundMarker] === true,
  );
}
