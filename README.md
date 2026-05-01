# Elizabeth

**The reactive web framework for the future.**

Elizabeth is a Bun-first, compile-first full-stack framework designed for high-fidelity web experiences with zero-runtime overhead. It ditches the Virtual DOM in favor of a sophisticated compiler that transforms your components into optimized server-render functions and precision-targeted client islands.

## Core Pillars

- **🚀 Zero-JS by Default:** Ship 0KB of JavaScript to the browser. Interactivity is an opt-in, not a requirement.
- **🎨 Scoped Aesthetics:** Built-in `<style>` scoping with zero-config hashing. Achieve high-fidelity designs with Vanilla CSS performance.
- **🧠 Native Logic:** No proprietary template DSLs. Write standard JavaScript `if` and `for` blocks directly inside your markup.
- **⚡ High-Fidelity HMR:** Precision hot-reloading that patches interactive islands instantly without losing state.
- **🥯 Bun-First:** Leverages the full power of the Bun ecosystem for compilation, routing, and testing.

## Try It

The fastest way to experience the future is with `create-elizabeth-app`:

```bash
bun create elizabeth-app my-app
cd my-app
bun install
bun run dev
```

## Syntax At A Glance

Elizabeth components use a declarative `@decorator` syntax to define visibility and behavior.

```js
@default
<HomePage>
  const items = [
    { text: "Fast", icon: "🚀" },
    { text: "Modern", icon: "💎" },
    { text: "Reactive", icon: "✨" }
  ];

  <style>
    .hero {
      background: rgba(255, 255, 255, 0.02);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 2rem;
      padding: 3rem;
      text-align: center;
    }
    .badge-group { display: flex; gap: 1rem; justify-content: center; }
    .badge { color: #c084fc; font-weight: 600; }
  </style>

  <div className="hero">
    <h1>Elizabeth</h1>
    <p>The web, refined.</p>
    
    <div className="badge-group">
      {for (const item of items) {
        <span className="badge">{item.icon} {item.text}</span>
      }}
    </div>

    {/* Interactive components are opted-in via @client or automated detection */}
    <Counter /> 
  </div>
</HomePage>
```

## Component Decorators

- `@declare`: Define a component for internal use (private by default).
- `@public`: Export a named component.
- `@default`: Export the default component for a module/page.
- `@client`: (Experimental) Force a component to be treated as an interactive island.

## Project Structure

- `src/pages`: File-system based routing.
- `src/components`: Reusable Elizabeth components.
- `src/api`: High-performance API routes.
- `src/styles.css`: Global styles with built-in TailwindCSS support.

## Roadmap

- [x] **OxC Integration:** High-speed logic parsing via OxC.
- [x] **Scoped Styles:** Automatic CSS hashing and isolation.
- [ ] **State Persistence:** Seamless server-to-client state dehydration.
- [ ] **Layout Transitions:** Native support for View Transitions API.
- [ ] **Standard for Bun:** Becoming the canonical way to build for the Bun ecosystem.
