import { describe, expect, it } from "vite-plus/test";
import { resolveMarkdownRender } from "./filePreviewMode";

const base = {
  isMarkdown: true,
  preferRendered: true,
  relativePath: "a.md" as string | null,
  revealLine: null as number | null,
  revealRequestId: 1,
  renderedReveal: null as { path: string; requestId: number } | null,
};

describe("resolveMarkdownRender", () => {
  it("is false for non-markdown files even when rendered is preferred", () => {
    expect(resolveMarkdownRender({ ...base, isMarkdown: false })).toBe(false);
  });

  it("is false when source is preferred", () => {
    expect(resolveMarkdownRender({ ...base, preferRendered: false })).toBe(false);
  });

  it("renders when markdown + preferred and no line reveal", () => {
    expect(resolveMarkdownRender({ ...base, revealLine: null })).toBe(true);
  });

  it("shows source during a line reveal that has not been acknowledged", () => {
    expect(
      resolveMarkdownRender({
        ...base,
        revealLine: 42,
        revealRequestId: 5,
        renderedReveal: { path: "a.md", requestId: 4 },
      }),
    ).toBe(false);
  });

  it("shows source during a line reveal when no reveal is acknowledged", () => {
    expect(
      resolveMarkdownRender({ ...base, revealLine: 42, revealRequestId: 5, renderedReveal: null }),
    ).toBe(false);
  });

  it("renders during a line reveal the user switched to rendered", () => {
    expect(
      resolveMarkdownRender({
        ...base,
        revealLine: 42,
        revealRequestId: 5,
        renderedReveal: { path: "a.md", requestId: 5 },
      }),
    ).toBe(true);
  });

  it("does not carry a reveal acknowledgement across files with a colliding request id", () => {
    expect(
      resolveMarkdownRender({
        ...base,
        relativePath: "b.md",
        revealLine: 42,
        revealRequestId: 5,
        renderedReveal: { path: "a.md", requestId: 5 },
      }),
    ).toBe(false);
  });

  it("stays source during a line reveal when source is preferred", () => {
    expect(
      resolveMarkdownRender({
        ...base,
        preferRendered: false,
        revealLine: 42,
        revealRequestId: 5,
        renderedReveal: { path: "a.md", requestId: 5 },
      }),
    ).toBe(false);
  });
});
