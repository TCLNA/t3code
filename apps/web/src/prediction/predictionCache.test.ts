import { describe, expect, it } from "vite-plus/test";
import { armedPredictionKey, nextPredictionKey, shouldFetchPrediction } from "./predictionCache.ts";

describe("nextPredictionKey", () => {
  it("is null without a thread or message", () => {
    expect(nextPredictionKey(null, "m1")).toBeNull();
    expect(nextPredictionKey("t1", null)).toBeNull();
  });
  it("combines thread and message id", () => {
    expect(nextPredictionKey("t1", "m9")).toBe("t1:m9");
  });
});

describe("armedPredictionKey", () => {
  const base = {
    enabled: true,
    phase: "ready" as const,
    prevPhase: "running" as const,
    key: "t1:m9",
  };
  it("arms on a running→ready turn boundary when enabled", () => {
    expect(armedPredictionKey(base)).toBe("t1:m9");
  });
  it("does not arm when disabled", () => {
    expect(armedPredictionKey({ ...base, enabled: false })).toBeNull();
  });
  it("does not arm without a key", () => {
    expect(armedPredictionKey({ ...base, key: null })).toBeNull();
  });
  it("does not arm without a turn boundary", () => {
    expect(armedPredictionKey({ ...base, prevPhase: "ready" })).toBeNull();
  });
  it("does not arm while still running", () => {
    expect(armedPredictionKey({ ...base, phase: "running" })).toBeNull();
  });
});

describe("shouldFetchPrediction", () => {
  const base = {
    enabled: true,
    promptIsEmpty: true,
    armedKey: "t1:m9",
    cachedKey: null,
  };
  it("fetches when armed, empty, enabled, and not yet cached", () => {
    expect(shouldFetchPrediction(base)).toBe(true);
  });
  it("does not fetch when disabled", () => {
    expect(shouldFetchPrediction({ ...base, enabled: false })).toBe(false);
  });
  it("does not fetch when the composer has text", () => {
    expect(shouldFetchPrediction({ ...base, promptIsEmpty: false })).toBe(false);
  });
  it("does not fetch without an armed key", () => {
    expect(shouldFetchPrediction({ ...base, armedKey: null })).toBe(false);
  });
  it("does not refetch the same turn key", () => {
    expect(shouldFetchPrediction({ ...base, cachedKey: "t1:m9" })).toBe(false);
  });

  it("regression: a turn armed while the composer is non-empty is still fetched once it later clears", () => {
    // Render at the turn boundary: composer still has text. The turn arms,
    // but must not fetch yet.
    const armedAtBoundary = armedPredictionKey({
      enabled: true,
      prevPhase: "running",
      phase: "ready",
      key: "t1:m9",
    });
    expect(armedAtBoundary).toBe("t1:m9");
    expect(
      shouldFetchPrediction({
        enabled: true,
        promptIsEmpty: false,
        armedKey: armedAtBoundary,
        cachedKey: null,
      }),
    ).toBe(false);

    // A later render for the SAME turn: phase is stable at "ready" (no new
    // boundary, so armedPredictionKey returns null and the previously armed
    // key must be preserved by the caller), but the composer is now empty.
    // The turn must still be eligible to fetch instead of being lost.
    const armedOnLaterRender = armedPredictionKey({
      enabled: true,
      prevPhase: "ready",
      phase: "ready",
      key: "t1:m9",
    });
    expect(armedOnLaterRender).toBeNull();
    const stillArmedKey = armedOnLaterRender ?? armedAtBoundary;
    expect(
      shouldFetchPrediction({
        enabled: true,
        promptIsEmpty: true,
        armedKey: stillArmedKey,
        cachedKey: null,
      }),
    ).toBe(true);
  });
});
