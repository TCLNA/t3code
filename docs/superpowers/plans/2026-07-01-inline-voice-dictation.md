# Inline Voice Dictation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-screen Voice Mode overlay with an inline composer mic button that dictates transcribed speech into the prompt at the cursor, plus a muted-by-default TTS toggle and per-message "Listen" buttons, with an Alt+V keybinding.

**Architecture:** Client-only React/TS changes in `apps/web` plus small `packages/contracts` + `packages/shared` edits for the keybinding and settings-schema cleanup. Dictation reuses the existing `VoiceCaptureController` (VAD) → `POST /api/stt/transcribe` → insert at the composer's tracked cursor. TTS reuses `TtsPlaybackController`, now owned by a `VoiceTtsProvider` context so both the auto-narration effect and per-message Listen buttons share one player.

**Tech Stack:** React 19, zustand, Effect Schema (contracts), TanStack Router, Tailwind v4, vitest, pnpm workspaces (`vp`).

## Global Constraints

- Package manager: `pnpm` via `vp`. Typecheck a package with `npx vp run --filter <pkg> typecheck`; test with `npx vitest run <path>`.
- Feature is OFF by default: mic UI gated on `settings.speech.sttEnabled`, TTS UI gated on `settings.speech.ttsEnabled`.
- Two states only: recording / not-recording. No push-to-talk, no auto-silence toggle, no codeword.
- `ttsMuted` defaults to **true** and persists in `localStorage`.
- Keybinding chord format is lowercase: `"alt+v"`. Action id: `"voice.toggleRecording"`.
- Do NOT commit unless the user asks. Each task's "Commit" step is staged for the user; run it only on their instruction (subagent-driven-development gates between tasks anyway).
- Match surrounding code style; no new deps.

## File Structure

**Create**
- `apps/web/src/voice/dictationInsert.ts` — pure helper computing the text to insert (leading-space rule).
- `apps/web/src/voice/dictationInsert.test.ts` — unit tests.
- `apps/web/src/voice/useVoiceDictation.ts` — hook: recording lifecycle → capture → transcribe → insert.
- `apps/web/src/voice/VoiceTtsProvider.tsx` — context owning `TtsPlaybackController`; auto-narration + `speak/stop`.
- `apps/web/src/components/chat/AssistantListenButton.tsx` — per-message Listen button.

**Modify**
- `packages/contracts/src/keybindings.ts` — add action id.
- `packages/shared/src/keybindings.ts` — add default chord.
- `packages/shared/src/keybindings.test.ts` (or nearest existing test) — resolve test.
- `packages/contracts/src/settings.ts` — remove `submitMode` + `sendPromptCodeword`.
- `apps/web/src/voice/useVoiceStore.ts` — rewrite slim.
- `apps/web/src/voice/audioCapture.ts` — remove push-to-talk.
- `apps/web/src/components/chat/ChatComposer.tsx` — `insertTextAtCursor` handle, drop old button, use dictation hook, pass new props.
- `apps/web/src/components/chat/ComposerPrimaryActions.tsx` — mic + mute buttons.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — mount Listen button.
- `apps/web/src/components/ChatView.tsx` — Alt+V dispatch branch.
- `apps/web/src/routes/_chat.tsx` — swap `<VoiceModeView/>` for `<VoiceTtsProvider>`.
- `docs/user/keybindings.md` — document command.
- `~/.t3/dev/settings.json`, `~/.t3/userdata/settings.json` — drop removed keys.

**Delete**
- `apps/web/src/components/voice/VoiceModeView.tsx`
- `apps/web/src/components/voice/VoiceOrb.tsx`
- `apps/web/src/components/voice/VoiceModeControls.tsx`
- `apps/web/src/components/voice/ComposerVoiceButton.tsx`
- `apps/web/src/voice/useVoiceSession.ts`

---

### Task 1: Register the `voice.toggleRecording` keybinding

**Files:**
- Modify: `packages/contracts/src/keybindings.ts` (STATIC_KEYBINDING_COMMANDS, ~line 50-71)
- Modify: `packages/shared/src/keybindings.ts` (DEFAULT_KEYBINDINGS, ~line 21-54)
- Modify: `docs/user/keybindings.md` (Available Commands, ~line 54-71)
- Test: `packages/shared/src/keybindings.test.ts` (create if absent)

**Interfaces:**
- Produces: `KeybindingCommand` now includes `"voice.toggleRecording"`; default chord `alt+v`.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/keybindings.test.ts` (create the file if it does not exist; mirror imports from the module):

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_KEYBINDINGS, parseKeybindingShortcut } from "./keybindings.ts";

describe("voice.toggleRecording keybinding", () => {
  it("has a default alt+v binding", () => {
    const rule = DEFAULT_KEYBINDINGS.find((r) => r.command === "voice.toggleRecording");
    expect(rule?.key).toBe("alt+v");
  });
  it("parses alt+v as the Alt modifier + v", () => {
    const shortcut = parseKeybindingShortcut("alt+v");
    expect(shortcut).toMatchObject({ key: "v", altKey: true, ctrlKey: false, metaKey: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/shared/src/keybindings.test.ts`
