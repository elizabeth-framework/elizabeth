# Elizabeth for VS Code

Official Visual Studio Code language support for the Elizabeth framework.

Elizabeth is a Bun-first full-stack web framework with `.liz` components, file-based routing, server-side rendering, API routes, scoped styles, and client islands.

This extension adds syntax highlighting, editor support, snippets, and language server features for `.liz` files.

## Features

- Syntax highlighting for `.liz` files
- Elizabeth decorators:
  - `@default`
  - `@public`
  - `@private`
  - `@declare`
  - `@client`
- TypeScript/TSX intelligence inside Elizabeth components
- JSX/HTML-like tag highlighting
- Attribute completion such as `className`, `id`, `onClick`
- Auto-import support from `.liz` components
- CSS highlighting inside `<style>` blocks
- CSS diagnostics and completion inside style blocks
- Auto-closing tags
- Self-closing tag support
- Elizabeth component snippets

## Example

```liz
@public
<Counter>
  const [count, setCount] = clientState(0);

  <div className="counter">
    <span>{count}</span>

    <button onClick={() => setCount(count + 1)}>
      Increment
    </button>

    <style>
      .counter {
        display: flex;
        gap: 0.5rem;
      }
    </style>
  </div>
</Counter>
````

## Snippets

Type `@` inside a `.liz` file to get Elizabeth snippets.

Examples:

```liz
@default
```

Expands to:

```liz
@default
<HomePage>
  
</HomePage>
```

```liz
@public
```

Expands to:

```liz
@public
<Component>
  
</Component>
```

`@client` inserts only the decorator:

```liz
@client
```

## Language Server Support

The extension includes an Elizabeth language server powered by Volar and TypeScript language services.

Supported editor features include:

* TypeScript completions
* DOM and ESNext globals
* JSX attribute completions
* CSS completions in `<style>` blocks
* Diagnostics for TypeScript and CSS regions
* Auto-import suggestions for exported `.liz` components

## Requirements

* VS Code `^1.90.0`
* The Elizabeth framework
* Bun is recommended for Elizabeth projects

## Recommended Settings

The extension automatically enables linked editing for Elizabeth files:

```json
{
  "[elizabeth]": {
    "editor.linkedEditing": true
  }
}
```

## File Extension

Elizabeth components use the `.liz` file extension.

```txt
src/pages/index.liz
src/components/Counter.liz
```

## Known Limitations

Elizabeth editor support is still evolving.

Some advanced Elizabeth-specific syntax may not be understood exactly like the Elizabeth compiler yet. The language server currently maps `.liz` files into virtual TSX/CSS documents to provide editor intelligence.

## Links

* Elizabeth repository: [https://github.com/elizabeth-js/elizabeth](https://github.com/elizabeth-js/elizabeth)

## License

Apache 2.0