/**
 * Turn assistant markdown into text that is worth reading aloud, and split it
 * into sentence-sized units for streaming text-to-speech.
 *
 * This is intentionally dependency-free (no markdown AST): it runs in the
 * browser TTS pipeline on every streamed delta, so it must be cheap and pure.
 * The goal is not perfect markdown parsing — it is to remove everything that
 * sounds like noise when spoken: fenced code blocks, URLs, image syntax, and
 * file-path-looking tokens, while keeping ordinary prose (the visible text of
 * links, and the inner text of inline `code` spans).
 */

const FENCED_CODE_BLOCK = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
// An unterminated fence (still-streaming code block): drop from the fence on.
const UNTERMINATED_FENCE = /(?:```|~~~)[\s\S]*$/;
// Inline code: keep the inner text (it's short and worth speaking), drop only
// the backticks. Fenced blocks are removed earlier, so this only sees `spans`.
const INLINE_CODE = /`([^`\n]*)`/g;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
// [text](url) -> text
const LINK = /\[([^\]]*)\]\((?:[^)]*)\)/g;
// [text][ref] -> text
const REFERENCE_LINK = /\[([^\]]*)\]\[[^\]]*\]/g;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const BARE_URL = /\b(?:https?|ftp|file):\/\/\S+/gi;
const MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s+/gm;
const BLOCKQUOTE = /^\s{0,3}>\s?/gm;
const LIST_MARKER = /^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm;
const TABLE_ROW = /^\s*\|.*\|\s*$/gm;
const THEMATIC_BREAK = /^\s{0,3}(?:[-*_]\s?){3,}$/gm;
// Emphasis / strong / strikethrough markers (keep the inner words).
const EMPHASIS_MARKERS = /(\*\*|\*|__|_|~~)/g;
// Path-like tokens: a slash-separated path, or a bare `name.ext[:line]`.
const PATH_LIKE =
  /(?:\.{0,2}\/[\w.\-/]+)|(?:\b[\w.\-]+\/[\w.\-/]+)|(?:\b[\w.\-]+\.[a-zA-Z]{1,6}(?::\d+(?::\d+)?)?\b)/g;

const SENTENCE_BOUNDARY = /[.!?…](?:["')\]]+)?(?=\s|$)/;

/** File extensions common enough that "name.ext" should be treated as a path. */
const COMMON_FILE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "mdx", "css", "scss",
  "html", "htm", "py", "rs", "go", "java", "kt", "rb", "php", "c", "h", "cpp",
  "cc", "hpp", "cs", "sh", "bash", "zsh", "yml", "yaml", "toml", "ini", "env",
  "lock", "sql", "xml", "svg", "png", "jpg", "jpeg", "gif", "wasm", "txt", "sh",
]);

function stripPathLike(text: string): string {
  return text.replace(PATH_LIKE, (match) => {
    // Keep tokens that are plainly prose ending in a sentence-final period,
    // e.g. "done." — only drop tokens whose extension looks like a real file.
    if (match.includes("/")) return " ";
    const dot = match.lastIndexOf(".");
    if (dot === -1) return match;
    const ext = match.slice(dot + 1).split(":")[0]?.toLowerCase() ?? "";
    return COMMON_FILE_EXTENSIONS.has(ext) ? " " : match;
  });
}

/**
 * Remove everything that should not be spoken and return clean prose. Safe to
 * call on a partial (still-streaming) markdown buffer.
 */
export function markdownToSpeakable(markdown: string): string {
  let text = markdown;
  text = text.replace(FENCED_CODE_BLOCK, " ");
  text = text.replace(UNTERMINATED_FENCE, " ");
  text = text.replace(IMAGE, " ");
  text = text.replace(REFERENCE_LINK, "$1");
  text = text.replace(LINK, "$1");
  text = text.replace(INLINE_CODE, "$1");
  text = text.replace(HTML_TAG, " ");
  text = text.replace(BARE_URL, " ");
  text = text.replace(TABLE_ROW, " ");
  text = text.replace(THEMATIC_BREAK, " ");
  text = text.replace(MARKDOWN_HEADING, "");
  text = text.replace(BLOCKQUOTE, "");
  text = text.replace(LIST_MARKER, "");
  text = stripPathLike(text);
  text = text.replace(EMPHASIS_MARKERS, "");
  // Collapse whitespace (including the gaps left by removals).
  text = text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  return text;
}

export interface SegmentResult {
  /** Complete, speakable sentences ready to synthesize. */
  readonly units: string[];
  /** Trailing incomplete sentence to carry into the next call. */
  readonly remainder: string;
}

/**
 * Split cleaned text into sentence units, keeping any trailing incomplete
 * sentence as `remainder`. Feed the remainder back in (prepended) on the next
 * streamed chunk so sentences are never spoken half-formed or twice.
 */
export function segmentSpeakable(text: string): SegmentResult {
  const units: string[] = [];
  let rest = text;

  while (rest.length > 0) {
    const match = SENTENCE_BOUNDARY.exec(rest);
    if (!match) break;
    const end = match.index + match[0].length;
    const sentence = rest.slice(0, end).trim();
    if (sentence.length > 0) units.push(sentence);
    rest = rest.slice(end);
  }

  return { units, remainder: rest.trim() };
}

export interface CodewordResult {
  readonly matched: boolean;
  /** Transcript with a trailing codeword removed (trimmed). */
  readonly strippedText: string;
}

function normalizeForCodeword(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detect a trailing "send prompt"-style codeword in a transcript. Matching is
 * case/punctuation/whitespace-insensitive and only fires when the phrase is at
 * the END of the transcript (so "send prompt" mid-sentence doesn't submit).
 */
export function detectSendPromptCodeword(
  transcript: string,
  phrase: string,
): CodewordResult {
  const normalizedPhrase = normalizeForCodeword(phrase);
  if (normalizedPhrase.length === 0) {
    return { matched: false, strippedText: transcript.trim() };
  }

  const normalized = normalizeForCodeword(transcript);
  if (normalized !== normalizedPhrase && !normalized.endsWith(` ${normalizedPhrase}`)) {
    return { matched: false, strippedText: transcript.trim() };
  }

  // Strip the trailing phrase from the ORIGINAL text (word-preserving), by
  // walking back the same number of normalized words.
  const phraseWordCount = normalizedPhrase.split(" ").length;
  const originalWords = transcript.trim().split(/\s+/);
  const kept = originalWords.slice(0, Math.max(0, originalWords.length - phraseWordCount));
  const strippedText = kept
    .join(" ")
    // Drop a dangling separator left before the codeword (", send prompt").
    .replace(/[\s,;:.\-–—]+$/u, "")
    .trim();

  return { matched: true, strippedText };
}
