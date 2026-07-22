# Sidebar Audio Control + Notification Beeps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar footer's TTS mute toggle with a tri-state audio cycle button (all / notify / none) plus a voice dropdown, and add in-app "done" and "needs-input" notification beeps.

**Architecture:** Client-side `useVoiceStore` gains an `audioMode` tri-state (migrated from the legacy `ttsMuted` boolean) and a `beepUnfocusedOnly` flag. A pure `resolveNotificationBeep` maps thread-status transitions to a beep kind. A single `useNotificationSounds()` hook mounted in the sidebar root watches every known thread's status and plays bundled `.oga` sounds. The footer renders a cycle button + a voice/options dropdown.

**Tech Stack:** React, Zustand, Vite (`?url` asset imports), Vitest, Tailwind, lucide-react, base-ui popover/switch.

## Global Constraints

- Beep files are freedesktop.org sound-theme `.oga`, licensed **CC BY-SA 3.0** — attribution required (Task 3).
- Assets imported via Vite `?url` (never a root `/sounds/...` path — breaks the hosted-static build).
- `ttsMuted` stays a readable store field (derived from `audioMode`); `VoiceTtsProvider` must keep working unchanged.
- Migration default for new/unset users is `"notify"`.
- Beep semantics: `done` fires only in `notify` mode (TTS narration is the finish signal in `all`); `needs-input` fires in both `all` and `notify`.
- All `localStorage` and `audio.play()` calls wrapped so failures are swallowed.

---

### Task 1: Voice store — tri-state `audioMode` + migration

**Files:**

- Modify: `apps/web/src/voice/useVoiceStore.ts`
- Test: `apps/web/src/voice/useVoiceStore.test.ts` (create)

**Interfaces:**

- Produces: `type AudioMode = "all" | "notify" | "none"`; `migrateAudioMode(storedMode, legacyTtsMuted): AudioMode`; `nextAudioMode(mode): AudioMode`; store fields `audioMode`, `ttsMuted` (derived), `beepUnfocusedOnly`; actions `setAudioMode(mode)`, `cycleAudioMode()`, `setBeepUnfocusedOnly(v)`.
- Note: `AudioMode` is defined and exported **here** (`useVoiceStore.ts`); Task 2's `notificationBeeps.ts` imports it as a type. No runtime cycle — the import is type-only.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/voice/useVoiceStore.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";

import { migrateAudioMode, nextAudioMode } from "./useVoiceStore";

describe("migrateAudioMode", () => {
  it("keeps a valid stored mode", () => {
    expect(migrateAudioMode("all", null)).toBe("all");
    expect(migrateAudioMode("notify", "true")).toBe("notify");
    expect(migrateAudioMode("none", "false")).toBe("none");
  });

  it("migrates legacy ttsMuted=false to all", () => {
    expect(migrateAudioMode(null, "false")).toBe("all");
  });

  it("defaults to notify when legacy is true or absent", () => {
    expect(migrateAudioMode(null, "true")).toBe("notify");
    expect(migrateAudioMode(null, null)).toBe("notify");
    expect(migrateAudioMode(undefined, undefined)).toBe("notify");
  });

  it("ignores an invalid stored mode and falls back", () => {
    expect(migrateAudioMode("bogus", "false")).toBe("all");
  });
});

