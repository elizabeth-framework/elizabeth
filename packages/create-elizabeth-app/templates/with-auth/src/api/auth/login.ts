import { createSessionCookie } from "../../lib/auth.ts";
import { authenticateUser } from "../../lib/users.ts";

export async function POST({ request }: { request: Request }): Promise<Response> {
  const form = await request.formData().catch(() => null);

  if (!form) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");

  if (!username || !password) {
    return Response.json({ error: "Username and password are required." }, { status: 400 });
  }

  const user = await authenticateUser(username, password);

  if (!user) {
    return Response.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const cookie = createSessionCookie({ userId: user.id, username: user.username });
  const accept = request.headers.get("accept") ?? "";

  if (accept.includes("application/json")) {
    return Response.json({ user: { id: user.id, username: user.username } }, { headers: { "set-cookie": cookie } });
  }

  return new Response(null, {
    status: 303,
    headers: {
      "set-cookie": cookie,
      location: "/",
    },
  });
}
