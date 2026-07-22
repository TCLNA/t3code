import { describe, expect, it } from "vite-plus/test";

import { migrateAudioMode, nextAudioMode } from "./useVoiceStore";

describe("migrateAudioMode", () => {
  it("keeps a valid stored mode", () => {
    expect(migrateAudioMode("all", null)).toBe("all");
    expect(migrateAudioMode("notify", "true")).toBe("notify");
    expect(migrateAudioMode("none", "false")).toBe("none");
  });

  it("migrates legacy ttsMuted=false to all", () => {
    expect(migrateAudioMode(null, "false")).toBe("all");
  });

  it("defaults to notify when legacy is true or absent", () => {
    expect(migrateAudioMode(null, "true")).toBe("notify");
    expect(migrateAudioMode(null, null)).toBe("notify");
    expect(migrateAudioMode(undefined, undefined)).toBe("notify");
  });

  it("ignores an invalid stored mode and falls back", () => {
    expect(migrateAudioMode("bogus", "false")).toBe("all");
  });
});

describe("nextAudioMode", () => {
  it("cycles all -> notify -> none -> all", () => {
    expect(nextAudioMode("all")).toBe("notify");
    expect(nextAudioMode("notify")).toBe("none");
    expect(nextAudioMode("none")).toBe("all");
  });
});
