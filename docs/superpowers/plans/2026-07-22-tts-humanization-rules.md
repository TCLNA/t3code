# TTS Humanization Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two TTS-humanization rules — drop colon-terminated sentences that only introduce a (removed) code block, and read time/unit tokens like `10s` correctly.

**Architecture:** Rule 1 is a pure change to `markdownToSpeakable` in `packages/shared/src/speakableText.ts`: replace removed fenced blocks with a `[CODEBLOCK]` sentinel, drop a colon-introducer immediately before it, then delete the sentinel — all before the function returns, so nothing downstream sees it. Rule 2 is a single instruction added to the haiku `SYSTEM_PROMPT` in `apps/server/src/speech/SpeechHumanize.ts` (context-aware, no regex).

**Tech Stack:** TypeScript, `vite-plus/test` (`vp test run`), Effect (server).

**Design doc:** `docs/superpowers/specs/2026-07-22-tts-humanization-rules-design.md`

## Global Constraints

- Test import convention in `packages/shared`: `import { ... } from "vite-plus/test";` and relative imports keep the `.ts` extension (e.g. `"./speakableText.ts"`).
- Run shared tests with: `pnpm --filter @t3tools/shared test` (runs `vp test run`).
- The `[CODEBLOCK]` sentinel must be fully created AND removed inside `markdownToSpeakable` — it must never appear in the returned string, reach `segmentSpeakable`, the LLM, or `stripMarkers`.
- Do NOT change `stripMarkers`, `segmentSpeakable`, the client voice code, or the `[CODE]/[PATH]/[ARROW]` markers.
- Rule 1 detection is colon-only: drop the preceding clause ONLY when it ends with `:` immediately before the sentinel.

---

### Task 1: Rule 1 — drop colon-introducer sentences (pure)

**Files:**

- Modify: `packages/shared/src/speakableText.ts` (function `markdownToSpeakable`, lines 76-97)
- Test: `packages/shared/src/speakableText.test.ts` (update 2 existing cases + add 5)

**Interfaces:**

- Consumes: nothing new.
- Produces: no signature change. `markdownToSpeakable(md: string): string` behavior changes: a colon-terminated introducer immediately before a fenced/unterminated code block is removed along with the block.

- [ ] **Step 1: Update the two existing tests that Rule 1 changes, and add the new cases**

In `packages/shared/src/speakableText.test.ts`, REPLACE the existing "drops fenced code blocks" test (currently lines 11-17) and the "drops an unterminated (still streaming) fence" test (currently lines 19-23) with the versions below, and add the five new cases after them:

````ts
it("drops fenced code blocks and their colon-introducer sentence", () => {
  const md = "Here is the fix:\n\n```ts\nconst x = 1;\n```\n\nAll done.";
  const spoken = markdownToSpeakable(md);
  expect(spoken).not.toContain("const x");
  expect(spoken).not.toContain("Here is the fix");
  expect(spoken).not.toContain("[CODEBLOCK]");
  expect(spoken).toContain("All done.");
});

it("drops an unterminated (still streaming) fence and its colon-introducer", () => {
  const md = "Try this:\n```js\nconsole.log('partial";
  const spoken = markdownToSpeakable(md);
  expect(spoken).toBe("");
});

it("drops a colon-terminated sentence that only introduces a code block", () => {
  const md = "A one-liner to check the device:\n\n```py\nx = 1\n```\n\nRun it now.";
  const spoken = markdownToSpeakable(md);
  expect(spoken).not.toContain("check the device");
  expect(spoken).not.toContain("[CODEBLOCK]");
  expect(spoken).toContain("Run it now.");
});

it("keeps a non-colon sentence before a code block", () => {
  const md = "All done.\n\n```py\nx = 1\n```";
  const spoken = markdownToSpeakable(md);
  expect(spoken).toContain("All done.");
  expect(spoken).not.toContain("[CODEBLOCK]");
});

it("drops only the colon-introducer clause, keeping the prior sentence", () => {
  const md = "Here's the setup. Run this:\n\n```sh\nls\n```";
  const spoken = markdownToSpeakable(md);
  expect(spoken).toContain("Here's the setup.");
  expect(spoken).not.toContain("Run this");
  expect(spoken).not.toContain("[CODEBLOCK]");
});

it("does not treat a mid-sentence colon like 3:1 as an introducer", () => {
  const md = "The ratio is 3:1\n\n```txt\ndata\n```";
  const spoken = markdownToSpeakable(md);
  expect(spoken).toContain("The ratio is 3:1");
  expect(spoken).not.toContain("[CODEBLOCK]");
});

it("handles a code block at the very start with nothing to drop", () => {
  const md = "```py\nx = 1\n```\n\nText after.";
  const spoken = markdownToSpeakable(md);
  expect(spoken).toContain("Text after.");
  expect(spoken).not.toContain("x = 1");
  expect(spoken).not.toContain("[CODEBLOCK]");
});
````

- [ ] **Step 2: Run the tests and confirm the new/updated ones FAIL**

Run: `pnpm --filter @t3tools/shared test`
Expected: FAILURES in the seven cases above — e.g. "drops a colon-terminated sentence…" fails because "check the device" is still present, and the unterminated-fence case returns `"Try this:"` not `""`. (Other unrelated tests stay green.)

