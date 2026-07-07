# Simplified Mobile View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `simplified=true` query-param-driven mobile shell that replaces the whole app with three navigable screens (Sessions home, Transcript, Voice conversation), togglable from Settings → General and persisted across navigation.

**Architecture:** A typed `simplified` search param on the `__root` route, retained across all navigations via router middleware. `useSimplifiedMode()` resolves param > persisted client setting > false. When active, `__root` renders a bare `SimplifiedLayout` instead of `AppSidebarLayout`, and the existing chat routes branch to render simplified screens built from real thread/message state (`useThreadShells`, `useThreadMessages`, `useThreadActivities`). Layout only; existing t3code theme tokens; no ember palette.

**Tech Stack:** React 19, TanStack Router v1 (file-based), Tailwind v4 (CSS-first tokens), Effect Atom state, Effect Schema contracts, Vitest.

## Global Constraints

- Theme: use existing semantic tokens only (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `border-border`, `--radius-*`). No ember/mockup palette.
- Client settings key name: `simplifiedMobileView` (boolean, default `false`).
- Search param name: `simplified` (boolean; `true`/`1` → true, `false`/`0` → false, absent/other → undefined).
- Resolution precedence: explicit search param overrides client setting; client setting is the fallback default.
- Reuse existing voice stack (`apps/web/src/voice/`), do not rebuild STT/TTS.
- Out of scope: ember theme port, mockup 3A question/verify turn UI, wake-word.
- Settings toggle wiring follows the existing `GeneralSettingsPanel` pattern (`SettingsRow` + `Switch` + `updateSettings`).
- Run commands from `apps/web/` unless noted. Test runner: `pnpm vitest run <path>` (or `pnpm test` per repo convention — verify with `pnpm -w vitest --version` first if unsure).

---

## File Structure

**Create:**
- `apps/web/src/components/simplified/useSimplifiedMode.ts` — resolution hook.
- `apps/web/src/components/simplified/useSimplifiedMode.test.ts`
- `apps/web/src/components/simplified/simplifiedNavigation.ts` — nav helper.
- `apps/web/src/components/simplified/SimplifiedLayout.tsx` — bare mobile shell.
- `apps/web/src/components/simplified/sessionsGrouping.ts` — pure status-grouping logic.
- `apps/web/src/components/simplified/sessionsGrouping.test.ts`
- `apps/web/src/components/simplified/SimplifiedPrimitives.tsx` — shared presentational pieces.
- `apps/web/src/components/simplified/SessionsHomeScreen.tsx` — 2A.
- `apps/web/src/components/simplified/TranscriptScreen.tsx` — 1C.
- `apps/web/src/components/simplified/VoiceConversationScreen.tsx` — 3A.
- `apps/web/src/components/simplified/SimplifiedThreadScreen.tsx` — 3A/1C tab host.

**Modify:**
- `packages/contracts/src/settings.ts` — add `simplifiedMobileView` to `ClientSettingsSchema` and `ClientSettingsPatch`.
- `apps/web/src/routes/__root.tsx` — `validateSearch`, `search.middlewares`, shell swap.
- `apps/web/src/components/settings/SettingsPanels.tsx` — toggle row.
- `apps/web/src/routes/_chat.index.tsx` — branch to 2A.
- `apps/web/src/routes/_chat.$environmentId.$threadId.tsx` — branch to thread screen.
- `apps/web/src/routes/_chat.draft.$draftId.tsx` — branch to thread screen (voice tab).

---

### Task 1: Add `simplifiedMobileView` client setting to contracts

**Files:**
- Modify: `packages/contracts/src/settings.ts:42-95` (schema), `:654-690` (patch)
- Test: `packages/contracts/src/settings.simplified.test.ts` (create)

**Interfaces:**
- Produces: `ClientSettings.simplifiedMobileView: boolean` (default `false`); `ClientSettingsPatch.simplifiedMobileView?: boolean`.

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/settings.simplified.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_CLIENT_SETTINGS } from "./settings";

