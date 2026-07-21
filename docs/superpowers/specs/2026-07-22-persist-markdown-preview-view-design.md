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
  revealLine: number | null;
  revealRequestId: number;
  renderedRevealId: number | null;
}): boolean {
  const { isMarkdown, preferRendered, revealLine, revealRequestId, renderedRevealId } = input;
  if (!isMarkdown || !preferRendered) return false;
  // A line-reveal forces source until the user opts back into rendered
  // for that exact reveal request.
  return revealLine === null || renderedRevealId === revealRequestId;
}
```

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
// Tracks a reveal request the user has explicitly switched to rendered,
// so line-reveal navigation shows source by default but can be overridden.
const [renderedRevealId, setRenderedRevealId] = useState<number | null>(null);
```

Derivation:

```ts
const renderMarkdown = resolveMarkdownRender({
  isMarkdown,
  preferRendered,
  revealLine,
  revealRequestId,
  renderedRevealId,
});
```

Toggle handler (`:790`):

```ts
onPressedChange={(pressed) => {
  setPreferRendered(pressed);
  setLocalStorageItem(MARKDOWN_VIEW_STORAGE_KEY, pressed, Schema.Boolean);
  setRenderedRevealId(pressed ? revealRequestId : null);
}}
```

The `Toggle`'s `pressed={renderMarkdown}`, the icon swap, `aria-label`, and the
`RenderedMarkdownSurface` render branch are all unchanged — they already key off
`renderMarkdown`.

### Data flow

```
open .md ──► preferRendered (from localStorage) ──► resolveMarkdownRender ──► renderMarkdown
toggle ────► setPreferRendered + setLocalStorageItem + setRenderedRevealId ──► resolveMarkdownRender
open .md at line ► revealLine set, renderedRevealId ≠ requestId ──► source (until toggled)
```

## Testing

Unit tests for `resolveMarkdownRender` (`filePreviewMode.test.ts`), truth table:

| isMarkdown | preferRendered | revealLine | renderedRevealId vs requestId | → result |
| ---------- | -------------- | ---------- | ----------------------------- | -------- |
| false      | true           | null       | —                             | false    |
| true       | false          | null       | —                             | false    |
| true       | true           | null       | —                             | **true** |
| true       | true           | 42         | mismatch                      | false    |
| true       | true           | 42         | match                         | **true** |
| true       | false          | 42         | match                         | false    |

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
