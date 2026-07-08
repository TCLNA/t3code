export type SessionGroupKey = "needsYou" | "running" | "done";

export interface SessionClassInput {
  readonly hasPendingUserInput: boolean;
  readonly hasPendingApprovals: boolean;
  readonly hasActionableProposedPlan: boolean;
  readonly session: { readonly status: string } | null;
}

/** Pure single-thread classification. Precedence: needsYou > running > done. */
export function classifySession(thread: SessionClassInput): SessionGroupKey {
  if (
    thread.hasPendingUserInput ||
    thread.hasPendingApprovals ||
    thread.hasActionableProposedPlan
  ) {
    return "needsYou";
  }
  const status = thread.session?.status;
  if (status === "running" || status === "starting") {
    return "running";
  }
  return "done";
}

/** Group threads into ordered status buckets. Input order is preserved. */
export function groupSessionsByStatus<T extends SessionClassInput>(
  threads: ReadonlyArray<T>,
  _nowMs: number,
): Record<SessionGroupKey, T[]> {
  const grouped: Record<SessionGroupKey, T[]> = {
    needsYou: [],
    running: [],
    done: [],
  };
  for (const thread of threads) {
    grouped[classifySession(thread)].push(thread);
  }
  return grouped;
}