describe("simplifiedMobileView client setting", () => {
  it("defaults to false", () => {
    expect(DEFAULT_CLIENT_SETTINGS.simplifiedMobileView).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @t3tools/contracts vitest run src/settings.simplified.test.ts`
Expected: FAIL — `simplifiedMobileView` is `undefined`.

- [ ] **Step 3: Add the field to the schema and patch**

In `packages/contracts/src/settings.ts`, inside `ClientSettingsSchema` (after the `sidebarThreadPreviewCount` entry, keeping alphabetical-ish grouping), add:

```ts
  simplifiedMobileView: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
```

In `ClientSettingsPatch` (the `Schema.Struct` near line 654), add:

```ts
  simplifiedMobileView: Schema.optionalKey(Schema.Boolean),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @t3tools/contracts vitest run src/settings.simplified.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the contracts package**

Run: `pnpm --filter @t3tools/contracts typecheck` (or `pnpm -w typecheck`)
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/settings.ts packages/contracts/src/settings.simplified.test.ts
git commit -m "feat(contracts): add simplifiedMobileView client setting"
```

---

### Task 2: `useSimplifiedMode` resolution hook

**Files:**
- Create: `apps/web/src/components/simplified/useSimplifiedMode.ts`
- Test: `apps/web/src/components/simplified/useSimplifiedMode.test.ts`

**Interfaces:**
- Consumes: `ClientSettings.simplifiedMobileView` (Task 1); `useClientSettings` from `~/hooks/useSettings`.
- Produces:
  - `parseSimplifiedSearch(raw: unknown): boolean | undefined` — lenient parser.
  - `resolveSimplifiedMode(param: boolean | undefined, setting: boolean): boolean` — pure resolver.
  - `useSimplifiedMode(): boolean` — React hook reading root search + client setting.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/simplified/useSimplifiedMode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSimplifiedSearch, resolveSimplifiedMode } from "./useSimplifiedMode";

describe("parseSimplifiedSearch", () => {
  it("parses truthy values", () => {
    expect(parseSimplifiedSearch(true)).toBe(true);
    expect(parseSimplifiedSearch("true")).toBe(true);
    expect(parseSimplifiedSearch("1")).toBe(true);
  });
  it("parses falsy values", () => {
    expect(parseSimplifiedSearch(false)).toBe(false);
    expect(parseSimplifiedSearch("false")).toBe(false);
    expect(parseSimplifiedSearch("0")).toBe(false);
  });
  it("returns undefined for absent/unknown values", () => {
    expect(parseSimplifiedSearch(undefined)).toBeUndefined();
    expect(parseSimplifiedSearch("banana")).toBeUndefined();
  });
});

describe("resolveSimplifiedMode", () => {
  it("prefers the explicit param over the setting", () => {
    expect(resolveSimplifiedMode(true, false)).toBe(true);
    expect(resolveSimplifiedMode(false, true)).toBe(false);
  });
  it("falls back to the setting when param is undefined", () => {
    expect(resolveSimplifiedMode(undefined, true)).toBe(true);
    expect(resolveSimplifiedMode(undefined, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/simplified/useSimplifiedMode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/components/simplified/useSimplifiedMode.ts`:

```ts
import { useSearch } from "@tanstack/react-router";

import { useClientSettings } from "~/hooks/useSettings";

/** Lenient parse of the `simplified` search value. */
export function parseSimplifiedSearch(raw: unknown): boolean | undefined {
  if (raw === true || raw === "true" || raw === "1") return true;
  if (raw === false || raw === "false" || raw === "0") return false;
  return undefined;
}

/** Param wins when present; otherwise fall back to the persisted setting. */
export function resolveSimplifiedMode(
  param: boolean | undefined,
  setting: boolean,
): boolean {
  return param ?? setting;
}

/** True when the simplified mobile shell should render. */
export function useSimplifiedMode(): boolean {
  const param = useSearch({
    strict: false,
    select: (search: Record<string, unknown>) => parseSimplifiedSearch(search.simplified),
  });
  const setting = useClientSettings((settings) => settings.simplifiedMobileView);
  return resolveSimplifiedMode(param, setting);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/simplified/useSimplifiedMode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/simplified/useSimplifiedMode.ts apps/web/src/components/simplified/useSimplifiedMode.test.ts
git commit -m "feat(web): add useSimplifiedMode resolution hook"
```

---

### Task 3: Root search schema + retain-across-navigation middleware

**Files:**
- Modify: `apps/web/src/routes/__root.tsx:55-83`

**Interfaces:**
- Consumes: `parseSimplifiedSearch` (Task 2).
- Produces: root search type `{ simplified?: boolean }`, retained on every navigation.

- [ ] **Step 1: Add the imports**

In `apps/web/src/routes/__root.tsx`, extend the `@tanstack/react-router` import to include `retainSearchParams`, and import the parser:

```ts
import {
  Outlet,
  createRootRoute,
  retainSearchParams,
  type ErrorComponentProps,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { parseSimplifiedSearch } from "../components/simplified/useSimplifiedMode";
```

- [ ] **Step 2: Add `validateSearch` and `search.middlewares` to the route**

In the `createRootRoute({ ... })` config object, add these two keys (alongside `beforeLoad`, `component`, etc.):

```ts
  validateSearch: (search: Record<string, unknown>): { simplified?: boolean } => {
    const simplified = parseSimplifiedSearch(search.simplified);
    return simplified === undefined ? {} : { simplified };
  },
  search: {
    middlewares: [retainSearchParams(["simplified"])],
  },
```

- [ ] **Step 3: Typecheck**

Run: `pnpm vitest run src/components/simplified/useSimplifiedMode.test.ts` (sanity) then `pnpm -w typecheck` (or `pnpm --filter @t3tools/web typecheck`).
Expected: no new type errors; `routeTree.gen.ts` search types resolve.

- [ ] **Step 4: Manually verify param retention**

Run the app (`pnpm --filter @t3tools/web dev`), open `http://localhost:<port>/?simplified=true`, click into a thread, confirm the URL keeps `?simplified=true`. (Shell still looks normal — swap comes in Task 5.)
Expected: param persists across navigation.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/__root.tsx
git commit -m "feat(web): add simplified root search param retained across navigation"
```

---

### Task 4: Simplified navigation helper

**Files:**
- Create: `apps/web/src/components/simplified/simplifiedNavigation.ts`

**Interfaces:**
- Produces:
  - `useSimplifiedNavigate(): (opts: NavigateOptions) => void` — wraps `useNavigate`, always retaining `simplified` (middleware already does this, but this makes intra-shell links explicit and future-proof).
  - Re-exports a typed `SimplifiedLink` if needed by screens.

- [ ] **Step 1: Write the implementation**

Create `apps/web/src/components/simplified/simplifiedNavigation.ts`:

```ts
import { useNavigate, type NavigateOptions } from "@tanstack/react-router";
import { useCallback } from "react";

/**
 * Navigate within the simplified shell. The root `retainSearchParams`
 * middleware already carries `simplified`, so this is a thin, semantic
 * wrapper that keeps call sites self-documenting and lets us evolve
 * shell-specific navigation behavior in one place.
 */
export function useSimplifiedNavigate() {
  const navigate = useNavigate();
  return useCallback(
    (opts: NavigateOptions) => {
      void navigate(opts);
    },
    [navigate],
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -w typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/simplified/simplifiedNavigation.ts
git commit -m "feat(web): add simplified navigation helper"
```

---

### Task 5: `SimplifiedLayout` shell + root swap

**Files:**
- Create: `apps/web/src/components/simplified/SimplifiedLayout.tsx`
- Modify: `apps/web/src/routes/__root.tsx:117-123`

**Interfaces:**
- Consumes: `useSimplifiedMode` (Task 2).
- Produces: `SimplifiedLayout` component wrapping `children` in a mobile-safe full-height column.

- [ ] **Step 1: Create the layout**

Create `apps/web/src/components/simplified/SimplifiedLayout.tsx`:

```tsx
import { type ReactNode } from "react";

/**
 * Bare full-height mobile shell used when simplified mode is active.
 * No desktop sidebar; screens manage their own header/tab chrome.
 */
export function SimplifiedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-background text-foreground pt-safe pb-safe">
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Swap the shell in `__root.tsx`**

In `RootRouteView`, add near the top of the component body (after the existing hooks, before the `/pair` check is fine since simplified only matters for the authenticated shell):

```ts
  const simplified = useSimplifiedMode();
```

Add the import:

```ts
import { SimplifiedLayout } from "../components/simplified/SimplifiedLayout";
import { useSimplifiedMode } from "../components/simplified/useSimplifiedMode";
```

Replace the `appShell` definition (currently lines 117-123):

```tsx
  const appShell = simplified ? (
    <CommandPalette>
      <SimplifiedLayout>
        <Outlet />
      </SimplifiedLayout>
    </CommandPalette>
  ) : (
    <CommandPalette>
      <AppSidebarLayout>
        <Outlet />
      </AppSidebarLayout>
    </CommandPalette>
  );
```

- [ ] **Step 3: Typecheck + manual verify**

Run: `pnpm -w typecheck`, then dev server, open `/?simplified=true`.
Expected: sidebar disappears; the current route's content renders inside the bare shell (screens are placeholders until Tasks 7-11 — for now the existing route components render without the sidebar).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/simplified/SimplifiedLayout.tsx apps/web/src/routes/__root.tsx
git commit -m "feat(web): swap to bare SimplifiedLayout when simplified mode active"
```

---

### Task 6: Settings → General toggle

**Files:**
- Modify: `apps/web/src/components/settings/SettingsPanels.tsx` (inside `GeneralSettingsPanel`, near the `wordWrap` `SettingsRow` at ~588-616)

**Interfaces:**
- Consumes: `simplifiedMobileView` client setting (Task 1); `useSimplifiedNavigate` (Task 4); existing `usePrimarySettings`/`useUpdatePrimarySettings` in the panel.
- Produces: a `SettingsRow` toggle that persists the setting and mirrors it into the URL param.

- [ ] **Step 1: Add imports at the top of `SettingsPanels.tsx`**

```ts
import { useSimplifiedNavigate } from "../simplified/simplifiedNavigation";
```

- [ ] **Step 2: Read the current value + navigate helper inside `GeneralSettingsPanel`**

At the top of `GeneralSettingsPanel` (where `settings` and `updateSettings` are already obtained), add:

```ts
  const simplifiedNavigate = useSimplifiedNavigate();
```

`settings.simplifiedMobileView` is already available via the merged `usePrimarySettings()` value (client keys are merged in).

- [ ] **Step 3: Add the toggle row**

Immediately after the `Word wrap` `SettingsRow` block, add:

```tsx
        <SettingsRow
          title="Simplified mobile view"
          description="Replace the app with a compact, voice-first mobile layout. Adds ?simplified=true to the URL so it persists and can be shared."
          resetAction={
            settings.simplifiedMobileView !== DEFAULT_UNIFIED_SETTINGS.simplifiedMobileView ? (
              <SettingResetButton
                label="simplified mobile view"
                onClick={() => {
                  updateSettings({
                    simplifiedMobileView: DEFAULT_UNIFIED_SETTINGS.simplifiedMobileView,
                  });
                  simplifiedNavigate({ to: ".", search: (prev) => ({ ...prev, simplified: undefined }) });
                }}
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.simplifiedMobileView}
              onCheckedChange={(checked) => {
                const next = Boolean(checked);
                updateSettings({ simplifiedMobileView: next });
                simplifiedNavigate({
                  to: ".",
                  search: (prev) => ({ ...prev, simplified: next ? true : undefined }),
                });
              }}
              aria-label="Enable simplified mobile view"
            />
          }
        />
```

- [ ] **Step 4: Typecheck + manual verify**

Run: `pnpm -w typecheck`, dev server → Settings → General. Toggle on: URL gains `?simplified=true` and the shell switches to bare layout. Toggle off: param removed, normal shell returns.
Expected: toggle drives both the persisted setting and the URL.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/settings/SettingsPanels.tsx
git commit -m "feat(web): add simplified mobile view toggle to General settings"
```

---

### Task 7: Sessions status-grouping logic (pure)

**Files:**
- Create: `apps/web/src/components/simplified/sessionsGrouping.ts`
- Test: `apps/web/src/components/simplified/sessionsGrouping.test.ts`

**Interfaces:**
- Consumes: `EnvironmentThreadShell` fields (`session`, `hasPendingUserInput`, `hasPendingApprovals`, `hasActionableProposedPlan`, `updatedAt`).
- Produces:
  - `type SessionGroupKey = "needsYou" | "running" | "done"`.
  - `classifySession(thread: SessionClassInput): SessionGroupKey` — pure.
  - `groupSessionsByStatus(threads, nowMs): Record<SessionGroupKey, T[]>` — pure, preserves input order.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/simplified/sessionsGrouping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifySession, groupSessionsByStatus } from "./sessionsGrouping";

const base = {
  hasPendingUserInput: false,
  hasPendingApprovals: false,
  hasActionableProposedPlan: false,
  session: null,
  updatedAt: "2026-07-07T10:00:00.000Z",
};

describe("classifySession", () => {
  it("classifies pending user input as needsYou", () => {
    expect(classifySession({ ...base, hasPendingUserInput: true })).toBe("needsYou");
  });
  it("classifies pending approvals as needsYou", () => {
    expect(classifySession({ ...base, hasPendingApprovals: true })).toBe("needsYou");
  });
  it("classifies a running session as running", () => {
    expect(classifySession({ ...base, session: { status: "running" } })).toBe("running");
  });
  it("classifies a starting session as running", () => {
    expect(classifySession({ ...base, session: { status: "starting" } })).toBe("running");
  });
  it("classifies everything else as done", () => {
    expect(classifySession({ ...base, session: { status: "stopped" } })).toBe("done");
    expect(classifySession(base)).toBe("done");
  });
});

describe("groupSessionsByStatus", () => {
  it("buckets and preserves order", () => {
    const nowMs = Date.parse("2026-07-07T12:00:00.000Z");
    const threads = [
      { id: "a", ...base, hasPendingUserInput: true },
      { id: "b", ...base, session: { status: "running" } },
      { id: "c", ...base },
    ];
    const grouped = groupSessionsByStatus(threads, nowMs);
    expect(grouped.needsYou.map((t) => t.id)).toEqual(["a"]);
    expect(grouped.running.map((t) => t.id)).toEqual(["b"]);
    expect(grouped.done.map((t) => t.id)).toEqual(["c"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/simplified/sessionsGrouping.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/components/simplified/sessionsGrouping.ts`:

```ts
export type SessionGroupKey = "needsYou" | "running" | "done";

export interface SessionClassInput {
  readonly hasPendingUserInput: boolean;
  readonly hasPendingApprovals: boolean;
  readonly hasActionableProposedPlan: boolean;
  readonly session: { readonly status: string } | null;
}

/** Pure single-thread classification. Precedence: needsYou > running > done. */
export function classifySession(thread: SessionClassInput): SessionGroupKey {
  if (
    thread.hasPendingUserInput ||
    thread.hasPendingApprovals ||
    thread.hasActionableProposedPlan
  ) {
    return "needsYou";
  }
  const status = thread.session?.status;
  if (status === "running" || status === "starting") {
    return "running";
  }
  return "done";
}

/** Group threads into ordered status buckets. Input order is preserved. */
export function groupSessionsByStatus<T extends SessionClassInput>(
  threads: ReadonlyArray<T>,
  _nowMs: number,
): Record<SessionGroupKey, T[]> {
  const grouped: Record<SessionGroupKey, T[]> = {
    needsYou: [],
    running: [],
    done: [],
  };
  for (const thread of threads) {
    grouped[classifySession(thread)].push(thread);
  }
  return grouped;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/simplified/sessionsGrouping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/simplified/sessionsGrouping.ts apps/web/src/components/simplified/sessionsGrouping.test.ts
git commit -m "feat(web): add session status grouping logic for simplified home"
```

---

### Task 8: Shared simplified UI primitives

**Files:**
- Create: `apps/web/src/components/simplified/SimplifiedPrimitives.tsx`

**Interfaces:**
- Consumes: `cn` from `~/lib/utils`; lucide icons.
- Produces (all presentational, token-only):
  - `SimplifiedHeader({ title, subtitle, left, right })`
  - `SessionStatusDot({ variant })` where `variant: "needsYou" | "running" | "done"`
  - `SessionCard({ projectName, title, statusLine, statusVariant, onClick })`
  - `SectionHeader({ label, count })`
  - `SimplifiedTabBar({ tabs, active, onSelect })` where `tabs: { key: string; label: string; icon: ReactNode }[]`
  - `MessageBubble({ role, children })` where `role: "user" | "assistant"`
  - `ListeningBar({ recording, onToggle, disabled })`

- [ ] **Step 1: Create the primitives file**

Create `apps/web/src/components/simplified/SimplifiedPrimitives.tsx`:

```tsx
import { type ReactNode } from "react";

import { cn } from "~/lib/utils";

export function SimplifiedHeader({
  title,
  subtitle,
  left,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
      {left}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{title}</div>
        {subtitle ? (
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>
      {right}
    </header>
  );
}

export function SessionStatusDot({
  variant,
}: {
  variant: "needsYou" | "running" | "done";
}) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        variant === "needsYou" && "bg-warning animate-pulse",
        variant === "running" && "bg-primary animate-pulse",
        variant === "done" && "bg-success",
      )}
      aria-hidden
    />
  );
}

export function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-4 pb-2 text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
      <span>{label}</span>
      <span className="text-muted-foreground/60">· {count}</span>
    </div>
  );
}

export function SessionCard({
  projectName,
  title,
  statusLine,
  statusVariant,
  onClick,
}: {
  projectName: string;
  title: string;
  statusLine: string;
  statusVariant: "needsYou" | "running" | "done";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-4 mb-2 flex w-[calc(100%-2rem)] flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent"
    >
      <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
        <SessionStatusDot variant={statusVariant} />
        <span className="truncate">{projectName}</span>
      </div>
      <div className="truncate text-sm font-semibold text-foreground">{title}</div>
      <div className="truncate text-xs text-muted-foreground">{statusLine}</div>
    </button>
  );
}

export function SimplifiedTabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: ReadonlyArray<{ key: string; label: string; icon: ReactNode }>;
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <nav className="flex shrink-0 border-t border-border">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onSelect(tab.key)}
          className={cn(
            "flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium",
            tab.key === active ? "text-primary" : "text-muted-foreground",
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

export function MessageBubble({
  role,
  children,
}: {
  role: "user" | "assistant";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
        role === "user"
          ? "self-end rounded-br-sm bg-primary/15 text-foreground"
          : "self-start rounded-bl-sm bg-accent text-foreground",
      )}
    >
      {children}
    </div>
  );
}

export function ListeningBar({
  recording,
  onToggle,
  disabled,
}: {
  recording: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mx-4 mb-6 flex shrink-0 items-center gap-3 rounded-full border border-border bg-card px-4 py-2">
      <span className="flex-1 text-xs text-muted-foreground">
        {disabled ? "Voice input off" : recording ? "Listening…" : "Tap the mic to talk"}
      </span>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={recording ? "Stop recording" : "Start recording"}
        className={cn(
          "flex size-10 items-center justify-center rounded-full text-primary-foreground disabled:opacity-40",
          recording ? "bg-primary animate-pulse" : "bg-primary",
        )}
      >
        <MicGlyph />
      </button>
    </div>
  );
}

function MicGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -w typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/simplified/SimplifiedPrimitives.tsx
git commit -m "feat(web): add shared simplified UI primitives"
```

---

### Task 9: Sessions home screen (2A)

**Files:**
- Create: `apps/web/src/components/simplified/SessionsHomeScreen.tsx`

**Interfaces:**
- Consumes: `useThreadShells` from `~/state/entities`; `groupSessionsByStatus`, `classifySession` (Task 7); primitives (Task 8); `useSimplifiedNavigate` (Task 4); `useActiveEnvironmentId`.
- Produces: `SessionsHomeScreen` (default-exported component) rendering greeting header (settings gear), Sessions/Projects tab, grouped list, and a voice CTA that opens a project picker sheet.

- [ ] **Step 1: Create the screen**

Create `apps/web/src/components/simplified/SessionsHomeScreen.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import { FolderIcon, ListIcon, MicIcon, SettingsIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useThreadShells } from "~/state/entities";
import { useSimplifiedNavigate } from "./simplifiedNavigation";
import {
  SectionHeader,
  SessionCard,
  SimplifiedTabBar,
} from "./SimplifiedPrimitives";
import {
  classifySession,
  groupSessionsByStatus,
  type SessionGroupKey,
} from "./sessionsGrouping";

const GROUP_LABELS: Record<SessionGroupKey, string> = {
  needsYou: "Needs you",
  running: "Running",
  done: "Done",
};
const GROUP_ORDER: ReadonlyArray<SessionGroupKey> = ["needsYou", "running", "done"];

function statusLineFor(thread: {
  session: { status: string } | null;
  hasPendingUserInput: boolean;
}): string {
  if (thread.hasPendingUserInput) return "needs your input";
  const status = thread.session?.status;
  return status ? status : "idle";
}

export default function SessionsHomeScreen() {
  const threads = useThreadShells();
  const navigate = useSimplifiedNavigate();
  const [tab, setTab] = useState<"sessions" | "projects">("sessions");

  const grouped = useMemo(
    () => groupSessionsByStatus(threads, 0),
    [threads],
  );

  const byProject = useMemo(() => {
    const map = new Map<string, typeof threads[number][]>();
    for (const thread of threads) {
      const key = thread.projectId as unknown as string;
      const list = map.get(key) ?? [];
      list.push(thread);
      map.set(key, list);
    }
    return map;
  }, [threads]);

  const openThread = (thread: (typeof threads)[number]) => {
    navigate({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: thread.environmentId,
        threadId: thread.id,
      },
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold text-foreground">Sessions</div>
          <div className="text-xs text-muted-foreground">
            {threads.length} {threads.length === 1 ? "agent" : "agents"}
          </div>
        </div>
        <Link
          to="/settings/general"
          aria-label="Open settings"
          className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
        >
          <SettingsIcon className="size-4" />
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {threads.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            No sessions yet.
          </div>
        ) : tab === "sessions" ? (
          GROUP_ORDER.map((key) => {
            const list = grouped[key];
            if (list.length === 0) return null;
            return (
              <section key={key}>
                <SectionHeader label={GROUP_LABELS[key]} count={list.length} />
                {list.map((thread) => (
                  <SessionCard
                    key={thread.id}
                    projectName={String(thread.projectId)}
                    title={thread.title || "Untitled session"}
                    statusLine={statusLineFor(thread)}
                    statusVariant={classifySession(thread)}
                    onClick={() => openThread(thread)}
                  />
                ))}
              </section>
            );
          })
        ) : (
          [...byProject.entries()].map(([projectId, list]) => (
            <section key={projectId}>
              <SectionHeader label={projectId} count={list.length} />
              {list.map((thread) => (
                <SessionCard
                  key={thread.id}
                  projectName={String(thread.projectId)}
                  title={thread.title || "Untitled session"}
                  statusLine={statusLineFor(thread)}
                  statusVariant={classifySession(thread)}
                  onClick={() => openThread(thread)}
                />
              ))}
            </section>
          ))
        )}
      </div>

      <div className="px-4 pb-3">
        <Link
          to="/"
          className="flex w-full items-center gap-3 rounded-full bg-primary px-4 py-3 text-primary-foreground"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-primary-foreground/20">
            <MicIcon className="size-4" />
          </span>
          <span className="text-sm font-semibold">Start new session</span>
        </Link>
      </div>

      <SimplifiedTabBar
        active={tab}
        onSelect={(key) => setTab(key as "sessions" | "projects")}
        tabs={[
          { key: "sessions", label: "Sessions", icon: <ListIcon className="size-5" /> },
          { key: "projects", label: "Projects", icon: <FolderIcon className="size-5" /> },
        ]}
      />
    </div>
  );
}
```

> Note: v1 "Start new session" links to the index (`/`) which surfaces the existing new-session entry. Full in-sheet project-picker-to-draft creation is a follow-up; keeping this grounded in verified navigation avoids depending on the draft-store internals.

- [ ] **Step 2: Typecheck**

Run: `pnpm -w typecheck`
Expected: no new errors. (If `thread.projectId`/`environmentId` need casting, use `String(...)` as shown; `environmentId`/`id` are branded and accepted by the typed `navigate` params.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/simplified/SessionsHomeScreen.tsx
git commit -m "feat(web): add simplified sessions home screen (2A)"
```

---

### Task 10: Transcript + Voice screens and thread host (1C / 3A)

**Files:**
- Create: `apps/web/src/components/simplified/TranscriptScreen.tsx`
- Create: `apps/web/src/components/simplified/VoiceConversationScreen.tsx`
- Create: `apps/web/src/components/simplified/SimplifiedThreadScreen.tsx`

**Interfaces:**
- Consumes: `useThreadMessages`, `useThreadShell` from `~/state/entities`; `ScopedThreadRef`; primitives (Task 8); `useSimplifiedNavigate`; `useVoiceStore` from `~/voice/useVoiceStore`.
- Produces:
  - `TranscriptScreen({ threadRef })` — 1C.
  - `VoiceConversationScreen({ threadRef })` — 3A.
  - `SimplifiedThreadScreen({ threadRef })` — hosts a 3A/1C toggle (default 3A), default-exported.

- [ ] **Step 1: Create `TranscriptScreen.tsx`**

```tsx
import { type ScopedThreadRef } from "@t3tools/client-runtime/environment";

import { useThreadMessages } from "~/state/entities";
import { useVoiceStore } from "~/voice/useVoiceStore";
import { ListeningBar, MessageBubble } from "./SimplifiedPrimitives";

export function TranscriptScreen({ threadRef }: { threadRef: ScopedThreadRef }) {
  const messages = useThreadMessages(threadRef);
  const recording = useVoiceStore((s) => s.recording);
  const toggleRecording = useVoiceStore((s) => s.toggleRecording);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No messages yet.
          </div>
        ) : (
          messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => (
              <MessageBubble key={m.id} role={m.role === "user" ? "user" : "assistant"}>
                {m.text}
              </MessageBubble>
            ))
        )}
      </div>
      <ListeningBar recording={recording} onToggle={toggleRecording} />
    </div>
  );
}
```

- [ ] **Step 2: Create `VoiceConversationScreen.tsx`**

```tsx
import { type ScopedThreadRef } from "@t3tools/client-runtime/environment";

import { useThreadMessages } from "~/state/entities";
import { useVoiceStore } from "~/voice/useVoiceStore";
import { ListeningBar } from "./SimplifiedPrimitives";

export function VoiceConversationScreen({ threadRef }: { threadRef: ScopedThreadRef }) {
  const messages = useThreadMessages(threadRef);
  const recording = useVoiceStore((s) => s.recording);
  const toggleRecording = useVoiceStore((s) => s.toggleRecording);

  const latestAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top half — assistant */}
      <div className="flex shrink-0 basis-1/2 flex-col justify-center gap-3 border-b border-border px-5 py-6">
        <div className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
          {recording ? "Listening" : "Étourmi"}
        </div>
        <p className="line-clamp-6 text-xl leading-snug font-medium text-foreground">
          {latestAssistant?.text ?? "Ready when you are."}
        </p>
      </div>

      {/* Bottom half — user */}
      <div className="flex min-h-0 flex-1 flex-col justify-end">
        <ListeningBar recording={recording} onToggle={toggleRecording} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `SimplifiedThreadScreen.tsx` (host + header + toggle)**

```tsx
import { type ScopedThreadRef } from "@t3tools/client-runtime/environment";
import { ChevronLeftIcon, MessageSquareIcon, MicIcon } from "lucide-react";
import { useState } from "react";

import { useThreadShell } from "~/state/entities";
import { useSimplifiedNavigate } from "./simplifiedNavigation";
import { SimplifiedHeader } from "./SimplifiedPrimitives";
import { TranscriptScreen } from "./TranscriptScreen";
import { VoiceConversationScreen } from "./VoiceConversationScreen";

export default function SimplifiedThreadScreen({
  threadRef,
}: {
  threadRef: ScopedThreadRef;
}) {
  const shell = useThreadShell(threadRef);
  const navigate = useSimplifiedNavigate();
  const [view, setView] = useState<"voice" | "transcript">("voice");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SimplifiedHeader
        left={
          <button
            type="button"
            aria-label="Back to sessions"
            onClick={() => navigate({ to: "/" })}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
        }
        title={shell?.title || "Session"}
        subtitle={shell?.session?.status ?? undefined}
        right={
          <button
            type="button"
            aria-label={view === "voice" ? "Open transcript" : "Open voice view"}
            onClick={() => setView((v) => (v === "voice" ? "transcript" : "voice"))}
            className="flex size-9 items-center justify-center rounded-full text-primary hover:bg-accent"
          >
            {view === "voice" ? (
              <MessageSquareIcon className="size-4" />
            ) : (
              <MicIcon className="size-4" />
            )}
          </button>
        }
      />
      {view === "voice" ? (
        <VoiceConversationScreen threadRef={threadRef} />
      ) : (
        <TranscriptScreen threadRef={threadRef} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm -w typecheck`
Expected: no new errors. Confirm `useVoiceStore` selector signatures (`recording`, `toggleRecording`) match `~/voice/useVoiceStore`; if `toggleRecording` requires args, wrap in `() => toggleRecording()`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/simplified/TranscriptScreen.tsx apps/web/src/components/simplified/VoiceConversationScreen.tsx apps/web/src/components/simplified/SimplifiedThreadScreen.tsx
git commit -m "feat(web): add simplified transcript, voice, and thread host screens (1C/3A)"
```

---

### Task 11: Route branching (wire screens into existing routes)

**Files:**
- Modify: `apps/web/src/routes/_chat.index.tsx`
- Modify: `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`
- Modify: `apps/web/src/routes/_chat.draft.$draftId.tsx`

**Interfaces:**
- Consumes: `useSimplifiedMode` (Task 2); `SessionsHomeScreen` (Task 9); `SimplifiedThreadScreen` (Task 10); existing `resolveThreadRouteRef`.

- [ ] **Step 1: Branch `_chat.index.tsx`**

Add imports:

```ts
import { useSimplifiedMode } from "../components/simplified/useSimplifiedMode";
import SessionsHomeScreen from "../components/simplified/SessionsHomeScreen";
```

At the top of `ChatIndexRouteView`, before the existing returns:

```tsx
  const simplified = useSimplifiedMode();
  if (simplified) {
    return <SessionsHomeScreen />;
  }
```

- [ ] **Step 2: Branch the thread route**

In `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`, add imports:

```ts
import { useSimplifiedMode } from "../components/simplified/useSimplifiedMode";
import SimplifiedThreadScreen from "../components/simplified/SimplifiedThreadScreen";
```

In `ChatThreadRouteView`, after `threadRef` is resolved and before the normal render, add:

```tsx
  const simplified = useSimplifiedMode();
  if (simplified && threadRef) {
    return <SimplifiedThreadScreen threadRef={threadRef} />;
  }
```

(Place this after the existing hooks so hook order stays stable; the early return is after all hooks are called — move it to just before the final `return` of the component, guarded by `threadRef`.)

- [ ] **Step 3: Branch the draft route**

In `apps/web/src/routes/_chat.draft.$draftId.tsx`, mirror Step 2: when `simplified` is on, render `SimplifiedThreadScreen` with the draft's resolved `ScopedThreadRef` (use the same ref resolution the file already performs). If the draft has no server ref yet, render `SessionsHomeScreen` as a safe fallback:

```tsx
  const simplified = useSimplifiedMode();
  if (simplified) {
    return draftThreadRef ? (
      <SimplifiedThreadScreen threadRef={draftThreadRef} />
    ) : (
      <SessionsHomeScreen />
    );
  }
```

Add the matching imports at the top.

- [ ] **Step 4: Typecheck**

Run: `pnpm -w typecheck`
Expected: no new errors. Ensure the early returns come after all hook calls (React rules-of-hooks) — if lint flags conditional hooks, move the `useSimplifiedMode()` call to the top with the other hooks and keep only the `return` conditional near the end.

- [ ] **Step 5: Lint**

Run: `pnpm --filter @t3tools/web lint` (or repo lint command)
Expected: no rules-of-hooks violations, no unused imports.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/_chat.index.tsx apps/web/src/routes/_chat.\$environmentId.\$threadId.tsx apps/web/src/routes/_chat.draft.\$draftId.tsx
git commit -m "feat(web): render simplified screens on chat routes when active"
```

---

### Task 12: Full-suite verification + manual end-to-end pass

**Files:** none (verification only)

- [ ] **Step 1: Run all new unit tests**

Run:
```bash
pnpm --filter @t3tools/contracts vitest run src/settings.simplified.test.ts
pnpm --filter @t3tools/web vitest run src/components/simplified
```
Expected: all PASS.

- [ ] **Step 2: Typecheck + lint the whole workspace**

Run: `pnpm -w typecheck && pnpm -w lint`
Expected: clean (no new errors).

- [ ] **Step 3: Manual end-to-end (dev server)**

Run `pnpm --filter @t3tools/web dev`, then verify each acceptance criterion:
1. `/?simplified=true` → bare mobile shell, Sessions home (2A) with grouped sessions.
2. Tap a session → thread screen opens in voice view (3A); URL keeps `?simplified=true`.
3. Toggle the header button → transcript view (1C) shows message bubbles; toggle back → 3A.
4. Back button → returns to 2A with param intact.
5. Settings gear on 2A → `/settings/general` with param intact.
6. Settings → General → "Simplified mobile view" toggle off → normal app returns, param removed; toggle on → param added, shell switches.
7. Reload with the setting on but no param in URL → simplified shell still active (setting fallback).
8. Mic button reflects `useVoiceStore.recording`; if STT disabled, controls behave per existing gating.

- [ ] **Step 4: Commit any fixes discovered, then final commit**

```bash
git add -A
git commit -m "test(web): verify simplified mobile view end-to-end"
```

---

## Self-Review

**Spec coverage:**
- Query param `simplified=true` → Tasks 3 (schema/middleware), 2 (parse/resolve). ✓
- Persist during navigation → Task 3 (`retainSearchParams`) + Task 4 helper. ✓
- Settings/General toggle → Tasks 1 (contract), 6 (UI). ✓
- Full-app replacement shell → Task 5. ✓
- 2A sessions home (status/project grouping, settings entry, voice CTA) → Tasks 7, 9. ✓
- 1C transcript → Task 10. ✓
- 3A unified voice split → Task 10. ✓
- Navigable between screens → Tasks 9, 10, 11. ✓
- Settings accessible from simple chat view → Task 9 (gear → /settings/general). ✓
- Theme = t3code tokens only → enforced in Global Constraints + Tasks 8-10. ✓
- Reuse voice stack → Task 10 (`useVoiceStore`). ✓

**Deferred (documented non-goals):** ember palette, 3A question/verify UI, wake-word, in-sheet draft creation from the project picker (v1 links to `/`).

**Type consistency:** `SessionGroupKey`/`classifySession`/`groupSessionsByStatus` names consistent across Tasks 7, 9. `parseSimplifiedSearch`/`resolveSimplifiedMode`/`useSimplifiedMode` consistent across Tasks 2, 3, 6, 11. `SimplifiedThreadScreen`/`SessionsHomeScreen` default exports match their import sites in Task 11. `ScopedThreadRef` used consistently in Task 10.

**Known verification points flagged for the implementer (resolve during typecheck, not placeholders):**
- `useVoiceStore` selector names (`recording`, `toggleRecording`) — confirm and adapt if the store exposes different names (Task 10 Step 4).
- Draft route's existing `ScopedThreadRef` resolution variable name (`draftThreadRef`) — match the file's actual identifier (Task 11 Step 3).
- Rules-of-hooks: keep `useSimplifiedMode()` with the other top-level hooks; only the `return` is conditional (Task 11 Step 4).
