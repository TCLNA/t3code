export const isMarkdownPreviewFile = (path: string): boolean => /\.(?:md|mdx)$/i.test(path);

export const MARKDOWN_VIEW_STORAGE_KEY = "t3code.markdownRenderView";

export function resolveMarkdownRender(input: {
  isMarkdown: boolean;
  preferRendered: boolean;
  relativePath: string | null;
  revealLine: number | null;
  revealRequestId: number;
  renderedReveal: { path: string; requestId: number } | null;
}): boolean {
  const { isMarkdown, preferRendered, relativePath, revealLine, revealRequestId, renderedReveal } =
    input;
  if (!isMarkdown || !preferRendered) return false;
  // A line-reveal navigation shows source so the target line is visible, until
  // the user explicitly switches this file's reveal request to rendered. The
  // acknowledgement is scoped per-file because revealRequestId is only unique
  // within a single file's path (see rightPanelStore.openFile).
  if (revealLine === null) return true;
  return (
    renderedReveal !== null &&
    renderedReveal.path === relativePath &&
    renderedReveal.requestId === revealRequestId
  );
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
