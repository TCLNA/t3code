import { describe, expect, it } from "vite-plus/test";

import { resolveTtsCommand } from "./TextToSpeech.ts";

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