Expected: FAIL (no rule with command `voice.toggleRecording`).

- [ ] **Step 3: Add the action id (contracts)**

In `packages/contracts/src/keybindings.ts`, add `"voice.toggleRecording"` to the `STATIC_KEYBINDING_COMMANDS` array (place it near the other single-purpose commands, e.g. after `"editor.openFavorite"`):

```ts
  "editor.openFavorite",
  "voice.toggleRecording",
```

- [ ] **Step 4: Add the default chord (shared)**

In `packages/shared/src/keybindings.ts`, add to `DEFAULT_KEYBINDINGS`:

```ts
  { key: "alt+v", command: "voice.toggleRecording" },
```

- [ ] **Step 5: Document it**

In `docs/user/keybindings.md` under Available Commands, add:

```markdown
- `voice.toggleRecording`: start/stop dictating into the composer (default `Alt+V`)
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run packages/shared/src/keybindings.test.ts`
Expected: PASS.
Run: `npx vp run --filter @t3tools/contracts typecheck && npx vp run --filter @t3tools/shared typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit** (only on user instruction)

```bash
git add packages/contracts/src/keybindings.ts packages/shared/src/keybindings.ts packages/shared/src/keybindings.test.ts docs/user/keybindings.md
git commit -m "feat(voice): register voice.toggleRecording keybinding (alt+v)"
```

---

### Task 2: `dictationInsert` pure helper

**Files:**
- Create: `apps/web/src/voice/dictationInsert.ts`
- Test: `apps/web/src/voice/dictationInsert.test.ts`

**Interfaces:**
- Produces: `dictationInsertText(prompt: string, cursor: number, chunk: string): string` — returns the exact string to splice in at `cursor` (trimmed chunk, prefixed with a single space when the char before `cursor` is a non-space, non-newline; `""` for a blank chunk).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { dictationInsertText } from "./dictationInsert.ts";

describe("dictationInsertText", () => {
  it("returns empty string for a blank chunk", () => {
    expect(dictationInsertText("hello", 5, "   ")).toBe("");
  });
  it("inserts without a leading space at the start", () => {
    expect(dictationInsertText("", 0, "hello world")).toBe("hello world");
  });
  it("adds a leading space after a word character", () => {
    expect(dictationInsertText("hello", 5, "world")).toBe(" world");
  });
  it("does not double a space when one precedes the cursor", () => {
    expect(dictationInsertText("hello ", 6, "world")).toBe("world");
  });
  it("does not add a space after a newline", () => {
    expect(dictationInsertText("hello\n", 6, "world")).toBe("world");
  });
  it("trims surrounding whitespace from the chunk", () => {
    expect(dictationInsertText("", 0, "  hi there  ")).toBe("hi there");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/voice/dictationInsert.test.ts`
Expected: FAIL ("dictationInsertText is not a function").

- [ ] **Step 3: Implement**

```ts
/**
 * Compute the text to splice into the composer at `cursor` for a dictated
 * chunk. Append-only: never rewrites existing text. Adds a single leading
 * space when the preceding character is a non-space, non-newline so words do
 * not run together; returns "" for an empty/whitespace chunk.
 */
export function dictationInsertText(prompt: string, cursor: number, chunk: string): string {
  const trimmed = chunk.trim();
  if (trimmed.length === 0) return "";
  const before = cursor > 0 ? prompt[cursor - 1] : undefined;
  const needsLeadingSpace = before !== undefined && before !== " " && before !== "\n";
  return needsLeadingSpace ? ` ${trimmed}` : trimmed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/voice/dictationInsert.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit** (only on user instruction)

```bash
git add apps/web/src/voice/dictationInsert.ts apps/web/src/voice/dictationInsert.test.ts
git commit -m "feat(voice): add dictationInsertText helper"
```

---

### Task 3: Rewrite the voice store and remove the old overlay system

This is the "remove old system" swap. After it, no voice UI is mounted but the tree typechecks.

**Files:**
- Modify: `apps/web/src/voice/useVoiceStore.ts` (rewrite)
- Modify: `apps/web/src/voice/audioCapture.ts` (remove push-to-talk)
- Modify: `apps/web/src/components/chat/ChatComposer.tsx` (drop `ComposerVoiceButton` import at line 94 and its render at line 328)
- Modify: `apps/web/src/routes/_chat.tsx` (drop `VoiceModeView` import line 20 + `<VoiceModeView />` line 157)
- Delete: `VoiceModeView.tsx`, `VoiceOrb.tsx`, `VoiceModeControls.tsx`, `ComposerVoiceButton.tsx`, `useVoiceSession.ts`

**Interfaces:**
- Produces: `useVoiceStore` with `{ recording, ttsMuted, error, setRecording, toggleRecording, setTtsMuted, toggleTtsMuted, setError }`.
- Produces: `VoiceCaptureController` with only `{ start(): Promise<void>, stop(): Promise<void>, setAutoEndOnSilence(v), level }` and callback `onUtteranceEnd(wav: Uint8Array)` (no `forced` arg).

- [ ] **Step 1: Rewrite `useVoiceStore.ts`**

```ts
import { create } from "zustand";

