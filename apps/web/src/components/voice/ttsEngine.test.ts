import { describe, expect, it } from "vite-plus/test";

import { shouldShowKokoroVoices } from "./ttsEngine";

describe("shouldShowKokoroVoices", () => {
  it("shows the Kokoro voice list for kokoro", () => {
    expect(shouldShowKokoroVoices("kokoro")).toBe(true);
  });
  it("shows it when the engine is undefined (default kokoro)", () => {
    expect(shouldShowKokoroVoices(undefined)).toBe(true);
  });
  it("hides it for chatterbox", () => {
    expect(shouldShowKokoroVoices("chatterbox")).toBe(false);
  });
});
