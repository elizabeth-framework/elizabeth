import { readJson } from "@elizabeth-js/request";

export type StandardSchemaV1<Input = unknown, Output = Input> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    validate(value: unknown): StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output };
  };
};

export type StandardSchemaResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardSchemaIssue>; readonly value?: undefined };

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

export type InferOutput<S> = S extends StandardSchemaV1<infer _Input, infer Output> ? Output : never;
export type InferInput<S> = S extends StandardSchemaV1<infer Input, infer _Output> ? Input : never;

export class SchemaValidationError extends Error {
  readonly issues: ReadonlyArray<StandardSchemaIssue>;
  readonly status: number;

  constructor(issues: ReadonlyArray<StandardSchemaIssue>) {
    super(formatIssues(issues));
    this.name = "SchemaValidationError";
    this.issues = issues;
    this.status = 422;
  }
}

export async function validate<S extends StandardSchemaV1>(schema: S, value: unknown): Promise<InferOutput<S>> {
  const result = await schema["~standard"].validate(value);

  if (result.issues !== undefined) {
    throw new SchemaValidationError(result.issues);
  }

  return result.value as InferOutput<S>;
}

export async function safeValidate<S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
): Promise<{ success: true; data: InferOutput<S> } | { success: false; error: SchemaValidationError }> {
  try {
    const data = await validate(schema, value);
    return { success: true, data };
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      return { success: false, error };
    }
    throw error;
  }
}

export async function validateBody<S extends StandardSchemaV1>(request: Request, schema: S): Promise<InferOutput<S>> {
  const body = await readJson(request);
  return validate(schema, body);
}

export async function validateSearchParams<S extends StandardSchemaV1>(
  input: Request | URL | string,
  schema: S,
): Promise<InferOutput<S>> {
  const params =
    input instanceof Request
      ? new URL(input.url).searchParams
      : input instanceof URL
        ? input.searchParams
        : new URL(input).searchParams;
  const obj: Record<string, string | string[]> = {};
  for (const key of params.keys()) {
    const values = params.getAll(key);
    obj[key] = values.length > 1 ? values : values[0];
  }
  return validate(schema, obj);
}

function formatIssues(issues: ReadonlyArray<StandardSchemaIssue>): string {
  if (issues.length === 0) {
    return "Schema validation failed";
  }
  return issues
    .map((issue) => {
      const path = formatPath(issue.path);
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

function formatPath(path: StandardSchemaIssue["path"]): string {
  if (!path || path.length === 0) {
    return "";
  }
  return path
    .map((segment) => (typeof segment === "object" && segment !== null ? segment.key : segment))
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`))
    .join("")
    .replace(/^\./, "");
}
