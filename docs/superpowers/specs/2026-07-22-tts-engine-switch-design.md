# UI switch for TTS engine (Kokoro ⇄ Chatterbox) — design

Date: 2026-07-22
Status: approved (brainstorm), pending implementation plan

## Goal

Let the user pick the TTS engine (Kokoro or Chatterbox) from the UI — in **both**
the sidebar voice popover and the Settings → Voice section — instead of hand-editing
`speech.kokoroCommand` in `settings.json`.

## Background (current state)

- The two engines are two external wrapper scripts. Today `speech.kokoroCommand`
  (a string in `settings.json`) points at whichever one is active; there is **no UI
  control** for it.
- `apps/server/src/speech/TextToSpeech.ts:88` resolves the command from
  `speech.kokoroCommand` (env fallback `T3_KOKORO_CMD`) and spawns it.
- Settings round-trip is generic: `updateSettings({ speech: {...} })` →
  `server.updateSettings` RPC → `applyServerSettingsPatch` (deep-merge) → persisted →
  config stream re-derives `primaryServerSettingsAtom`. **No new RPC/route/handler is
  needed** — any `speech.*` field flows through this path.
- The sidebar voice picker (`SidebarVoiceDropdown`, `apps/web/src/components/Sidebar.tsx`)
  and the Settings Voice section (`apps/web/src/components/settings/SettingsPanels.tsx`)
  both read `primaryServerSettingsAtom` and write via `useUpdatePrimarySettings`.

## Data model — `packages/contracts/src/settings.ts`

Add two fields to `SpeechSettings`, mirrored into `ServerSettingsPatch.speech`:

- `ttsEngine: Schema.Literals(["kokoro", "chatterbox"])`, decoding-default `"kokoro"`
  (mirrors existing enums like `ThreadEnvMode`/`TimestampFormat`). Existing settings
  therefore stay on Kokoro.
- `chatterboxCommand: TrimmedString`, default `""`, placeholder
  `/path/to/tts-wrapper-chatterbox.sh` — mirrors `kokoroCommand`.

Add `ttsEngine` to the `order` array so the generated provider form stays coherent.
Leave `kokoroCommand`, `kokoroVoice`, `kokoroEnabledVoices` unchanged.

## Server — `apps/server/src/speech/TextToSpeech.ts`

At the command-resolution site (`:88`), branch on the engine:

```ts
const engine = speech.ttsEngine ?? "kokoro";
const command =
  engine === "chatterbox"
    ? resolveConfigValue(speech.chatterboxCommand, "T3_CHATTERBOX_CMD")
    : resolveConfigValue(speech.kokoroCommand, "T3_KOKORO_CMD");
```

Keep the existing `binary-missing` failure when the resolved command is empty, but
include the engine name in the error `detail` (e.g. `No chatterbox command
configured.`). Nothing else in the file changes; the `--out/--voice/--model/--speed`
arg contract is identical for both engines.

## UI — shared `TtsEngineSelect` used in both locations

New component `apps/web/src/components/voice/TtsEngineSelect.tsx`:

- A 2-item `Select` (Kokoro / Chatterbox) mirroring the Settings Theme-row dropdown
  (`SettingsPanels.tsx` Theme select) — the established select pattern.
- Value = `settings.speech.ttsEngine ?? "kokoro"`; on change →
  `updateSettings({ speech: { ttsEngine: value } })`.
- Reads/writes through the same `usePrimarySettings` / `useUpdatePrimarySettings`
  hooks both call sites already use (the component takes the current engine value +
  an `onChange`, so it stays presentational; each call site owns its settings hook).

Shared constants in that file (or a colocated `ttsEngine.ts`): the engine option list
`[{value:"kokoro",label:"Kokoro"},{value:"chatterbox",label:"Chatterbox"}]` and the
note text `"Chatterbox uses its configured voice."` — one source so the two spots
can't drift.

**Sidebar** (`SidebarVoiceDropdown`): render `<TtsEngineSelect>` above the voice list.
When the engine is `chatterbox`, **hide** the Kokoro voice buttons and render the note
instead.

**Settings** (`SettingsPanels.tsx` Voice section): render the same select as a
`SettingsRow` labelled "TTS engine"; the "Available voices" checkbox list is hidden
under Chatterbox, replaced by the same note.

A pure helper `shouldShowKokoroVoices(engine): boolean` (`engine !== "chatterbox"`)
gates the voice list in both spots and is unit-tested.

## Testing

- **Contracts** (`packages/contracts/src/settings.test.ts`): `ttsEngine` decodes to
  `"kokoro"` by default; `chatterboxCommand` defaults to `""`; `ServerSettingsPatch.speech`
  accepts `{ ttsEngine: "chatterbox" }` and `{ chatterboxCommand: "…" }`.
- **Server** (`apps/server/src/speech/TextToSpeech.test.ts`, or a colocated test): with a
  fake `ProcessRunner`, `ttsEngine:"chatterbox"` spawns `chatterboxCommand`;
  unset/`"kokoro"` spawns `kokoroCommand`; selected-but-empty → `binary-missing`.
- **Web** (`shouldShowKokoroVoices` unit test): `"kokoro"`/undefined → true,
  `"chatterbox"` → false. JSX wiring covered by `tsgo` typecheck + in-app check.

## Settings migration (machine-local, applied after merge — NOT repo code)

The dev `~/.t3/dev/settings.json` currently has `kokoroCommand` pointing at the
**Chatterbox** wrapper. Post-implementation, set:
`kokoroCommand` → the Kokoro wrapper, `chatterboxCommand` → the Chatterbox wrapper,
`ttsEngine` → the desired default. Mirror into `~/.t3/userdata/settings.json` if
wanted. This is an operator step, not part of the code change.

## Out of scope

- Any new RPC/route/handler (the generic settings path is reused).
- Renaming the `kokoro*` keys to engine-neutral names.
- Chatterbox voice/clone selection UI (Chatterbox voice is configured operator-side).
- Auto-detecting which engines are installed.