describe("nextAudioMode", () => {
  it("cycles all -> notify -> none -> all", () => {
    expect(nextAudioMode("all")).toBe("notify");
    expect(nextAudioMode("notify")).toBe("none");
    expect(nextAudioMode("none")).toBe("all");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/voice/useVoiceStore.test.ts`
Expected: FAIL — `migrateAudioMode`/`nextAudioMode` not exported.

- [ ] **Step 3: Rewrite the store**

Replace the entire contents of `apps/web/src/voice/useVoiceStore.ts` with:

```ts
import { create } from "zustand";

export type AudioMode = "all" | "notify" | "none";

const AUDIO_MODE_KEY = "t3.voice.audioMode";
const BEEP_UNFOCUSED_KEY = "t3.voice.beepUnfocusedOnly";
const LEGACY_TTS_MUTED_KEY = "t3.voice.ttsMuted";

const AUDIO_MODE_CYCLE: Record<AudioMode, AudioMode> = {
  all: "notify",
  notify: "none",
  none: "all",
};

/** Advance to the next audio mode in the cycle. */
export function nextAudioMode(mode: AudioMode): AudioMode {
  return AUDIO_MODE_CYCLE[mode];
}

/** Resolve the effective audio mode from the stored value, migrating the legacy ttsMuted flag. */
export function migrateAudioMode(
  storedMode: string | null | undefined,
  legacyTtsMuted: string | null | undefined,
): AudioMode {
  if (storedMode === "all" || storedMode === "notify" || storedMode === "none") {
    return storedMode;
  }
  return legacyTtsMuted === "false" ? "all" : "notify";
}

function readAudioMode(): AudioMode {
  try {
    return migrateAudioMode(
      globalThis.localStorage?.getItem(AUDIO_MODE_KEY),
      globalThis.localStorage?.getItem(LEGACY_TTS_MUTED_KEY),
    );
  } catch {
    return "notify";
  }
}

function writeAudioMode(mode: AudioMode): void {
  try {
    globalThis.localStorage?.setItem(AUDIO_MODE_KEY, mode);
  } catch {
    // ignore persistence failures (private mode, etc.)
  }
}

function readBeepUnfocusedOnly(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(BEEP_UNFOCUSED_KEY);
    return raw === null || raw === undefined ? true : raw === "true";
  } catch {
    return true;
  }
}

function writeBeepUnfocusedOnly(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(BEEP_UNFOCUSED_KEY, value ? "true" : "false");
  } catch {
    // ignore persistence failures
  }
}

interface VoiceStoreState {
  /** Whether the composer is actively capturing/dictating. */
  recording: boolean;
  /** Audio mode: all sounds, notification beeps only, or none. Persisted. */
  audioMode: AudioMode;
  /** Derived from audioMode; kept in sync for TTS consumers. */
  ttsMuted: boolean;
  /** When true, beeps play only while the app is unfocused. Persisted. */
  beepUnfocusedOnly: boolean;
  /** Last error message, if any. */
  error: string | null;

  setRecording: (recording: boolean) => void;
  toggleRecording: () => void;
  setAudioMode: (mode: AudioMode) => void;
  cycleAudioMode: () => void;
  setBeepUnfocusedOnly: (value: boolean) => void;
  setError: (error: string | null) => void;
}

export const useVoiceStore = create<VoiceStoreState>((set) => {
  const initialMode = readAudioMode();
  return {
    recording: false,
    audioMode: initialMode,
    ttsMuted: initialMode !== "all",
    beepUnfocusedOnly: readBeepUnfocusedOnly(),
    error: null,

    setRecording: (recording) => set(recording ? { recording, error: null } : { recording }),
    toggleRecording: () => set((state) => ({ recording: !state.recording, error: null })),
    setAudioMode: (audioMode) => {
      writeAudioMode(audioMode);
      set({ audioMode, ttsMuted: audioMode !== "all" });
    },
    cycleAudioMode: () =>
      set((state) => {
        const audioMode = nextAudioMode(state.audioMode);
        writeAudioMode(audioMode);
        return { audioMode, ttsMuted: audioMode !== "all" };
      }),
    setBeepUnfocusedOnly: (beepUnfocusedOnly) => {
      writeBeepUnfocusedOnly(beepUnfocusedOnly);
      set({ beepUnfocusedOnly });
    },
    setError: (error) => set({ error }),
  };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/voice/useVoiceStore.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/voice/useVoiceStore.ts apps/web/src/voice/useVoiceStore.test.ts
git commit -m "feat(web): tri-state audioMode in voice store with ttsMuted migration"
```

---

### Task 2: Pure beep resolver

**Files:**

- Create: `apps/web/src/voice/notificationBeeps.ts`
- Test: `apps/web/src/voice/notificationBeeps.test.ts`

**Interfaces:**

- Consumes: `AudioMode` from `./useVoiceStore`; `ThreadStatusPill` (type) from `../components/Sidebar.logic`.
- Produces: `type BeepKind = "done" | "needs-input"`; `resolveNotificationBeep(prev, next, mode): BeepKind | null`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/voice/notificationBeeps.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";

import { resolveNotificationBeep } from "./notificationBeeps";

describe("resolveNotificationBeep", () => {
  it("beeps done on Working -> Completed in notify mode", () => {
    expect(resolveNotificationBeep("Working", "Completed", "notify")).toBe("done");
  });

  it("suppresses done beep in all mode (TTS narrates)", () => {
    expect(resolveNotificationBeep("Working", "Completed", "all")).toBeNull();
  });

  it("beeps needs-input on Working -> input labels in all and notify", () => {
    for (const label of ["Awaiting Input", "Pending Approval", "Plan Ready"] as const) {
      expect(resolveNotificationBeep("Working", label, "all")).toBe("needs-input");
      expect(resolveNotificationBeep("Working", label, "notify")).toBe("needs-input");
    }
  });

  it("never beeps in none mode", () => {
    expect(resolveNotificationBeep("Working", "Completed", "none")).toBeNull();
    expect(resolveNotificationBeep("Working", "Awaiting Input", "none")).toBeNull();
  });

  it("only fires on a Working -> settled edge", () => {
    expect(resolveNotificationBeep("Completed", "Awaiting Input", "notify")).toBeNull();
    expect(resolveNotificationBeep(null, "Completed", "notify")).toBeNull();
    expect(resolveNotificationBeep("Working", "Working", "notify")).toBeNull();
  });

  it("returns null for non-beep next labels", () => {
    expect(resolveNotificationBeep("Working", "Connecting", "notify")).toBeNull();
    expect(resolveNotificationBeep("Working", null, "notify")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/voice/notificationBeeps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

Create `apps/web/src/voice/notificationBeeps.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/voice/notificationBeeps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/voice/notificationBeeps.ts apps/web/src/voice/notificationBeeps.test.ts
git commit -m "feat(web): pure resolveNotificationBeep for thread-status transitions"
```

---

### Task 3: Bundle sounds + playback module

**Files:**

- Create: `apps/web/src/voice/sounds/complete.oga` (copied)
- Create: `apps/web/src/voice/sounds/window-question.oga` (copied)
- Create: `apps/web/src/voice/sounds/ATTRIBUTION.md`
- Create: `apps/web/src/sounds-oga.d.ts`
- Create: `apps/web/src/voice/notificationSounds.ts`

**Interfaces:**

- Consumes: `BeepKind` from `./notificationBeeps`.
- Produces: `playBeep(kind: BeepKind): void`.

- [ ] **Step 1: Copy the sound assets**

```bash
mkdir -p apps/web/src/voice/sounds
cp /usr/share/sounds/freedesktop/stereo/complete.oga apps/web/src/voice/sounds/complete.oga
cp /usr/share/sounds/freedesktop/stereo/window-question.oga apps/web/src/voice/sounds/window-question.oga
```

Expected: both files exist (`ls apps/web/src/voice/sounds` shows the two `.oga`).

- [ ] **Step 2: Write the attribution file**

Create `apps/web/src/voice/sounds/ATTRIBUTION.md`:

```markdown
# Notification sound attribution

- `complete.oga` (done beep) and `window-question.oga` (needs-input beep) are
  from the freedesktop.org Sound Theme.
- Source: https://www.freedesktop.org/wiki/Specifications/sound-theme-spec/
  (upstream: https://gitlab.freedesktop.org/xdg/sound-theme-freedesktop)
- License: **CC BY-SA 3.0** — https://creativecommons.org/licenses/by-sa/3.0/
- The share-alike terms apply to these audio files, not to the application.
```

- [ ] **Step 3: Add the ambient module declaration**

Create `apps/web/src/sounds-oga.d.ts`:

```ts
declare module "*.oga?url" {
  const url: string;
  export default url;
}
```

- [ ] **Step 4: Implement the player**

Create `apps/web/src/voice/notificationSounds.ts`:

```ts
import doneSoundUrl from "./sounds/complete.oga?url";
import needsInputSoundUrl from "./sounds/window-question.oga?url";
import type { BeepKind } from "./notificationBeeps";

const SOUND_URLS: Record<BeepKind, string> = {
  done: doneSoundUrl,
  "needs-input": needsInputSoundUrl,
};

const audioByKind = new Map<BeepKind, HTMLAudioElement>();

/** Play the notification beep for a kind. No-ops on autoplay/decode failure. */
export function playBeep(kind: BeepKind): void {
  try {
    let audio = audioByKind.get(kind);
    if (!audio) {
      audio = new Audio(SOUND_URLS[kind]);
      audioByKind.set(kind, audio);
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // ignore autoplay-policy rejections
    });
  } catch {
    // ignore construction/playback failures
  }
}
```

- [ ] **Step 5: Typecheck the asset imports**

Run: `cd apps/web && npx tsgo --noEmit && cd ..`
Expected: exit 0 (the `?url` imports resolve against `sounds-oga.d.ts`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/voice/sounds apps/web/src/sounds-oga.d.ts apps/web/src/voice/notificationSounds.ts
git commit -m "feat(web): bundle freedesktop beep sounds + playBeep player"
```

---

### Task 4: Central notification watcher hook

**Files:**

- Create: `apps/web/src/voice/useNotificationSounds.ts`

**Interfaces:**

- Consumes: `useThreadShells()` from `../state/entities`; `useUiStateStore` from `../uiStateStore`; `scopeThreadRef`, `scopedThreadKey` from `@t3tools/client-runtime/environment`; `resolveThreadStatusPill`, `ThreadStatusPill` from `../components/Sidebar.logic`; `resolveNotificationBeep` (Task 2); `playBeep` (Task 3); `useVoiceStore` (Task 1).
- Produces: `useNotificationSounds(): void`.

- [ ] **Step 1: Implement the hook**

Create `apps/web/src/voice/useNotificationSounds.ts`:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsgo --noEmit && cd ..`
Expected: exit 0. (Confirms `thread.environmentId`/`thread.id` and the `ThreadStatusInput` spread typecheck against `EnvironmentThreadShell`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/voice/useNotificationSounds.ts
git commit -m "feat(web): central useNotificationSounds watcher hook"
```

---

### Task 5: Sidebar UI — cycle button, options dropdown, mount watcher

**Files:**

- Modify: `apps/web/src/components/Sidebar.tsx`

**Interfaces:**

- Consumes: everything from Tasks 1–4.

- [ ] **Step 1: Add icon imports**

In `apps/web/src/components/Sidebar.tsx`, add `BellIcon` and `ChevronUpIcon` to the lucide-react import block (lines 2–18), keeping alphabetical order:

```ts
  ArchiveIcon,
  ArrowUpDownIcon,
  BellIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloudIcon,
```

- [ ] **Step 2: Add voice/watcher imports**

Add after the existing `import { useVoiceStore } from "~/voice/useVoiceStore";` (line 223):

```ts
import { useNotificationSounds } from "~/voice/useNotificationSounds";
```

- [ ] **Step 3: Replace `SidebarVoiceDropdown` with the cycle button + reworked dropdown**

Replace the entire `function SidebarVoiceDropdown() { ... }` block with:

```tsx
function SidebarAudioModeButton() {
  const audioMode = useVoiceStore((s) => s.audioMode);
  const cycleAudioMode = useVoiceStore((s) => s.cycleAudioMode);

  const { Icon, label } =
    audioMode === "all"
      ? { Icon: Volume2Icon, label: "All sounds" }
      : audioMode === "notify"
        ? { Icon: BellIcon, label: "Notifications only" }
        : { Icon: VolumeXIcon, label: "No sound" };

  return (
    <button
      type="button"
      title={`Audio: ${label} (click to change)`}
      aria-label={`Audio: ${label} (click to change)`}
      onClick={() => cycleAudioMode()}
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon className="size-4" />
    </button>
  );
}

function SidebarVoiceDropdown() {
  const settings = useAtomValue(primaryServerSettingsAtom);
  const updateSettings = useUpdatePrimarySettings();
  const beepUnfocusedOnly = useVoiceStore((s) => s.beepUnfocusedOnly);
  const setBeepUnfocusedOnly = useVoiceStore((s) => s.setBeepUnfocusedOnly);

  const ttsEnabled = settings.speech.ttsEnabled;
  const enabledVoices = settings.speech.kokoroEnabledVoices ?? [...KOKORO_VOICES];
  const activeVoice = settings.speech.kokoroVoice || DEFAULT_KOKORO_VOICE;

  return (
    <Popover>
      <PopoverTrigger
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Audio options"
      >
        <ChevronUpIcon className="size-4" />
      </PopoverTrigger>
      <PopoverPopup side="top" align="end" sideOffset={8} viewportClassName="py-2">
        <div className="flex items-center justify-between gap-4 px-1">
          <span className="text-sm font-medium">Only beep when unfocused</span>
          <Switch
            checked={beepUnfocusedOnly}
            onCheckedChange={(checked) => setBeepUnfocusedOnly(checked)}
            aria-label="Only beep when the app is unfocused"
          />
        </div>
        {ttsEnabled && enabledVoices.length > 0 && (
          <div className="mt-2 flex flex-col border-t border-border pt-2">
            <span className="px-1 pb-1 text-xs text-muted-foreground">Voice</span>
            {enabledVoices.map((voice) => (
              <button
                key={voice}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm",
                  voice === activeVoice
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                onClick={() =>
                  updateSettings({ speech: { ...settings.speech, kokoroVoice: voice } })
                }
              >
                <span className="flex size-3.5 shrink-0 items-center justify-center">
                  {voice === activeVoice && <CheckIcon className="size-3" />}
                </span>
                {voice}
              </button>
            ))}
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}
```

- [ ] **Step 4: Render the cycle button in the footer**

In `SidebarChromeFooter`, update the `SidebarMenuItem` to include the cycle button before the dropdown:

```tsx
<SidebarMenuItem className="flex items-center gap-1">
  <SidebarMenuButton
    size="sm"
    className="flex-1 gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
    onClick={handleSettingsClick}
  >
    <SettingsIcon className="size-3.5" />
    <span className="text-xs">Settings</span>
  </SidebarMenuButton>
  <SidebarAudioModeButton />
  <SidebarVoiceDropdown />
</SidebarMenuItem>
```

- [ ] **Step 5: Mount the watcher in the sidebar root**

In `export default function Sidebar() {`, add the hook call as the first statement inside the body, immediately before `const projects = useProjects();`:

```tsx
export default function Sidebar() {
  useNotificationSounds();
  const projects = useProjects();
```

- [ ] **Step 6: Typecheck + existing tests**

Run: `cd apps/web && npx tsgo --noEmit && cd ..`
Expected: exit 0.

Run: `npx vitest run apps/web/src/components/Sidebar.logic.test.ts`
Expected: PASS (unchanged; sanity check nothing regressed).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): sidebar audio cycle button + options dropdown + mount beep watcher"
```

---

## Manual verification (after all tasks)

With the dev server running (`localhost:5733`):

1. Footer shows: Settings (grows) · cycle icon · chevron-up dropdown.
2. Clicking the cycle button rotates 🔊 All → 🔔 Notifications → 🔇 None → 🔊; reload persists the choice.
3. Dropdown (opens upward) shows "Only beep when unfocused" switch + voice list (if TTS enabled); selecting a voice persists to server settings.
4. In `notify` mode with the app unfocused, finishing a thread plays `complete.oga`; a thread needing input plays `window-question.oga`.
5. In `all` mode, a finishing thread narrates via TTS with no done beep; a needs-input thread still beeps.
6. In `none` mode, silent.

## Self-Review

- **Spec coverage:** state model (T1), beep logic (T2), sounds+attribution (T3), central watcher (T4), footer UI + cycle + dropdown + focus switch + mount (T5). All spec sections mapped.
- **Placeholder scan:** none — every step has full code.
- **Type consistency:** `AudioMode` defined in `useVoiceStore.ts`, imported as type by `notificationBeeps.ts`; `BeepKind` defined in `notificationBeeps.ts`, imported by `notificationSounds.ts` and the hook; `resolveNotificationBeep(prev, next, mode)` signature matches call site in T4; `playBeep(kind)` matches. `thread.environmentId`/`thread.id` verified against `SidebarThreadRow` usage.

```

```
