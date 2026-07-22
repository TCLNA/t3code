# Dynamic Chatterbox voice picker — design

Date: 2026-07-22
Status: approved (brainstorm), pending implementation plan

## Goal

Let the user pick the Chatterbox TTS voice from the UI, with the list built
**dynamically** from the reference-clip directory on disk — drop a new `.wav`
into the folder and it appears in the picker (on app load / reconnect).

## Background (already in place)

- The Chatterbox adapter/daemon (`~/opt/t3-voice/`, machine-local) already
  support voice cloning: a request's `--voice <name>` maps to
  `VOICES_DIR/<name>.wav`, and the daemon caches per-voice conditionals so
  switching is instant (no reload). `DEFAULT_VOICE=rossmann`. **No changes to
  the adapter/daemon are needed.**
- The server already selects the engine command (`resolveTtsCommand`) and passes
  `--voice`. The TTS synth path is HTTP (`/api/tts/synthesize`) carrying a
  free-form `voice` string end to end (`TextToSpeechRequest.voice` →
  `TextToSpeechInput.voice` → `--voice`).
- `ServerConfig` (streamed via `server.getConfig`) already carries **computed**
  lists such as `availableEditors`; the web reads them through per-list atoms.

## Data model — `packages/contracts`

`SpeechSettings` (+ mirror in `ServerSettingsPatch.speech`), `settings.ts`:

- `chatterboxVoice: TrimmedString`, default `""` (selected voice name; empty →
  the adapter's built-in default voice). Mirrors `kokoroVoice`.
- `chatterboxVoicesDir: TrimmedString`, default `""` (absolute dir the server
  scans for `*.wav`; empty → no voices listed). Mirrors `kokoroCommand`.

`ServerConfig`, `server.ts`:

- `chatterboxVoices: Schema.Array(Schema.String)` — computed list of voice names
  (base filename without `.wav`), mirroring `availableEditors`.

## Server

**Discovery** — in `loadServerConfig` (`ws.ts`), beside `resolveAvailableEditors()`:
read `speech.chatterboxVoicesDir`; if non-empty, `NodeFSP.readdir` it and map to
voice names via a pure helper `voiceNamesFromFilenames(files): string[]` (keep
`*.wav` case-insensitively, strip the extension, sort, de-dupe). Empty dir,
missing dir, or read error → `[]` (never throws — the feature just shows no
voices). The FS read is a thin wrapper around the pure helper.

**Voice resolution** — in `TextToSpeech.ts`, replace the Kokoro-only fallback
with an engine-aware pure helper
`resolveTtsVoice(engine, requestedVoice, speech, env): string`:

- `chatterbox` → `requestedVoice?.trim() || chatterboxVoice(env T3_CHATTERBOX_VOICE) || ""`
  (empty string is fine — the adapter falls back to its default voice; no
  `af_heart`).
- `kokoro` → existing behavior: `requestedVoice || kokoroVoice || "af_heart"`.
  The `--voice` arg is still always passed. The `--model` arg (from
  `kokoroModelPath`) is left as-is; the Chatterbox adapter ignores it.

## Web

- **Atom**: `primaryServerChatterboxVoicesAtom` in `state/server.ts`, mirroring
  `primaryServerAvailableEditorsAtom` (reads `config.chatterboxVoices`).
- **Synth voice**: `VoiceTtsProvider.tsx` `getVoice` becomes engine-aware via a
  pure helper `selectSynthVoice(speech): string | undefined` — returns
  `chatterboxVoice` when `ttsEngine === "chatterbox"`, else `kokoroVoice`
  (empty → `undefined`). Nothing else in the synth path changes.
- **Pickers**: replace the two "Chatterbox uses its configured voice" note
  branches (Sidebar `SidebarVoiceDropdown`, Settings Voice section) with a
  single-select list built from `chatterboxVoices`, mirroring the existing
  Kokoro voice buttons, writing
  `updateSettings({ speech: { ...settings.speech, chatterboxVoice: name } })`.
  When `chatterboxVoices` is empty, show a note:
  "No Chatterbox voices found — add .wav files to the voices folder."

## Testing

- **Contracts**: `chatterboxVoice`/`chatterboxVoicesDir` default to `""` and
  round-trip through `ServerSettingsPatch.speech`; `ServerConfig.chatterboxVoices`
  decodes an array (and defaults to `[]` when absent).
- **Server (pure)**:
  - `voiceNamesFromFilenames(["rossmann.wav","a.WAV","note.txt","rossmann.wav"])`
    → `["a","rossmann"]` (sorted, de-duped, non-wav dropped, case-insensitive ext).
  - `resolveTtsVoice`: chatterbox picks `chatterboxVoice` (no `af_heart`); kokoro
    keeps `af_heart` default; explicit request wins for both.
- **Web (pure)**: `selectSynthVoice` returns the engine-appropriate voice /
  `undefined` when empty.
- JSX wiring covered by `tsgo` + in-app check.

## Machine-local (operator step, post-merge — NOT repo code)

Set `speech.chatterboxVoicesDir` to `/home/thomas/opt/t3-voice/voices` in
`~/.t3/dev/settings.json` so the scan finds `rossmann.wav` / `rossmann2.wav`.
(Optionally set `chatterboxVoice` to the default choice.) Mirror to `userdata`
if wanted.

## Out of scope

- Any change to the Chatterbox adapter/daemon (already do per-voice cloning).
- A dedicated list-voices RPC / filesystem watcher (config-stream refresh chosen).
- Uploading/recording voices from the UI, or editing `chatterboxVoicesDir` from
  the UI (it's a settings.json field).
- Chatterbox `exaggeration`/`cfg_weight` controls (turbo ignores them).
