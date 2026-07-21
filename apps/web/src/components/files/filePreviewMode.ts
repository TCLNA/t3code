export const isMarkdownPreviewFile = (path: string): boolean => /\.(?:md|mdx)$/i.test(path);

export const MARKDOWN_VIEW_STORAGE_KEY = "t3code.markdownRenderView";

export function resolveMarkdownRender(input: {
  isMarkdown: boolean;
  preferRendered: boolean;
  revealLine: number | null;
  revealRequestId: number;
  renderedRevealId: number | null;
}): boolean {
  const { isMarkdown, preferRendered, revealLine, revealRequestId, renderedRevealId } = input;
  if (!isMarkdown || !preferRendered) return false;
  // A line-reveal navigation shows source so the target line is visible,
  // until the user explicitly switches this reveal request to rendered.
  return revealLine === null || renderedRevealId === revealRequestId;
}

export function setMarkdownTaskChecked(
  markdown: string,
  markerOffset: number,
  checked: boolean,
): string {
  if (
    markerOffset < 0 ||
    markdown[markerOffset] !== "[" ||
    !/[ xX]/.test(markdown[markerOffset + 1] ?? "") ||
    markdown[markerOffset + 2] !== "]"
  ) {
    return markdown;
  }

  return `${markdown.slice(0, markerOffset + 1)}${checked ? "x" : " "}${markdown.slice(markerOffset + 2)}`;
}
