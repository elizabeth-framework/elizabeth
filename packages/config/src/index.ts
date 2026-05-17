export interface MiddlewareContext {
  request: Request;
  pathname: string;
  params: Record<string, string>;
  locals: Record<string, unknown>;
  error?: unknown;
  readonly url: URL;
}

export type Middleware = (
  context: MiddlewareContext,
  next: () => Response | Promise<Response>,
) => Response | Promise<Response>;

export interface RouteRootConfig {
  basePath?: string;
  middleware?: Middleware[];
}

export type RouteRootsConfig = string | string[] | Record<string, string | RouteRootConfig>;

export interface ElizabethUserConfig {
  middleware?: Middleware[];
  pageRoutes?: RouteRootsConfig;
  apiRoutes?: RouteRootsConfig;
}

export function defineConfig(config: ElizabethUserConfig): ElizabethUserConfig {
  return config;
}

export interface ApiContext {
  request: Request;
  pathname: string;
  params: Record<string, string>;
  locals: Record<string, unknown>;
  error?: unknown;
  readonly url: URL;
}

export type ApiHandlerResult = Response | string | null | undefined | void | unknown;

export type ApiHandler = (context: ApiContext) => ApiHandlerResult | Promise<ApiHandlerResult>;

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export type ApiHandlers = Partial<Record<HttpMethod, ApiHandler>>;

export function defineApiRoute<T extends ApiHandlers>(handlers: T): T {
  return handlers;
}
