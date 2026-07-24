import { describe, expect, it } from "vite-plus/test";

import { selectSynthVoice } from "./selectSynthVoice";

describe("selectSynthVoice", () => {
  it("returns kokoroVoice for the kokoro engine", () => {
    expect(selectSynthVoice({ ttsEngine: "kokoro", kokoroVoice: "af_nova" })).toBe("af_nova");
  });
  it("returns chatterboxVoice for the chatterbox engine", () => {
    expect(
      selectSynthVoice({
        ttsEngine: "chatterbox",
        chatterboxVoice: "rossmann",
        kokoroVoice: "af_nova",
      }),
    ).toBe("rossmann");
  });
  it("returns undefined when the selected voice is empty", () => {
    expect(selectSynthVoice({ ttsEngine: "chatterbox", chatterboxVoice: "" })).toBeUndefined();
    expect(selectSynthVoice({ ttsEngine: "kokoro", kokoroVoice: "" })).toBeUndefined();
  });
});