const TTS_MUTED_KEY = "t3.voice.ttsMuted";

function readTtsMuted(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(TTS_MUTED_KEY);
    return raw === null || raw === undefined ? true : raw === "true";
  } catch {
    return true;
  }
}

function writeTtsMuted(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(TTS_MUTED_KEY, value ? "true" : "false");
  } catch {
    // ignore persistence failures (private mode, etc.)
  }
}

interface VoiceStoreState {
  /** Whether the composer is actively capturing/dictating. */
  recording: boolean;
  /** When true, assistant replies are not spoken automatically. Persisted. */
  ttsMuted: boolean;
  /** Last error message, if any. */
  error: string | null;

  setRecording: (recording: boolean) => void;
  toggleRecording: () => void;
  setTtsMuted: (muted: boolean) => void;
  toggleTtsMuted: () => void;
  setError: (error: string | null) => void;
}

export const useVoiceStore = create<VoiceStoreState>((set) => ({
  recording: false,
  ttsMuted: readTtsMuted(),
  error: null,

  setRecording: (recording) => set({ recording, error: recording ? null : undefined }),
  toggleRecording: () => set((state) => ({ recording: !state.recording, error: null })),
  setTtsMuted: (ttsMuted) => {
    writeTtsMuted(ttsMuted);
    set({ ttsMuted });
  },
  toggleTtsMuted: () =>
    set((state) => {
      const ttsMuted = !state.ttsMuted;
      writeTtsMuted(ttsMuted);
      return { ttsMuted };
    }),
  setError: (error) => set({ error }),
}));
```

- [ ] **Step 2: Simplify `audioCapture.ts`**

- Change the callback type to `readonly onUtteranceEnd?: (wav: Uint8Array) => void;` (remove the `forced` param + its doc comment added in the prior hotfix).
- Delete `beginForcedUtterance()` and the `private forced = false;` field.
- In `handleFrame`, change `const isVoice = this.forced || rms >= this.speechThreshold;` to `const isVoice = rms >= this.speechThreshold;`.
- In `finishUtterance()`, delete `const wasForced = this.forced;` and `this.forced = false;`, and call `this.callbacks.onUtteranceEnd?.(wav);` (no arg).

- [ ] **Step 3: Detach the old UI**

- `ChatComposer.tsx`: delete `import { ComposerVoiceButton } from "../voice/ComposerVoiceButton";` (line 94) and the `<ComposerVoiceButton />` render (line 328).
- `routes/_chat.tsx`: delete the `VoiceModeView` import (line 20) and `<VoiceModeView />` (line 157).

- [ ] **Step 4: Delete dead files**

```bash
git rm apps/web/src/components/voice/VoiceModeView.tsx \
       apps/web/src/components/voice/VoiceOrb.tsx \
       apps/web/src/components/voice/VoiceModeControls.tsx \
       apps/web/src/components/voice/ComposerVoiceButton.tsx \
       apps/web/src/voice/useVoiceSession.ts
```

- [ ] **Step 5: Verify no dangling references + typecheck**

Run: `rg -n "VoiceModeView|VoiceOrb|VoiceModeControls|ComposerVoiceButton|useVoiceSession|beginForcedUtterance" apps/web/src`
Expected: no matches.
Run: `npx vp run --filter @t3tools/web typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit** (only on user instruction)

```bash
git add -A apps/web/src/voice apps/web/src/components/chat/ChatComposer.tsx apps/web/src/routes/_chat.tsx apps/web/src/components/voice
git commit -m "refactor(voice): slim voice store, remove overlay/orb and push-to-talk"
```

---

### Task 4: Remove `submitMode` + `sendPromptCodeword` from settings

**Files:**
- Modify: `packages/contracts/src/settings.ts` (SpeechSettings ~line 379-462; ServerSettingsPatch.speech ~line 621-633; and the `VoiceSubmitMode`/`DEFAULT_*` consts ~line 366-370 + `DEFAULT_SEND_PROMPT_CODEWORD`)
- Modify: `~/.t3/dev/settings.json`, `~/.t3/userdata/settings.json`

**Interfaces:**
- Produces: `SpeechSettings` without `submitMode`/`sendPromptCodeword`; `speech` patch without them.

- [ ] **Step 1: Check for other references**

