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

  it("regression: a thread-change render never registers a turn boundary, even when the outgoing thread was mid-run", () => {
    // Bug 3 (thread-switch boundary leak): the user is viewing thread A,
    // which is `running`. They switch to idle thread B (composer empty,
    // `phase === "ready"`, B has a completed-but-never-fetched turn). Without
    // a fix, prevPhaseRef still holds A's "running" from the prior render, so
    // this render would see prevPhase="running" -> phase="ready" and treat it
    // as a fresh boundary for B, arming (and then fetching) a prediction B
    // never earned this render.
    //
    // The hook's fix feeds `effectivePrevPhase = args.phase` (the CURRENT
    // thread's phase) as prevPhase on any thread-change render, so the
    // boundary check always sees prevPhase === phase and is neutralized.
    // Asserted here at the pure-function level since this repo has no
    // renderHook harness to exercise the ref logic directly.
    const onThreadChange = armedPredictionKey({
      enabled: true,
      phase: "ready",
      prevPhase: "ready", // effectivePrevPhase on thread-change: args.phase, not A's stale "running"
      key: "B:m1",
    });
    expect(onThreadChange).toBeNull();

    // Contrast: a genuine same-thread boundary (no thread change, prevPhase
    // really is the prior render's phase) still arms as before.
    const genuineBoundary = armedPredictionKey({
      enabled: true,
      phase: "ready",
      prevPhase: "running",
      key: "B:m1",
    });
    expect(genuineBoundary).toBe("B:m1");
  });
});

describe("shouldFetchPrediction", () => {
  const base = {
    enabled: true,
    phase: "ready" as const,
    promptIsEmpty: true,
    armedKey: "t1:m9",
    armedThreadId: "t1",
    threadId: "t1",
    cachedKey: null,
  };
  it("fetches when armed, ready, empty, enabled, same thread, and not yet cached", () => {
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

  it("does not fetch when the current phase is not ready, even if armed/empty/enabled", () => {
    // Bug 2 (same-thread mid-run staleness): the user resubmits on the same
    // thread (ready -> running) before the armed turn is fetched. The old
    // key stays armed (no new running->ready boundary), but a fetch must not
    // fire while a new turn is in flight.
    expect(shouldFetchPrediction({ ...base, phase: "running" })).toBe(false);
  });
  it("does not fetch while connecting or disconnected either", () => {
    expect(shouldFetchPrediction({ ...base, phase: "connecting" })).toBe(false);
    expect(shouldFetchPrediction({ ...base, phase: "disconnected" })).toBe(false);
  });

  it("does not fetch when the armed entry belongs to a different thread than the current one", () => {
    // Bug 1 (cross-thread leak): a turn armed on thread A while unfetched,
    // then the user switches to thread B. The armed key/thread must not be
    // used to fetch against (or mixed with) the now-current thread.
    expect(shouldFetchPrediction({ ...base, armedThreadId: "A", threadId: "B" })).toBe(false);
  });
  it("does not fetch when there is no armed thread at all", () => {
    expect(shouldFetchPrediction({ ...base, armedThreadId: null })).toBe(false);
  });

  it("regression: a turn armed while the composer is non-empty is still fetched once it later clears (same thread, ready phase)", () => {
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
        phase: "ready",
        promptIsEmpty: false,
        armedKey: armedAtBoundary,
        armedThreadId: "t1",
        threadId: "t1",
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
        phase: "ready",
        promptIsEmpty: true,
        armedKey: stillArmedKey,
        armedThreadId: "t1",
        threadId: "t1",
        cachedKey: null,
      }),
    ).toBe(true);
  });
});
