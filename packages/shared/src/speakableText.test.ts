import { describe, expect, it } from "vite-plus/test";

import {
  detectSendPromptCodeword,
  markdownToSpeakable,
  segmentSpeakable,
} from "./speakableText.ts";

describe("markdownToSpeakable", () => {
  it("drops fenced code blocks", () => {
    const md = "Here is the fix:\n\n```ts\nconst x = 1;\n```\n\nAll done.";
    const spoken = markdownToSpeakable(md);
    expect(spoken).not.toContain("const x");
    expect(spoken).toContain("Here is the fix");
    expect(spoken).toContain("All done.");
  });

  it("drops an unterminated (still streaming) fence", () => {
    const md = "Try this:\n```js\nconsole.log('partial";
    const spoken = markdownToSpeakable(md);
    expect(spoken).toBe("Try this:");
  });

  it("speaks inline code content but drops the backticks", () => {
    const spoken = markdownToSpeakable("Call the `useVoiceStore` hook now.");
    expect(spoken).toContain("useVoiceStore");
    expect(spoken).not.toContain("`");
    expect(spoken).toContain("Call the");
    expect(spoken).toContain("hook now.");
  });

  it("keeps link text and drops the url", () => {
    const spoken = markdownToSpeakable("See [the docs](https://example.com/x) for more.");
    expect(spoken).toContain("the docs");
    expect(spoken).not.toContain("example.com");
  });

  it("drops bare urls", () => {
    const spoken = markdownToSpeakable("Open https://example.com/foo now.");
    expect(spoken).not.toContain("example.com");
    expect(spoken).toContain("Open");
  });

  it("drops file paths", () => {
    const spoken = markdownToSpeakable("Edit src/index.ts and package.json please.");
    expect(spoken).not.toContain("src/index.ts");
    expect(spoken).not.toContain("package.json");
    expect(spoken).toContain("Edit");
    expect(spoken).toContain("please.");
  });

  it("strips markdown emphasis and headings but keeps words", () => {
    const spoken = markdownToSpeakable("# Title\n\nThis is **bold** and _italic_ text.");
    expect(spoken).toContain("Title");
    expect(spoken).toContain("bold");
    expect(spoken).toContain("italic");
    expect(spoken).not.toContain("**");
    expect(spoken).not.toContain("#");
  });

  it("does not treat sentence-final words as file paths", () => {
    const spoken = markdownToSpeakable("We are done.");
    expect(spoken).toBe("We are done.");
  });
});

describe("segmentSpeakable", () => {
  it("splits complete sentences and keeps the remainder", () => {
    const { units, remainder } = segmentSpeakable("Hello there. How are you? I am fine and");
    expect(units).toEqual(["Hello there.", "How are you?"]);
    expect(remainder).toBe("I am fine and");
  });

  it("returns no units when there is no sentence boundary yet", () => {
    const { units, remainder } = segmentSpeakable("still typing a sentence");
    expect(units).toEqual([]);
    expect(remainder).toBe("still typing a sentence");
  });

  it("handles ellipsis and trailing quotes", () => {
    const { units, remainder } = segmentSpeakable('She said "wait." Then left.');
    expect(units).toEqual(['She said "wait."', "Then left."]);
    expect(remainder).toBe("");
  });
});

describe("detectSendPromptCodeword", () => {
  it("matches a trailing codeword and strips it", () => {
    const result = detectSendPromptCodeword("refactor the parser send prompt", "send prompt");
    expect(result.matched).toBe(true);
    expect(result.strippedText).toBe("refactor the parser");
  });

  it("is punctuation and case insensitive", () => {
    const result = detectSendPromptCodeword("Fix the bug, Send Prompt.", "send prompt");
    expect(result.matched).toBe(true);
    expect(result.strippedText).toBe("Fix the bug");
  });

  it("does not match the codeword mid-sentence", () => {
    const result = detectSendPromptCodeword("send prompt to the server when ready", "send prompt");
    expect(result.matched).toBe(false);
    expect(result.strippedText).toBe("send prompt to the server when ready");
  });

  it("matches when the transcript is only the codeword", () => {
    const result = detectSendPromptCodeword("send prompt", "send prompt");
    expect(result.matched).toBe(true);
    expect(result.strippedText).toBe("");
  });

  it("never matches an empty phrase", () => {
    const result = detectSendPromptCodeword("anything at all", "");
    expect(result.matched).toBe(false);
  });
});
