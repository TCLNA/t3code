# Sidebar hide/show projects

## Goal

Let users hide sidebar projects they aren't actively using and reveal them on
demand. Two entry points:

- A per-project **Hide project / Show project** toggle in the project row's
  right-click context menu.
- A global **Show hidden projects** toggle in the sidebar options menu.

When the global toggle is on, hidden projects reappear in the list marked with an
eye-crossed icon so they are visually distinct from ordinary projects.

## Scope

- Sidebar only (`apps/web/src/components/Sidebar.tsx` + `uiStateStore.ts`).
- No contracts / server changes. State is device-local (localStorage), matching
  the existing project expand/collapse state.
- Hiding operates on the **logical** project (`project.projectKey`), i.e. the
  whole sidebar row, not individual grouped members.

## State (`apps/web/src/uiStateStore.ts`)

Two new persisted fields, mirroring `projectExpandedById`:

```ts
projectHiddenById: Record<string, boolean>; // keyed by logical project.projectKey
showHiddenProjects: boolean; // global toggle, default false
```

Wiring (all mirror the existing `projectExpandedById` plumbing):

- `PersistedUiState` interface + `UiProjectState`/`initialState`: add both fields.
- `parsePersistedState`: sanitize `projectHiddenById` with the existing
  `sanitizeBooleanRecord` helper; coerce `showHiddenProjects` to a boolean with a
  `false` default. Include both in the returned object.
- `persistState`: add both to the `JSON.stringify({...})` payload — fields not
  listed here are silently not saved.
- Reducers / actions on the store:
  - `setProjectHidden(projectKey: string, hidden: boolean)` — mirrors
    `setProjectExpanded`.
  - `setShowHiddenProjects(value: boolean)`.
  - `resolveProjectHidden(projectHiddenById, projectKey): boolean` — pure resolver
    mirroring `resolveProjectExpanded` (returns `false` when unset).

## Context menu (`Sidebar.tsx`, `handleProjectButtonContextMenu` ~:1706)

Add a single leaf item to the `api.contextMenu.show([...])` array, positioned
above the destructive "Remove" item:

- Label: `"Show project"` when the project is currently hidden, else
  `"Hide project"`.
- Action: `setProjectHidden(project.projectKey, !isHidden)`.
- Single leaf on the logical row — **not** a per-member submenu (unlike Rename /
  Group into...), because hiding keys on `project.projectKey`.
- No `icon` keyword (stripped on native menus; only the web fallback uses it).

`isHidden` is read via `resolveProjectHidden(projectHiddenById, project.projectKey)`.
The context menu is rebuilt on each open, so it reflects current state without
extra reactivity work.

## Sidebar options menu (`ProjectSortMenu`, `Sidebar.tsx` ~:2640, rendered ~:3152)

Add a new `<MenuGroup>` containing a `<Switch>` labelled "Show hidden projects":

```tsx
<Switch
  checked={showHiddenProjects}
  onCheckedChange={onShowHiddenProjectsChange}
  aria-label="Show hidden projects"
/>
```

- Follows the existing `<Switch>` usage already in this file.
- `ProjectSortMenu` receives `showHiddenProjects` + `onShowHiddenProjectsChange`
  as props (like the other option state), sourced from `uiStateStore` in the
  parent (`useUiStateStore`), with a `handleShowHiddenProjectsChange` callback
  calling `setShowHiddenProjects`.

## Filtering (`sortedProjects` memo, `Sidebar.tsx` ~:3532)

When resolving sorted snapshots back from keys, drop hidden ones while the global
toggle is off:

```ts
return sortProjectsForSidebar(...).flatMap((project) => {
  const resolved = sidebarProjectByKey.get(project.id);
  if (!resolved) return [];
  if (!showHiddenProjects && projectHiddenById[resolved.projectKey]) return [];
  return [resolved];
});
```

Add `showHiddenProjects` and `projectHiddenById` to the memo's dependency array.

## Eye-crossed indicator

When `showHiddenProjects` is on, a hidden project row renders an `EyeOffIcon`
(lucide-react, already imported/used elsewhere in the repo) in the project row
header — muted foreground, near the title/favicon — so hidden rows are visually
distinguishable from ordinary ones. When the toggle is off, hidden projects are
filtered out entirely, so no indicator is needed there.

Import `EyeOffIcon` into the existing `"lucide-react"` import block at the top of
`Sidebar.tsx`.

## Edge cases

- **Active thread inside a hidden project (toggle off):** the project is still
  filtered out. No pin-back — kept simple. Users can reach it via the global
  toggle. (Revisit only if this proves annoying in practice.)
- **Unknown / stale project keys** in `projectHiddenById`: harmless — the
  resolver defaults to `false` and stale entries just never match a live
  snapshot.

## Testing

- **Unit** (`Sidebar.logic.test.ts` or a `uiStateStore` test): `resolveProjectHidden`
  returns `false` when unset / `true` when set; `setProjectHidden` and
  `setShowHiddenProjects` reducers produce the expected next state;
  `parsePersistedState` round-trips both fields and defaults missing ones.
- **Manual:** hide a project via context menu → row disappears; open sidebar
  options → toggle "Show hidden projects" on → row reappears with the eye-off
  icon; context menu now offers "Show project" → restores it to a normal row.

## Non-goals

- No sync across devices (device-local by design).
- No per-member hiding within a grouped project.
- No bulk hide/unhide, no "hidden projects" count badge, no separate section.
- No server / contracts changes.
