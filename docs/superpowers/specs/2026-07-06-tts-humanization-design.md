# TTS Humanization — Design Spec

**Date:** 2026-07-06
**Branch:** claude/local-stt-tts-oe0hit

## Problem

The TTS pipeline currently drops file paths silently and speaks inline code tokens verbatim.
This means `useVoiceStore`, `src/components/Foo.tsx`, and `->` either disappear or sound like
noise when read aloud.

## Goal

Make the voice pipeline speak inline code identifiers, arrows, and file names in natural English
without adding perceivable latency to the first audio chunk.

---

## Architecture

Two phases are added to the existing pipeline:

```
stream delta
  → markdownToSpeakable()      [sync, marking phase — speakableText.ts]
  → segmentSpeakable()         [sync, unchanged]
  → humanizeForSpeech()        [async, LLM phase — humanizeSpeech.ts]
  → playback.enqueue()         [TTS synthesis, unchanged]
```

### Phase 1 — Marker Insertion (sync, `speakableText.ts`)

Instead of stripping inline code and dropping paths, replace them with typed markers:

| Input | Output |
|---|---|
| `` `useVoiceStore` `` | `[CODE:useVoiceStore]` |
| `src/components/Foo.tsx` | `[PATH:src/components/Foo.tsx]` |
| `package.json` | `[PATH:package.json]` |
| `->` | `[ARROW:->]` |
| `=>` | `[ARROW:=>]` |
| `<-` | `[ARROW:<-]` |
| `-->` | `[ARROW:-->]` |
| fenced code block | ` ` (dropped, unchanged) |

Markers use square-bracket syntax that is uncommon in prose and unambiguous to the LLM.

**Arrow detection:** Applied after inline-code and fenced-block stripping so that arrows inside
code blocks are already gone before marker insertion.

**Path detection:** Existing `stripPathLike` is replaced by `markPathLike` — same regex,
but instead of returning `" "` it returns `[PATH:…]`.

### Phase 2 — LLM Humanization (async, `humanizeSpeech.ts`)

`humanizeForSpeech(sentence: string): Promise<string>`

- Model: `claude-haiku-4-5-20251001` (fastest, cheapest)
- Called once per sentence unit, after `segmentSpeakable`
- Sentences pipeline: sentence N+1's LLM call starts while sentence N's TTS synthesis runs
- Expected latency to first audio chunk: +200–400 ms vs today

**System prompt (authoritative):**

```
You are a text preprocessor for text-to-speech. Transform the input sentence and return only
the rewritten text — no explanation, no commentary.

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
    Spell source-code-only extensions letter by letter: ts, tsx, jsx, mjs, cjs, py, rs, go,
    rb, kt, cpp, cs, sh, etc. (anything a developer would write, not a user would open)
    Say well-known acronym extensions as their common spoken name: HTML, CSS, JSON, YAML,
    XML, SQL, PDF, SVG, PNG, JPEG, GIF, MP4 — never spell these out
- [ARROW:arrow] — replace with the most natural spoken word given surrounding context:
    -> and => are usually "to"; after ) they may be "returns"
    <-  is usually "from"
    --> is usually "then" or "leading to"
    A neutral pause (comma) is acceptable if no word fits naturally
- Leave all other prose unchanged
```

**Fallback:** If the LLM call fails or times out (>3 s), strip markers with a simple regex
(`[CODE:x]` → x, `[PATH:x]` → "", `[ARROW:x]` → ",") and proceed — never block audio.

### Files Changed

| File | Change |
|---|---|
| `packages/shared/src/speakableText.ts` | Replace `INLINE_CODE` strip + `stripPathLike` drop with marker insertion; add `markArrows` |
| `packages/shared/src/speakableText.test.ts` | Update inline-code and path tests; add marker output tests |
| `apps/web/src/voice/humanizeSpeech.ts` | New — `humanizeForSpeech()` with Anthropic SDK call + fallback |
| `apps/web/src/voice/VoiceTtsProvider.tsx` | Await `humanizeForSpeech(unit)` before `playback.enqueue` |

---

## Edge Cases

- **Markers with no surrounding context** (e.g. a sentence that is only `[CODE:foo]`): LLM still
  expands; fallback keeps the token text.
- **Nested markers** (shouldn't happen given pipeline order, but if they do): LLM handles them
  gracefully; fallback strips all markers.
- **Long inline code** (a token > ~40 chars): LLM may abbreviate — acceptable.
- **Non-ASCII identifiers** (e.g. `café_mode`): spoken as-is by the LLM.
- **AssistantListenButton** (manual "Listen" path): calls the same `speak()` entry point in
  `VoiceTtsProvider`, so it benefits from humanization automatically.

---

## Testing

- Unit tests in `speakableText.test.ts`: verify marker output for inline code, paths, arrows
- Integration smoke test: run the voice pipeline on a canned assistant message containing
  `useVoiceStore`, `src/components/Foo.tsx`, and `a -> b`, confirm spoken output sounds natural
- Fallback test: mock LLM to throw, verify audio still plays (markers stripped)
