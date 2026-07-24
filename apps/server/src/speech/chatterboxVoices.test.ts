import { describe, expect, it } from "vite-plus/test";

import { voiceNamesFromFilenames } from "./chatterboxVoices.ts";

describe("voiceNamesFromFilenames", () => {
  it("keeps only .wav (case-insensitive), strips the extension, sorts, de-dupes", () => {
    expect(
      voiceNamesFromFilenames(["rossmann.wav", "Alice.WAV", "notes.txt", "rossmann.wav"]),
    ).toEqual(["Alice", "rossmann"]);
  });
  it("returns an empty array for no wav files", () => {
    expect(voiceNamesFromFilenames(["a.txt", "b.md"])).toEqual([]);
  });
});
