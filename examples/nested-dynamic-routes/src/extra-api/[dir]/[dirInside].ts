type RouteContext = {
  request: Request;
  params: {
    dir: string;
    dirInside: string;
  };
  url: URL;
};

export function GET(ctx: RouteContext) {
  return Response.json({
    method: "GET",
    route: "/v1/[dir]/[dirInside]",
    params: ctx.params,
    pathname: ctx.url.pathname,
  });
}

export async function PATCH(ctx: RouteContext) {
  const body = await ctx.request.json().catch(() => ({}));

  return Response.json({
    method: "PATCH",
    route: "/v1/[dir]/[dirInside]",
    params: ctx.params,
    pathname: ctx.url.pathname,
    body,
  });
}

