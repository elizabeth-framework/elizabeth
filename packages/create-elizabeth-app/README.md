# create-elizabeth-app

The official scaffolding tool for the [Elizabeth](https://github.com/elizabeth-js/elizabeth) web framework.

## Usage

You don't need to install this package directly. You can initialize a new Elizabeth project using `bun create`:

```bash
bun create elizabeth-app my-app
```

This will automatically:
1. Scaffold a fresh Elizabeth project in the `my-app` directory.
2. Install all necessary dependencies (`bun install`).
3. Set up a starting template.

## Templates

Pick a template with `--template <name>`:

```bash
bun create elizabeth-app my-app --template default
bun create elizabeth-app my-app --template tailwind
bun create elizabeth-app my-app --template with-auth
```

| Template | What you get |
| --- | --- |
| `default` | Minimal starter with scoped styles and a client-island counter. |
| `tailwind` | Same starter wired up with Tailwind CSS v4 via `@tailwindcss/vite`. |
| `with-auth` | Signup / login / logout flow using HMAC-signed cookie sessions + scrypt password hashing. |

## Other options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--template <name>` | `default` | Template to use. |
| `--elizabeth <specifier>` | `npm:@elizabeth-js/elizabeth@latest` | Override the `elizabeth` dependency specifier (handy when iterating on the framework locally; pass e.g. `--elizabeth file:../elizabeth`). |
| `--force` | `false` | Allow writing into a non-empty target directory. |

## Getting Started

Once your project is created, navigate into it and start the development server:

```bash
cd my-app
bun run dev
```

Your app will be running at `http://localhost:3712`.
