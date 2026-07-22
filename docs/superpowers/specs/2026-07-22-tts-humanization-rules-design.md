# TTS humanization: two new rules — design

Date: 2026-07-22
Status: approved (brainstorm), pending implementation plan

## Goal

Fix two gaps in the TTS text-humanization pipeline the user found while
listening to Chatterbox narration:

1. A sentence that exists only to introduce a code block is still spoken, even
   though the code block itself is dropped — leaving a dangling "…to check the
   device:" with nothing after it.
2. Time/unit tokens like `10s` are read wrong (e.g. "tens" instead of "ten
   seconds").

## Background: the pipeline (unchanged by this work)

`packages/shared/src/speakableText.ts` — pure, dependency-free, unit-tested
(`speakableText.test.ts`, framework `vite-plus/test`):

- `markdownToSpeakable(md)` strips/marks markdown, inserting `[CODE:…]`,
  `[PATH:…]`, `[ARROW:…]` markers. **Fenced code blocks are currently replaced
  with a single space** (lines ~78-79), leaving no trace.
- `segmentSpeakable(text)` splits into sentence units.

Then, client-side (`apps/web/src/voice/`), each sentence is sent to the
server LLM stage `apps/server/src/speech/SpeechHumanize.ts` (`claude -p`,
`claude-haiku-4-5-20251001`, 3s timeout) whose `SYSTEM_PROMPT` expands the
markers into spoken English. On any failure it falls back to
`stripMarkers()` (pure).

## Rule 1 — drop colon-introducer sentences (pure stage)

**Where:** `packages/shared/src/speakableText.ts`, inside `markdownToSpeakable`.
No other file changes.

**Decision:** drop the sentence immediately preceding a removed code block
**only when it ends with a colon** (`:`). Colon is the reliable "this only
introduces what follows" signal; a non-colon sentence (e.g. "All done.") is
kept.

**Mechanism:**

1. Replace fenced blocks — both `FENCED_CODE_BLOCK` and `UNTERMINATED_FENCE`
   (streaming) — with the sentinel `[CODEBLOCK]` instead of `" "`.
2. After the existing transforms, run one pass:
   `text.replace(/[^.!?\n]*:\s*\[CODEBLOCK\]/g, " ")` — removes the run back to
   the previous sentence boundary that ends in `:`, together with the sentinel.
3. Remove any remaining sentinels (blocks with no colon-introducer):
   `text.replace(/\[CODEBLOCK\]/g, " ")`.
4. Existing final whitespace-collapse + trim then applies.

**Ordering:** the sentinel is inserted at the fence-stripping step (before the
other regex transforms) and fully consumed by steps 2-3 before
`markdownToSpeakable` returns. No later transform matches `[CODEBLOCK]`
(`markArrows` only skips `[CODE|PATH:…]`; emphasis/heading/etc. don't touch
it). The sentinel therefore **never reaches** `segmentSpeakable`, the LLM
`SYSTEM_PROMPT`, or `stripMarkers` — those stay untouched.

**Behavior table (all verified by tests):**

| Input (before a fenced block)                       | Result                                          |
| --------------------------------------------------- | ----------------------------------------------- |
| `A one-liner to check the device:`                  | dropped                                         |
| `Here's the setup. Run this:`                       | keeps "Here's the setup.", drops "Run this:"    |
| `The ratio is 3:1`                                  | kept (colon isn't the char before the sentinel) |
| `All done.`                                         | kept (no colon)                                 |
| code block at start of text (no preceding sentence) | sentinel removed, nothing dropped               |

**Existing test that changes:** `speakableText.test.ts` currently asserts
"Here is the fix:" survives a following code block. Under Rule 1 it is dropped
(it ends with `:`), so that assertion is updated to expect it absent while
"All done." (the sentence after the block) remains.

## Rule 2 — read units in context (LLM stage)

**Where:** `apps/server/src/speech/SpeechHumanize.ts`, `SYSTEM_PROMPT` only. No
pure-stage code, no new marker, no `stripMarkers` change.

**Decision:** add one instruction telling the model to read durations/units as
spoken words **in context**, and to leave decade/plural forms alone:

- `10s` → "ten seconds", `500ms` → "five hundred milliseconds",
  `2h` → "two hours", `3x` → "three times".
- `the 90s` → "the nineties", `URLs` → "urls" (unchanged plurals/decades).

**Rationale:** these tokens already pass through the LLM untouched, and
context-sensitive number/unit reading is exactly what the LLM does well and a
regex does badly (decades, plurals). The rare LLM-fallback path
(`stripMarkers`) stays literal — acceptable degradation.

**Testing:** the LLM stage shells out to `claude -p`, so it is not
deterministically unit-testable. Verified by listening in-app. Trivially
reverted (one prompt line).

## Files touched

- `packages/shared/src/speakableText.ts` — Rule 1 (sentinel + introducer pass).
- `packages/shared/src/speakableText.test.ts` — update the one existing case +
  add Rule 1 cases.
- `apps/server/src/speech/SpeechHumanize.ts` — Rule 2 (`SYSTEM_PROMPT` line).

## Out of scope

- Any change to `stripMarkers`, `segmentSpeakable`, the client voice code, or
  the `[CODE]/[PATH]/[ARROW]` markers.
- A deterministic regex for units (explicitly rejected in favor of the LLM
  rule).
- Non-colon introducer detection.
