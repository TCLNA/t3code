import { describe, expect, it } from "vite-plus/test";
import { nextPredictionKey, shouldFetchPrediction } from "./predictionCache.ts";

describe("nextPredictionKey", () => {
  it("is null without a thread or message", () => {
    expect(nextPredictionKey(null, "m1")).toBeNull();
    expect(nextPredictionKey("t1", null)).toBeNull();
  });
  it("combines thread and message id", () => {
    expect(nextPredictionKey("t1", "m9")).toBe("t1:m9");
  });
});

describe("shouldFetchPrediction", () => {
  const base = {
    enabled: true,
    phase: "ready" as const,
    prevPhase: "running" as const,
    promptIsEmpty: true,
    key: "t1:m9",
    cachedKey: null,
  };
  it("fetches on running→ready when empty and enabled", () => {
    expect(shouldFetchPrediction(base)).toBe(true);
  });
  it("does not fetch when disabled", () => {
    expect(shouldFetchPrediction({ ...base, enabled: false })).toBe(false);
  });
  it("does not fetch when the composer has text", () => {
    expect(shouldFetchPrediction({ ...base, promptIsEmpty: false })).toBe(false);
  });
  it("does not refetch the same turn key", () => {
    expect(shouldFetchPrediction({ ...base, cachedKey: "t1:m9" })).toBe(false);
  });
  it("does not fetch without a turn boundary", () => {
    expect(shouldFetchPrediction({ ...base, prevPhase: "ready" })).toBe(false);
  });
});
