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
  // Tracked alongside the thread it belongs to so a later fetch always
  // targets the thread the turn actually happened on.
  const armedRef = useRef<{ key: string; threadId: ThreadId } | null>(null);
  const runGetPrediction = useAtomCommand(serverEnvironment.getPrediction, "get prediction");

  const clear = useCallback(() => setPrediction(""), []);

  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = args.phase;
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
        promptIsEmpty: args.promptIsEmpty,
        armedKey: armedRef.current?.key ?? null,
        cachedKey: cachedKeyRef.current,
      }) ||
      armedRef.current === null
    ) {
      return;
    }
    const { key: fetchKey, threadId } = armedRef.current;
    cachedKeyRef.current = fetchKey;
    let cancelled = false;
    void (async () => {
      try {
        const result = await runGetPrediction({
          environmentId: args.environmentId,
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
