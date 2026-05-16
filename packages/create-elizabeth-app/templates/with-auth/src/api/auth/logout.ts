import { clearSessionCookie } from "../../lib/auth.ts";

export function POST({ request }: { request: Request }): Response {
  const accept = request.headers.get("accept") ?? "";
  const cookie = clearSessionCookie();

  if (accept.includes("application/json")) {
    return Response.json({ ok: true }, { headers: { "set-cookie": cookie } });
  }

  return new Response(null, {
    status: 303,
    headers: {
      "set-cookie": cookie,
      location: "/",
    },
  });
}
