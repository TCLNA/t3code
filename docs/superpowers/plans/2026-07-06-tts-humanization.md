# TTS Humanization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the voice pipeline speak inline code identifiers, arrows, and file paths as natural English instead of dropping or mispronouncing them.

**Architecture:** `markdownToSpeakable` is changed from a stripper to a marker inserter — inline code, paths, and arrows are tagged `[CODE:…]`, `[PATH:…]`, `[ARROW:…]`. A new server endpoint (`POST /api/tts/humanize`) spawns `claude -p` to expand those markers per sentence. The web client (`humanizeForSpeech`) calls that endpoint with a 3 s timeout and falls back to `stripMarkers()` on any failure, so audio is never blocked.

**Tech Stack:** TypeScript, Effect (server), React (web), claude CLI (`claude -p`), existing `voiceFetch` / `ProcessRunner` / `HttpRouter` patterns.

## Global Constraints

- Model for humanization: `claude-haiku-4-5-20251001`
- Client-side fallback: `stripMarkers(sentence)` — never throw, never block audio
- Server-side timeout: `"3 seconds"` via `ProcessRunner` `timeoutBehavior: "timedOutResult"`
- No new npm packages; reuse existing `ProcessRunner`, `voiceFetch`, `HttpRouter` patterns
- All new server service files go under `apps/server/src/speech/`
- All new web voice files go under `apps/web/src/voice/`

---

### Task 1: Update `speakableText.ts` — replace strips with markers, export `stripMarkers`

**Files:**
- Modify: `packages/shared/src/speakableText.ts`

**Interfaces:**
- Produces: `markdownToSpeakable(markdown: string): string` (output now contains `[CODE:…]`, `[PATH:…]`, `[ARROW:…]` markers instead of stripped/dropped tokens)
- Produces: `stripMarkers(text: string): string` (exported fallback)

- [ ] **Step 1: Remove `stripPathLike`, add `markPathLike`, `markArrows`, `stripMarkers`**

Replace the `stripPathLike` function and add the new helpers. The arrow regex uses the "match what to skip first" alternation trick so existing markers are never double-marked.

In `packages/shared/src/speakableText.ts`, replace the block from `function stripPathLike` through its closing `}`:

```typescript
function markPathLike(text: string): string {
  return text.replace(PATH_LIKE, (match) => {
    if (match.includes("/")) return `[PATH:${match}]`;
    const dot = match.lastIndexOf(".");
    if (dot === -1) return match;
    const ext = match.slice(dot + 1).split(":")[0]?.toLowerCase() ?? "";
    return COMMON_FILE_EXTENSIONS.has(ext) ? `[PATH:${match}]` : match;
  });
}

function markArrows(text: string): string {
  // Match existing markers first (keep them), then arrow tokens (mark them).
  return text.replace(/\[(?:CODE|PATH):[^\]]*\]|-->|->|=>|<-/g, (match) =>
    match.startsWith("[") ? match : `[ARROW:${match}]`,
  );
}

/** Strip markers to plain text — used as a fallback when LLM humanization fails. */
export function stripMarkers(text: string): string {
  return text
    .replace(/\[CODE:([^\]]*)\]/g, "$1")
    .replace(/\[PATH:[^\]]*\]/g, "")
    .replace(/\[ARROW:[^\]]*\]/g, ",");
}
```

- [ ] **Step 2: Update `markdownToSpeakable` — inline code → `[CODE:…]`, path → `markPathLike`, add `markArrows`**

In `markdownToSpeakable`, change two lines and add one:

```typescript
// Change:
  text = text.replace(INLINE_CODE, "$1");
// To:
  text = text.replace(INLINE_CODE, "[CODE:$1]");
```

```typescript
// Change:
  text = stripPathLike(text);
// To:
  text = markPathLike(text);
  text = markArrows(text);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/thomas/Lab/t3code
bun run --cwd packages/shared typecheck 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/speakableText.ts
git commit -m "feat(voice): replace speakableText strips with [CODE/PATH/ARROW] markers"
```

---

### Task 2: Update `speakableText.test.ts` — fix broken tests, add marker coverage

**Files:**
- Modify: `packages/shared/src/speakableText.test.ts`

