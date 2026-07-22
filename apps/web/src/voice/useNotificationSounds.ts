import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect, useRef } from "react";

import { resolveThreadStatusPill, type ThreadStatusPill } from "../components/Sidebar.logic";
import { useThreadShells } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";
import { resolveNotificationBeep } from "./notificationBeeps";
import { playBeep } from "./notificationSounds";
import { useVoiceStore } from "./useVoiceStore";

type StatusLabel = ThreadStatusPill["label"];

/**
 * Watches every sidebar-known thread's status and plays a beep on a
 * Working -> settled transition. Mount once (in the sidebar root). Seeds each
 * thread's label on first observation so already-settled threads stay silent.
 */
export function useNotificationSounds(): void {
  const threads = useThreadShells();
  const lastVisitedById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const audioMode = useVoiceStore((state) => state.audioMode);
  const beepUnfocusedOnly = useVoiceStore((state) => state.beepUnfocusedOnly);
  const prevLabelByKey = useRef<Map<string, StatusLabel | null>>(new Map());

  useEffect(() => {
    const prev = prevLabelByKey.current;
    const seen = new Set<string>();

    for (const thread of threads) {
      const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      seen.add(key);
      const label =
        resolveThreadStatusPill({
          thread: { ...thread, lastVisitedAt: lastVisitedById[key] },
        })?.label ?? null;

      const known = prev.has(key);
      const prevLabel = prev.get(key) ?? null;
      prev.set(key, label);
      if (!known) continue; // seed on first observation without beeping

      const beep = resolveNotificationBeep(prevLabel, label, audioMode);
      if (beep !== null && (!beepUnfocusedOnly || document.hidden)) {
        playBeep(beep);
      }
    }

    for (const key of [...prev.keys()]) {
      if (!seen.has(key)) prev.delete(key);
    }
  }, [threads, lastVisitedById, audioMode, beepUnfocusedOnly]);
}
