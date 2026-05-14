import { redirect } from "elizabeth/route";
import { createPost } from "@/db.ts";

export async function POST(ctx: { request: Request }) {
  const form = await ctx.request.formData();
  const title = String(form.get("title") ?? "");
  const excerpt = String(form.get("excerpt") ?? "");
  const body = String(form.get("body") ?? "");

  if (!title.trim() || !excerpt.trim() || !body.trim()) {
    return new Response("Missing title, excerpt, or body.", {
      status: 400,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const post = createPost({ title, excerpt, body });
  return redirect(`/posts/${post.slug}`, 303);
}
