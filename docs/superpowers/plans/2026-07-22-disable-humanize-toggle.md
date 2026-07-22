# Disable-Humanize TTS Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `speech.humanizeEnabled` setting (default on) that, when off, makes the web TTS pipeline speak marker-stripped text without the per-unit LLM humanize round-trip.

**Architecture:** New boolean field in the `SpeechSettings` contract (backward-compatible via `withDecodingDefault`). The web client already holds speech settings (`primaryServerSettingsAtom`), so the gate lives in the web voice layer: a `prepareForSpeech(unit, humanizeEnabled)` helper returns `humanizeForSpeech(unit)` when on and `Promise.resolve(stripMarkers(unit))` when off. All three `VoiceTtsProvider` call sites route through it. No server changes.

**Tech Stack:** Effect Schema (contracts), React (web), `vite-plus/test` + `vp test` (both packages), `@t3tools/shared/speakableText` (`stripMarkers`).

## Global Constraints

- New setting defaults to `humanizeEnabled: true` (feature stays on for existing installs).
- Marker-stripped fallback uses `stripMarkers` from `@t3tools/shared/speakableText` — never raw passthrough (raw `[CODE:]`/`[PATH:]`/`[ARROW:]` markers would be spoken literally).
- No server-side changes: `SpeechHumanize` and `/api/tts/humanize` stay untouched.
- Follow the existing `ttsEnabled` field pattern exactly (schema shape, annotation, patch entry).

---

### Task 1: Add `humanizeEnabled` to the settings contract

**Files:**

- Modify: `packages/contracts/src/settings.ts` (SpeechSettings struct ~432, `order` array ~504-513, `ServerSettingsPatch.speech` ~676-687)
- Test: `packages/contracts/src/settings.test.ts` (append to `describe("SpeechSettings.kokoroEnabledVoices", ...)` block, ends ~239)

**Interfaces:**

- Produces: `SpeechSettings.Type` gains `humanizeEnabled: boolean`; `ServerSettingsPatch.speech` gains optional `humanizeEnabled: boolean`. Default decoded value is `true`.

- [ ] **Step 1: Write the failing tests**

Append these three tests inside the existing `describe("SpeechSettings.kokoroEnabledVoices", () => { ... })` block in `packages/contracts/src/settings.test.ts`, just before its closing `});` (~line 238):

```ts
it("defaults humanizeEnabled to true when absent", () => {
  const decoded = decodeServerSettings({});
  expect(decoded.speech.humanizeEnabled).toBe(true);
});
it("decodes an explicit humanizeEnabled false", () => {
  const decoded = decodeServerSettings({ speech: { humanizeEnabled: false } });
  expect(decoded.speech.humanizeEnabled).toBe(false);
});
it("accepts humanizeEnabled in ServerSettingsPatch.speech", () => {
  const patch = decodeServerSettingsPatch({
    speech: { humanizeEnabled: false },
  });
  expect(patch.speech?.humanizeEnabled).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @t3tools/contracts test -- settings`
Expected: FAIL — `decoded.speech.humanizeEnabled` is `undefined`; patch property does not exist (type error / undefined).

- [ ] **Step 3: Add the field to the `SpeechSettings` struct**

In `packages/contracts/src/settings.ts`, immediately after the `ttsEnabled` field (closes at ~line 432, before `ttsEngine`), insert:

```ts
    humanizeEnabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
      Schema.annotateKey({
        title: "Humanize TTS text",
        description:
          "Rewrite code, paths, and symbols into natural speech with a small LLM before speaking. When off, text is spoken as-is with markers stripped.",
        providerSettingsForm: { control: "switch" },
      }),
    ),
```

- [ ] **Step 4: Add the key to the `order` array**

In the same `makeProviderSettingsSchema` call, add `"humanizeEnabled"` to the `order` array (~line 504-513) right after `"ttsEnabled"`:

```ts
    order: [
      "sttEnabled",
      "ttsEnabled",
      "humanizeEnabled",
      "whisperBinaryPath",
      "whisperModelPath",
      "kokoroCommand",
      "kokoroModelPath",
      "kokoroVoice",
      "kokoroEnabledVoices",
    ],
```

- [ ] **Step 5: Add the key to `ServerSettingsPatch.speech`**

In the `ServerSettingsPatch` struct's `speech` block (~lines 676-687), add after `ttsEnabled`:

```ts
      humanizeEnabled: Schema.optionalKey(Schema.Boolean),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @t3tools/contracts test -- settings`
Expected: PASS (all three new tests green, existing tests still green).

- [ ] **Step 7: Typecheck the contract**

Run: `pnpm --filter @t3tools/contracts typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/settings.ts packages/contracts/src/settings.test.ts
git commit -m "feat(voice): add speech.humanizeEnabled setting"
```

---

### Task 2: Add the `prepareForSpeech` gate helper

**Files:**

- Modify: `apps/web/src/voice/humanizeSpeech.ts` (add export alongside `humanizeForSpeech`)
- Test: `apps/web/src/voice/humanizeSpeech.test.ts` (create)

**Interfaces:**

- Consumes: `stripMarkers` from `@t3tools/shared/speakableText` (already imported in this file); existing `humanizeForSpeech(sentence: string): Promise<string>`.
- Produces: `prepareForSpeech(sentence: string, humanizeEnabled: boolean): Promise<string>` — returns `humanizeForSpeech(sentence)` when `humanizeEnabled` is `true`, else `Promise.resolve(stripMarkers(sentence))` (no network call).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/voice/humanizeSpeech.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { prepareForSpeech } from "./humanizeSpeech";

