import { readSession } from "../../lib/auth.ts";

export function GET({ request }: { request: Request }): Response {
  const session = readSession(request);

  if (!session) {
    return Response.json({ user: null }, { status: 200 });
  }

  return Response.json({
    user: {
      id: session.userId,
      username: session.username,
    },
  });
}
