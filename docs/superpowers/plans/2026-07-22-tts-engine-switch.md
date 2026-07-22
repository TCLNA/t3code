# TTS Engine Switch (Kokoro/Chatterbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the TTS engine (Kokoro | Chatterbox) as a UI control in both the sidebar voice popover and the Settings → Voice section, backed by a new `speech.ttsEngine` setting.

**Architecture:** Add `ttsEngine` + `chatterboxCommand` to the speech settings contract; the server picks the command by engine at one spot in `TextToSpeech.ts`; a shared presentational `TtsEngineSelect` (mirroring the Theme dropdown) is rendered in both UI spots, persisting via the existing `updateSettings({ speech: { ttsEngine } })` path (no new RPC). The Kokoro voice list hides under Chatterbox.

**Tech Stack:** TypeScript, Effect Schema (contracts), Effect (server), React + jotai/effect-atom (web), `vite-plus/test` (`vp test run`).

**Design doc:** `docs/superpowers/specs/2026-07-22-tts-engine-switch-design.md`

## Global Constraints

- Test import convention everywhere: `import { describe, expect, it } from "vite-plus/test";`; relative imports keep `.ts`.
- Test commands: contracts `pnpm --filter @t3tools/contracts test`; server `pnpm --filter t3 test`; web `pnpm --filter @t3tools/web test`. Typecheck: `pnpm --filter <pkg> typecheck` (`tsgo --noEmit`).
- Engine values are exactly `"kokoro"` and `"chatterbox"`. Default engine is `"kokoro"` (decoding default) so existing settings are unaffected.
- No new RPC/route/handler — reuse `server.updateSettings` (any `speech.*` field deep-merges).
- Do NOT rename existing `kokoro*` keys. Do NOT change `SpeechHumanize`, `segmentSpeakable`, or the `--out/--voice/--model/--speed` adapter contract.

---

### Task 1: Contracts — add `ttsEngine` + `chatterboxCommand`

**Files:**

- Modify: `packages/contracts/src/settings.ts` (`SpeechSettings` ~415-496; `ServerSettingsPatch.speech` ~657-668)
- Test: `packages/contracts/src/settings.test.ts` (add to the `describe("SpeechSettings…")` block ~196)

**Interfaces:**

- Produces: `SpeechSettings.ttsEngine: "kokoro" | "chatterbox"` (default `"kokoro"`) and `SpeechSettings.chatterboxCommand: string` (default `""`); both accepted in `ServerSettingsPatch.speech`. Consumed by Tasks 2-4.

- [ ] **Step 1: Write failing contract tests**

Add inside the existing `describe("SpeechSettings.kokoroEnabledVoices", …)` block (or a new sibling `describe`) in `packages/contracts/src/settings.test.ts`:

```ts
it("defaults ttsEngine to kokoro when absent", () => {
  const decoded = decodeServerSettings({});
  expect(decoded.speech.ttsEngine).toBe("kokoro");
});
it("defaults chatterboxCommand to empty string when absent", () => {
  const decoded = decodeServerSettings({});
  expect(decoded.speech.chatterboxCommand).toBe("");
});
it("decodes an explicit chatterbox engine", () => {
  const decoded = decodeServerSettings({ speech: { ttsEngine: "chatterbox" } });
  expect(decoded.speech.ttsEngine).toBe("chatterbox");
});
it("accepts ttsEngine and chatterboxCommand in ServerSettingsPatch.speech", () => {
  const patch = decodeServerSettingsPatch({
    speech: { ttsEngine: "chatterbox", chatterboxCommand: "/opt/cb.sh" },
  });
  expect(patch.speech?.ttsEngine).toBe("chatterbox");
  expect(patch.speech?.chatterboxCommand).toBe("/opt/cb.sh");
});
```

- [ ] **Step 2: Run tests — confirm FAIL**

Run: `pnpm --filter @t3tools/contracts test`
Expected: the four new cases fail (property missing / patch decode drops unknown keys).

