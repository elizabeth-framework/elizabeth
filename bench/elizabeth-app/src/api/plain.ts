export function GET() {
  return new Response("Hello, Elizabeth", {
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
