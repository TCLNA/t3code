# Sidebar Hide/Show Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users hide sidebar projects via the project context menu and reveal them with a global "Show hidden projects" toggle, marking revealed rows with an eye-crossed icon.

**Architecture:** Two new device-local fields in the Zustand `uiStateStore` (`projectHiddenById` keyed by logical `projectKey`, and a global `showHiddenProjects` boolean), mirroring the existing `projectExpandedById` plumbing. The sidebar filters hidden projects out of its `sortedProjects` memo when the toggle is off; a context-menu leaf toggles a project's flag; the options menu hosts the global toggle; and hidden rows (only rendered when the toggle is on) show an `EyeOffIcon`.

**Tech Stack:** React 19, Zustand, TypeScript, lucide-react, `vite-plus/test` (`vp test`), Tailwind v4, Base UI menu primitives.

## Global Constraints

- State is **device-local** (localStorage via `uiStateStore`) — no contracts, settings-schema, or server changes.
- Hiding operates on the **logical** project key `project.projectKey`, i.e. the whole sidebar row — never per grouped member.
- `showHiddenProjects` default is `false`.
- Follow existing patterns: new pure store functions are exported and unit-tested in `apps/web/src/uiStateStore.test.ts`; UI wiring lives in `apps/web/src/components/Sidebar.tsx`.
- Test runner is `vp test` (Vitest-compatible). Run web tests from `apps/web`.

---

### Task 1: uiStateStore — `projectHiddenById` + `showHiddenProjects` state

**Files:**

- Modify: `apps/web/src/uiStateStore.ts`
- Test: `apps/web/src/uiStateStore.test.ts`

**Interfaces:**

- Consumes: existing `sanitizeBooleanRecord`, `UiState`, store `create` pattern.
- Produces (imported by Task 2–5):
  - `resolveProjectHidden(projectHiddenById: Readonly<Record<string, boolean>>, projectKey: string): boolean`
  - `setProjectHidden(state: UiState, projectKey: string, hidden: boolean): UiState`
  - `setShowHiddenProjects(state: UiState, value: boolean): UiState`
  - Store actions on `useUiStateStore`: `setProjectHidden(projectKey: string, hidden: boolean): void`, `setShowHiddenProjects(value: boolean): void`
  - New `UiState` fields: `projectHiddenById: Record<string, boolean>`, `showHiddenProjects: boolean`

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/uiStateStore.test.ts`. First extend the `makeUiState` helper (top of file) to include the two new fields:

```ts
function makeUiState(overrides: Partial<UiState> = {}): UiState {
  return {
    projectExpandedById: {},
    projectOrder: [],
    threadLastVisitedAtById: {},
    threadChangedFilesExpandedById: {},
    defaultAdvertisedEndpointKey: null,
    projectHiddenById: {},
    showHiddenProjects: false,
    ...overrides,
  };
}
```

Add these imports to the existing import block from `"./uiStateStore"`:

```ts
  resolveProjectHidden,
  setProjectHidden,
  setShowHiddenProjects,