**Interfaces:**
- Consumes: `markdownToSpeakable`, `stripMarkers` from `./speakableText.ts`

- [ ] **Step 1: Run tests to see which ones break**

```bash
cd /home/thomas/Lab/t3code
bun run --cwd packages/shared test 2>&1 | tail -30
```

Expected: the "speaks inline code" and "drops file paths" tests will fail.

- [ ] **Step 2: Fix the two broken tests**

Update `"speaks inline code content but drops the backticks"`:

```typescript
it("marks inline code with [CODE:…] and removes backticks", () => {
  const spoken = markdownToSpeakable("Call the `useVoiceStore` hook now.");
  expect(spoken).toContain("[CODE:useVoiceStore]");
  expect(spoken).not.toContain("`");
  expect(spoken).toContain("Call the");
  expect(spoken).toContain("hook now.");
});
```

Update `"drops file paths"`:

```typescript
it("marks file paths with [PATH:…] instead of dropping them", () => {
  const spoken = markdownToSpeakable("Edit src/index.ts and package.json please.");
  expect(spoken).toContain("[PATH:src/index.ts]");
  expect(spoken).toContain("[PATH:package.json]");
  expect(spoken).toContain("Edit");
  expect(spoken).toContain("please.");
});
```

- [ ] **Step 3: Add new tests for arrows and `stripMarkers`**

Append to the `markdownToSpeakable` describe block:

```typescript
it("marks prose arrows with [ARROW:…]", () => {
  const spoken = markdownToSpeakable("State goes from false -> true on submit.");
  expect(spoken).toContain("[ARROW:->]");
  expect(spoken).not.toContain("->");
});

it("marks => arrows", () => {
  const spoken = markdownToSpeakable("Each item => its processed form.");
  expect(spoken).toContain("[ARROW:=>]");
});

it("marks --> arrows", () => {
  const spoken = markdownToSpeakable("Step A --> Step B.");
  expect(spoken).toContain("[ARROW:-->]");
});

it("embeds arrows inside CODE markers when in inline code", () => {
  const spoken = markdownToSpeakable("The `false -> true` transition.");
  // Arrow inside inline code ends up inside the CODE marker
  expect(spoken).toContain("[CODE:false [ARROW:->] true]");
});

