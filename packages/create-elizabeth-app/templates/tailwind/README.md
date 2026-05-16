# Elizabeth App (Tailwind)

A reactive web application built with [Elizabeth](https://github.com/elizabeth-js/elizabeth), styled with [Tailwind CSS](https://tailwindcss.com).

## Getting Started

Start the development server:

```bash
bun run dev
```

Open `http://localhost:3712` in your browser.

## Tailwind

Tailwind CSS is set up via `@tailwindcss/vite`. Edit `src/styles.css` to add your own `@theme` overrides, `@layer` rules, or component classes. The framework picks `src/styles.css` up as the global CSS entry automatically.

## Editing

* **Pages**: Add or edit `.liz` files in `src/pages/`. Use Tailwind utility classes via `className`.
* **API Routes**: Add `.ts` files in `src/api/` and export `GET`, `POST`, etc.
* **Components**: Add reusable UI elements in `src/components/`.

## Building for Production

```bash
bun run build
bun run start
```
