# Persist markdown preview view (source ⇄ rendered)

## Goal

Remember the user's source-vs-rendered choice for markdown files. Once a user
switches a `.md`/`.mdx` file to rendered view, every markdown file they open
afterward defaults to rendered — and vice versa — persisting across reloads.

Today the file preview panel already renders markdown natively (reusing the
chat `ChatMarkdown` renderer) with a 👁/`Code2` toggle, but the choice resets to
**source** on every file open. This makes the rendered view feel hidden.

## Scope

- Only `FilePreviewPanel` (`apps/web/src/components/files/FilePreviewPanel.tsx`)
  and its helper module `filePreviewMode.ts`. No chat, editor, or server changes.
- No new dependencies. Reuses the existing `localStorage` pattern
  (`getLocalStorageItem` / `setLocalStorageItem` + `Schema.Boolean`) already used
  for `FILE_EXPLORER_STORAGE_KEY`.
- No new UI — the same existing toggle drives the preference.

## Behavior

A single **global** boolean preference, stored under
`t3code.markdownRenderView`:

- **Default (first-ever user):** `false` → source view, matching today.
- **Toggling** rendered/source writes the preference immediately.
- **Opening any `.md`/`.mdx`** seeds its view from the preference.
- **Line-reveal navigation preserved:** opening a markdown file _at a specific
  line_ (e.g. clicking a `file://path#L42` link) still shows source so the line
  is visible, regardless of the preference, until the user toggles to rendered.

Non-goals: per-file memory, per-thread memory, session-only memory, any change
to how markdown is rendered.

## Current mechanism (for reference)

`FilePreviewPanel.tsx` today:

- State: `markdownView: { path: string | null; revealRequestId: number | null }`,
  initialized `{ path: null, revealRequestId: null }` (always source on open).
- Derivation (`:681`):
  ```ts
  renderMarkdown =
    isMarkdown &&
    markdownView.path === relativePath &&
    (revealLine === null || markdownView.revealRequestId === revealRequestId);
  ```
- Toggle (`:790`) sets `markdownView` to `{ path: relativePath, revealRequestId }`
  when pressed (rendered) or `{ path: null, revealRequestId: null }` when
  released (source).
- Render branch (`:878`): `isMarkdown && renderMarkdown` → `RenderedMarkdownSurface`.

## Design

### Pure helper (`apps/web/src/components/files/filePreviewMode.ts`)

Extract the render decision into a testable pure function:

```ts
export function resolveMarkdownRender(input: {
  isMarkdown: boolean;
  preferRendered: boolean;
  relativePath: string | null;
  revealLine: number | null;
  revealRequestId: number;
  renderedReveal: { path: string; requestId: number } | null;
}): boolean {
  const { isMarkdown, preferRendered, relativePath, revealLine, revealRequestId, renderedReveal } =
    input;
  if (!isMarkdown || !preferRendered) return false;
  // A line-reveal navigation shows source so the target line is visible, until
  // the user explicitly switches this file's reveal request to rendered. The
  // acknowledgement is scoped per-file because revealRequestId is only unique
  // within a single file's path (see rightPanelStore.openFile).
  if (revealLine === null) return true;
  return (
    renderedReveal !== null &&
    renderedReveal.path === relativePath &&
    renderedReveal.requestId === revealRequestId
  );
}
```

**Why the acknowledgement is per-file:** `revealRequestId` is only unique
_within_ a single file's path (`rightPanelStore.openFile` computes
`(existing?.revealRequestId ?? 0) + 1`, keyed by `file:${path}`), and
`FilePreviewPanel`'s state persists across file switches (the panel is keyed by
`environmentId:workspaceRoot`, not by path). A bare `renderedRevealId: number`
therefore collides across files — file A's acknowledged reveal (id 1) would
match file B's first-ever reveal (also id 1) and wrongly render B. Scoping the
acknowledgement to `{ path, requestId }` prevents that.

Add a storage-key constant alongside the existing pattern:

```ts
export const MARKDOWN_VIEW_STORAGE_KEY = "t3code.markdownRenderView";
```

### Component state (`FilePreviewPanel.tsx`)

Replace the `markdownView` object with two pieces of state:

```ts
const [preferRendered, setPreferRendered] = useState(
  () => getLocalStorageItem(MARKDOWN_VIEW_STORAGE_KEY, Schema.Boolean) ?? false,
);
// A line-reveal the user has explicitly switched to rendered, scoped to the
// file's path because revealRequestId is only unique within a single path.
const [renderedReveal, setRenderedReveal] = useState<{ path: string; requestId: number } | null>(
  null,
);
```

Derivation:

```ts
const renderMarkdown = resolveMarkdownRender({
  isMarkdown,
  preferRendered,
  relativePath,
  revealLine,
  revealRequestId,
  renderedReveal,
});
```

Toggle handler (`:790`):

```ts
onPressedChange={(pressed) => {
  setPreferRendered(pressed);
  try {
    setLocalStorageItem(MARKDOWN_VIEW_STORAGE_KEY, pressed, Schema.Boolean);
  } catch (error) {
    console.error(error);
  }
  setRenderedReveal(
    pressed && relativePath ? { path: relativePath, requestId: revealRequestId } : null,
  );
}}
```

The `Toggle`'s `pressed={renderMarkdown}`, the icon swap, `aria-label`, and the
`RenderedMarkdownSurface` render branch are all unchanged — they already key off
`renderMarkdown`.

### Data flow

```
open .md ──► preferRendered (from localStorage) ──► resolveMarkdownRender ──► renderMarkdown
toggle ────► setPreferRendered + setLocalStorageItem + setRenderedReveal ──► resolveMarkdownRender
open .md at line ► revealLine set, renderedReveal.path/requestId ≠ current ──► source (until toggled)
```

## Testing

Unit tests for `resolveMarkdownRender` (`filePreviewMode.test.ts`), truth table:

| isMarkdown | preferRendered | revealLine | renderedReveal vs current (path, requestId) | → result |
| ---------- | -------------- | ---------- | ------------------------------------------- | -------- |
| false      | true           | null       | —                                           | false    |
| true       | false          | null       | —                                           | false    |
| true       | true           | null       | —                                           | **true** |
| true       | true           | 42         | requestId mismatch                          | false    |
| true       | true           | 42         | null (no acknowledgement)                   | false    |
| true       | true           | 42         | path + requestId match                      | **true** |
| true       | true           | 42         | different path, same requestId (collision)  | false    |
| true       | false          | 42         | path + requestId match                      | false    |

Manual:

- Open a `.md`, toggle to rendered, open another `.md` → opens rendered.
- Toggle back to source, open another `.md` → opens source.
- Reload the app → last choice still applies.
- Click a `file://…#L<n>` link into a `.md` while preference is rendered →
  shows source at that line; toggling flips to rendered.

## Files touched

- `apps/web/src/components/files/filePreviewMode.ts` — add
  `MARKDOWN_VIEW_STORAGE_KEY` + `resolveMarkdownRender`.
- `apps/web/src/components/files/filePreviewMode.test.ts` — new, truth table.
- `apps/web/src/components/files/FilePreviewPanel.tsx` — swap state + toggle
  handler + derivation.
