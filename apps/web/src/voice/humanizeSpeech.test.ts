import { describe, expect, it } from "vite-plus/test";
import { prepareForSpeech } from "./humanizeSpeech";

describe("prepareForSpeech", () => {
  it("strips a CODE marker to its token when humanize is disabled", async () => {
    const result = await prepareForSpeech("call [CODE:useVoiceStore]", false);
    expect(result).toBe("call useVoiceStore");
  });

  it("leaves marker-free text unchanged when disabled", async () => {
    const result = await prepareForSpeech("hello world", false);
    expect(result).toBe("hello world");
  });
});