describe("prepareForSpeech", () => {
  it("strips a CODE marker to its token when humanize is disabled", async () => {
    const result = await prepareForSpeech("call [CODE:useVoiceStore]", false);
    expect(result).toBe("call useVoiceStore");
  });

  it("leaves marker-free text unchanged when disabled", async () => {
    const result = await prepareForSpeech("hello world", false);
    expect(result).toBe("hello world");
  });
});
```

These literals match `stripMarkers` (`packages/shared/src/speakableText.ts:110`): `[CODE:token]` → `token` (kept), and marker-free text is returned verbatim. (For reference: `[PATH:...]` strips to empty and `[ARROW:...]` to `,`, which is why the CODE case is used here — it has no trailing-space ambiguity.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @t3tools/web test -- humanizeSpeech`
Expected: FAIL — `prepareForSpeech` is not exported.

- [ ] **Step 3: Implement `prepareForSpeech`**

In `apps/web/src/voice/humanizeSpeech.ts`, append after `humanizeForSpeech`:

```ts
/**
 * Prepare a marked sentence for TTS. When humanization is enabled, delegate to
 * the LLM humanizer; when disabled, skip the network round-trip entirely and
 * just strip markers so text is spoken as-is.
 */
export function prepareForSpeech(sentence: string, humanizeEnabled: boolean): Promise<string> {
  return humanizeEnabled ? humanizeForSpeech(sentence) : Promise.resolve(stripMarkers(sentence));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @t3tools/web test -- humanizeSpeech`
Expected: PASS (both tests green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/voice/humanizeSpeech.ts apps/web/src/voice/humanizeSpeech.test.ts
git commit -m "feat(voice): add prepareForSpeech humanize gate helper"
```

---

### Task 3: Route `VoiceTtsProvider` call sites through the gate

**Files:**

- Modify: `apps/web/src/voice/VoiceTtsProvider.tsx` (import ~line 10; call sites ~93, ~105, ~141)

**Interfaces:**

- Consumes: `prepareForSpeech(sentence, humanizeEnabled)` from Task 2; `speech.humanizeEnabled` from the settings atom already read at line 28-29 (`const speech = settings.speech`), mirrored into `speechRef` at line 41-42.

- [ ] **Step 1: Update the import**

In `apps/web/src/voice/VoiceTtsProvider.tsx`, change line 10 from:

```ts
import { humanizeForSpeech } from "./humanizeSpeech";
```

to:

```ts
import { prepareForSpeech } from "./humanizeSpeech";
```

- [ ] **Step 2: Update the streaming-units call site (~line 93)**

Change:

```ts
humanizeForSpeech(unit).then((humanized) => {
  if (stopEpochRef.current !== epoch) return;
  playback.enqueue(idx, humanized);
});
```

to:

```ts
prepareForSpeech(unit, speechRef.current.humanizeEnabled).then((humanized) => {
  if (stopEpochRef.current !== epoch) return;
  playback.enqueue(idx, humanized);
});
```

- [ ] **Step 3: Update the tail-remainder call site (~line 105)**

Change:

```ts
humanizeForSpeech(tail).then((humanized) => {
  if (stopEpochRef.current !== epoch) return;
  playback.enqueue(idx, humanized);
});
```

to:

```ts
prepareForSpeech(tail, speechRef.current.humanizeEnabled).then((humanized) => {
  if (stopEpochRef.current !== epoch) return;
  playback.enqueue(idx, humanized);
});
```

- [ ] **Step 4: Update the imperative `speak()` call site (~line 141)**

This is inside the `useMemo` at line 122. It reads settings through `speechRef.current` (the memo has an empty dep array, so it must not close over `speech` directly). Change:

```ts
humanizeForSpeech(part).then((humanized) => {
  if (stopEpochRef.current !== speakEpoch) return;
  playback.enqueue(idx, humanized);
});
```

to:

```ts
prepareForSpeech(part, speechRef.current.humanizeEnabled).then((humanized) => {
  if (stopEpochRef.current !== speakEpoch) return;
  playback.enqueue(idx, humanized);
});
```

- [ ] **Step 5: Verify no stale references remain**

Run: `grep -n "humanizeForSpeech" apps/web/src/voice/VoiceTtsProvider.tsx`
Expected: no output (all three call sites now use `prepareForSpeech`, and the import was swapped).

- [ ] **Step 6: Typecheck the web app**

Run: `pnpm --filter @t3tools/web typecheck`
Expected: no errors.

- [ ] **Step 7: Run the voice tests**

Run: `pnpm --filter @t3tools/web test -- voice`
Expected: PASS (existing voice tests + the new `humanizeSpeech` test).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/voice/VoiceTtsProvider.tsx
git commit -m "feat(voice): gate TTS humanize behind humanizeEnabled setting"
```

---

## Notes for the implementer

- Confirm the exact test command syntax for each package before Step 2 of each task — this repo uses `vite-plus`/`vp test`; the plan uses `pnpm --filter <pkg> test -- <pattern>` to filter. If the filter flag differs, run the package's `test` script directly (e.g. `pnpm --filter @t3tools/web test`) and scope by file path.
- Do not touch `apps/server/src/speech/SpeechHumanize.ts` or `speechRoutes.ts` — the server path is intentionally unchanged.
- The settings form renders `humanizeEnabled` automatically from the `providerSettingsForm: { control: "switch" }` annotation plus its presence in the `order` array — no separate UI task is required.