Run: `rg -n "submitMode|sendPromptCodeword|VoiceSubmitMode|DEFAULT_SEND_PROMPT_CODEWORD|DEFAULT_VOICE_SUBMIT_MODE" packages apps`
Expected after Task 3: only `packages/contracts/src/settings.ts` and possibly `@t3tools/shared/speakableText` (`detectSendPromptCodeword` — leave that; it is generic and unit-tested). If any app code still references them, it is stale — resolve before editing.

- [ ] **Step 2: Edit the schema**

In `packages/contracts/src/settings.ts`:
- Delete the `submitMode` and `sendPromptCodeword` fields from the `SpeechSettings` struct and drop them from its `order` array.
- Delete `submitMode` and `sendPromptCodeword` from the `speech` struct in `ServerSettingsPatch`.
- Delete the now-unused consts `VoiceSubmitMode`, `DEFAULT_VOICE_SUBMIT_MODE`, `DEFAULT_SEND_PROMPT_CODEWORD` (keep `DEFAULT_KOKORO_VOICE`). Remove the `VoiceSubmitMode` type export.

- [ ] **Step 3: Strip the keys from on-disk settings**

Run:

```bash
python3 - <<'PY'
import json
for p in ["/home/thomas/.t3/dev/settings.json", "/home/thomas/.t3/userdata/settings.json"]:
    d = json.load(open(p))
    sp = d.get("speech")
    if isinstance(sp, dict):
        sp.pop("submitMode", None); sp.pop("sendPromptCodeword", None)
    json.dump(d, open(p, "w"), indent=2)
    print("cleaned", p)
PY
```

- [ ] **Step 4: Typecheck**

Run: `npx vp run --filter @t3tools/contracts typecheck && npx vp run --filter @t3tools/web typecheck`
Expected: exit 0.
Run: `rg -n "submitMode|sendPromptCodeword" packages/contracts`
Expected: no matches.

- [ ] **Step 5: Commit** (only on user instruction)

```bash
git add packages/contracts/src/settings.ts
git commit -m "refactor(voice): drop submitMode/sendPromptCodeword settings"
```

---

### Task 5: `VoiceTtsProvider` (context + auto-narration)

**Files:**
- Create: `apps/web/src/voice/VoiceTtsProvider.tsx`
- Modify: `apps/web/src/routes/_chat.tsx` (mount the provider where `<VoiceModeView/>` was)

**Interfaces:**
- Consumes: `TtsPlaybackController` from `./ttsPlayback` (`new TtsPlaybackController(callbacks)`, `nextIndex()`, `enqueue(i, text)`, `stop()`, `dispose()`); `markdownToSpeakable`, `segmentSpeakable` from `@t3tools/shared/speakableText`; `useVoiceStore`; `primaryServerSettingsAtom`; `useThreadMessages`, `resolveThreadRouteTarget`, `useParams` (see deleted `useVoiceSession.ts` for the exact import paths/usage to mirror).
- Produces: `useVoiceTts(): { speak(text: string): void; stop(): void }` and the `VoiceTtsProvider` component.

- [ ] **Step 1: Implement the provider**

