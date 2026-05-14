export function GET(ctx: { params: { dir: string; dirInside: string }; url: URL }) {
  return Response.json({
    method: "GET",
    route: "/api/[dir]/[dirInside]",
    params: ctx.params,
    pathname: ctx.url.pathname,
  });
}

export async function POST(ctx: { request: Request; params: { dir: string; dirInside: string }; url: URL }) {
  const body = await ctx.request.json().catch(() => ({}));

  return Response.json({
    method: "POST",
    route: "/api/[dir]/[dirInside]",
    params: ctx.params,
    pathname: ctx.url.pathname,
    body,
  }, { status: 201 });
}

export async function PUT(ctx: { request: Request; params: { dir: string; dirInside: string }; url: URL }) {
  const body = await ctx.request.json().catch(() => ({}));

  return Response.json({
    method: "PUT",
    route: "/api/[dir]/[dirInside]",
    params: ctx.params,
    pathname: ctx.url.pathname,
    body,
  });
}

export function DELETE(ctx: { params: { dir: string; dirInside: string }; url: URL }) {
  return Response.json({
    method: "DELETE",
    route: "/api/[dir]/[dirInside]",
    params: ctx.params,
    pathname: ctx.url.pathname,
  });
}
