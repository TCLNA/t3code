# Inline Voice Dictation in the Composer — Design

**Date:** 2026-07-01
**Status:** Approved (pending spec review)

## Goal

Replace the full-screen "Voice Mode" overlay with an inline dictation experience
in the classic chat composer:

- A round mic button next to the Send button. Idle = same style/color as Send;
  recording = red + pulsing.
- Speech is transcribed and **appended at the last cursor position** in the
  prompt, as if typed (append-per-pause, no retroactive rewrite).
- Exactly **two states**: recording / not recording (no push-to-talk vs
  auto-silence toggle, no codeword).
- **Alt+V** toggles recording, wired as a real remappable keybinding.
- Assistant replies can still be spoken (Kokoro TTS), but **muted by default**,
  controlled by a speaker toggle in the prompt bar, with a per-message "Listen"
  button.

## Decisions (locked)

| Question | Decision |
| --- | --- |
| Insert timing | Append per pause (live), append-only, never rewrites existing text |
| TTS | Kept. Muted by default. Auto-speaks the streaming reply only when unmuted. |
| Mute control | Speaker icon toggle in the prompt bar (gated on `ttsEnabled`) |
| Listen button | On **every** assistant message |
| Modes | recording / not-recording only |
| Alt+V | Formal, remappable keybinding action `voice.toggleRecording` |

## Removals

- Delete `apps/web/src/components/voice/VoiceModeView.tsx`, `VoiceOrb.tsx`,
  `VoiceModeControls.tsx`, and the old `ComposerVoiceButton.tsx`.
- Remove the `<VoiceModeView />` mount and import in
  `apps/web/src/routes/_chat.tsx` (lines 20, 157).
- `apps/web/src/voice/audioCapture.ts`: remove push-to-talk
  (`beginForcedUtterance`, the `forced` flag, and the `forced` argument added to
  `onUtteranceEnd` in the prior hotfix). Dictation uses continuous VAD only.
- `packages/contracts/src/settings.ts`: remove `submitMode` and
  `sendPromptCodeword` from `SpeechSettings` and `ServerSettingsPatch` (no modes,
  no codeword). `detectSendPromptCodeword` stays in `@t3tools/shared` (unused,
  still unit-tested).
- Update `~/.t3/dev/settings.json` and `~/.t3/userdata/settings.json` to drop the
  now-removed `submitMode`/`sendPromptCodeword` keys.
- `apps/web/src/voice/useVoiceSession.ts` is replaced (see below).

## Components

### 1. Voice store — `apps/web/src/voice/useVoiceStore.ts` (rewritten)

Slim zustand store:

```ts
interface VoiceStoreState {
  recording: boolean;
  ttsMuted: boolean;        // persisted to localStorage, default true
  error: string | null;
  setRecording(v: boolean): void;
  toggleRecording(): void;
  setTtsMuted(v: boolean): void;
  toggleTtsMuted(): void;
  setError(e: string | null): void;
}
```

Drops `isOpen/mode/status/level/transcript`. `ttsMuted` initializes from and
writes through to `localStorage` so the preference survives reloads.

### 2. Audio capture — `audioCapture.ts` (simplified)

Keep the worklet + energy-VAD utterance detection. Dictation always runs with
`autoEndOnSilence: true`; each detected utterance fires
`onUtteranceEnd(wav: Uint8Array)`. Remove push-to-talk entirely.

### 3. Dictation hook — `apps/web/src/voice/useVoiceDictation.ts` (new)

Used inside `ChatComposer`.

```ts
useVoiceDictation({ insertAtCursor, stopTts }: {
  insertAtCursor: (text: string) => void;
  stopTts: () => void;
}): void
```

- Watches `recording`. On `true`: construct a `VoiceCaptureController`, `stopTts()`
  (barge-in), `.start()`. On `false`/unmount: `.stop()`.
- `onUtteranceEnd(wav)` → `transcribeAudio(wav)` → `insertAtCursor(text)` with a
  leading space inserted when the char before the cursor is non-space.
- Transcription/mic errors → `toastManager` + `store.setError`, and stop recording.

### 4. Insert-at-cursor — `ChatComposer` + `ChatComposerHandle`

Add `insertTextAtCursor(text: string): void` to `ChatComposerHandle`, implemented
with the existing `replaceTextRange` + `composerCursor` machinery (mirrors the
terminal-context insertion already in the file at ~line 1488). Insert at the
expanded `composerCursor`, update prompt/cursor/trigger, then `focusAt(newCursor)`.
"Last cursor position" = the persisted `composerCursor`, which survives the blur
when the mic button is clicked. A small pure helper
`buildDictationInsertion(prompt, cursor, chunk)` (in `composer-logic` or a new
`voice/dictationInsert.ts`) computes the leading-space rule and new text/cursor,
and is unit-tested.