```tsx
import { useAtomValue } from "@effect/atom-react";
import { useParams } from "@tanstack/react-router";
import { markdownToSpeakable, segmentSpeakable } from "@t3tools/shared/speakableText";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";

import { useThreadMessages } from "~/state/entities";
import { primaryServerSettingsAtom } from "~/state/server";
import { resolveThreadRouteTarget } from "~/threadRoutes";

import { TtsPlaybackController } from "./ttsPlayback";
import { useVoiceStore } from "./useVoiceStore";

interface VoiceTtsValue {
  speak: (text: string) => void;
  stop: () => void;
}

const VoiceTtsContext = createContext<VoiceTtsValue | null>(null);

export function useVoiceTts(): VoiceTtsValue {
  const value = useContext(VoiceTtsContext);
  // Safe no-op fallback so consumers work even if the provider is absent.
  return value ?? { speak: () => {}, stop: () => {} };
}

export function VoiceTtsProvider({ children }: { children: React.ReactNode }) {
  const settings = useAtomValue(primaryServerSettingsAtom);
  const speech = settings.speech;
  const ttsMuted = useVoiceStore((s) => s.ttsMuted);

  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const threadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const messages = useThreadMessages(threadRef);

  const playbackRef = useRef<TtsPlaybackController | null>(null);
  const speechRef = useRef(speech);
  speechRef.current = speech;

  // Lazily create the single playback controller.
  useEffect(() => {
    const playback = new TtsPlaybackController({
      getVoice: () => speechRef.current.kokoroVoice || undefined,
    });
    playbackRef.current = playback;
    return () => {
      void playback.dispose();
      playbackRef.current = null;
    };
  }, []);

  // Per-message sentence tracker (mirrors the old useVoiceSession logic).
  const spokenRef = useRef<{ messageId: string | null; spokenCount: number; done: boolean }>({
    messageId: null,
    spokenCount: 0,
    done: false,
  });

  useEffect(() => {
    if (!speechRef.current.ttsEnabled || ttsMuted) return;
    const playback = playbackRef.current;
    if (!playback) return;

    let assistant: (typeof messages)[number] | undefined;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]!.role === "assistant") {
        assistant = messages[i];
        break;
      }
    }
    if (!assistant) return;

    const tracker = spokenRef.current;
    if (assistant.id !== tracker.messageId) {
      tracker.messageId = assistant.id;
      tracker.spokenCount = 0;
      tracker.done = false;
    }
    if (tracker.done) return;

    const spoken = markdownToSpeakable(assistant.text);
    const { units, remainder } = segmentSpeakable(spoken);
    for (let i = tracker.spokenCount; i < units.length; i += 1) {
      playback.enqueue(playback.nextIndex(), units[i]!);
    }
    tracker.spokenCount = units.length;

    if (!assistant.streaming) {
      const tail = remainder.trim();
      if (tail.length > 0) playback.enqueue(playback.nextIndex(), tail);
      tracker.done = true;
    }
  }, [messages, ttsMuted]);

  // Muting stops any in-flight playback.
  useEffect(() => {
    if (ttsMuted) playbackRef.current?.stop();
  }, [ttsMuted]);

  const value = useMemo<VoiceTtsValue>(
    () => ({
      speak: (text: string) => {
        const playback = playbackRef.current;
        if (!playback) return;
        const spoken = markdownToSpeakable(text).trim();
        if (spoken.length === 0) return;
        playback.stop();
        playback.enqueue(playback.nextIndex(), spoken);
      },
      stop: () => playbackRef.current?.stop(),
    }),
    [],
  );

  return <VoiceTtsContext.Provider value={value}>{children}</VoiceTtsContext.Provider>;
}
```

- [ ] **Step 2: Mount in `_chat.tsx`**

Wrap the chat subtree that previously sat alongside `<VoiceModeView />` in `<VoiceTtsProvider>…</VoiceTtsProvider>` (import it from `~/voice/VoiceTtsProvider`). The provider must be an ancestor of both `ChatComposer` and `MessagesTimeline` so both can call `useVoiceTts()`. If the file's structure makes wrapping awkward, place `<VoiceTtsProvider>` as the outermost element returned by the `_chat` layout component.

- [ ] **Step 3: Typecheck**

Run: `npx vp run --filter @t3tools/web typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit** (only on user instruction)

```bash
git add apps/web/src/voice/VoiceTtsProvider.tsx apps/web/src/routes/_chat.tsx
git commit -m "feat(voice): add VoiceTtsProvider with muted-by-default narration"
```

---

### Task 6: `insertTextAtCursor` handle + `useVoiceDictation` hook

**Files:**
- Create: `apps/web/src/voice/useVoiceDictation.ts`
- Modify: `apps/web/src/components/chat/ChatComposer.tsx` (add handle method + `ChatComposerHandle` interface entry + call the hook)

**Interfaces:**
- Consumes: `applyPromptReplacement(rangeStart, rangeEnd, replacement, options?)` (existing useCallback in ChatComposer ending ~line 1512), `expandCollapsedComposerCursor`, `composerCursor`, guards used by `insertTextAtEnd` (~line 1924); `dictationInsertText` (Task 2); `transcribeAudio` from `~/voice/sttClient`; `VoiceCaptureController` from `~/voice/audioCapture`; `useVoiceStore`; `useVoiceTts` (Task 5); `toastManager` from `~/components/ui/toast`.
- Produces: `ChatComposerHandle.insertTextAtCursor(text: string): boolean`; `useVoiceDictation({ insertAtCursor, stopTts }: { insertAtCursor: (text: string) => void; stopTts: () => void }): void`.

- [ ] **Step 1: Add `insertTextAtCursor` to the interface**

In `ChatComposerHandle` (near line 395, beside `insertTextAtEnd`):

```ts
  insertTextAtCursor: (text: string) => boolean;
```

- [ ] **Step 2: Implement it in the imperative handle**

In the `useImperativeHandle` object (beside `insertTextAtEnd`, ~line 1924), add:

```ts
      insertTextAtCursor: (text: string) => {
        if (
          isConnecting ||
          isComposerApprovalState ||
          pendingUserInputs.length > 0 ||
          (environmentUnavailable !== null && activePendingProgress === null)
        ) {
          return false;
        }
        const expandedCursor = expandCollapsedComposerCursor(promptRef.current, composerCursor);
        const insertText = dictationInsertText(promptRef.current, expandedCursor, text);
        if (insertText.length === 0) return false;
        return applyPromptReplacement(expandedCursor, expandedCursor, insertText);
      },
