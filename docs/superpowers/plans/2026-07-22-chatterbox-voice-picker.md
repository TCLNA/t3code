# Dynamic Chatterbox Voice Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick the Chatterbox TTS voice in the UI, with the list built dynamically from a voices directory on disk (scanned server-side, streamed via `server.getConfig`).

**Architecture:** Add `chatterboxVoice` + `chatterboxVoicesDir` speech settings and a computed `ServerConfig.chatterboxVoices`. The server scans the dir (pure name-mapping helper + tolerant FS read) inside `loadServerConfig`, and resolves the per-engine synth voice via a pure helper. The web exposes the list as an atom, makes `getVoice` engine-aware, and renders a dynamic voice picker under Chatterbox in the sidebar + settings. The machine-local adapter/daemon already clone per `--voice <name>` and are untouched.

**Tech Stack:** TypeScript, Effect Schema (contracts), Effect (server), React + effect-atom (web), `vite-plus/test`.

**Design doc:** `docs/superpowers/specs/2026-07-22-chatterbox-voice-picker-design.md`

## Global Constraints

- Test import: `import { describe, expect, it } from "vite-plus/test";`. Contracts/server keep `.ts` in relative imports; **web omits the extension** (`from "./x"`).
- Test commands: contracts `pnpm --filter @t3tools/contracts test`; server `pnpm --filter t3 test`; web `pnpm --filter @t3tools/web test`. Typecheck: `pnpm --filter <pkg> typecheck`.
- Voice name = base filename without `.wav`. Empty `chatterboxVoice` → adapter's built-in default (do NOT substitute a Kokoro voice or `af_heart`).
- The dir scan must NEVER throw: missing/empty/unreadable dir → `[]`.
- Do NOT change the Chatterbox adapter/daemon, the `/api/tts/synthesize` route, or the `TextToSpeechRequest`/`TextToSpeechInput` shapes.

---

### Task 1: Contracts — voice settings + config list

**Files:**

- Modify: `packages/contracts/src/settings.ts` (`SpeechSettings` field block + `order` ~512 + `ServerSettingsPatch.speech` ~686)
- Modify: `packages/contracts/src/server.ts` (`ServerConfig` struct ~409-424)
- Test: `packages/contracts/src/settings.test.ts`

**Interfaces:**

- Produces: `SpeechSettings.chatterboxVoice: string` (default `""`), `SpeechSettings.chatterboxVoicesDir: string` (default `""`), both in `ServerSettingsPatch.speech`; `ServerConfig.chatterboxVoices?: readonly string[]`.

- [ ] **Step 1: Write failing tests**

Add to `packages/contracts/src/settings.test.ts` inside the `describe("SpeechSettings.kokoroEnabledVoices", …)` block:

```ts
it("defaults chatterboxVoice and chatterboxVoicesDir to empty strings", () => {
  const decoded = decodeServerSettings({});
  expect(decoded.speech.chatterboxVoice).toBe("");
  expect(decoded.speech.chatterboxVoicesDir).toBe("");
});
it("accepts chatterboxVoice and chatterboxVoicesDir in ServerSettingsPatch.speech", () => {
  const patch = decodeServerSettingsPatch({
    speech: { chatterboxVoice: "rossmann", chatterboxVoicesDir: "/voices" },
  });
  expect(patch.speech?.chatterboxVoice).toBe("rossmann");
  expect(patch.speech?.chatterboxVoicesDir).toBe("/voices");
});
```

- [ ] **Step 2: Run — confirm FAIL**

Run: `pnpm --filter @t3tools/contracts test`
Expected: the two new cases fail (properties missing / patch drops unknown keys).

- [ ] **Step 3: Add the two speech fields**

In `packages/contracts/src/settings.ts`, add to the `SpeechSettings` field object — `chatterboxVoice` immediately after `chatterboxCommand`, and `chatterboxVoicesDir` immediately after it:

