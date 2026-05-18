export interface ElizabethRequestContext {
  request: Request;
  pathname: string;
  params: Record<string, string>;
  locals: Record<string, unknown>;
  error?: unknown;
  readonly url: URL;
}

export type ElizabethMiddleware = (
  context: ElizabethRequestContext,
  next: () => Response | Promise<Response>,
) => Response | Promise<Response>;

export interface ConfigMiddlewareReference {
  kind: "config";
  index: number;
}

export interface ModuleMiddlewareReference {
  kind: "module";
  sourcePath: string;
  outputPath: string;
}

export type MiddlewareReference = ConfigMiddlewareReference | ModuleMiddlewareReference;

export async function runMiddleware(
  middleware: ElizabethMiddleware[],
  context: ElizabethRequestContext,
  handler: () => Response | Promise<Response>,
): Promise<Response> {
  let index = -1;

  async function dispatch(nextIndex: number): Promise<Response> {
    if (nextIndex <= index) {
      throw new Error("Middleware called next() more than once.");
    }

    index = nextIndex;
    let current;
    
    if (middleware instanceof Promise) {
      middleware = await middleware;
    }
    
    current = middleware[nextIndex];

    if (!current) {
      return await handler();
    }

    return await current(context, () => dispatch(nextIndex + 1));
  }

  return await dispatch(0);
}
