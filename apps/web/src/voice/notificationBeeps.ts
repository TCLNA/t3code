import type { ThreadStatusPill } from "../components/Sidebar.logic";
import type { AudioMode } from "./useVoiceStore";

export type BeepKind = "done" | "needs-input";

type StatusLabel = ThreadStatusPill["label"];

const NEEDS_INPUT_LABELS: ReadonlySet<StatusLabel> = new Set<StatusLabel>([
  "Awaiting Input",
  "Pending Approval",
  "Plan Ready",
]);

/**
 * Map a thread status transition to a notification beep, honouring the audio mode.
 *
 * Only a Working -> settled edge beeps, so threads already settled at mount stay
 * silent. The `done` beep is suppressed in `all` mode because TTS narration is the
 * completion signal there.
 */
export function resolveNotificationBeep(
  prev: StatusLabel | null,
  next: StatusLabel | null,
  mode: AudioMode,
): BeepKind | null {
  if (mode === "none") return null;
  if (prev !== "Working") return null;
  if (next === "Completed") return mode === "notify" ? "done" : null;
  if (next !== null && NEEDS_INPUT_LABELS.has(next)) return "needs-input";
  return null;
}
