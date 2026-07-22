# Sidebar audio control + in-app notification beeps

**Date:** 2026-07-22
**Status:** Design — awaiting review
**Area:** `apps/web` — sidebar footer, voice/audio

## Problem

The sidebar footer has a single TTS mute toggle (`ttsMuted`, a client-side
boolean). Now that the control lives at the bottom of the sidebar there is room
for a richer audio control. We want:

1. A **cycle button** with three states: **All sounds** (notification beeps +
   TTS), **Notifications beep only**, **No sound**.
2. A **voice dropdown** on the right to choose the Kokoro voice.
3. **New in-app notification beeps** — t3code has none today:
   - a **done** beep when a thread finishes (→ `Completed`), and
   - a **needs-input** beep when the agent needs the user (→ `Awaiting Input`,
     `Pending Approval`, or `Plan Ready`).

## Decisions (from brainstorming)

- Control shape: **cycle button** (click advances state), not a segmented control.
- Beep timing: user-configurable — **"Only beep when unfocused"** switch, default **on**.
- `all` mode on finish: **TTS narration is the finish signal** — suppress the
  _done_ beep in `all` mode; still beep for _needs-input_ (prompts aren't narrated).
- Sound source: **bundle the freedesktop `.oga` files** (`complete.oga` = done,
  `window-question.oga` = needs-input), matching the Claude Code harness sounds.
  License: freedesktop sound theme, **CC BY-SA 3.0** → record attribution.

## State model

Extend `apps/web/src/voice/useVoiceStore.ts` (client-side, `localStorage`):

- `audioMode: "all" | "notify" | "none"` — persisted at `t3.voice.audioMode`.
- `beepUnfocusedOnly: boolean` — persisted at `t3.voice.beepUnfocusedOnly`, default `true`.
- Keep a derived `ttsMuted: boolean` field in the store, kept in sync as
  `audioMode !== "all"`, so existing consumers (`VoiceTtsProvider`, composer
  speaker button, `AssistantListenButton`) need no changes.
- `kokoroVoice` stays in **server** settings (`settings.speech.kokoroVoice`),
  written by the voice dropdown exactly as today.

Derived helpers:

- `ttsMuted = audioMode !== "all"`
- `beepsEnabled = audioMode !== "none"`

Actions:

- `setAudioMode(mode)` — persists mode, updates derived `ttsMuted`.
- `cycleAudioMode()` — order `all → notify → none → all`.
- `toggleTtsMuted()` (kept for the composer speaker button) maps onto audioMode:
  muting → `notify` (preserve beeps), unmuting → `all`. Never sets `none`.
- `setBeepUnfocusedOnly(value)` — persists.

**Migration** (one-time, on store init): if `t3.voice.audioMode` is absent, read
the legacy `t3.voice.ttsMuted`: `false` → `"all"`; otherwise (or absent) → the
new default `"notify"`. New installs default to `"notify"` — beeps are useful and
non-intrusive because `beepUnfocusedOnly` defaults to `true`.

## Notification beep logic (pure, unit-tested)

New `apps/web/src/voice/notificationBeeps.ts`:

```
type BeepKind = "done" | "needs-input";
const NEEDS_INPUT_LABELS = { "Awaiting Input", "Pending Approval", "Plan Ready" };

resolveNotificationBeep(prev, next, mode): BeepKind | null
  if mode === "none" → null
  if prev !== "Working" → null            // only fire on a Working→settled edge
  if next === "Completed"        → mode === "notify" ? "done" : null   // all: TTS narrates
  if next ∈ NEEDS_INPUT_LABELS   → "needs-input"                       // all + notify
  else → null
```

Requiring `prev === "Working"` means threads already settled at mount never beep,
and re-renders that don't change the label never beep.

## Beep trigger (central watcher)

New `apps/web/src/voice/useNotificationSounds.ts`, mounted **once** in the sidebar
root (it already has the full project/thread collection used to render rows):

- Holds `useRef<Map<threadKey, ThreadStatusPill["label"] | null>>` of previous labels.
- On each render, for every known thread compute its label via the existing
  `resolveThreadStatusPill`, compare to the stored previous, call
  `resolveNotificationBeep(prev, next, audioMode)`, and if non-null and
  `(!beepUnfocusedOnly || !document.hasFocus())`, play the sound. Then store `next`.
- First observation of a thread seeds the map without beeping.
- Fires regardless of which rows are mounted/visible.

**Scope:** covers threads the sidebar knows about (open projects). Not a global
server-side watcher — out of scope for v1.

## Sound playback

New `apps/web/src/voice/notificationSounds.ts` — thin player:

- Assets `apps/web/src/voice/sounds/complete.oga` (done) and
  `window-question.oga` (needs-input), imported with Vite `?url` (base-path safe;
  a root `/sounds/...` path would break the hosted-static build).
- `playBeep(kind)` lazily constructs/reuses one `HTMLAudioElement` per kind and
  calls `.play()`. Rejections (autoplay policy) are swallowed — the user has
  already interacted with the app and beeps are opt-in, so this is a non-issue in
  practice, but we guard anyway.

## UI — sidebar footer

`SidebarChromeFooter` row: `[ ⚙ Settings (flex-1) ] [ cycle button ] [ voice ▾ ]`.

- **Cycle button** (`SidebarAudioModeButton`, new): icon reflects `audioMode` —
  `Volume2` (all) / `Bell` (notify) / `VolumeX` (none). `onClick` → `cycleAudioMode()`.
  `aria-label` + tooltip state the current mode, e.g. "Audio: notifications only
  (click to change)".
- **Voice dropdown** (`SidebarVoiceDropdown`, reworked): caret button opening a
  popover (`side="top"`). Contents:
  - "Only beep when unfocused" `Switch` bound to `beepUnfocusedOnly` (always shown).
  - Voice list (existing), shown only when `settings.speech.ttsEnabled` and there
    are enabled voices.
  - If TTS is server-disabled, the dropdown still renders for the focus switch.

Remove the old single mute-toggle trigger. Mount `useNotificationSounds()` once in
the sidebar root.

## Testing

Unit (Vitest, colocated `.test.ts`):

- `resolveNotificationBeep` across the transition × mode matrix (Working→Completed
  in all/notify/none; Working→each needs-input label; non-Working prev; unrelated
  transitions).
- `cycleAudioMode` order and `toggleTtsMuted` → audioMode mapping.
- Migration: legacy `ttsMuted` false/true/absent → correct `audioMode`.

The audio player and the DOM hook stay thin (no unit tests for `.play()`); logic
lives in the pure module.

## Error handling / edges

- `localStorage` read/write wrapped in try/catch (existing pattern).
- `audio.play()` promise rejection swallowed.
- Window focus (`document.hasFocus()`) evaluated at fire time.
- Collapsed sidebar (icon mode): footer shows two `size-8` icons; acceptable.

## Attribution

Add `apps/web/src/voice/sounds/ATTRIBUTION.md` noting the two files are from the
freedesktop.org sound theme, licensed **CC BY-SA 3.0**, with the upstream source
URL. (Share-alike applies to the audio files, not the app.)

## Files

New:

- `apps/web/src/voice/notificationBeeps.ts` (+ `.test.ts`)
- `apps/web/src/voice/useNotificationSounds.ts`
- `apps/web/src/voice/notificationSounds.ts`
- `apps/web/src/voice/sounds/{complete,window-question}.oga`
- `apps/web/src/voice/sounds/ATTRIBUTION.md`

Changed:

- `apps/web/src/voice/useVoiceStore.ts` (tri-state + migration + derived `ttsMuted`)
- `apps/web/src/components/Sidebar.tsx` (footer cycle button + reworked voice
  dropdown + mount watcher)

## Out of scope

- Server-side / cross-client notification.
- Per-thread or per-project sound preferences.
- Desktop OS notifications.