- [ ] **Step 3: Add the two fields to `SpeechSettings`**

In `packages/contracts/src/settings.ts`, inside the `SpeechSettings` field object, add `ttsEngine` immediately after `ttsEnabled` (so engine sits with the enable toggle) and `chatterboxCommand` immediately after `kokoroCommand`:

```ts
    ttsEngine: Schema.Literals(["kokoro", "chatterbox"]).pipe(
      Schema.withDecodingDefault(Effect.succeed("kokoro")),
      Schema.annotateKey({
        title: "TTS engine",
        description: "Which local text-to-speech engine to use.",
      }),
    ),
```

```ts
    chatterboxCommand: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Chatterbox command",
        description:
          "Command (or wrapper script path) for the Chatterbox engine; same stdin/WAV contract as the Kokoro command.",
        providerSettingsForm: {
          placeholder: "/path/to/tts-wrapper-chatterbox.sh",
          clearWhenEmpty: "omit",
        },
      }),
    ),
```

Then add both keys to the `order` array (ttsEngine right after `ttsEnabled`, chatterboxCommand right after `kokoroCommand`):

```ts
    order: [
      "sttEnabled",
      "ttsEnabled",
      "ttsEngine",
      "whisperBinaryPath",
      "whisperModelPath",
      "kokoroCommand",
      "chatterboxCommand",
      "kokoroModelPath",
      "kokoroVoice",
      "kokoroEnabledVoices",
    ],
```

- [ ] **Step 4: Mirror both fields in `ServerSettingsPatch.speech`**

In the `speech: Schema.optionalKey(Schema.Struct({ … }))` block (~657-668), add:

```ts
      ttsEngine: Schema.optionalKey(Schema.Literals(["kokoro", "chatterbox"])),
      chatterboxCommand: Schema.optionalKey(TrimmedString),
```

- [ ] **Step 5: Run tests + typecheck — confirm PASS**

Run: `pnpm --filter @t3tools/contracts test` → all pass (new + existing).
Run: `pnpm --filter @t3tools/contracts typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/settings.ts packages/contracts/src/settings.test.ts
git commit -m "feat(voice): add ttsEngine + chatterboxCommand speech settings"
```

---

### Task 2: Server — resolve command by engine

**Files:**

- Modify: `apps/server/src/speech/TextToSpeech.ts` (`resolveConfigValue` ~45; command resolution ~88)
- Test: `apps/server/src/speech/TextToSpeech.test.ts` (new)

**Interfaces:**

- Consumes: `speech.ttsEngine` / `speech.chatterboxCommand` from Task 1.
- Produces: exported pure `resolveTtsCommand(speech, env)` → `{ engine: "kokoro" | "chatterbox"; command: string }`, used by `synthesize`.

- [ ] **Step 1: Write failing tests for the pure resolver**

Create `apps/server/src/speech/TextToSpeech.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";

import { resolveTtsCommand } from "./TextToSpeech.ts";

describe("resolveTtsCommand", () => {
  it("defaults to the kokoro command when engine is unset", () => {
    const r = resolveTtsCommand({ kokoroCommand: "/kk", chatterboxCommand: "/cb" }, {});
    expect(r).toEqual({ engine: "kokoro", command: "/kk" });
  });
  it("uses the chatterbox command when engine is chatterbox", () => {
    const r = resolveTtsCommand(
      { ttsEngine: "chatterbox", kokoroCommand: "/kk", chatterboxCommand: "/cb" },
      {},
    );
    expect(r).toEqual({ engine: "chatterbox", command: "/cb" });
  });
  it("falls back to the engine-specific env var when the field is empty", () => {
    const r = resolveTtsCommand({ ttsEngine: "chatterbox" }, { T3_CHATTERBOX_CMD: "/env-cb" });
    expect(r).toEqual({ engine: "chatterbox", command: "/env-cb" });
  });
  it("returns an empty command when nothing is configured", () => {
    const r = resolveTtsCommand({ ttsEngine: "chatterbox" }, {});
    expect(r.command).toBe("");
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

Run: `pnpm --filter t3 test TextToSpeech`
Expected: FAIL — `resolveTtsCommand` is not exported.

- [ ] **Step 3: Implement the resolver + wire it in**

In `apps/server/src/speech/TextToSpeech.ts`:

(a) Give `resolveConfigValue` an injectable env (default `process.env`) — replace its signature/body:

```ts
const resolveConfigValue = (
  value: string | undefined,
  envKey: string,
  env: Record<string, string | undefined> = process.env,
): string => {
  const trimmed = value?.trim();
  if (trimmed) return trimmed;
  const fromEnv = env[envKey]?.trim();
  return fromEnv ?? "";
};
```

(b) Add the exported pure resolver (place it just below `resolveConfigValue`):

```ts
export interface TtsCommandInputs {
  readonly ttsEngine?: "kokoro" | "chatterbox" | undefined;
  readonly kokoroCommand?: string | undefined;
  readonly chatterboxCommand?: string | undefined;
}

