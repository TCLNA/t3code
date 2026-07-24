import { describe, expect, it } from "vite-plus/test";

import { resolveTtsCommand, resolveTtsVoice } from "./TextToSpeech.ts";

describe("resolveTtsCommand", () => {
  it("defaults to the kokoro command when engine is unset", () => {
    const r = resolveTtsCommand({ kokoroCommand: "/kk", chatterboxCommand: "/cb" }, {});
    expect(r).toEqual({ engine: "kokoro", command: "/kk" });
  });
  it("uses the chatterbox command when engine is chatterbox", () => {
    const r = resolveTtsCommand(
      { ttsEngine: "chatterbox", kokoroCommand: "/kk", chatterboxCommand: "/cb" },
      {},
    );
    expect(r).toEqual({ engine: "chatterbox", command: "/cb" });
  });
  it("falls back to the engine-specific env var when the field is empty", () => {
    const r = resolveTtsCommand({ ttsEngine: "chatterbox" }, { T3_CHATTERBOX_CMD: "/env-cb" });
    expect(r).toEqual({ engine: "chatterbox", command: "/env-cb" });
  });
  it("returns an empty command when nothing is configured", () => {
    const r = resolveTtsCommand({ ttsEngine: "chatterbox" }, {});
    expect(r.command).toBe("");
  });
});

describe("resolveTtsVoice", () => {
  it("kokoro uses kokoroVoice then falls back to af_heart", () => {
    expect(resolveTtsVoice("kokoro", undefined, { kokoroVoice: "af_nova" }, {})).toBe("af_nova");
    expect(resolveTtsVoice("kokoro", undefined, {}, {})).toBe("af_heart");
  });
  it("chatterbox uses chatterboxVoice with NO af_heart fallback", () => {
    expect(resolveTtsVoice("chatterbox", undefined, { chatterboxVoice: "rossmann" }, {})).toBe(
      "rossmann",
    );
    expect(resolveTtsVoice("chatterbox", undefined, {}, {})).toBe("");
  });
  it("an explicit requested voice wins for both engines", () => {
    expect(resolveTtsVoice("chatterbox", "custom", { chatterboxVoice: "rossmann" }, {})).toBe(
      "custom",
    );
    expect(resolveTtsVoice("kokoro", "custom", { kokoroVoice: "af_nova" }, {})).toBe("custom");
  });
});
