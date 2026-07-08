import type { SessionPhase } from "../types.ts";

export function nextPredictionKey(
  threadId: string | null,
  lastMessageId: string | null,
): string | null {
  if (!threadId || !lastMessageId) return null;
  return `${threadId}:${lastMessageId}`;
}

export function shouldFetchPrediction(args: {
  enabled: boolean;
  phase: SessionPhase;
  prevPhase: SessionPhase;
  promptIsEmpty: boolean;
  key: string | null;
  cachedKey: string | null;
}): boolean {
  if (!args.enabled) return false;
  if (!args.promptIsEmpty) return false;
  if (args.key === null) return false;
  if (args.key === args.cachedKey) return false;
  // Turn just finished: transitioned out of "running" into "ready".
  return args.prevPhase === "running" && args.phase === "ready";
}