```ts
    chatterboxVoice: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Chatterbox voice",
        description: "Selected Chatterbox voice (reference-clip name in the voices folder).",
        providerSettingsForm: { placeholder: "rossmann", clearWhenEmpty: "omit" },
      }),
    ),
    chatterboxVoicesDir: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Chatterbox voices directory",
        description: "Directory scanned for Chatterbox voice reference clips (*.wav).",
        providerSettingsForm: {
          placeholder: "/path/to/voices",
          clearWhenEmpty: "omit",
        },
      }),
    ),
```

Add both keys to the `order` array (after `kokoroEnabledVoices` is fine):

```ts
      "kokoroEnabledVoices",
      "chatterboxVoice",
      "chatterboxVoicesDir",
```

- [ ] **Step 4: Mirror both in `ServerSettingsPatch.speech`**

In the `speech: Schema.optionalKey(Schema.Struct({ … }))` block, add:

```ts
      chatterboxVoice: Schema.optionalKey(TrimmedString),
      chatterboxVoicesDir: Schema.optionalKey(TrimmedString),
```

- [ ] **Step 5: Add `chatterboxVoices` to `ServerConfig`**

In `packages/contracts/src/server.ts`, inside the `ServerConfig` struct, add after `availableEditors` (line ~417):

```ts
  chatterboxVoices: Schema.optionalKey(Schema.Array(Schema.String)),
```

- [ ] **Step 6: Run tests + typecheck — confirm PASS**

Run: `pnpm --filter @t3tools/contracts test` → all pass.
Run: `pnpm --filter @t3tools/contracts typecheck` → clean.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/settings.ts packages/contracts/src/server.ts packages/contracts/src/settings.test.ts
git commit -m "feat(voice): add chatterboxVoice/chatterboxVoicesDir settings + config list"
```

---

### Task 2: Server — voice-name discovery

**Files:**

- Create: `apps/server/src/speech/chatterboxVoices.ts` (pure helper + tolerant scan)
- Create: `apps/server/src/speech/chatterboxVoices.test.ts`
- Modify: `apps/server/src/ws.ts` (`loadServerConfig` ~1069-1101)

**Interfaces:**

- Produces: `voiceNamesFromFilenames(files: readonly string[]): string[]` and `scanChatterboxVoices(dir: string): Effect.Effect<string[]>` (never fails → `[]`). Consumed by `loadServerConfig` (populates `ServerConfig.chatterboxVoices`).

- [ ] **Step 1: Write the failing pure-helper test**

Create `apps/server/src/speech/chatterboxVoices.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";

import { voiceNamesFromFilenames } from "./chatterboxVoices.ts";