```

Add `dictationInsertText` to the imports (`import { dictationInsertText } from "../../voice/dictationInsert";` — match the file's relative-import style). Ensure `composerCursor` and `applyPromptReplacement` are in the `useImperativeHandle` dependency array (append them).

- [ ] **Step 3: Implement the hook**

```ts
import { useEffect, useRef } from "react";

import { toastManager } from "~/components/ui/toast";
import { VoiceCaptureController } from "./audioCapture";
import { transcribeAudio } from "./sttClient";
import { useVoiceStore } from "./useVoiceStore";

/**
 * Drives composer dictation: while `recording` is true, capture mic audio with
 * VAD, transcribe each utterance, and append it at the cursor. Starting a
 * recording stops any TTS playback (barge-in).
 */
export function useVoiceDictation({
  insertAtCursor,
  stopTts,
}: {
  insertAtCursor: (text: string) => void;
  stopTts: () => void;
}): void {
  const recording = useVoiceStore((s) => s.recording);
  const setRecording = useVoiceStore((s) => s.setRecording);
  const setError = useVoiceStore((s) => s.setError);

  const insertRef = useRef(insertAtCursor);
  insertRef.current = insertAtCursor;
  const stopTtsRef = useRef(stopTts);
  stopTtsRef.current = stopTts;

  useEffect(() => {
    if (!recording) return;
    stopTtsRef.current();

    const capture = new VoiceCaptureController(
      {
        onUtteranceEnd: (wav) => {
          void (async () => {
            try {
              const { text } = await transcribeAudio(wav);
              if (text.trim().length > 0) insertRef.current(text);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              setError(message);
              toastManager.add({ title: "Transcription failed", description: message });
            }
          })();
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          setError(message);
          toastManager.add({ title: "Microphone error", description: message });
          setRecording(false);
        },
      },
      { autoEndOnSilence: true },
    );

    void capture.start().catch(() => setRecording(false));
    return () => {
      void capture.stop();
    };
  }, [recording, setError, setRecording]);
}
```

> Note: confirm the `toastManager.add({ title, description })` shape against an existing call site in the codebase; adjust the argument to match (some APIs take a string). Grep `toastManager.add(` for an example.

- [ ] **Step 4: Call the hook in `ChatComposer`**

Near the other hooks in `ChatComposer`, add:

```ts
  const voiceTts = useVoiceTts();
  useVoiceDictation({
    insertAtCursor: (text) => composerRef.current?.insertTextAtCursor(text),
    stopTts: voiceTts.stop,
  });
```

Import `useVoiceDictation` from `../../voice/useVoiceDictation` and `useVoiceTts` from `../../voice/VoiceTtsProvider`.

- [ ] **Step 5: Typecheck**

Run: `npx vp run --filter @t3tools/web typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit** (only on user instruction)

```bash
git add apps/web/src/voice/useVoiceDictation.ts apps/web/src/components/chat/ChatComposer.tsx
git commit -m "feat(voice): dictation hook + insertTextAtCursor composer handle"
```

---

### Task 7: Mic + mute buttons in the composer

**Files:**
- Modify: `apps/web/src/components/chat/ComposerPrimaryActions.tsx`
- Modify: `apps/web/src/components/chat/ChatComposer.tsx` (`ComposerFooterPrimaryActions` wrapper ~line 333-386 and its render site — thread new props)

**Interfaces:**
- Consumes: `useVoiceStore` (recording/ttsMuted/toggles), `settings.speech.sttEnabled/ttsEnabled`, `MicIcon`, `Volume2Icon`, `VolumeXIcon` from `lucide-react`.
- Produces: `ComposerPrimaryActions` renders a mic button (and mute toggle) next to Send.

- [ ] **Step 1: Add props to `ComposerPrimaryActionsProps`**

```ts
  sttEnabled: boolean;
  ttsEnabled: boolean;
  recording: boolean;
  ttsMuted: boolean;
  onToggleRecording: () => void;
  onToggleMute: () => void;
```

Destructure them in the component signature.

- [ ] **Step 2: Render mic + mute next to Send (default branch)**

Replace the final `return (<button type="submit" …>…</button>);` (lines 196-228) with a wrapping flex row that keeps the exact Send button and adds the mic (left of Send) and mute toggle:

```tsx
  return (
    <div className="flex items-center gap-1.5">
      {props.ttsEnabled ? (
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground/80"
          {...pointerFocusProps}
          onClick={props.onToggleMute}
          aria-label={props.ttsMuted ? "Speak replies" : "Mute replies"}
          aria-pressed={!props.ttsMuted}
        >
          {props.ttsMuted ? <VolumeXIcon className="size-4" /> : <Volume2Icon className="size-4" />}
        </button>
      ) : null}
      {props.sttEnabled ? (
        <button
          type="button"
          className={cn(
            "flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-all duration-150 hover:scale-105 sm:h-8 sm:w-8",
            props.recording
              ? "animate-pulse bg-red-500 text-white shadow-xs shadow-red-500/30"
              : "bg-primary/90 text-primary-foreground shadow-xs enabled:shadow-primary/24 hover:bg-primary",
          )}
          {...pointerFocusProps}
          onClick={props.onToggleRecording}
          aria-label={props.recording ? "Stop recording (Alt+V)" : "Record (Alt+V)"}
          aria-pressed={props.recording}
        >
          <MicIcon className="size-4" />
        </button>
      ) : null}
      <button
        type="submit"
        className="flex h-9 w-9 enabled:cursor-pointer items-center justify-center rounded-full bg-primary/90 text-primary-foreground shadow-xs enabled:shadow-primary/24 enabled:inset-shadow-[0_1px_--theme(--color-white/16%)] transition-all duration-150 hover:bg-primary hover:scale-105 active:inset-shadow-[0_1px_--theme(--color-black/8%)] active:shadow-none disabled:pointer-events-none disabled:opacity-30 disabled:shadow-none disabled:hover:scale-100 sm:h-8 sm:w-8"
        {...pointerFocusProps}
        disabled={isSendBusy || isConnecting || isEnvironmentUnavailable || !hasSendableContent}
        aria-label={
          isEnvironmentUnavailable
            ? "Environment disconnected"
            : isConnecting
              ? "Connecting"
              : isPreparingWorktree
                ? "Preparing worktree"
                : isSendBusy
                  ? "Sending"
                  : "Send message"
        }
      >
        {isConnecting || isSendBusy ? (
          <Spinner className="size-3.5" aria-hidden="true" />
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
```

Add `MicIcon, Volume2Icon, VolumeXIcon` to the `lucide-react` import.

- [ ] **Step 3: Thread props through `ComposerFooterPrimaryActions` and `ChatComposer`**

In `ChatComposer.tsx`, `ComposerFooterPrimaryActions` (props type + passthrough) gains the same six props; at its render site read them from the store/settings:

```ts
  const recording = useVoiceStore((s) => s.recording);
  const ttsMuted = useVoiceStore((s) => s.ttsMuted);
  const toggleRecording = useVoiceStore((s) => s.toggleRecording);
  const toggleTtsMuted = useVoiceStore((s) => s.toggleTtsMuted);
```

Pass `sttEnabled={settings.speech.sttEnabled}`, `ttsEnabled={settings.speech.ttsEnabled}`, `recording={recording}`, `ttsMuted={ttsMuted}`, `onToggleRecording={toggleRecording}`, `onToggleMute={toggleTtsMuted}` down to `ComposerPrimaryActions`.

- [ ] **Step 4: Typecheck + manual smoke**

Run: `npx vp run --filter @t3tools/web typecheck`
Expected: exit 0.
Manual: with `sttEnabled` true, the mic appears left of Send; clicking toggles red+pulse and starts/stops dictation; text lands at the cursor. With `ttsEnabled` true, the speaker toggle appears.

- [ ] **Step 5: Commit** (only on user instruction)

```bash
git add apps/web/src/components/chat/ComposerPrimaryActions.tsx apps/web/src/components/chat/ChatComposer.tsx
git commit -m "feat(voice): inline mic + mute buttons in composer"
```

---

### Task 8: Per-message "Listen" button

**Files:**
- Create: `apps/web/src/components/chat/AssistantListenButton.tsx`
- Modify: `apps/web/src/components/chat/MessagesTimeline.tsx` (hover-action row in `AssistantTimelineRow`, ~line 999, beside `<AssistantCopyButton />`)

**Interfaces:**
- Consumes: `useVoiceTts` (Task 5), `primaryServerSettingsAtom`, `markdownToSpeakable`, `Button`, `Volume2Icon`.
- Produces: `<AssistantListenButton text={row.message.text} />`.

- [ ] **Step 1: Implement the button**

```tsx
import { useAtomValue } from "@effect/atom-react";
import { markdownToSpeakable } from "@t3tools/shared/speakableText";
import { Volume2Icon } from "lucide-react";

import { Button } from "../ui/button";
import { primaryServerSettingsAtom } from "~/state/server";
import { useVoiceTts } from "~/voice/VoiceTtsProvider";

export function AssistantListenButton({ text }: { text: string }) {
  const settings = useAtomValue(primaryServerSettingsAtom);
  const voiceTts = useVoiceTts();
  if (!settings.speech.ttsEnabled) return null;
  const speakable = markdownToSpeakable(text).trim();
  if (speakable.length === 0) return null;
  return (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      aria-label="Listen to response"
      className="text-muted-foreground hover:text-foreground"
      onClick={() => voiceTts.speak(text)}
    >
      <Volume2Icon className="size-3" />
    </Button>
  );
}
```

- [ ] **Step 2: Mount it in the hover-action row**

In `MessagesTimeline.tsx` `AssistantTimelineRow`, inside the action `<div>` (the one with `group-hover/assistant:opacity-100`, ~line 997), add after `<AssistantCopyButton row={row} />`:

```tsx
            <AssistantListenButton text={row.message.text} />
```

Import it at the top of the file. Guard is internal, so it can render unconditionally; it renders `null` when `ttsEnabled` is false.

- [ ] **Step 3: Typecheck + manual**

Run: `npx vp run --filter @t3tools/web typecheck`
Expected: exit 0.
Manual: hovering an assistant message shows the speaker button; clicking speaks the reply.

- [ ] **Step 4: Commit** (only on user instruction)

```bash
git add apps/web/src/components/chat/AssistantListenButton.tsx apps/web/src/components/chat/MessagesTimeline.tsx
git commit -m "feat(voice): per-message Listen button"
```

---

### Task 9: Alt+V dispatch

**Files:**
- Modify: `apps/web/src/components/ChatView.tsx` (the `resolveShortcutCommand` keydown handler)

**Interfaces:**
- Consumes: `useVoiceStore`, `resolveShortcutCommand` (existing), `settings.speech.sttEnabled`.

- [ ] **Step 1: Add the dispatch branch**

In the keydown handler where other commands are handled, add:

```ts
    if (command === "voice.toggleRecording") {
      if (!settings.speech.sttEnabled) return;
      event.preventDefault();
      event.stopPropagation();
      useVoiceStore.getState().toggleRecording();
      return;
    }
```

Import `useVoiceStore` from `~/voice/useVoiceStore`. Ensure `settings` (or the equivalent settings atom already used in ChatView) is in scope; if the handler closes over a `keybindings`/settings value, add `settings.speech.sttEnabled` usage without breaking the effect deps (add `settings` to the dep array if required).

- [ ] **Step 2: Typecheck + manual**

Run: `npx vp run --filter @t3tools/web typecheck`
Expected: exit 0.
Manual: press Alt+V → mic toggles red+pulse and starts/stops dictation; verify it also shows as "Voice: Toggle Recording" in Keybindings settings.

- [ ] **Step 3: Commit** (only on user instruction)

```bash
git add apps/web/src/components/ChatView.tsx
git commit -m "feat(voice): Alt+V toggles recording"
```

---

### Task 10: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Repo-wide typecheck**

Run: `npx vp run -r --concurrency-limit 2 typecheck`
Expected: exit 0.

- [ ] **Step 2: Lint the changed web files**

Run: `npx vp lint --report-unused-disable-directives`
Expected: no new errors in touched files.

- [ ] **Step 3: Unit tests**

Run: `npx vitest run apps/web/src/voice/dictationInsert.test.ts packages/shared/src/keybindings.test.ts packages/shared/src/speakableText.test.ts`
Expected: all PASS.

- [ ] **Step 4: Manual end-to-end (dev server running)**

Verify each, on `http://localhost:<web port>`:
1. Mic button is round, sits next to Send, same color when idle; red + pulsing while recording.
2. Speaking inserts transcribed text at the caret; moving the caret and dictating inserts at the new spot; leading spaces are correct.
3. Only two states (click or Alt+V toggles; no mode toggle UI remains).
4. Speaker toggle: default muted (no auto-speech). Unmute → a streaming reply is spoken as it prints. Toggle persists across reload.
5. "Listen" button on any assistant message speaks it, including after navigating away and back.
6. Starting a recording stops current TTS playback (barge-in).
7. With `sttEnabled=false` the mic/shortcut do nothing and the button is hidden; with `ttsEnabled=false` the speaker toggle and Listen buttons are hidden.

- [ ] **Step 5: Update the memory note**

Update `/home/thomas/.claude/projects/-home-thomas-Lab-t3code/memory/voice-mode-setup.md` to record that voice is now inline dictation (overlay removed), TTS muted-by-default, Alt+V bound.

## Self-Review

- **Spec coverage:** removals (T3/T4), mic button styling+placement (T7), red/pulse (T7), append-at-cursor (T2/T6), two states (T3 store + T7), Alt+V formal keybinding (T1/T9), TTS kept+muted-by-default+auto-speak-while-printing (T5), speaker toggle in prompt bar (T7), Listen on every assistant message (T8). All covered.
- **Placeholders:** none — code given for every code step; two "confirm against existing call site" notes (toast API shape, `_chat.tsx` wrap point) are explicit verification instructions, not deferred work.
- **Type consistency:** `insertTextAtCursor`, `dictationInsertText`, `useVoiceDictation({insertAtCursor, stopTts})`, `useVoiceTts(): {speak, stop}`, store `{recording, ttsMuted, toggleRecording, toggleTtsMuted}`, `onUtteranceEnd(wav)` used consistently across tasks.
