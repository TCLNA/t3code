# Persist Markdown Preview View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `.md`/`.mdx` source-vs-rendered choice in the file preview panel persist across file opens and reloads via a global localStorage preference.

**Architecture:** Extract the render decision into a pure, unit-tested helper in `filePreviewMode.ts`. Replace `FilePreviewPanel`'s per-file `markdownView` state with a persisted global boolean (`preferRendered`) plus a `renderedRevealId` that preserves today's "line-reveal shows source" behavior. The toggle writes the preference to localStorage.

**Tech Stack:** React, TypeScript, Effect `Schema`, `vite-plus/test` (vitest-compatible), existing `getLocalStorageItem`/`setLocalStorageItem` helpers.

> **Post-implementation correction:** The task code below uses a bare
> `renderedRevealId: number | null` acknowledgement. Review caught that
> `revealRequestId` is only unique _within_ a single file's path, so a bare
> number collides across files (the panel's state persists across file
> switches). The shipped code (commit `fix(web): scope markdown reveal
acknowledgement per file`) scopes it per-file as
> `renderedReveal: { path: string; requestId: number } | null`, adds
> `relativePath` to `resolveMarkdownRender`, guards the localStorage write in
> try/catch, and adds a cross-file-collision regression test. See the updated
> design doc for the corrected shapes; `filePreviewMode.ts` is the source of
> truth.

## Global Constraints

- No new dependencies.
- Storage key: `t3code.markdownRenderView`, encoded with `Schema.Boolean` (mirrors `FILE_EXPLORER_STORAGE_KEY = "t3code.fileExplorerOpen"`).
- Default when unset: `false` (source view) — matches current behavior.
- No new UI; the existing 👁/`Code2` `Toggle` drives the preference.
- Only `apps/web/src/components/files/filePreviewMode.ts`, its new test file, and `apps/web/src/components/files/FilePreviewPanel.tsx` change.
- Tests run with `pnpm --filter @t3tools/web test` (script: `vp test run --passWithNoTests --project unit`). Import test APIs from `vite-plus/test`.

---

## File Structure

- `apps/web/src/components/files/filePreviewMode.ts` — MODIFY: add `MARKDOWN_VIEW_STORAGE_KEY` constant and `resolveMarkdownRender` pure function. Already exports `isMarkdownPreviewFile` / `setMarkdownTaskChecked`.
- `apps/web/src/components/files/filePreviewMode.test.ts` — CREATE: truth-table unit tests for `resolveMarkdownRender`.
- `apps/web/src/components/files/FilePreviewPanel.tsx` — MODIFY: swap `markdownView` state for `preferRendered` + `renderedRevealId`; update derivation and toggle handler.

---

## Task 1: Pure render-decision helper + storage key

**Files:**

- Modify: `apps/web/src/components/files/filePreviewMode.ts`
- Test: `apps/web/src/components/files/filePreviewMode.test.ts` (create)

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `MARKDOWN_VIEW_STORAGE_KEY: string` = `"t3code.markdownRenderView"`.
  - `resolveMarkdownRender(input: { isMarkdown: boolean; preferRendered: boolean; revealLine: number | null; revealRequestId: number; renderedRevealId: number | null }): boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/files/filePreviewMode.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { resolveMarkdownRender } from "./filePreviewMode";

const base = {
  isMarkdown: true,
  preferRendered: true,
  revealLine: null as number | null,
  revealRequestId: 1,
  renderedRevealId: null as number | null,
};

describe("resolveMarkdownRender", () => {
  it("is false for non-markdown files even when rendered is preferred", () => {
    expect(resolveMarkdownRender({ ...base, isMarkdown: false })).toBe(false);
  });

  it("is false when source is preferred", () => {
    expect(resolveMarkdownRender({ ...base, preferRendered: false })).toBe(false);
  });

  it("renders when markdown + preferred and no line reveal", () => {
    expect(resolveMarkdownRender({ ...base, revealLine: null })).toBe(true);
  });

  it("shows source during a line reveal that has not been acknowledged", () => {
    expect(
      resolveMarkdownRender({ ...base, revealLine: 42, revealRequestId: 5, renderedRevealId: 4 }),
    ).toBe(false);
  });

  it("renders during a line reveal the user switched to rendered", () => {
    expect(
      resolveMarkdownRender({ ...base, revealLine: 42, revealRequestId: 5, renderedRevealId: 5 }),
    ).toBe(true);
  });

  it("stays source during a line reveal when source is preferred", () => {
    expect(
      resolveMarkdownRender({
        ...base,
        preferRendered: false,
        revealLine: 42,
        revealRequestId: 5,
        renderedRevealId: 5,
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @t3tools/web test filePreviewMode`
Expected: FAIL — `resolveMarkdownRender` is not exported / not a function.

- [ ] **Step 3: Write minimal implementation**

Add to the top of `apps/web/src/components/files/filePreviewMode.ts` (after the existing `isMarkdownPreviewFile` line):

```ts
export const MARKDOWN_VIEW_STORAGE_KEY = "t3code.markdownRenderView";

export function resolveMarkdownRender(input: {
  isMarkdown: boolean;
  preferRendered: boolean;
  revealLine: number | null;
  revealRequestId: number;
  renderedRevealId: number | null;
}): boolean {
  const { isMarkdown, preferRendered, revealLine, revealRequestId, renderedRevealId } = input;
  if (!isMarkdown || !preferRendered) return false;
  // A line-reveal navigation shows source so the target line is visible,
  // until the user explicitly switches this reveal request to rendered.
  return revealLine === null || renderedRevealId === revealRequestId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @t3tools/web test filePreviewMode`
