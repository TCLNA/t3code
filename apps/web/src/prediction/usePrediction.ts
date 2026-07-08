import { useCallback, useEffect, useRef, useState } from "react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import type { SessionPhase } from "../types.ts";
import { nextPredictionKey, shouldFetchPrediction } from "./predictionCache.ts";

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
  const runGetPrediction = useAtomCommand(serverEnvironment.getPrediction, "get prediction");

  const clear = useCallback(() => setPrediction(""), []);

  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = args.phase;
    const threadId = args.threadId;
    const key = nextPredictionKey(threadId, args.lastMessageId);
    if (
      !shouldFetchPrediction({
        enabled: args.enabled,
        phase: args.phase,
        prevPhase,
        promptIsEmpty: args.promptIsEmpty,
        key,
        cachedKey: cachedKeyRef.current,
      }) ||
      key === null ||
      threadId === null
    ) {
      return;
    }
    cachedKeyRef.current = key;
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