describe("voiceNamesFromFilenames", () => {
  it("keeps only .wav (case-insensitive), strips the extension, sorts, de-dupes", () => {
    expect(
      voiceNamesFromFilenames(["rossmann.wav", "Alice.WAV", "notes.txt", "rossmann.wav"]),
    ).toEqual(["Alice", "rossmann"]);
  });
  it("returns an empty array for no wav files", () => {
    expect(voiceNamesFromFilenames(["a.txt", "b.md"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

Run: `pnpm --filter t3 test chatterboxVoices`
Expected: FAIL — module/function missing.

- [ ] **Step 3: Implement the helper + tolerant scan**

Create `apps/server/src/speech/chatterboxVoices.ts`. Mirror the readdir approach used in `apps/server/src/workspace/WorkspaceEntries.ts` (`NodeFSP.readdir`); the scan must swallow every error into `[]`.

```ts
import * as NodeFSP from "node:fs/promises";
import * as Effect from "effect/Effect";

/** Map directory filenames to sorted, de-duped Chatterbox voice names. */
export function voiceNamesFromFilenames(files: readonly string[]): string[] {
  const names = new Set<string>();
  for (const file of files) {
    if (file.toLowerCase().endsWith(".wav")) {
      names.add(file.slice(0, file.length - ".wav".length));
    }
  }
  return [...names].sort();
}

/** Scan a directory for *.wav voice clips. Never fails: any error → []. */
export const scanChatterboxVoices = (dir: string): Effect.Effect<string[]> => {
  const trimmed = dir.trim();
  if (!trimmed) return Effect.succeed([]);
  return Effect.tryPromise(() => NodeFSP.readdir(trimmed)).pipe(
    Effect.map(voiceNamesFromFilenames),
    Effect.orElseSucceed(() => []),
  );
};
```

- [ ] **Step 4: Run — confirm PASS**

Run: `pnpm --filter t3 test chatterboxVoices` → 2 pass.

- [ ] **Step 5: Populate `chatterboxVoices` in `loadServerConfig`**

In `apps/server/src/ws.ts`, add the import near the other speech imports:

```ts
import { scanChatterboxVoices } from "./speech/chatterboxVoices.ts";
```

In `loadServerConfig` (~1069), capture the RAW settings before redaction so the (possibly path-like) dir isn't stripped, then add `chatterboxVoices` to the returned object. Replace:

```ts
const settings = ServerSettings.redactServerSettingsForClient(yield * serverSettings.getSettings);
```

with:

```ts
const rawSettings = yield * serverSettings.getSettings;
const settings = ServerSettings.redactServerSettingsForClient(rawSettings);
const chatterboxVoices = yield * scanChatterboxVoices(rawSettings.speech.chatterboxVoicesDir);
```

and add this line to the returned object literal (next to `availableEditors`):

```ts
          chatterboxVoices,
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter t3 typecheck`
Expected: no NEW errors referencing `chatterboxVoices.ts` or the `loadServerConfig` edit (pre-existing suggestion diagnostics elsewhere are unrelated).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/speech/chatterboxVoices.ts apps/server/src/speech/chatterboxVoices.test.ts apps/server/src/ws.ts
git commit -m "feat(voice): scan chatterbox voices dir into server config"
```

---

### Task 3: Server — engine-aware synth voice

**Files:**

- Modify: `apps/server/src/speech/TextToSpeech.ts` (voice resolution ~126-130)
- Test: `apps/server/src/speech/TextToSpeech.test.ts` (append to the existing file from the engine-switch work)

**Interfaces:**

- Consumes: `resolveTtsCommand` (already in this file) for the engine.
- Produces: exported pure `resolveTtsVoice(engine, requestedVoice, speech, env)` → `string`, used by `synthesize`.

- [ ] **Step 1: Write failing tests**

Append to `apps/server/src/speech/TextToSpeech.test.ts`:

```ts
import { resolveTtsVoice } from "./TextToSpeech.ts";

describe("resolveTtsVoice", () => {
  it("kokoro uses kokoroVoice then falls back to af_heart", () => {
    expect(resolveTtsVoice("kokoro", undefined, { kokoroVoice: "af_nova" }, {})).toBe("af_nova");
    expect(resolveTtsVoice("kokoro", undefined, {}, {})).toBe("af_heart");
  });
  it("chatterbox uses chatterboxVoice with NO af_heart fallback", () => {
    expect(resolveTtsVoice("chatterbox", undefined, { chatterboxVoice: "rossmann" }, {})).toBe(
      "rossmann",
    );
    expect(resolveTtsVoice("chatterbox", undefined, {}, {})).toBe("");
  });
  it("an explicit requested voice wins for both engines", () => {
    expect(resolveTtsVoice("chatterbox", "custom", { chatterboxVoice: "rossmann" }, {})).toBe(
      "custom",
    );
    expect(resolveTtsVoice("kokoro", "custom", { kokoroVoice: "af_nova" }, {})).toBe("custom");
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

Run: `pnpm --filter t3 test TextToSpeech`
Expected: FAIL — `resolveTtsVoice` not exported.

- [ ] **Step 3: Implement `resolveTtsVoice` + wire it**

In `apps/server/src/speech/TextToSpeech.ts`, add the exported helper just below `resolveTtsCommand`. Extend `TtsCommandInputs` (already defined in this file for `resolveTtsCommand`) to also carry the voice fields, OR use a small local input type — the simplest is a dedicated param type:

```ts
export interface TtsVoiceInputs {
  readonly kokoroVoice?: string | undefined;
  readonly chatterboxVoice?: string | undefined;
}

/** Pick the synth voice for the engine. Empty is valid for chatterbox
 *  (adapter uses its built-in default); kokoro keeps the af_heart default. */
export const resolveTtsVoice = (
  engine: "kokoro" | "chatterbox",
  requestedVoice: string | undefined,
  speech: TtsVoiceInputs,
  env: Record<string, string | undefined> = process.env,
): string => {
  const requested = requestedVoice?.trim();
  if (requested) return requested;
  if (engine === "chatterbox") {
    return resolveConfigValue(speech.chatterboxVoice, "T3_CHATTERBOX_VOICE", env);
  }
  return resolveConfigValue(speech.kokoroVoice, "T3_KOKORO_VOICE", env) || "af_heart";
};
```

Then replace the current voice block (lines ~127-130):

```ts
const voice =
  input.voice?.trim() || resolveConfigValue(speech.kokoroVoice, "T3_KOKORO_VOICE") || "af_heart";
```

with:

```ts
const voice = resolveTtsVoice(engine, input.voice, speech);
```

(`engine` is already in scope from `const { engine, command } = resolveTtsCommand(speech);`.)

- [ ] **Step 4: Run tests + typecheck — confirm PASS**

Run: `pnpm --filter t3 test TextToSpeech` → engine + voice tests pass.
Run: `pnpm --filter t3 typecheck` → no new errors in `TextToSpeech.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/speech/TextToSpeech.ts apps/server/src/speech/TextToSpeech.test.ts
git commit -m "feat(voice): engine-aware synth voice resolution"
```

---

### Task 4: Web — voices atom + engine-aware getVoice

**Files:**

- Modify: `apps/web/src/state/server.ts` (add atom near `primaryServerAvailableEditorsAtom` ~88)
- Create: `apps/web/src/components/voice/selectSynthVoice.ts`
- Create: `apps/web/src/components/voice/selectSynthVoice.test.ts`
- Modify: `apps/web/src/voice/VoiceTtsProvider.tsx` (`getVoice` ~47)

**Interfaces:**

- Produces: `primaryServerChatterboxVoicesAtom` (readonly string[]) and `selectSynthVoice(speech): string | undefined`. Consumed by Task 5 + the synth path.

- [ ] **Step 1: Write the failing helper test**

Create `apps/web/src/components/voice/selectSynthVoice.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";

import { selectSynthVoice } from "./selectSynthVoice";

describe("selectSynthVoice", () => {
  it("returns kokoroVoice for the kokoro engine", () => {
    expect(selectSynthVoice({ ttsEngine: "kokoro", kokoroVoice: "af_nova" })).toBe("af_nova");
  });
  it("returns chatterboxVoice for the chatterbox engine", () => {
    expect(
      selectSynthVoice({
        ttsEngine: "chatterbox",
        chatterboxVoice: "rossmann",
        kokoroVoice: "af_nova",
      }),
    ).toBe("rossmann");
  });
  it("returns undefined when the selected voice is empty", () => {
    expect(selectSynthVoice({ ttsEngine: "chatterbox", chatterboxVoice: "" })).toBeUndefined();
    expect(selectSynthVoice({ ttsEngine: "kokoro", kokoroVoice: "" })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

Run: `pnpm --filter @t3tools/web test selectSynthVoice`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/components/voice/selectSynthVoice.ts`:

```ts
export interface SynthVoiceInputs {
  readonly ttsEngine?: "kokoro" | "chatterbox" | undefined;
  readonly kokoroVoice?: string | undefined;
  readonly chatterboxVoice?: string | undefined;
}

/** The voice string to send with a synth request, or undefined if none set. */
export function selectSynthVoice(speech: SynthVoiceInputs): string | undefined {
  const voice =
    (speech.ttsEngine ?? "kokoro") === "chatterbox" ? speech.chatterboxVoice : speech.kokoroVoice;
  return voice && voice.length > 0 ? voice : undefined;
}
```

- [ ] **Step 4: Run — confirm PASS**

Run: `pnpm --filter @t3tools/web test selectSynthVoice` → 3 pass.

- [ ] **Step 5: Add the atom**

In `apps/web/src/state/server.ts`, add after `primaryServerAvailableEditorsAtom` (~91). Use a shared empty constant for referential stability (define `const EMPTY_CHATTERBOX_VOICES: ReadonlyArray<string> = [];` near the other `EMPTY_*` consts):

```ts
export const primaryServerChatterboxVoicesAtom = Atom.make(
  (get): ReadonlyArray<string> =>
    get(primaryServerConfigAtom)?.chatterboxVoices ?? EMPTY_CHATTERBOX_VOICES,
).pipe(Atom.withLabel("web-primary-server-chatterbox-voices"));
```

- [ ] **Step 6: Make `getVoice` engine-aware**

In `apps/web/src/voice/VoiceTtsProvider.tsx`, add the import:

```ts
import { selectSynthVoice } from "../components/voice/selectSynthVoice";
```

Replace `getVoice: () => speechRef.current.kokoroVoice || undefined,` (~line 47) with:

```ts
      getVoice: () => selectSynthVoice(speechRef.current),
```

- [ ] **Step 7: Typecheck + test**

Run: `pnpm --filter @t3tools/web typecheck` → clean.
Run: `pnpm --filter @t3tools/web test selectSynthVoice` → still green.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/state/server.ts apps/web/src/components/voice/selectSynthVoice.ts apps/web/src/components/voice/selectSynthVoice.test.ts apps/web/src/voice/VoiceTtsProvider.tsx
git commit -m "feat(voice): chatterbox voices atom + engine-aware synth voice"
```

---

### Task 5: Web — dynamic voice picker in sidebar + settings

**Files:**

- Modify: `apps/web/src/components/Sidebar.tsx` (`SidebarVoiceDropdown` chatterbox branch ~2911-2915)
- Modify: `apps/web/src/components/settings/SettingsPanels.tsx` (Voice section chatterbox `else` branch ~1112-1116)

**Interfaces:**

- Consumes: `primaryServerChatterboxVoicesAtom` (Task 4), `settings.speech.chatterboxVoice`, `updateSettings`.

- [ ] **Step 1: Sidebar — replace the chatterbox note with a picker**

In `apps/web/src/components/Sidebar.tsx`, in `SidebarVoiceDropdown`, read the voices + selection near the other derived values (after `const ttsEngine = …`):

```ts
const chatterboxVoices = useAtomValue(primaryServerChatterboxVoicesAtom);
const activeChatterboxVoice = settings.speech.chatterboxVoice ?? "";
```

Add the atom import with the other `state/server` imports:

```ts
import { primaryServerChatterboxVoicesAtom } from "../state/server";
```

Replace the current chatterbox note branch (the `{ttsEnabled && !shouldShowKokoroVoices(ttsEngine) && ( <p>…{CHATTERBOX_VOICE_NOTE}…</p> )}` block) with:

```tsx
{
  ttsEnabled && !shouldShowKokoroVoices(ttsEngine) && chatterboxVoices.length === 0 && (
    <p className="mt-2 border-t border-border px-1 pt-2 text-xs text-muted-foreground">
      No Chatterbox voices found — add .wav files to the voices folder.
    </p>
  );
}
{
  ttsEnabled && !shouldShowKokoroVoices(ttsEngine) && chatterboxVoices.length > 0 && (
    <div className="mt-2 flex flex-col border-t border-border pt-2">
      <span className="px-1 pb-1 text-xs text-muted-foreground">Voice</span>
      {chatterboxVoices.map((voice) => (
        <button
          key={voice}
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm",
            voice === activeChatterboxVoice
              ? "text-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
          onClick={() => updateSettings({ speech: { ...settings.speech, chatterboxVoice: voice } })}
        >
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            {voice === activeChatterboxVoice && <CheckIcon className="size-3" />}
          </span>
          {voice}
        </button>
      ))}
    </div>
  );
}
```

`CHATTERBOX_VOICE_NOTE` may now be unused in Sidebar — remove it from the `./voice/ttsEngine` import if the linter flags it (keep `shouldShowKokoroVoices`).

- [ ] **Step 2: Settings — replace the chatterbox note with a picker**

In `apps/web/src/components/settings/SettingsPanels.tsx`, in the Voice section, add the atom read near the top of the component (with the other `useAtomValue` calls) and the import:

```ts
import { primaryServerChatterboxVoicesAtom } from "../../state/server";
```

```ts
const chatterboxVoices = useAtomValue(primaryServerChatterboxVoicesAtom);
```

Replace the chatterbox `else` branch (currently `<div …><p …>{CHATTERBOX_VOICE_NOTE}</p></div>`) with:

```tsx
<div className="px-4 py-3.5 sm:px-5">
  {chatterboxVoices.length === 0 ? (
    <p className="text-sm text-muted-foreground">
      No Chatterbox voices found — add .wav files to the voices folder.
    </p>
  ) : (
    <div className="flex flex-col gap-2">
      <p className="mb-1 text-[13px] font-semibold tracking-[-0.01em] text-foreground">Voice</p>
      {chatterboxVoices.map((voice) => {
        const isChecked = (settings.speech.chatterboxVoice ?? "") === voice;
        return (
          <label
            key={voice}
            className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground"
          >
            <input
              type="radio"
              name="chatterbox-voice"
              checked={isChecked}
              onChange={() =>
                updateSettings({
                  speech: { ...settings.speech, chatterboxVoice: voice },
                })
              }
            />
            {voice}
          </label>
        );
      })}
    </div>
  )}
</div>
```

If `CHATTERBOX_VOICE_NOTE` becomes unused in this file, drop it from the `../voice/ttsEngine` import (keep `shouldShowKokoroVoices`).

- [ ] **Step 3: Typecheck + web tests**

Run: `pnpm --filter @t3tools/web typecheck` → clean (no errors in `Sidebar.tsx` / `SettingsPanels.tsx`).
Run: `pnpm --filter @t3tools/web test` → green (no regressions).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx apps/web/src/components/settings/SettingsPanels.tsx
git commit -m "feat(voice): dynamic Chatterbox voice picker in sidebar + settings"
```

---

## Self-Review

**Spec coverage:**

- `chatterboxVoice` + `chatterboxVoicesDir` settings + `ServerConfig.chatterboxVoices` → Task 1. ✅
- Server dir scan (pure `voiceNamesFromFilenames` + tolerant `scanChatterboxVoices`, `[]` on error) wired into `loadServerConfig` → Task 2. ✅
- Engine-aware `resolveTtsVoice` (chatterbox: no `af_heart`; kokoro: unchanged) → Task 3. ✅
- Web atom + engine-aware `getVoice` via `selectSynthVoice` → Task 4. ✅
- Dynamic pickers in both UI spots + empty-state note → Task 5. ✅
- Machine-local `chatterboxVoicesDir` migration → operator step (post-merge), not a code task. ✅

**Placeholder scan:** the "…{CHATTERBOX_VOICE_NOTE}… block" references point at concrete existing code shown in each task; no TODO/TBD.

**Type consistency:** `resolveTtsVoice(engine, requestedVoice, speech, env)` and `selectSynthVoice(speech)` signatures match their tests; `chatterboxVoices` is `readonly string[]` in the contract, atom, and both pickers; `chatterboxVoice`/`chatterboxVoicesDir` names identical across contracts/server/web.