/** Pick the TTS command + env fallback for the configured engine. */
export const resolveTtsCommand = (
  speech: TtsCommandInputs,
  env: Record<string, string | undefined> = process.env,
): { readonly engine: "kokoro" | "chatterbox"; readonly command: string } => {
  const engine = speech.ttsEngine ?? "kokoro";
  const command =
    engine === "chatterbox"
      ? resolveConfigValue(speech.chatterboxCommand, "T3_CHATTERBOX_CMD", env)
      : resolveConfigValue(speech.kokoroCommand, "T3_KOKORO_CMD", env);
  return { engine, command };
};
```

(c) Replace the command resolution at ~line 88 (currently `const command = resolveConfigValue(speech.kokoroCommand, "T3_KOKORO_CMD");`) and its empty-check detail:

```ts
const { engine, command } = resolveTtsCommand(speech);
if (!command) {
  return (
    yield *
    Effect.fail(
      new TextToSpeechError({
        reason: "binary-missing",
        detail: `No ${engine} command configured.`,
      }),
    )
  );
}
```

Leave the rest of `synthesize` (model/voice/speed/args/spawn) unchanged.

- [ ] **Step 4: Run tests + typecheck — confirm PASS**

Run: `pnpm --filter t3 test TextToSpeech` → 4 pass.
Run: `pnpm --filter t3 typecheck` → no NEW errors referencing `TextToSpeech.ts` (pre-existing `unnecessaryFailYieldableError` _suggestions_ elsewhere are unrelated).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/speech/TextToSpeech.ts apps/server/src/speech/TextToSpeech.test.ts
git commit -m "feat(voice): resolve TTS command by configured engine"
```

---

### Task 3: Web — shared `TtsEngineSelect` + `shouldShowKokoroVoices`

**Files:**

- Create: `apps/web/src/components/voice/ttsEngine.ts` (constants + pure helper)
- Create: `apps/web/src/components/voice/ttsEngine.test.ts`
- Create: `apps/web/src/components/voice/TtsEngineSelect.tsx` (presentational)

**Interfaces:**

- Produces: `TTS_ENGINE_OPTIONS`, `CHATTERBOX_VOICE_NOTE`, `type TtsEngine`, `shouldShowKokoroVoices(engine)`, and `<TtsEngineSelect value onChange className? />`. Consumed by Task 4.

- [ ] **Step 1: Write the failing helper test**

Create `apps/web/src/components/voice/ttsEngine.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";

import { shouldShowKokoroVoices } from "./ttsEngine.ts";

describe("shouldShowKokoroVoices", () => {
  it("shows the Kokoro voice list for kokoro", () => {
    expect(shouldShowKokoroVoices("kokoro")).toBe(true);
  });
  it("shows it when the engine is undefined (default kokoro)", () => {
    expect(shouldShowKokoroVoices(undefined)).toBe(true);
  });
  it("hides it for chatterbox", () => {
    expect(shouldShowKokoroVoices("chatterbox")).toBe(false);
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

Run: `pnpm --filter @t3tools/web test ttsEngine`
Expected: FAIL — module/function missing.

- [ ] **Step 3: Create the constants + helper**

Create `apps/web/src/components/voice/ttsEngine.ts`:

```ts
export type TtsEngine = "kokoro" | "chatterbox";

