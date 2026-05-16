export class BodyParseError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BodyParseError";
    this.status = status;
  }
}

export async function readJson<T = unknown>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType && !/^application\/(?:[\w.+-]+\+)?json/i.test(contentType)) {
    throw new BodyParseError(`Expected JSON content-type, got "${contentType}"`, 415);
  }

  const raw = await request.text();

  if (raw.length === 0) {
    throw new BodyParseError("Request body is empty");
  }

  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new BodyParseError(`Invalid JSON body: ${message}`);
  }
}

export async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new BodyParseError(`Failed to read form data: ${message}`);
  }
}

export async function readText(request: Request): Promise<string> {
  return await request.text();
}

export function formValue(form: FormData, name: string): string | null {
  const value = form.get(name);

  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : null;
}

export function formValues(form: FormData, name: string): string[] {
  return form.getAll(name).filter((value): value is string => typeof value === "string");
}

export function formFile(form: FormData, name: string): File | null {
  const value = form.get(name);

  if (value === null || typeof value === "string") {
    return null;
  }

  return value;
}

export function searchParams(input: Request | URL | string): URLSearchParams {
  if (typeof input === "string") {
    return new URL(input).searchParams;
  }

  if (input instanceof URL) {
    return input.searchParams;
  }

  return new URL(input.url).searchParams;
}

export function queryParam(input: Request | URL | string, name: string): string | null {
  return searchParams(input).get(name);
}

export function queryParams(input: Request | URL | string, name: string): string[] {
  return searchParams(input).getAll(name);
}