### 5. Mic + mute buttons — `apps/web/src/components/chat/ComposerPrimaryActions.tsx`

- **Mic button:** `type="button"`, rendered immediately beside the Send button,
  reusing the Send button's classes
  (`h-9 w-9 sm:h-8 sm:w-8 rounded-full ...`). Idle: `bg-primary/90` like Send.
  Recording: swap to `bg-red-500 text-white animate-pulse` and
  `aria-pressed=true`. `MicIcon` (`size-3.5`). Gated on `settings.speech.sttEnabled`.
  onClick → `toggleRecording`. Tooltip "Record (Alt+V)".
- **Mute toggle:** small ghost button (speaker) in the prompt bar, gated on
  `settings.speech.ttsEnabled`. `Volume2Icon` when unmuted, `VolumeXIcon` when
  muted. onClick → `toggleTtsMuted`. Tooltip "Speak replies" / "Muted".

`ComposerPrimaryActions` gains props: `sttEnabled`, `ttsEnabled`, `recording`,
`ttsMuted`, `onToggleRecording`, `onToggleMute`.

### 6. TTS provider — `apps/web/src/voice/VoiceTtsProvider.tsx` (new)

Mounted where `VoiceModeView` was (`routes/_chat.tsx`). Owns one
`TtsPlaybackController` and exposes via context:

```ts
interface VoiceTts {
  speak(text: string): void;   // stop() then enqueue whole message
  stop(): void;
}
```

- Auto-narration effect: for the active thread's latest assistant message, when
  `ttsEnabled && !ttsMuted`, enqueue newly-arrived speakable sentences as they
  stream (reuses the sentence-tracking logic from the old `useVoiceSession`).
- `getVoice` reads `settings.speech.kokoroVoice`.
- Toggling mute → on (muted) calls `stop()`.
- Dictation `stopTts` calls `stop()` (barge-in).

### 7. Listen button — `apps/web/src/components/chat/MessagesTimeline.tsx`

In `AssistantTimelineRow`'s hover-action row (beside `AssistantCopyButton`, ~line
999), add a `Button size="xs" variant="ghost"` with `Volume2Icon` (`size-3`),
gated on `ttsEnabled`. onClick → `voiceTts.speak(markdownToSpeakable(row.message.text))`.
Available on every assistant message; works after navigating away / to replay.

### 8. Keybinding — `voice.toggleRecording` → `alt+v`

- `packages/contracts/src/keybindings.ts`: add `"voice.toggleRecording"` to
  `STATIC_KEYBINDING_COMMANDS`.
- `packages/shared/src/keybindings.ts`: add
  `{ key: "alt+v", command: "voice.toggleRecording" }` to `DEFAULT_KEYBINDINGS`.
- `apps/web/src/components/ChatView.tsx`: in the existing `resolveShortcutCommand`
  keydown handler, add a `command === "voice.toggleRecording"` branch →
  `useVoiceStore.getState().toggleRecording()` (guarded on `sttEnabled` + active
  thread).
- `docs/user/keybindings.md`: document the command.
- Settings UI auto-discovers it ("Voice: Toggle Recording"); no UI change needed.

## Data flow

```
Alt+V / mic click ──▶ store.toggleRecording
      recording=true ──▶ useVoiceDictation: stopTts(); capture.start() (VAD)
      speech pause ─────▶ onUtteranceEnd(wav) ─▶ transcribeAudio ─▶ insertTextAtCursor
      recording=false ─▶ capture.stop()

assistant reply streams ─▶ (ttsEnabled && !ttsMuted) VoiceTtsProvider enqueues sentences
Listen button ───────────▶ voiceTts.speak(markdownToSpeakable(message.text))
speaker toggle ──────────▶ store.toggleTtsMuted (persisted); muting calls stop()
```

## Testing

- Keep `packages/shared/src/speakableText.test.ts`.
- New unit tests for `buildDictationInsertion` (leading-space rule; insert at
  start/middle/end; empty chunk).
- New unit test that `parseKeybindingShortcut("alt+v")` and
  `resolveShortcutCommand` resolve to `voice.toggleRecording`.
- VAD/AudioContext + live mic remain manual verification (documented steps).
- `pnpm --filter @t3tools/web typecheck`, contracts + shared typecheck, and the
  existing server speech integration path all stay green.

## Risks

- **Insert-at-cursor through the rich `ComposerPromptEditor`** (expanded/collapsed
  cursor mapping). Mitigation: reuse the in-file `replaceTextRange` pattern and
  cover the pure helper with tests.
- **Removing settings fields** (`submitMode`/`sendPromptCodeword`) from a
  persisted schema. Mitigation: decode is lenient to unknown keys; also proactively
  strip them from the two on-disk settings.json files.

## Out of scope

- Streaming/partial transcription within a single utterance.
- Whole-recording re-transcription/correction on stop.
- Non-chat surfaces (only the classic chat composer).