export const TTS_ENGINE_OPTIONS: ReadonlyArray<{ value: TtsEngine; label: string }> = [
  { value: "kokoro", label: "Kokoro" },
  { value: "chatterbox", label: "Chatterbox" },
];

/** Shown in place of the Kokoro voice list when Chatterbox is selected. */
export const CHATTERBOX_VOICE_NOTE = "Chatterbox uses its configured voice.";

/** The Kokoro voice list only applies to the Kokoro engine. */
export function shouldShowKokoroVoices(engine: TtsEngine | undefined): boolean {
  return (engine ?? "kokoro") !== "chatterbox";
}
```

- [ ] **Step 4: Create the presentational select**

Create `apps/web/src/components/voice/TtsEngineSelect.tsx` (mirror the Theme select in `SettingsPanels.tsx:543-563`):

```tsx
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select.tsx";
import { TTS_ENGINE_OPTIONS, type TtsEngine } from "./ttsEngine.ts";

export function TtsEngineSelect({
  value,
  onChange,
  triggerClassName,
}: {
  value: TtsEngine;
  onChange: (engine: TtsEngine) => void;
  triggerClassName?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === "kokoro" || next === "chatterbox") onChange(next);
      }}
    >
      <SelectTrigger className={triggerClassName ?? "w-full sm:w-40"} aria-label="TTS engine">
        <SelectValue>
          {TTS_ENGINE_OPTIONS.find((o) => o.value === value)?.label ?? "Kokoro"}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {TTS_ENGINE_OPTIONS.map((o) => (
          <SelectItem hideIndicator key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
```

- [ ] **Step 5: Run helper test + typecheck — confirm PASS**

Run: `pnpm --filter @t3tools/web test ttsEngine` → 3 pass.
Run: `pnpm --filter @t3tools/web typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/voice/ttsEngine.ts apps/web/src/components/voice/ttsEngine.test.ts apps/web/src/components/voice/TtsEngineSelect.tsx
git commit -m "feat(voice): shared TtsEngineSelect + voice-visibility helper"
```

---

### Task 4: Web — wire the select into the sidebar + settings

**Files:**

- Modify: `apps/web/src/components/Sidebar.tsx` (`SidebarVoiceDropdown` ~2833-2888)
- Modify: `apps/web/src/components/settings/SettingsPanels.tsx` (Voice section ~1054-1098)

**Interfaces:**

- Consumes: `TtsEngineSelect`, `shouldShowKokoroVoices`, `CHATTERBOX_VOICE_NOTE` from Task 3.

- [ ] **Step 1: Wire the sidebar dropdown**

In `apps/web/src/components/Sidebar.tsx`, add the import near the other component imports:

```ts
import { TtsEngineSelect } from "./voice/TtsEngineSelect.tsx";
import { CHATTERBOX_VOICE_NOTE, shouldShowKokoroVoices } from "./voice/ttsEngine.ts";
```

In `SidebarVoiceDropdown`, after the existing `activeVoice` line (~2841) derive the engine:

```ts
const ttsEngine = settings.speech.ttsEngine ?? "kokoro";
```

Then, inside `<PopoverPopup …>`, insert an engine row directly BEFORE the existing `{ttsEnabled && enabledVoices.length > 0 && ( … )}` block, and gate the voice list on the engine (show the note under Chatterbox):

```tsx
{
  ttsEnabled && (
    <div className="mt-2 flex items-center justify-between gap-4 border-t border-border px-1 pt-2">
      <span className="text-sm font-medium">TTS engine</span>
      <TtsEngineSelect
        value={ttsEngine}
        onChange={(engine) => updateSettings({ speech: { ttsEngine: engine } })}
        triggerClassName="w-32"
      />
    </div>
  );
}
{
  ttsEnabled && !shouldShowKokoroVoices(ttsEngine) && (
    <p className="mt-2 border-t border-border px-1 pt-2 text-xs text-muted-foreground">
      {CHATTERBOX_VOICE_NOTE}
    </p>
  );
}
{
  ttsEnabled && shouldShowKokoroVoices(ttsEngine) && enabledVoices.length > 0 && (
    <div className="mt-2 flex flex-col border-t border-border pt-2">
      {/* …existing voice-list block unchanged… */}
    </div>
  );
}
```

(Only the outer condition of the existing voice-list block changes — add `shouldShowKokoroVoices(ttsEngine) &&`. Keep the inner `<span>Voice</span>` + `enabledVoices.map(...)` exactly as-is.)

- [ ] **Step 2: Wire the settings Voice section**

In `apps/web/src/components/settings/SettingsPanels.tsx`, add imports:

```ts
import { TtsEngineSelect } from "../voice/TtsEngineSelect.tsx";
import { CHATTERBOX_VOICE_NOTE, shouldShowKokoroVoices } from "../voice/ttsEngine.ts";
```

In the `{settings.speech.ttsEnabled && (<SettingsSection title="Voice">…)}` block (~1054), derive the engine at the top of that section body and add a `SettingsRow` for the engine before the "Available voices" panel, then gate that panel:

```tsx
<SettingsSection title="Voice">
  <SettingsRow
    title="TTS engine"
    description="Which local text-to-speech engine to use."
    control={
      <TtsEngineSelect
        value={settings.speech.ttsEngine ?? "kokoro"}
        onChange={(engine) => updateSettings({ speech: { ttsEngine: engine } })}
      />
    }
  />
  {shouldShowKokoroVoices(settings.speech.ttsEngine) ? (
    <div className="px-4 py-3.5 sm:px-5">{/* …existing "Available voices" panel unchanged… */}</div>
  ) : (
    <div className="px-4 py-3.5 sm:px-5">
      <p className="text-sm text-muted-foreground">{CHATTERBOX_VOICE_NOTE}</p>
    </div>
  )}
</SettingsSection>
```

(Keep the existing "Available voices" `<div>` body verbatim inside the truthy branch. `SettingsRow` is already imported in this file — confirm; if not, add it from the settings layout module used by the Theme row.)

- [ ] **Step 3: Typecheck + web tests**

Run: `pnpm --filter @t3tools/web typecheck` → clean.
Run: `pnpm --filter @t3tools/web test` → green (no test regressions; the helper test still passes).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx apps/web/src/components/settings/SettingsPanels.tsx
git commit -m "feat(voice): TTS engine switch in sidebar + settings"
```

---

## Self-Review

**Spec coverage:**

- `ttsEngine` + `chatterboxCommand` in schema + patch → Task 1. ✅
- Server picks command by engine, engine-named error → Task 2. ✅
- Shared `TtsEngineSelect` + `shouldShowKokoroVoices` → Task 3. ✅
- Both locations wired; voice list hidden + note under Chatterbox → Task 4. ✅
- Tests: contract defaults/patch (T1), pure resolver (T2), helper (T3) → all present. ✅
- No new RPC (reuses `updateSettings`) → Tasks 4 use existing path. ✅
- Migration is operator-side (settings.json) → out of repo scope, handled post-merge. ✅

**Placeholder scan:** the two "…existing block unchanged…" markers are explicit "keep verbatim" instructions with the surrounding condition shown — not gaps.

**Type consistency:** `TtsEngine = "kokoro" | "chatterbox"` used consistently; `resolveTtsCommand` return shape matches its test; `updateSettings({ speech: { ttsEngine } })` matches the patch key added in Task 1.
