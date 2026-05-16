export type RouteRootsConfig = string | string[] | Record<string, string>;

export interface ElizabethUserConfig {
  pageRoutes?: RouteRootsConfig;
  apiRoutes?: RouteRootsConfig;
}

export function defineConfig(config: ElizabethUserConfig): ElizabethUserConfig {
  return config;
}

export interface ApiContext {
  request: Request;
  params: Record<string, string>;
  locals: Record<string, unknown>;
  readonly url: URL;
}

export type ApiHandlerResult = Response | string | null | undefined | void | unknown;

export type ApiHandler = (context: ApiContext) => ApiHandlerResult | Promise<ApiHandlerResult>;

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export type ApiHandlers = Partial<Record<HttpMethod, ApiHandler>>;

export function defineApiRoute<T extends ApiHandlers>(handlers: T): T {
  return handlers;
}
