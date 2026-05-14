import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";

export interface Post {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  created_at: string;
}

const dbPath = join(import.meta.dir, "data/blog.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.run(`
  create table if not exists posts (
    id integer primary key autoincrement,
    title text not null,
    slug text not null unique,
    excerpt text not null,
    body text not null,
    created_at text not null default current_timestamp
  )
`);

const count = db.query("select count(*) as count from posts").get() as { count: number };

if (count.count === 0) {
  createPost({
    title: "First Elizabeth Post",
    excerpt: "A small SQLite-backed page rendered by Elizabeth.",
    body: "This post was inserted when the database was first created. Edit src/db.ts or add a new post from the form.",
  });
}

export function listPosts(): Post[] {
  return db.query("select * from posts order by datetime(created_at) desc, id desc").all() as Post[];
}

export function getPost(slug: string): Post | null {
  return db.query("select * from posts where slug = ?").get(slug) as Post | null;
}

export function createPost(input: { title: string; excerpt: string; body: string }): Post {
  const title = input.title.trim();
  const excerpt = input.excerpt.trim();
  const body = input.body.trim();
  const slugBase = slugify(title);
  const slug = uniqueSlug(slugBase);

  db.query("insert into posts (title, slug, excerpt, body) values (?, ?, ?, ?)").run(title, slug, excerpt, body);

  const post = getPost(slug);
  if (!post) {
    throw new Error("Post was inserted but could not be loaded.");
  }

  return post;
}

function uniqueSlug(base: string): string {
  let slug = base || "post";
  let index = 2;

  while (getPost(slug)) {
    slug = `${base}-${index}`;
    index++;
  }

  return slug;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