```

Then add a new `describe` block:

```ts
describe("project hidden state", () => {
  it("resolveProjectHidden defaults to false when unset", () => {
    expect(resolveProjectHidden({}, "proj-1")).toBe(false);
    expect(resolveProjectHidden({ "proj-1": true }, "proj-1")).toBe(true);
    expect(resolveProjectHidden({ "proj-1": false }, "proj-1")).toBe(false);
  });

  it("setProjectHidden sets and clears the flag", () => {
    const state = makeUiState();
    const hidden = setProjectHidden(state, "proj-1", true);
    expect(hidden.projectHiddenById["proj-1"]).toBe(true);
    const shown = setProjectHidden(hidden, "proj-1", false);
    expect(shown.projectHiddenById["proj-1"]).toBe(false);
  });

  it("setProjectHidden returns the same state when unchanged", () => {
    const state = makeUiState({ projectHiddenById: { "proj-1": true } });
    expect(setProjectHidden(state, "proj-1", true)).toBe(state);
  });

  it("setShowHiddenProjects toggles the global flag", () => {
    const state = makeUiState();
    expect(setShowHiddenProjects(state, false)).toBe(state);
    const on = setShowHiddenProjects(state, true);
    expect(on.showHiddenProjects).toBe(true);
  });

  it("parsePersistedState round-trips and defaults the new fields", () => {
    const parsed = parsePersistedState({
      projectHiddenById: { "proj-1": true, "": true, bad: 1 as unknown as boolean },
      showHiddenProjects: true,
    } as PersistedUiState);
    expect(parsed.projectHiddenById).toEqual({ "proj-1": true });
    expect(parsed.showHiddenProjects).toBe(true);

    const empty = parsePersistedState({} as PersistedUiState);
    expect(empty.projectHiddenById).toEqual({});
    expect(empty.showHiddenProjects).toBe(false);
  });

  it("persistState writes the new fields", () => {
    const state = makeUiState({
      projectHiddenById: { "proj-1": true },
      showHiddenProjects: true,
    });
    persistState(state);
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as PersistedUiState;
    expect(parsed.projectHiddenById).toEqual({ "proj-1": true });
    expect(parsed.showHiddenProjects).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && pnpm test -- uiStateStore`
Expected: FAIL — `resolveProjectHidden`/`setProjectHidden`/`setShowHiddenProjects` are not exported (and type errors on the new `UiState` fields).

- [ ] **Step 3: Add the state fields**

In `apps/web/src/uiStateStore.ts`, extend `PersistedUiState` (after `threadChangedFilesExpandedById`, ~line 27):

```ts
  projectHiddenById?: Record<string, boolean>;
  showHiddenProjects?: boolean;
```

Extend `UiProjectState` (~line 30):

```ts
export interface UiProjectState {
  projectExpandedById: Record<string, boolean>;
  projectHiddenById: Record<string, boolean>;
  projectOrder: string[];
  showHiddenProjects: boolean;
}
```

Extend `initialState` (~line 46):

```ts
const initialState: UiState = {
  projectExpandedById: {},
  projectHiddenById: {},
  projectOrder: [],
  showHiddenProjects: false,
  threadLastVisitedAtById: {},
  threadChangedFilesExpandedById: {},
  defaultAdvertisedEndpointKey: null,
};
```

- [ ] **Step 4: Parse and persist the fields**

In `parsePersistedState` (~line 123), add to the returned object:

```ts
    projectHiddenById: sanitizeBooleanRecord(parsed.projectHiddenById),
    showHiddenProjects: parsed.showHiddenProjects === true,
```

In `persistState`, inside the `JSON.stringify({...})` payload (~line 208), add:

```ts
        projectHiddenById: state.projectHiddenById,
        showHiddenProjects: state.showHiddenProjects,
```

(Fields not listed in this payload are silently dropped — do not skip this.)

- [ ] **Step 5: Add the pure reducers and resolver**

In `apps/web/src/uiStateStore.ts`, after `setProjectExpanded` (~line 368), add:

```ts
export function resolveProjectHidden(
  projectHiddenById: Readonly<Record<string, boolean>>,
  projectKey: string,
): boolean {
  return projectHiddenById[projectKey] ?? false;
}

export function setProjectHidden(state: UiState, projectKey: string, hidden: boolean): UiState {
  if ((state.projectHiddenById[projectKey] ?? false) === hidden) {
    return state;
  }
  return {
    ...state,
    projectHiddenById: {
      ...state.projectHiddenById,
      [projectKey]: hidden,
    },
  };
}

export function setShowHiddenProjects(state: UiState, value: boolean): UiState {
  if (state.showHiddenProjects === value) {
    return state;
  }
  return {
    ...state,
    showHiddenProjects: value,
  };
}
```

- [ ] **Step 6: Wire the store actions**

Extend the `UiStateStore` interface (~line 419, after `setProjectExpanded`):

```ts
  setProjectHidden: (projectKey: string, hidden: boolean) => void;
  setShowHiddenProjects: (value: boolean) => void;
```

Extend the `create<UiStateStore>` body (~line 437, after `setProjectExpanded`):

```ts
  setProjectHidden: (projectKey, hidden) =>
    set((state) => setProjectHidden(state, projectKey, hidden)),
  setShowHiddenProjects: (value) => set((state) => setShowHiddenProjects(state, value)),
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd apps/web && pnpm test -- uiStateStore`
Expected: PASS (all new tests green, existing tests still green).

- [ ] **Step 8: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/uiStateStore.ts apps/web/src/uiStateStore.test.ts
git commit -m "feat(web): add projectHiddenById + showHiddenProjects ui state"
```

---

### Task 2: Filter hidden projects out of the sidebar list

**Files:**

- Modify: `apps/web/src/components/Sidebar.tsx` (`Sidebar()` top-level component, `sortedProjects` memo ~line 3509)

**Interfaces:**

- Consumes: `resolveProjectHidden` (Task 1), `useUiStateStore`, existing `sortedProjects` memo.
- Produces: `sortedProjects` now excludes hidden projects when `showHiddenProjects` is off. No new exports.

This task is verified by typecheck + manual check (the memo lives in the 3900-line `Sidebar.tsx`; no isolated unit test).

- [ ] **Step 1: Import the resolver**

In `apps/web/src/components/Sidebar.tsx`, add `resolveProjectHidden` to the existing import from `../uiStateStore` (the block importing `resolveProjectExpanded`, `useUiStateStore`, ~line 100):

```ts
import {
  legacyProjectCwdPreferenceKey,
  resolveProjectExpanded,
  resolveProjectHidden,
  useUiStateStore,
} from "../uiStateStore";
```

- [ ] **Step 2: Read the new state in `Sidebar()`**

Next to `const projectExpandedById = useUiStateStore((store) => store.projectExpandedById);` (~line 3244), add:

```ts
const projectHiddenById = useUiStateStore((store) => store.projectHiddenById);
const showHiddenProjects = useUiStateStore((store) => store.showHiddenProjects);
```

- [ ] **Step 3: Filter in the `sortedProjects` memo**

Replace the `.flatMap` body in the `sortedProjects` memo (~line 3528) with:

```ts
    ).flatMap((project) => {
      const resolvedProject = sidebarProjectByKey.get(project.id);
      if (!resolvedProject) {
        return [];
      }
      if (!showHiddenProjects && resolveProjectHidden(projectHiddenById, resolvedProject.projectKey)) {
        return [];
      }
      return [resolvedProject];
    });
```

Add `projectHiddenById` and `showHiddenProjects` to the memo's dependency array (~line 3532):

```ts
  }, [
    sidebarProjectSortOrder,
    physicalToLogicalKey,
    projectHiddenById,
    projectPhysicalKeyByScopedRef,
    showHiddenProjects,
    sidebarProjectByKey,
    sidebarProjects,
    visibleThreads,
  ]);
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): filter hidden projects from sidebar list"
```

---

### Task 3: Context-menu "Hide project" / "Show project" item

**Files:**

- Modify: `apps/web/src/components/Sidebar.tsx` (`SidebarProjectItem` — `handleProjectButtonContextMenu` ~line 1610)

**Interfaces:**

- Consumes: `useUiStateStore` `setProjectHidden` action + `projectHiddenById` read via `getState()` (Task 1).
- Produces: a new logical-project-level context-menu leaf. No new exports.

Verified by typecheck + manual check.

- [ ] **Step 1: Read the `setProjectHidden` action in `SidebarProjectItem`**

Next to `const setProjectExpanded = useUiStateStore((state) => state.setProjectExpanded);` (~line 1150), add:

```ts
const setProjectHidden = useUiStateStore((state) => state.setProjectHidden);
```

- [ ] **Step 2: Build the toggle item inside the context-menu handler**

In `handleProjectButtonContextMenu` (~line 1610), just before the `const clicked = await api.contextMenu.show(` call (~line 1685), add:

```ts
const isProjectHidden = useUiStateStore.getState().projectHiddenById[project.projectKey] ?? false;
const toggleHiddenId = "toggle-hidden";
actionHandlers.set(toggleHiddenId, () => {
  setProjectHidden(project.projectKey, !isProjectHidden);
});
```

Then add the item to the `show([...])` array, positioned above the destructive "Remove" (~line 1690):

```ts
const clicked = await api.contextMenu.show(
  [
    buildTargetedItem("rename", "Rename"),
    buildTargetedItem("grouping", "Group into..."),
    buildTargetedItem("copy-path", "Copy Path"),
    { id: toggleHiddenId, label: isProjectHidden ? "Show project" : "Hide project" },
    buildTargetedItem("delete", "Remove", {
      destructive: true,
    }),
  ],
  {
    x: event.clientX,
    y: event.clientY,
  },
);
```

- [ ] **Step 3: Add `project.projectKey` and `setProjectHidden` to the callback deps**

In the `useCallback` dependency array for `handleProjectButtonContextMenu` (~line 1707), add `project.projectKey` and `setProjectHidden`:

```ts
    [
      copyPathToClipboard,
      handleRemoveProject,
      openProjectGroupingDialog,
      openProjectRenameDialog,
      project.groupedProjectCount,
      project.memberProjects,
      project.projectKey,
      setProjectHidden,
      suppressProjectClickForContextMenuRef,
    ],
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): add hide/show project context menu item"
```

---

### Task 4: "Show hidden projects" toggle in the sidebar options menu

**Files:**

- Modify: `apps/web/src/components/Sidebar.tsx` (`ProjectSortMenu` ~line 2620)

**Interfaces:**

- Consumes: `useUiStateStore` (`showHiddenProjects`, `setShowHiddenProjects`), existing `Switch`, `MenuGroup`, `MenuSeparator`.
- Produces: a global toggle. No new props (read the store directly inside `ProjectSortMenu` to avoid prop-drilling).

Verified by typecheck + manual check.

- [ ] **Step 1: Read the store state inside `ProjectSortMenu`**

`Switch`, `MenuGroup`, `MenuSeparator`, and `useUiStateStore` are already imported. Inside `ProjectSortMenu`, right after `const handleThreadPreviewCountChange = useCallback(` block (before the `return (`, ~line 2652), add:

```ts
const showHiddenProjects = useUiStateStore((state) => state.showHiddenProjects);
const setShowHiddenProjects = useUiStateStore((state) => state.setShowHiddenProjects);
```

- [ ] **Step 2: Add the toggle group to the menu**

Inside the `<MenuPopup>`, after the closing `</MenuGroup>` of the "Group projects" section (~line 2763, before `</MenuPopup>`), add:

```tsx
        <MenuSeparator />
        <MenuGroup>
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="text-muted-foreground sm:text-xs font-medium">
              Show hidden projects
            </span>
            <Switch
              checked={showHiddenProjects}
              onCheckedChange={(checked) => setShowHiddenProjects(checked)}
              aria-label="Show hidden projects"
            />
          </div>
        </MenuGroup>
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): add show hidden projects toggle to sidebar options"
```

---

### Task 5: Eye-crossed indicator on hidden project rows

**Files:**

- Modify: `apps/web/src/components/Sidebar.tsx` (import block ~line 2; `SidebarProjectItem` header ~line 2311)

**Interfaces:**

- Consumes: `EyeOffIcon` from `lucide-react`, `resolveProjectHidden` + `useUiStateStore` (Task 1).
- Produces: a visible eye-off marker on hidden rows. No new exports.

Verified by typecheck + manual check. A hidden row only renders when the global toggle is on (Task 2 filters otherwise), so `isHidden === true` in a rendered row already implies "reveal mode".

- [ ] **Step 1: Import `EyeOffIcon`**

Add `EyeOffIcon` to the `lucide-react` import block (alphabetically, after `ContainerIcon`, ~line 7):

```ts
  ContainerIcon,
  EyeOffIcon,
  FolderPlusIcon,
```

- [ ] **Step 2: Subscribe to the project's hidden flag**

In `SidebarProjectItem`, next to where `setProjectHidden` was added in Task 3 (~line 1150), add:

```ts
const isProjectHidden = useUiStateStore((state) =>
  resolveProjectHidden(state.projectHiddenById, project.projectKey),
);
```

(`resolveProjectHidden` is imported in Task 2, Step 1.)

- [ ] **Step 3: Render the icon in the project header**

In the project header (~line 2311), add the icon inside the title `<span>`, before `project.displayName`:

```tsx
          <ProjectFavicon environmentId={project.environmentId} cwd={project.workspaceRoot} />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {isProjectHidden ? (
              <EyeOffIcon
                aria-label="Hidden project"
                className="size-3 shrink-0 text-muted-foreground/60"
              />
            ) : null}
            <span className="truncate text-xs font-medium text-foreground/90">
              {project.displayName}
            </span>
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification (full feature)**

Run the web app. Then:

1. Right-click a project → "Hide project" → the row disappears from the list.
2. Open the sidebar options menu (arrows icon) → toggle "Show hidden projects" on → the hidden row reappears with an eye-off icon.
3. Right-click the revealed row → it now offers "Show project" → click → the icon disappears and the row returns to normal.
4. Toggle "Show hidden projects" off → any still-hidden rows disappear again.
5. Reload the page → the hidden state and toggle persist.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): show eye-off icon on revealed hidden projects"
```

---

## Self-Review Notes

- **Spec coverage:** context menu toggle (Task 3), options toggle (Task 4), filtering (Task 2), eye-off indicator (Task 5), device-local persistence (Task 1). All spec sections mapped.
- **Type consistency:** `projectHiddenById`/`showHiddenProjects` field names, `resolveProjectHidden`/`setProjectHidden`/`setShowHiddenProjects` signatures, and `project.projectKey` keying are used identically across all tasks.
- **Edge cases (per spec):** stale keys default to `false` via `resolveProjectHidden`; active-thread-in-hidden-project intentionally still filters out (no pin-back).