- [ ] **Step 3: Implement Rule 1 in `markdownToSpeakable`**

In `packages/shared/src/speakableText.ts`, change the two fence-replacement lines (78-79) to emit the sentinel instead of a space:

```ts
text = text.replace(FENCED_CODE_BLOCK, "[CODEBLOCK]");
text = text.replace(UNTERMINATED_FENCE, "[CODEBLOCK]");
```

Then, immediately AFTER the `EMPHASIS_MARKERS` line (currently line 93: `text = text.replace(EMPHASIS_MARKERS, "");`) and BEFORE the whitespace-collapse line, insert:

```ts
// Drop a colon-terminated sentence that only introduces a now-removed code
// block (back to the previous sentence boundary), then remove any remaining
// code-block sentinels. The sentinel never escapes this function.
text = text.replace(/[^.!?\n]*:\s*\[CODEBLOCK\]/g, " ");
text = text.replace(/\[CODEBLOCK\]/g, " ");
```

Leave the existing whitespace-collapse + trim line as-is.

- [ ] **Step 4: Run the tests and confirm all pass**

Run: `pnpm --filter @t3tools/shared test`
Expected: PASS — all seven cases above plus the previously-green suite. If the "3:1" case fails, verify the sentinel regex requires the colon to be the last non-space char before `[CODEBLOCK]`.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @t3tools/shared typecheck`
Expected: no errors (`tsgo --noEmit` clean).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/speakableText.ts packages/shared/src/speakableText.test.ts
git commit -m "feat(voice): drop colon-introducer sentences before code blocks"
```

---

### Task 2: Rule 2 — read time/units in context (LLM prompt)

**Files:**

- Modify: `apps/server/src/speech/SpeechHumanize.ts` (`SYSTEM_PROMPT`, lines 16-35)

**Interfaces:**

- Consumes: nothing. No code-path or signature change; only the prompt string grows one bullet.
- Produces: nothing new.

- [ ] **Step 1: Add the durations/units rule to `SYSTEM_PROMPT`**

In `apps/server/src/speech/SpeechHumanize.ts`, the `SYSTEM_PROMPT` ends with the bullet `- Leave all other prose unchanged`. Insert this new bullet immediately BEFORE that final line:

```
- Durations, times, and units — read as spoken words in context:
    "10s" → "ten seconds", "500ms" → "five hundred milliseconds", "2h" → "two hours", "3x" → "three times", "5GB" → "five gigabytes"
    But leave decade and plural forms alone: "the 90s" → "the nineties", "URLs" → "urls", "IDs" → "eye dees"
```

So the tail of the template literal reads:

```
    A neutral pause (comma) is acceptable if no word fits naturally
- Durations, times, and units — read as spoken words in context:
    "10s" → "ten seconds", "500ms" → "five hundred milliseconds", "2h" → "two hours", "3x" → "three times", "5GB" → "five gigabytes"
    But leave decade and plural forms alone: "the 90s" → "the nineties", "URLs" → "urls", "IDs" → "eye dees"
- Leave all other prose unchanged`;
```

- [ ] **Step 2: Typecheck the server package**

Run: `pnpm --filter @t3tools/server typecheck`
Expected: no NEW errors from this change (the edit is a string literal; it cannot introduce type errors). If the server package has pre-existing unrelated errors, confirm none reference `SpeechHumanize.ts`.

- [ ] **Step 3: Sanity-check the prompt end-to-end (optional, needs `claude` CLI)**

This stage shells out to `claude -p` and is not deterministically unit-testable. If a `claude` CLI is available, spot-check the rule:

```bash
printf '%s' "$(sed -n '16,40p' apps/server/src/speech/SpeechHumanize.ts)" >/dev/null  # (prompt lives here)
echo "The warm start takes about 10s and is 3x faster." | claude -p --output-format text --model claude-haiku-4-5-20251001 --dangerously-skip-permissions
```

Expected (roughly): "…about ten seconds and is three times faster." Exact wording will vary — this is a smell test, not an assertion. Skip if no CLI.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/speech/SpeechHumanize.ts
git commit -m "feat(voice): humanize time/unit tokens in TTS prompt"
```

---

## Self-Review

**Spec coverage:**

- Rule 1 sentinel + colon-introducer drop → Task 1 Steps 3. ✅
- Rule 1 behavior table (colon dropped, non-colon kept, mid-paragraph, 3:1, block-at-start) → Task 1 Step 1 cases. ✅
- Rule 1 "existing test changes" → Task 1 Step 1 updates BOTH affected tests (fenced + unterminated). ✅ (spec named one; the unterminated case is also colon-introduced — caught here.)
- Sentinel never escapes → asserted via `.not.toContain("[CODEBLOCK]")` in every Rule 1 case. ✅
- Rule 2 SYSTEM_PROMPT instruction, context-aware, decades/plurals excluded → Task 2 Step 1. ✅
- Rule 2 not unit-testable → Task 2 Step 3 is an optional smell test, not an assertion. ✅
- Out of scope (stripMarkers/segment/client/markers untouched) → no task modifies them. ✅

**Placeholder scan:** none — all steps carry literal code and exact commands.

**Type consistency:** No new symbols. `markdownToSpeakable` signature unchanged; `[CODEBLOCK]` is a literal used identically in the emit lines and both removal regexes.
