import { describe, expect, test } from "bun:test";
import { h, renderOgImage } from "../src/index.ts";

describe("h()", () => {
  test("returns the element shape satori expects", () => {
    const node = h("div", { style: { color: "white" } }, "Hello");
    expect(node.type).toBe("div");
    expect(node.props.style).toEqual({ color: "white" });
    expect(node.props.children).toBe("Hello");
  });

  test("collapses a single child to a scalar children prop", () => {
    const node = h("span", null, "only");
    expect(node.props.children).toBe("only");
  });

  test("preserves an array when multiple children are passed", () => {
    const a = h("strong", null, "a");
    const b = h("em", null, "b");
    const node = h("p", null, a, "between", b);
    expect(Array.isArray(node.props.children)).toBe(true);
    expect((node.props.children as unknown[]).length).toBe(3);
  });

  test("merges props when none are provided", () => {
    const node = h("div");
    expect(node.props).toEqual({});
  });
});

describe("renderOgImage()", () => {
  test("throws a helpful error when no fonts are provided", async () => {
    await expect(
      renderOgImage({
        fonts: [] as never,
        template: h("div", null, "no fonts"),
      }),
    ).rejects.toThrow(/at least one font/i);
  });
});
