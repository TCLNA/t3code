import type { SessionPhase } from "../types.ts";

export function nextPredictionKey(
  threadId: string | null,
  lastMessageId: string | null,
): string | null {
  if (!threadId || !lastMessageId) return null;
  return `${threadId}:${lastMessageId}`;
}

/**
 * Decides whether a turn boundary (running -> ready) should (re-)arm the
 * given key as eligible for a prediction fetch. Arming is independent of
 * whether the composer is empty: a completed turn stays eligible until it's
 * either fulfilled or superseded by a newer turn boundary.
 *
 * Returns the key to arm, or null if this render doesn't introduce a new
 * turn boundary (in which case the caller should keep whatever key was
 * armed previously).
 */
export function armedPredictionKey(args: {
  enabled: boolean;
  phase: SessionPhase;
  prevPhase: SessionPhase;
  key: string | null;
}): string | null {
  if (!args.enabled) return null;
  if (args.key === null) return null;
  if (args.prevPhase !== "running" || args.phase !== "ready") return null;
  return args.key;
}

export function shouldFetchPrediction(args: {
  enabled: boolean;
  promptIsEmpty: boolean;
  armedKey: string | null;
  cachedKey: string | null;
}): boolean {
  if (!args.enabled) return false;
  if (!args.promptIsEmpty) return false;
  if (args.armedKey === null) return false;
  if (args.armedKey === args.cachedKey) return false;
  return true;
}
