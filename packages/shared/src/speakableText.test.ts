import { describe, expect, it } from "vite-plus/test";

import {
  detectSendPromptCodeword,
  markdownToSpeakable,
  segmentSpeakable,
  stripMarkers,
} from "./speakableText.ts";

describe("markdownToSpeakable", () => {
  it("drops fenced code blocks and their colon-introducer sentence", () => {
    const md = "Here is the fix:\n\n```ts\nconst x = 1;\n```\n\nAll done.";
    const spoken = markdownToSpeakable(md);
    expect(spoken).not.toContain("const x");
    expect(spoken).not.toContain("Here is the fix");
    expect(spoken).not.toContain("[CODEBLOCK]");
    expect(spoken).toContain("All done.");
  });
  it("drops an unterminated (still streaming) fence and its colon-introducer", () => {
    const md = "Try this:\n```js\nconsole.log('partial";
    const spoken = markdownToSpeakable(md);
    expect(spoken).toBe("");
  });
  it("drops a colon-terminated sentence that only introduces a code block", () => {
    const md = "A one-liner to check the device:\n\n```py\nx = 1\n```\n\nRun it now.";
    const spoken = markdownToSpeakable(md);
    expect(spoken).not.toContain("check the device");
    expect(spoken).not.toContain("[CODEBLOCK]");
    expect(spoken).toContain("Run it now.");
  });
  it("keeps a non-colon sentence before a code block", () => {
    const md = "All done.\n\n```py\nx = 1\n```";
    const spoken = markdownToSpeakable(md);
    expect(spoken).toContain("All done.");
    expect(spoken).not.toContain("[CODEBLOCK]");
  });
  it("drops only the colon-introducer clause, keeping the prior sentence", () => {
    const md = "Here's the setup. Run this:\n\n```sh\nls\n```";
    const spoken = markdownToSpeakable(md);
    expect(spoken).toContain("Here's the setup.");
    expect(spoken).not.toContain("Run this");
    expect(spoken).not.toContain("[CODEBLOCK]");
  });
  it("does not treat a mid-sentence colon like 3:1 as an introducer", () => {
    const md = "The ratio is 3:1\n\n```txt\ndata\n```";
    const spoken = markdownToSpeakable(md);
    expect(spoken).toContain("The ratio is 3:1");
    expect(spoken).not.toContain("[CODEBLOCK]");
  });
  it("handles a code block at the very start with nothing to drop", () => {
    const md = "```py\nx = 1\n```\n\nText after.";
    const spoken = markdownToSpeakable(md);
    expect(spoken).toContain("Text after.");
    expect(spoken).not.toContain("x = 1");
    expect(spoken).not.toContain("[CODEBLOCK]");
  });

  it("marks inline code with [CODE:…] and removes backticks", () => {
    const spoken = markdownToSpeakable("Call the `useVoiceStore` hook now.");
    expect(spoken).toContain("[CODE:useVoiceStore]");
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

  it("marks file paths with [PATH:…] instead of dropping them", () => {
    const spoken = markdownToSpeakable("Edit src/index.ts and package.json please.");
    expect(spoken).toContain("[PATH:src/index.ts]");
    expect(spoken).toContain("[PATH:package.json]");
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

  it("marks prose arrows with [ARROW:…]", () => {
    const spoken = markdownToSpeakable("State goes from false -> true on submit.");
    expect(spoken).toContain("[ARROW:->]");
    // No bare arrow outside a marker
    expect(spoken.replace(/\[ARROW:[^\]]*\]/g, "")).not.toContain("->");
  });

  it("marks => arrows", () => {
    const spoken = markdownToSpeakable("Each item => its processed form.");
    expect(spoken).toContain("[ARROW:=>]");
  });

  it("marks --> arrows", () => {
    const spoken = markdownToSpeakable("Step A --> Step B.");
    expect(spoken).toContain("[ARROW:-->]");
  });

  it("arrows inside inline code stay within the CODE marker, not separately marked", () => {
    const spoken = markdownToSpeakable("The `false -> true` transition.");
    // The arrow inside backtick content is preserved inside [CODE:…] as-is
    expect(spoken).toContain("[CODE:false -> true]");
    // No separate [ARROW:->] marker is emitted
    expect(spoken).not.toContain("[ARROW:->]");
  });

  it("does not mark arrows inside CODE markers", () => {
    const spoken = markdownToSpeakable("Use `a -> b` pattern.");
    const arrowCount = (spoken.match(/\[ARROW:/g) ?? []).length;
    expect(arrowCount).toBe(0); // arrow stays inside CODE, not separately marked
  });
});

describe("stripMarkers", () => {
  it("expands CODE markers back to their inner text", () => {
    expect(stripMarkers("[CODE:useVoiceStore]")).toBe("useVoiceStore");
  });

  it("removes PATH markers entirely", () => {
    expect(stripMarkers("[PATH:src/components/Foo.tsx]")).toBe("");
  });

  it("replaces ARROW markers with a comma", () => {
    expect(stripMarkers("[ARROW:->]")).toBe(",");
  });

  it("handles mixed marker sentence", () => {
    const result = stripMarkers(
      "Update [CODE:useVoiceStore] so [PATH:foo.ts] returns [ARROW:->] value.",
    );
    expect(result).toBe("Update useVoiceStore so  returns , value.");
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
