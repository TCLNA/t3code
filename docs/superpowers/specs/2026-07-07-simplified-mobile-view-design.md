# Simplified Mobile View — Design

**Date:** 2026-07-07
**Status:** Approved, ready for implementation plan
**Source design:** "Étourmi / Ember Voice Orchestrator" mockup (`/home/thomas/Lab/Etourmi Voice Orchestrator.html`) — screens 3A, 2A, 1C.

## Summary

Add a **simplified mobile view** that replaces the entire app shell when
`simplified=true` is present in the URL query string. The param **persists
during navigation** and is **togglable from Settings → General**. When active,
the app renders three navigable mobile screens adapted from the mockup:

- **2A — Sessions home**: every agent/session at a glance, grouped by session
  status or by project, with a settings entry point and a voice CTA.
- **1C — Spoken transcript**: the full scrollable conversation for one thread.
- **3A — Unified voice conversation**: split mobile layout — assistant output on
  top, user composer/mic on bottom.

The simplified view adopts the mockup's **layout structure only**. It uses
t3code's existing theme tokens (Tailwind v4 semantic classes). The mockup's
dark "ember" palette is intentionally **not** ported in this iteration (left on
standby as a possible follow-up).

## Goals

1. `simplified=true` query param toggles a full-app-replacement mobile shell.
2. The param persists across all in-app navigation.
3. A Settings → General toggle controls the default (persisted client setting).
4. Three screens (2A, 1C, 3A) render from **real app data** and are navigable.
5. Settings remain accessible from the simplified view (2A gear icon).

## Non-goals (this iteration)

- Porting the ember color palette / dark theme from the mockup.
- The full question/verify state machine from mockup 3A (single/multi-select
  option cards, "write another", verify-before-send review cards). v1 shows the
  existing composer + latest assistant turn; the richer turn UI is a follow-up.
- Rebuilding voice STT/TTS — the existing `apps/web/src/voice/` stack is reused.
- Desktop-specific chrome; the simplified view targets mobile viewports but is
  reachable on any viewport when the param/setting is set.

## Activation & persistence

### Query param

- Add a typed search param `simplified?: boolean` to the **`__root`** route via
  TanStack Router `validateSearch`. Root-level so it is available app-wide and
  inheritable by every child route.
- Parsing is lenient: `?simplified=true` / `?simplified=1` → `true`; absent or
  any other value → `undefined` (falls back to the setting).

### Resolution hook

`useSimplifiedMode(): boolean` resolves in this order:

1. If the `simplified` search param is explicitly present, **it wins**
   (`true` or `false`).
2. Otherwise fall back to the persisted **client setting**
   `simplifiedMobileView` (localStorage tier, via `useClientSettings` —
   same mechanism as theme / word-wrap).
3. Default `false`.

### Persistence during navigation

- TanStack search params are **not** inherited by default. Add root-level
  search **middleware** (`search.middlewares`, e.g. `retainSearchParams
  (['simplified'])`) so the param is carried across all navigations
  automatically, plus a `useSimplifiedNavigate()` / `<SimplifiedLink>` helper
  used by simplified-screen navigation to be explicit.
- When the client setting is `true` but the URL lacks the param, the resolver
  still returns `true`, so behavior is stable even on a fresh load without the
  param. Toggling the setting on also writes `?simplified=true` to the URL for
  shareable links.

### Settings toggle

- New `Switch` row in `GeneralSettingsPanel`
  (`apps/web/src/components/settings/SettingsPanels.tsx`), label
  "Simplified mobile view", helper text describing it.
- Wired to the **client** settings tier: add `simplifiedMobileView: boolean`
  to the client settings shape; toggle via `useUpdateClientSettings()`.
- On toggle **on**: persist setting and navigate to add `?simplified=true`.
  On toggle **off**: persist and remove the param.

## Architecture — Approach A (layout swap, reuse existing routes)

Chosen over (B) dedicated new routes and (C) a self-contained overlay, because
A satisfies "persist during navigation" for free via search inheritance, keeps
one source of truth for thread/message data, and reuses the composer + voice
stack.

### Root shell swap

In `apps/web/src/routes/__root.tsx`, when `useSimplifiedMode()` is `true`,
render a bare `SimplifiedLayout` (no `AppSidebarLayout`, no desktop sidebar)
wrapping `<Outlet/>`. When `false`, render the existing `AppSidebarLayout`
unchanged. The `_chat` layout's `VoiceTtsProvider` remains in place so TTS is
available to the simplified screens.

### Route → screen mapping

Existing chat routes branch on `useSimplifiedMode()`:

| Route | Normal | Simplified |
|---|---|---|
| `_chat.index` | empty state | **2A — Sessions home** |
| `_chat.$environmentId.$threadId` | `ChatView` | **3A / 1C** (in-view tab toggle) |
| `_chat.draft.$draftId` | draft `ChatView` | **3A** (new/draft session voice view) |
| `settings.*` | settings panels | unchanged (reachable from 2A gear) |