Expected: PASS — all 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/files/filePreviewMode.ts apps/web/src/components/files/filePreviewMode.test.ts
git commit -m "feat(web): add resolveMarkdownRender helper + storage key"
```

---

## Task 2: Wire persisted preference into FilePreviewPanel

**Files:**

- Modify: `apps/web/src/components/files/FilePreviewPanel.tsx`

**Interfaces:**

- Consumes: `MARKDOWN_VIEW_STORAGE_KEY`, `resolveMarkdownRender` from Task 1; existing `getLocalStorageItem` / `setLocalStorageItem` (imported at `:25`), `Schema` (already imported), `isMarkdown` (computed at `:680`), props `revealLine` / `revealRequestId`.
- Produces: persisted `renderMarkdown` behavior. No new exports.

This task has no unit test (it's React wiring); it is verified by the Task 1 unit tests plus the manual checklist at the end. It is a single reviewable deliverable: the panel now honors the persisted preference.

- [ ] **Step 1: Extend the helper import**

At `apps/web/src/components/files/FilePreviewPanel.tsx`, find the existing import of `isMarkdownPreviewFile` from `./filePreviewMode` and add the two new names. It currently reads (around the top imports):

```ts
import { isMarkdownPreviewFile, setMarkdownTaskChecked } from "./filePreviewMode";
```

Change it to:

```ts
import {
  isMarkdownPreviewFile,
  MARKDOWN_VIEW_STORAGE_KEY,
  resolveMarkdownRender,
  setMarkdownTaskChecked,
} from "./filePreviewMode";
```

(If the existing import list differs, keep its current members and add `MARKDOWN_VIEW_STORAGE_KEY` and `resolveMarkdownRender`.)

- [ ] **Step 2: Replace the `markdownView` state (`:675`)**

Find:

```ts
const [markdownView, setMarkdownView] = useState<{
  path: string | null;
  revealRequestId: number | null;
}>({ path: null, revealRequestId: null });
```

Replace with:

```ts
const [preferRendered, setPreferRendered] = useState(
  () => getLocalStorageItem(MARKDOWN_VIEW_STORAGE_KEY, Schema.Boolean) ?? false,
);
// A line-reveal request the user has explicitly switched to rendered, so
// navigating to a specific line still defaults to source view.
const [renderedRevealId, setRenderedRevealId] = useState<number | null>(null);
```

- [ ] **Step 3: Replace the `renderMarkdown` derivation (`:681`)**

Find:

```ts
const renderMarkdown =
  isMarkdown &&
  markdownView.path === relativePath &&
  (revealLine === null || markdownView.revealRequestId === revealRequestId);
```

Replace with:

```ts
const renderMarkdown = resolveMarkdownRender({
  isMarkdown,
  preferRendered,
  revealLine,
  revealRequestId,
  renderedRevealId,
});
```

- [ ] **Step 4: Update the toggle handler (`:790`)**

Find:

```ts
                    onPressedChange={(pressed) => {
                      setMarkdownView({
                        path: pressed ? relativePath : null,
                        revealRequestId: pressed ? revealRequestId : null,
                      });
                    }}
```

Replace with:

```ts
                    onPressedChange={(pressed) => {
                      setPreferRendered(pressed);
                      setLocalStorageItem(MARKDOWN_VIEW_STORAGE_KEY, pressed, Schema.Boolean);
                      setRenderedRevealId(pressed ? revealRequestId : null);
                    }}
```

- [ ] **Step 5: Verify no stale references remain**

Run: `grep -n "markdownView\|setMarkdownView" apps/web/src/components/files/FilePreviewPanel.tsx`
Expected: no matches (all references removed).

- [ ] **Step 6: Typecheck + tests**

Run: `pnpm --filter @t3tools/web test filePreviewMode`
Expected: PASS (helper tests still green).

Run: `pnpm --filter @t3tools/web exec tsc --noEmit` (or the repo's typecheck script if different)
Expected: no new type errors in `FilePreviewPanel.tsx`.

- [ ] **Step 7: Manual verification**

Start the app (test-t3-app skill or existing dev server). Then:

- Open a `.md` file, toggle to rendered (👁). Open a _different_ `.md` → it opens **rendered**.
- Toggle back to source (`</>`). Open a _different_ `.md` → it opens **source**.
- Reload the app → the last choice still applies on the next `.md` open.
- Click a `file://…#L<n>` link into a `.md` while preference is rendered → shows **source** scrolled to the line; clicking 👁 flips it to rendered.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/files/FilePreviewPanel.tsx
git commit -m "feat(web): persist markdown source/rendered preview choice"
```

---

## Self-Review

**Spec coverage:**

- Global boolean pref stored under `t3code.markdownRenderView` → Task 1 (`MARKDOWN_VIEW_STORAGE_KEY`) + Task 2 Step 2/4.
- Default `false` / source → Task 1 helper (`preferRendered` gate) + Task 2 Step 2 (`?? false`).
- Toggle writes preference → Task 2 Step 4.
- Opening a `.md` seeds from preference → Task 2 Step 2 (lazy `useState` initializer) + Step 3 derivation.
- Line-reveal-shows-source preserved → Task 1 helper (`revealLine`/`renderedRevealId`) + Task 2 Step 4 (`setRenderedRevealId`).
- Non-goals (per-file/session memory, render engine changes) → not implemented; nothing added beyond the above.
- Tests / truth table → Task 1 Step 1.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `resolveMarkdownRender` input shape is identical in the helper (Task 1 Step 3), the test (Task 1 Step 1), and the call site (Task 2 Step 3). `revealLine: number | null`, `revealRequestId: number`, `renderedRevealId: number | null` match `FilePreviewPanel` prop types (`:75-76`).
