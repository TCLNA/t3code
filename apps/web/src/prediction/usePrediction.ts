import { useCallback, useEffect, useRef, useState } from "react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import type { SessionPhase } from "../types.ts";
import { armedPredictionKey, nextPredictionKey, shouldFetchPrediction } from "./predictionCache.ts";

export function usePrediction(args: {
  enabled: boolean;
  environmentId: EnvironmentId;
  threadId: ThreadId | null;
  lastMessageId: string | null;
  phase: SessionPhase;
  promptIsEmpty: boolean;
}): { prediction: string; clear: () => void } {
  const [prediction, setPrediction] = useState("");
  const cachedKeyRef = useRef<string | null>(null);
  const prevPhaseRef = useRef<SessionPhase>(args.phase);
  // The turn currently eligible for a fetch, armed on a running->ready
  // transition and cleared only when a newer turn boundary supersedes it.
  // Tracked alongside the thread it belongs to so a fetch is only ever
  // considered while it still belongs to the CURRENT thread (see the
  // thread-change reset below and the armedThreadId gate in
  // shouldFetchPrediction).
  const armedRef = useRef<{ key: string; threadId: ThreadId } | null>(null);
  // Tracks the thread this hook instance last saw, so a thread switch can be
  // detected even though this hook instance isn't remounted per thread.
  const prevThreadIdRef = useRef<ThreadId | null>(args.threadId);
  const runGetPrediction = useAtomCommand(serverEnvironment.getPrediction, "get prediction");

  const clear = useCallback(() => setPrediction(""), []);

  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = args.phase;

    // Invalidate stale arming/caching when the thread changes: a previous
    // thread's armed-but-unfetched turn (or its cached key/ghost) must never
    // carry over and leak into the newly-current thread. This ref-reset path
    // has no direct unit test (this repo has no renderHook harness); the
    // shouldFetchPrediction case "does not fetch across a thread mismatch"
    // below is the closest pure-function proxy, exercising the gate this
    // reset exists to make redundant-but-safe.
    if (prevThreadIdRef.current !== args.threadId) {
      prevThreadIdRef.current = args.threadId;
      armedRef.current = null;
      cachedKeyRef.current = null;
      setPrediction("");
    }

    const key = nextPredictionKey(args.threadId, args.lastMessageId);

    const armed = armedPredictionKey({
      enabled: args.enabled,
      phase: args.phase,
      prevPhase,
      key,
    });
    if (armed !== null && args.threadId !== null) {
      armedRef.current = { key: armed, threadId: args.threadId };
    }

    if (
      !shouldFetchPrediction({
        enabled: args.enabled,
        phase: args.phase,
        promptIsEmpty: args.promptIsEmpty,
        armedKey: armedRef.current?.key ?? null,
        armedThreadId: armedRef.current?.threadId ?? null,
        threadId: args.threadId,
        cachedKey: cachedKeyRef.current,
      }) ||
      armedRef.current === null
    ) {
      return;
    }
    // The armedThreadId === threadId gate above guarantees armedRef.current
    // .threadId equals args.threadId here, so pairing it with args
    // .environmentId (rather than any stale value) always targets the
    // CURRENT thread's environment.
    const { key: fetchKey, threadId } = armedRef.current;
    const { environmentId } = args;
    cachedKeyRef.current = fetchKey;
    let cancelled = false;
    void (async () => {
      try {
        const result = await runGetPrediction({
          environmentId,
          input: { threadId },
        });
        if (!cancelled && result._tag === "Success" && result.value.prediction) {
          setPrediction(result.value.prediction);
        }
      } catch {
        // Silent: no ghost on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    args.enabled,
    args.environmentId,
    args.threadId,
    args.lastMessageId,
    args.phase,
    args.promptIsEmpty,
    runGetPrediction,
  ]);

  // Clear the ghost as soon as the composer is no longer empty.
  useEffect(() => {
    if (!args.promptIsEmpty && prediction) setPrediction("");
  }, [args.promptIsEmpty, prediction]);

  return { prediction, clear };
}