3A and 1C are two tabs of the same thread route, matching the mockup's
reciprocal "open chat view" / "open voice view" buttons. Tab state is local
component state (not a route), defaulting to 3A (voice) for an active/running
session and 1C (transcript) otherwise; both preserve the `simplified` param.

## Components

New directory `apps/web/src/components/simplified/`:

- `SimplifiedLayout.tsx` — bare mobile shell (status-bar-safe padding via
  existing `pt-safe`/`pb-safe` utilities), renders `<Outlet/>`.
- `SessionsHomeScreen.tsx` (2A) — greeting header (avatar + "Morning, {name}"
  derived from available profile/host info, or a neutral greeting), settings
  gear button → `/settings/general`, a tab toggle **Sessions | Projects**, the
  grouped session list, a voice CTA pill, and a project-picker bottom sheet.
- `TranscriptScreen.tsx` (1C) — header (back, thread title + status, "open
  voice view" button), a scrollable message thread, a bottom listening/mic bar.
- `VoiceConversationScreen.tsx` (3A) — split layout: top = latest assistant
  turn + speaking indicator (from `VoiceTtsProvider`); bottom = composer/mic
  input; "open transcript" button.
- Shared presentational pieces: `SessionCard`, `SessionStatusBadge`,
  `SimplifiedMessageBubble`, `SimplifiedTabBar`, `ProjectPickerSheet`,
  `ListeningBar`, `SpeakingIndicator`. All use t3code tokens.
- `useSimplifiedMode.ts` — the resolution hook.
- `simplifiedNavigation.ts` — `useSimplifiedNavigate` / search-inheritance
  helper.

## Data mapping

All from existing state hooks (`apps/web/src/state/entities.ts`); no new
server contracts.

### 2A — Sessions home

- List: `useThreadShells()` / `useThreadShellsForProjectRefs()`.
- **Group by status** (default tab):
  - **Needs you** — `thread.hasPendingUserInput || thread.hasPendingApprovals
    || thread.hasActionableProposedPlan`.
  - **Running** — `thread.session?.status === "running" | "starting"`.
  - **Done today** — no active session and `updatedAt` within today.
  - Reuse status-derivation helpers from
    `apps/web/src/components/Sidebar.logic.ts` where they exist; extract shared
    helpers rather than duplicating.
- **Group by project** (Projects tab): existing project→threads grouping.
- Card content per thread: project name, status affordance
  (running indicator / needs-you dot / done check), `title`, and a status/
  latest-turn line.
- Voice CTA → project-picker sheet → create/open a thread (reuse existing
  new-thread/draft creation path), navigating with the `simplified` param.

### 1C — Transcript

- `useThreadMessages(ref)` → `OrchestrationMessage { role, text, attachments,
  createdAt, ... }` rendered as bubbles: `role === "user"` right-aligned,
  `assistant` left-aligned.
- Interleave step/action rows from `useThreadActivities(ref)`.
- Bottom listening bar reuses `useVoiceDictation` + `useVoiceStore` for mic
  state; input inserts transcript into the thread's composer/send path.

### 3A — Unified voice

- Top: latest assistant message/turn text + a speaking indicator driven by the
  existing `VoiceTtsProvider` (`useVoiceTts`) narration state.
- Bottom: reuse the existing dictation + send path. v1 keeps the composer
  interaction simple (mic + text), deferring the mockup's option/verify cards.

## Theme

Layout only. Colors, radii, spacing use t3code semantic tokens
(`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`,
`bg-primary`, `border-border`, `--radius-*`). No new palette. Verified the app
uses Tailwind v4 CSS-first tokens in `apps/web/src/index.css`.

## Error / edge handling

- No threads → 2A shows an empty state with the voice CTA.
- Thread not found / unavailable → simplified thread route shows a minimal
  error card with a back link to 2A (param preserved).
- Voice unavailable (STT/TTS settings disabled) → mic controls render disabled
  with a hint, matching existing gating (`settings.speech.sttEnabled` /
  `ttsEnabled`).
- Toggling the setting or param mid-session swaps the shell without a reload;
  active thread/route is preserved.

## Testing

- **Unit**
  - `validateSearch` parses `simplified` leniently (`true`/`1`/absent/junk).
  - `useSimplifiedMode` resolution: param present overrides setting; absent
    falls back to setting; default false.
  - Search-inheritance helper keeps `simplified` across navigations.
  - Settings toggle writes the client setting and updates the URL param.
- **Component**
  - 2A status grouping from sample `EnvironmentThreadShell` fixtures
    (needs-you / running / done buckets).
  - 1C renders user vs assistant bubbles from sample `OrchestrationMessage[]`.
- Use existing Vitest infra (`*.test.ts` / `*.test.tsx`).

## Open follow-ups (not in this iteration)

- Ember palette / dark theme port as an opt-in simplified theme.
- Full 3A question/verify turn UI (option cards, write-another, verify review).
- Wake-word ("hey …") always-listening affordance shown in the mockup.
