# TTS Voice Selector Design

**Date:** 2026-07-06
**Branch:** claude/local-stt-tts-oe0hit

## Overview

Expand the sidebar TTS mute button into a popover dropdown that lets the user toggle TTS on/off and switch between voices. Voices are configured in General settings via a checkbox list.

## Data Model

### New constant — `KOKORO_VOICES`

`packages/contracts/src/settings.ts` exports:

```ts
export const KOKORO_VOICES = [
  "af_heart", "af_bella", "af_nova", "af_sky", "af_sarah",
  "am_adam", "am_michael",
  "bf_emma", "bf_isabella",
  "bm_george", "bm_lewis",
] as const;
```

Single source of truth for the master voice list.

### New settings field — `kokoroEnabledVoices`

Added to `SpeechSettings` in `packages/contracts/src/settings.ts`:

```ts
kokoroEnabledVoices: {
  type: "array",
  items: { type: "string" },
  default: [...KOKORO_VOICES],   // all enabled by default
}
```

Patched via `ServerSettingsPatch` (same mechanism as `kokoroVoice`). The existing `kokoroVoice` field is unchanged.

**Edge case:** if the currently active `kokoroVoice` is removed from `kokoroEnabledVoices`, auto-patch `kokoroVoice` to the first remaining enabled voice. This logic lives in the settings patch handler or a dedicated helper called from the General settings component.

## Sidebar Voice Dropdown

### Component

`SidebarTtsMuteButton` in `apps/web/src/components/Sidebar.tsx:2743` is replaced with `SidebarVoiceDropdown`.

- The trigger button is visually identical to today (volume icon, same size).
- Clicking opens a Radix `Popover` (already used elsewhere in the codebase).
- The popover closes on outside click.

### Popover contents

```
┌─────────────────────────┐
│ Text-to-speech  [toggle] │  ← patches ttsEnabled
├─────────────────────────┤
│ ○ af_heart               │
│ ● af_bella               │  ← active voice highlighted
│ ○ af_nova                │
│   ...                    │  ← only enabled voices shown
└─────────────────────────┘
```

- Toggle row: label "Text-to-speech" + the existing on/off toggle switch. Patches `ttsEnabled`.
- Voice list: one radio row per voice in `kokoroEnabledVoices`. Selecting patches `kokoroVoice`.
- Voice names displayed as-is (no friendly labels).
- List hidden (or greyed) when TTS is toggled off.

## General Settings — Voice Subsection

Added to the existing General settings component (no new nav entry).

Renders only when `ttsEnabled` is true.

```
Voice
─────
Available voices
  ☑ af_heart
  ☑ af_bella
  ☑ af_nova
  ...
```

- One checkbox per entry in `KOKORO_VOICES`.
- Checked state = voice is in `kokoroEnabledVoices`.
- Toggling patches `kokoroEnabledVoices`.
- The last checked voice's checkbox is disabled (must keep at least one).
- If unchecking a voice that is currently active (`kokoroVoice`), auto-switch active voice to first remaining enabled voice.

## Affected Files

| File | Change |
|---|---|
| `packages/contracts/src/settings.ts` | Add `KOKORO_VOICES` constant; add `kokoroEnabledVoices` to `SpeechSettings` |
| `apps/web/src/components/Sidebar.tsx` | Replace `SidebarTtsMuteButton` with `SidebarVoiceDropdown` |
| `apps/web/src/components/settings/SettingsPanels.tsx` (`GeneralSettingsPanel`, line 479) | Add voice subsection with checkbox list |

## Out of Scope

- Speed control
- Custom/user-added voices
- Voice preview/playback from settings
- Friendly display names for voices