it("does not double-mark arrows already inside a CODE marker", () => {
  const spoken = markdownToSpeakable("Use `a -> b` pattern.");
  const arrowCount = (spoken.match(/\[ARROW:/g) ?? []).length;
  expect(arrowCount).toBe(1); // only one arrow marker total
});
```

Add a new `describe("stripMarkers", ...)` block:

```typescript
describe("stripMarkers", () => {
  it("expands CODE markers back to their inner text", () => {
    expect(stripMarkers("[CODE:useVoiceStore]")).toBe("useVoiceStore");
  });

  it("removes PATH markers entirely", () => {
    expect(stripMarkers("[PATH:src/components/Foo.tsx]")).toBe("");
  });

  it("replaces ARROW markers with a comma", () => {
    expect(stripMarkers("[ARROW:->]")).toBe(",");
  });

  it("handles mixed marker sentence", () => {
    const result = stripMarkers("Update [CODE:useVoiceStore] so [PATH:foo.ts] returns [ARROW:->] value.");
    expect(result).toBe("Update useVoiceStore so  returns , value.");
  });
});
```

- [ ] **Step 4: Run tests — all must pass**

```bash
bun run --cwd packages/shared test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/speakableText.test.ts
git commit -m "test(voice): update speakableText tests for marker output, add stripMarkers tests"
```

---

### Task 3: Add contracts for the humanize endpoint

**Files:**
- Modify: `packages/contracts/src/speech.ts`

**Interfaces:**
- Produces: `SpeechHumanizeRequest` (Schema + type), `SpeechHumanizeResult` (Schema + type) — already re-exported via `packages/contracts/src/index.ts` which does `export * from "./speech.ts"`

- [ ] **Step 1: Add schemas to `speech.ts`**

Append to `packages/contracts/src/speech.ts` after the `TextToSpeechError` class:

```typescript
// ── Speech humanization ────────────────────────────────────────

/**
 * Request body for `POST /api/tts/humanize`. One sentence-sized unit containing
 * [CODE:…], [PATH:…], [ARROW:…] markers; response is `{ humanized: string }`.
 */
export const SpeechHumanizeRequest = Schema.Struct({
  sentence: TrimmedNonEmptyString,
});
export type SpeechHumanizeRequest = typeof SpeechHumanizeRequest.Type;

export const SpeechHumanizeResult = Schema.Struct({
  humanized: Schema.String,
});
export type SpeechHumanizeResult = typeof SpeechHumanizeResult.Type;
```

- [ ] **Step 2: Typecheck contracts**

```bash
bun run --cwd packages/contracts typecheck 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/speech.ts
git commit -m "feat(voice): add SpeechHumanizeRequest/Result contracts"
```

---

### Task 4: Create `SpeechHumanize` Effect service

**Files:**
- Create: `apps/server/src/speech/SpeechHumanize.ts`

**Interfaces:**
- Consumes: `ProcessRunner` from `../processRunner.ts`
- Produces: `SpeechHumanize` (Effect Context.Service), `SpeechHumanize.layer` (Effect Layer)
  - `humanize(sentence: string): Effect.Effect<string, never>` — never fails; degrades to original sentence on error/timeout

- [ ] **Step 1: Write `SpeechHumanize.ts`**

Create `apps/server/src/speech/SpeechHumanize.ts`:

```typescript
/**
 * SpeechHumanize – LLM-based TTS text humanization via the Claude CLI.
 *
 * Expands [CODE:…], [PATH:…], and [ARROW:…] markers into natural spoken English
 * by delegating to `claude -p`. Returns the original sentence unchanged on any
 * failure (timeout, non-zero exit, spawn error) so audio is never blocked.
 *
 * @module SpeechHumanize
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProcessRunner } from "../processRunner.ts";

const SYSTEM_PROMPT = `You are a text preprocessor for text-to-speech. Transform the input sentence and return only the rewritten text — no explanation, no commentary.

Rules:
- [CODE:token] — expand into spoken English words:
    camelCase → space-separated words ("useVoiceStore" → "use voice store")
    snake_case → space-separated words ("my_fn" → "my fn")
    SCREAMING_CASE → lowercase words ("MAX_RETRY" → "max retry")
    PascalCase → space-separated words ("ChatComposer" → "chat composer");
    leading all-caps acronym segments stay as letters ("TtsPlayback" → "tee tee ess playback")
- [PATH:path] — speak naturally:
    Include 1–2 meaningful path segments if they add context (drop leading src/, apps/, packages/)
    Speak the file stem naturally (camelCase rules apply)
    Spell source-code-only extensions letter by letter: ts, tsx, jsx, mjs, cjs, py, rs, go, rb, kt, cpp, cs, sh, etc.
    Say well-known acronym extensions as their common spoken name: HTML, CSS, JSON, YAML, XML, SQL, PDF, SVG, PNG, JPEG, GIF, MP4 — never spell these out
- [ARROW:arrow] — replace with the most natural spoken word given surrounding context:
    -> and => are usually "to"; after ) they may be "returns"
    <- is usually "from"
    --> is usually "then" or "leading to"
    A neutral pause (comma) is acceptable if no word fits naturally
- Leave all other prose unchanged`;

export class SpeechHumanize extends Context.Service<
  SpeechHumanize,
  {
    readonly humanize: (sentence: string) => Effect.Effect<string, never>;
  }
>()("t3/speech/SpeechHumanize") {}

export const make = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner;

  const humanize: SpeechHumanize["Service"]["humanize"] = (sentence) =>
    Effect.gen(function* () {
      const prompt = `${SYSTEM_PROMPT}\n\nSentence to transform:\n${sentence}`;
      const result = yield* processRunner.run({
        command: "claude",
        args: [
          "-p",
          "--output-format",
          "text",
          "--model",
          "claude-haiku-4-5-20251001",
          "--dangerously-skip-permissions",
        ],
        stdin: prompt,
        timeout: "3 seconds",
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: 10 * 1024,
      });
      if (result.timedOut || result.code !== 0) return sentence;
      const out = result.stdout.trim();
      return out.length > 0 ? out : sentence;
    }).pipe(Effect.orElseSucceed(() => sentence));

  return SpeechHumanize.of({ humanize });
});

export const layer = Layer.effect(SpeechHumanize, make);
```

- [ ] **Step 2: Typecheck server**

```bash
bun run --cwd apps/server typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/speech/SpeechHumanize.ts
git commit -m "feat(voice): add SpeechHumanize Effect service (claude -p humanization)"
```

---

### Task 5: Add `POST /api/tts/humanize` route and wire the service

**Files:**
- Modify: `apps/server/src/speech/speechRoutes.ts`
- Modify: `apps/server/src/server.ts`

**Interfaces:**
- Consumes: `SpeechHumanize` service from `./SpeechHumanize.ts`, `SpeechHumanizeRequest` from `@t3tools/contracts`
- Produces: route at `POST /api/tts/humanize` → `{ humanized: string }`

- [ ] **Step 1: Add the new route to `speechRoutes.ts`**

At the top of `apps/server/src/speech/speechRoutes.ts`, add to the imports:

```typescript
import { AuthOrchestrationOperateScope, TextToSpeechRequest, SpeechHumanizeRequest } from "@t3tools/contracts";
```

```typescript
import { SpeechToText } from "./SpeechToText.ts";
import { TextToSpeech } from "./TextToSpeech.ts";
import { SpeechHumanize } from "./SpeechHumanize.ts";
```

Add the constant and route after `ttsRouteLayer`:

```typescript
const HUMANIZE_PATH = "/api/tts/humanize";

const decodeSpeechHumanizeRequest = Schema.decodeUnknownEffect(SpeechHumanizeRequest);

export const humanizeRouteLayer = HttpRouter.add(
  "POST",
  HUMANIZE_PATH,
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const speechHumanize = yield* SpeechHumanize;

    const json = yield* request.json.pipe(Effect.orElseSucceed(() => null));
    const decoded = yield* decodeSpeechHumanizeRequest(json).pipe(Effect.option);
    if (Option.isNone(decoded)) {
      return HttpServerResponse.text("Invalid request body.", { status: 400 });
    }

    const humanized = yield* speechHumanize.humanize(decoded.value.sentence);
    return HttpServerResponse.jsonUnsafe({ humanized }, { status: 200 });
  }).pipe(Effect.catchTags(authErrorHandlers)),
);
```

- [ ] **Step 2: Wire `humanizeRouteLayer` and `SpeechHumanize.layer` into `server.ts`**

In `apps/server/src/server.ts`, update the imports (lines 17–19):

```typescript
import { sttRouteLayer, ttsRouteLayer, humanizeRouteLayer } from "./speech/speechRoutes.ts";
import * as SpeechToText from "./speech/SpeechToText.ts";
import * as TextToSpeech from "./speech/TextToSpeech.ts";
import * as SpeechHumanize from "./speech/SpeechHumanize.ts";
```

Update `SpeechLayerLive` (line 249):

```typescript
const SpeechLayerLive = Layer.mergeAll(SpeechToText.layer, TextToSpeech.layer, SpeechHumanize.layer).pipe(
  Layer.provide(ProcessRunner.layer),
);
```

Add `humanizeRouteLayer` wherever `sttRouteLayer` and `ttsRouteLayer` are composed into the HTTP router. Search for `sttRouteLayer` and add `humanizeRouteLayer` alongside it.

- [ ] **Step 3: Typecheck server**

```bash
bun run --cwd apps/server typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/speech/speechRoutes.ts apps/server/src/server.ts
git commit -m "feat(voice): add POST /api/tts/humanize route, wire SpeechHumanize layer"
```

---

### Task 6: Create `humanizeSpeech.ts` web client

**Files:**
- Create: `apps/web/src/voice/humanizeSpeech.ts`

**Interfaces:**
- Consumes: `stripMarkers` from `@t3tools/shared/speakableText`, `voiceFetch` from `./voiceHttp`
- Produces: `humanizeForSpeech(sentence: string): Promise<string>` — always resolves, never rejects

- [ ] **Step 1: Write `humanizeSpeech.ts`**

Create `apps/web/src/voice/humanizeSpeech.ts`:

```typescript
import { stripMarkers } from "@t3tools/shared/speakableText";

import { voiceFetch } from "./voiceHttp";

/**
 * Send a marked sentence to the server LLM humanizer and return the spoken form.
 * Falls back to `stripMarkers()` on any failure (network error, timeout, bad
 * response) so audio is never blocked.
 */
export async function humanizeForSpeech(sentence: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await voiceFetch("/api/tts/humanize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sentence }),
      signal: controller.signal,
    });
    if (!response.ok) return stripMarkers(sentence);
    const data = (await response.json()) as { humanized?: string };
    return typeof data.humanized === "string" && data.humanized.length > 0
      ? data.humanized
      : stripMarkers(sentence);
  } catch {
    return stripMarkers(sentence);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Typecheck web**

```bash
bun run --cwd apps/web typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/voice/humanizeSpeech.ts
git commit -m "feat(voice): add humanizeForSpeech client (3s timeout, stripMarkers fallback)"
```

---

### Task 7: Wire `humanizeForSpeech` into `VoiceTtsProvider.tsx`

**Files:**
- Modify: `apps/web/src/voice/VoiceTtsProvider.tsx`

**Interfaces:**
- Consumes: `humanizeForSpeech` from `./humanizeSpeech`
- The key insight: call `playback.nextIndex()` eagerly (reserves the slot and determines play order), then `humanizeForSpeech` fires async, and calls `playback.enqueue(idx, humanized)` when done. Units play in index order regardless of which LLM call finishes first.

- [ ] **Step 1: Add import**

At the top of `apps/web/src/voice/VoiceTtsProvider.tsx`, add:

```typescript
import { humanizeForSpeech } from "./humanizeSpeech";
```

- [ ] **Step 2: Update the streaming auto-narration path**

In the `useEffect` that processes streaming messages, replace the sentence enqueue loop and tail handling:

```typescript
// Before:
for (let i = tracker.spokenCount; i < units.length; i += 1) {
  playback.enqueue(playback.nextIndex(), units[i]!);
}
tracker.spokenCount = units.length;

if (!assistant.streaming) {
  const tail = remainder.trim();
  if (tail.length > 0) playback.enqueue(playback.nextIndex(), tail);
  tracker.done = true;
}

// After:
for (let i = tracker.spokenCount; i < units.length; i += 1) {
  const unit = units[i]!;
  const idx = playback.nextIndex();
  humanizeForSpeech(unit).then((humanized) => {
    playback.enqueue(idx, humanized);
  });
}
tracker.spokenCount = units.length;

if (!assistant.streaming) {
  const tail = remainder.trim();
  if (tail.length > 0) {
    const idx = playback.nextIndex();
    humanizeForSpeech(tail).then((humanized) => {
      playback.enqueue(idx, humanized);
    });
  }
  tracker.done = true;
}
```

- [ ] **Step 3: Update the manual `speak()` path**

In the `value` useMemo, replace the enqueue loop inside `speak`:

```typescript
// Before:
playback.stop();
for (const part of parts) playback.enqueue(playback.nextIndex(), part);

// After:
playback.stop();
for (const part of parts) {
  const idx = playback.nextIndex();
  humanizeForSpeech(part).then((humanized) => {
    playback.enqueue(idx, humanized);
  });
}
```

- [ ] **Step 4: Typecheck web**

```bash
bun run --cwd apps/web typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 5: Run web tests**

```bash
bun run --cwd apps/web test 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/voice/VoiceTtsProvider.tsx
git commit -m "feat(voice): thread humanizeForSpeech into TTS pipeline (auto-narrate + manual speak)"
```

---

## Verification

After all tasks complete, manually test by opening the app, sending a message that includes:
1. Inline code: `` `useVoiceStore` `` — should be spoken as "use voice store"
2. A file path: `src/components/Foo.tsx` — should be spoken as "the foo component dot t s x" (or similar)
3. An arrow: `state goes false -> true` — should be spoken as "state goes false to true"
4. Fallback: kill the server's claude CLI (e.g., `which claude` then temporarily rename) — audio should still play with marker-stripped text
