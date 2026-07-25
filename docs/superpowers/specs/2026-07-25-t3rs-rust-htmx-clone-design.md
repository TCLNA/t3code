# t3rs — a Rust + HTMX clone of T3 Code (design)

**Date:** 2026-07-25
**Status:** Draft for review
**Author:** thomas (with Claude)

## 1. Motivation & goals

Rebuild the core of [T3 Code](../../../README.md) — a web GUI for coding agents — as a
single Rust binary that serves a server-rendered HTMX frontend. The driving
motivation is to run the whole thing without a Node.js runtime: one static Rust
executable + a SQLite file, wrapping the `claude` CLI.

This spec covers **milestone 1** only. Later providers (Codex, OpenCode, Cursor),
desktop/mobile shells, cloud, and checkpoints are explicitly out of scope here,
but the design keeps clean seams for them.

### Milestone 1 — definition of done

- Register one or more **projects** (working directories).
- Create **multiple concurrent sessions** across projects, listed in a sidebar.
- In a session: type a prompt, watch the Claude agent stream its work
  (assistant text, tool calls, tool results, final result) live in the browser.
- History and the session list **survive a server restart** (SQLite), and a
  reopened session can be **resumed** so the agent keeps its context.
- Single user, localhost, no auth.

### Non-goals (milestone 1)

Multiple providers; permission prompts / interactive tool approval UI; rich diff
review; checkpoints/rollback; multi-user or remote auth; desktop/mobile packaging;
marketing site. Where a decision touches these, we prefer the option that leaves a
seam rather than one that builds the feature.

## 2. Architecture

A single Rust binary crate (working name `t3rs`), Tokio-based, `axum` for HTTP.

```
Browser (HTMX + SSE)
   │  GET pages (full HTML)   POST forms (create session, send prompt, stop)
   │  GET /sessions/:id/events  (SSE stream of HTML fragments)
   ▼
axum server ────────────────────────────────────────────────┐
  web::   pages / session handlers / SSE stream / maud render │
  agent:: SessionActor registry (one live actor per session)  │
  db::    sqlx SQLite pool (projects, sessions, events)        │
   │                                                           │
   └── SessionActor owns a `claude` child process ─────────────┘
         (stdin = user messages as stream-json,
          stdout = agent events as stream-json lines)
```

### 2.1 Crate layout

```
src/
  main.rs            // axum app setup, router, config load, startup, migrations
  config.rs          // env/CLI: bind addr, db path, claude binary path, default project dir
  error.rs           // AppError -> IntoResponse
  db/
    mod.rs           // sqlx pool, migrations runner
    projects.rs      // project CRUD
    sessions.rs      // session CRUD (+ claude_session_id, status)
    events.rs        // append-only event log; read-by-session; append; last seq
  agent/
    mod.rs           // AgentEvent domain type, SessionActor, public handle API
    process.rs       // spawn/manage the `claude` child (stdin/stdout/stderr)
    protocol.rs      // serde types for claude stream-json in/out
    normalize.rs     // raw claude events -> normalized AgentEvent
    registry.rs      // DashMap<session_id, SessionHandle> of live actors
  web/
    mod.rs           // router wiring, shared AppState
    pages.rs         // full-page GET handlers (home, project, session view)
    projects.rs      // POST create project
    sessions.rs      // POST create session, POST send prompt, POST stop, POST resume
    stream.rs        // GET /sessions/:id/events -> SSE of HTML fragments
    render.rs        // maud: layout + every event fragment
  assets/            // htmx.min.js, sse extension, app.css (served static, vendored)
migrations/          // sqlx migrations (0001_init.sql, ...)
```

### 2.2 Module boundaries

- `agent::` has **no** HTTP or HTML knowledge. It owns child processes and emits
  typed `AgentEvent`s. Testable by feeding recorded stdout fixtures.
- `web::` has **no** knowledge of how a child process works. It subscribes to a
  session's event stream (live broadcast + DB replay) and renders HTML.
- `db::` is pure persistence — no business logic, no rendering.
- `AppState { db: SqlitePool, registry: Arc<Registry>, config: Arc<Config> }` is
  the only shared state, cloned into handlers.

## 3. Data model (SQLite, via sqlx)

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,      -- uuid v4
  path        TEXT NOT NULL UNIQUE,  -- absolute dir
  name        TEXT NOT NULL,         -- display name (defaults to basename)
  created_at  INTEGER NOT NULL       -- unix millis
);

CREATE TABLE sessions (
  id                TEXT PRIMARY KEY, -- our uuid, stable across resume
  project_id        TEXT NOT NULL REFERENCES projects(id),
  title             TEXT NOT NULL,    -- from first prompt; editable later
  claude_session_id TEXT,             -- from claude 'system/init'; used for --resume
  status            TEXT NOT NULL,    -- 'idle' | 'running' | 'error'
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT, -- global order; used as SSE id
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  seq         INTEGER NOT NULL,       -- per-session monotonic sequence
  kind        TEXT NOT NULL,          -- see AgentEvent kinds (§4.3)
  payload     TEXT NOT NULL,          -- JSON of the normalized AgentEvent
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_events_session_seq ON events(session_id, seq);
```

Usage:

- **History render** = `SELECT ... WHERE session_id=? ORDER BY seq`, each row → fragment.
- **Live tail** = SSE replays events with `id > Last-Event-ID`, then follows the
  broadcast channel. `events.id` is the SSE event id, so reconnect is gap-free.
- **Resume** = a reopened session spawns `claude --resume <claude_session_id>`; the
  `events` log already drives the UI, so display is instant.
- `payload` is our **normalized** shape, not raw Claude JSON — the seam that keeps
  future providers out of the schema.

Timestamps are unix millis (`i64`). UUIDs via the `uuid` crate. Time is injected
through a small `Clock` trait so tests are deterministic (no wall-clock in logic).

## 4. Claude Code integration

### 4.1 Spawn

One child process per **running turn** of a session:

```
claude -p
  --input-format stream-json
  --output-format stream-json
  --verbose
  --permission-mode acceptEdits        # M1 default; configurable later
  [--resume <claude_session_id>]       # when the session already has one
```

The working directory is set via `Command::current_dir(project.path)` (robust and
flag-independent), not a CLI flag — see §11.

Notes:

- `-p/--print` + `stream-json` on both ends is the documented programmatic mode.
- `--input-format stream-json` lets us keep stdin open and send the user message as
  a JSON line, rather than passing the prompt as an argv.
- We rely on Claude Code's own session persistence for agent context; `--resume`
  rehydrates it. Our DB is the source of truth for _what the UI shows_.
- `--permission-mode acceptEdits` is a milestone-1 simplification (no interactive
  approval UI yet). A later milestone adds `manual` mode + an approval fragment.
  This is called out as a deliberate, logged simplification, not silently assumed.

### 4.2 Process I/O

- **stdin**: newline-delimited JSON. To send a user turn we write one
  `{"type":"user","message":{"role":"user","content":[{"type":"text","text": ...}]}}`
  line (exact shape pinned against the installed CLI during Task 1; see §11).
- **stdout**: newline-delimited JSON, one event per line. A `BufReader::lines()`
  loop parses each into `protocol::RawEvent` (serde, with a permissive
  `#[serde(other)]`/untagged fallback so unknown event types don't crash the loop).
- **stderr**: captured to `tracing` and, on nonzero exit, surfaced as an `error`
  AgentEvent.

### 4.3 Normalized event model

`protocol.rs` deserializes Claude's raw stream; `normalize.rs` maps it to the
provider-agnostic `AgentEvent` that everything downstream (DB, render) uses:

```rust
enum AgentEvent {
    SessionInit { claude_session_id: String, model: String },
    AssistantText { text: String },              // streamed/aggregated assistant message
    ToolUse { id: String, name: String, input: serde_json::Value },
    ToolResult { id: String, ok: bool, content: String },
    Result { ok: bool, summary: Option<String> }, // turn finished
    Error { message: String },
}
```

- `SessionInit` carries the `claude_session_id`, which the actor writes back to
  `sessions.claude_session_id` on first turn.
- Streaming granularity: milestone 1 renders **per-message** (each assistant/tool
  event is one appended fragment). Token-level partial streaming
  (`--include-partial-messages`) is a fast follow, not required for M1, and slots
  in as additional `AssistantText` deltas targeting the same bubble.
- Unknown raw event kinds → dropped with a `tracing::debug`, never fatal.

### 4.4 SessionActor lifecycle

One `SessionActor` per **live** session, spawned on demand (first prompt, or reopen
of a session whose actor isn't resident). It owns:

- the `Child` (or `None` when idle between turns),
- a `broadcast::Sender<StoredEvent>` (fan-out to SSE subscribers),
- the per-session `seq` counter.

Command channel (`mpsc`) accepts: `SendPrompt(String)`, `Stop`, `Shutdown`.
Main loop:

1. `SendPrompt`: if no child, spawn one (`--resume` if we have an id); mark session
   `running`; append a `user` event (persist + broadcast); write the JSON line to
   stdin.
2. For each stdout line: normalize → assign `seq` → `db::events::append` →
   `broadcast.send(StoredEvent{ id, seq, event })`. On `SessionInit`, persist
   `claude_session_id`. On `Result`, mark session `idle` and drop the child (turns
   are one child each in M1 — simplest correct model; a long-lived child is a later
   optimization).
3. `Stop`: kill the child, append an `error`/`result` event, mark `idle`.
4. On unexpected child exit: append `error`, mark `error`.

Registry (`DashMap`) hands out `SessionHandle { cmd_tx, broadcast_tx }`. Idle actors
may be evicted; reopening respawns from DB + `--resume`.

## 5. Web layer & HTMX wiring

### 5.1 Routes

| Method | Path                     | Purpose                                       | Response                              |
| ------ | ------------------------ | --------------------------------------------- | ------------------------------------- |
| GET    | `/`                      | Home: project list + global session list      | full page                             |
| POST   | `/projects`              | Add a project (path form)                     | redirect / OOB sidebar row            |
| GET    | `/projects/:id`          | Project view: its sessions + new-session form | full page                             |
| POST   | `/sessions`              | Create session (project_id, first prompt)     | redirect to session view              |
| GET    | `/sessions/:id`          | Session view: history + composer + SSE hookup | full page                             |
| POST   | `/sessions/:id/messages` | Send a prompt (HTMX form)                     | 204 (user echo arrives via SSE, §5.2) |
| POST   | `/sessions/:id/stop`     | Stop current turn                             | 204 / status fragment                 |
| GET    | `/sessions/:id/events`   | SSE: replay + live tail of HTML fragments     | `text/event-stream`                   |
| GET    | `/assets/*`              | Vendored htmx, sse ext, css                   | static                                |

### 5.2 Streaming contract

The session view contains a transcript container:

```html
<div
  id="transcript"
  hx-ext="sse"
  sse-connect="/sessions/{id}/events"
  sse-swap="message"
  hx-swap="beforeend"
></div>
```

The SSE endpoint emits, per event, an `event: message` frame whose `data` is a
rendered maud fragment (e.g. an assistant bubble or tool-call card), and an `id:`
equal to `events.id`. HTMX appends each into `#transcript`. Because each SSE frame
carries `id`, the browser sends `Last-Event-ID` on reconnect and the server replays
only the gap.

Multi-line HTML is encoded per the SSE spec (each line prefixed with `data:`); a
small `sse_frame(id, "message", html)` helper handles this.

Sending a prompt: the composer form does `hx-post="/sessions/:id/messages"` with
`hx-swap="none"` — the server returns nothing (204) because the user bubble arrives
through the SSE stream like every other event, keeping a single ordered source of
truth (avoids the double-render race of optimistic append + stream echo).

Turn status (running/idle, stop button enabled) is delivered as an **out-of-band**
fragment (`hx-swap-oob`) targeting a `#turn-status` element on relevant events
(`user` → running, `result` → idle).

### 5.3 UI surfaces (maud)

- **Layout**: left sidebar (projects → sessions, live-updating), main pane.
- **Session view**: header (title, project, status), `#transcript`, composer form.
- **Fragments**: `assistant_bubble`, `user_bubble`, `tool_use_card`
  (name + collapsible input), `tool_result_card` (ok/err + output), `result_line`,
  `error_line`, `turn_status`. One function per fragment in `render.rs`.
- Styling: a single hand-written `app.css` (dark, terminal-ish). No build step, no
  Tailwind, no bundler — vendored HTMX + one CSS file is the whole frontend
  toolchain. That is itself a spite feature.

## 6. Error handling

- `AppError` (`thiserror`) with variants `Db`, `Agent`, `NotFound`, `BadRequest`,
  `Internal`; `IntoResponse` renders an HTML error fragment (for HTMX swaps) or a
  full error page (for full-page GETs), chosen by the `HX-Request` header.
- Agent/process failures never take down the server: they become `Error`
  AgentEvents on the affected session only.
- The stdout parse loop tolerates malformed/unknown lines (log + skip); only a
  child crash or broken pipe ends a turn (→ `error` status).
- SSE connections are per-request; a dropped browser just unsubscribes from the
  broadcast. The actor keeps running (its output still persists to DB).
- DB writes for the event log are the durability boundary: an event is broadcast
  **only after** it is persisted, so a reconnect can always replay it.

## 7. Configuration

Env vars (with defaults), overridable by CLI flags:

- `T3RS_BIND` (default `127.0.0.1:3773`)
- `T3RS_DB` (default `./t3rs.sqlite`)
- `T3RS_CLAUDE_BIN` (default `claude` on `PATH`)
- `T3RS_DEFAULT_PROJECT` (optional; seeds one project on first run for convenience)

Config is loaded once into `Arc<Config>`. No config file in M1.

## 8. Testing strategy

Test-driven where it pays off:

- **`normalize.rs`** (highest value): table-driven tests mapping recorded raw
  Claude stdout lines → expected `AgentEvent`s. We capture a real fixture during
  Task 1 by running `claude -p --output-format stream-json` on a throwaway prompt
  and saving the JSONL. This pins the protocol against the installed CLI.
- **`db::events`**: append + read-by-session ordering; `seq` monotonicity; replay
  after a given id.
- **SessionActor**: driven with a **fake process** — `process.rs` is abstracted
  behind a trait (`AgentProcess`) with a real `claude` impl and a scripted test
  impl that emits fixture lines. Lets us assert the actor persists+broadcasts in
  order, updates `claude_session_id`, and flips status on `result` — no real CLI.
- **Web handlers**: `axum` router tested with `tower::ServiceExt::oneshot` — assert
  routes, redirects, and that the SSE endpoint replays persisted events. Fragment
  rendering asserted by substring/DOM checks on maud output.
- **One end-to-end smoke test** (ignored by default, run manually / in a nightly
  job) that spawns the real `claude` against a temp dir and asserts a full turn
  streams to completion. Kept out of the default `cargo test` so the suite needs no
  network/credentials.

## 9. Build sequence (for the implementation plan)

Each step is independently testable and leaves the app runnable.

1. **Skeleton**: crate, `axum` hello page, config, `sqlx` pool + `0001_init.sql`
   migration, static asset serving. Capture a real Claude stream-json fixture and
   commit it to `tests/fixtures/`.
2. **Protocol + normalize**: `protocol.rs`, `normalize.rs`, TDD against the fixture.
3. **DB layer**: projects/sessions/events CRUD + tests.
4. **Process abstraction**: `AgentProcess` trait, scripted fake, real `claude` impl.
5. **SessionActor + registry**: lifecycle over the fake process; tests for
   persist/broadcast/status.
6. **Web read paths**: home, project view, session view rendering history from DB
   (no live streaming yet).
7. **Create flows**: add project, create session (spawns actor, first turn).
8. **SSE streaming**: `/sessions/:id/events`, HTMX wiring, live transcript append,
   `Last-Event-ID` replay, turn-status OOB.
9. **Send prompt + stop** on a live/existing session; resume path (`--resume`).
10. **Polish**: styling pass, error fragments, restart-survival manual test, README.

## 10. Future seams (not built now, but designed around)

- **More providers**: `agent::` already emits normalized `AgentEvent`; add a
  `Provider` trait alongside `process.rs` and a `provider` column on `sessions`.
- **Permission prompts**: `manual` permission mode + a `tool_approval` AgentEvent
  and an interactive fragment that POSTs an allow/deny.
- **Token-level streaming**: `--include-partial-messages` → `AssistantText` deltas
  swapping the same bubble instead of appending.
- **Diffs / checkpoints**: new event kinds + tables; the append-only log already
  supports it.

## 11. Open questions / to verify during Task 1

- Exact stdin JSON shape the installed `claude` (v2.1.219) accepts for a user turn
  in `--input-format stream-json` — pin against the real CLI, adjust `protocol.rs`.
- Whether `--cwd` is the correct flag name for setting the working directory (vs.
  spawning the child with `current_dir`). Default to `Command::current_dir` if the
  flag is absent — more robust anyway.
- Confirm `--permission-mode acceptEdits` behaves non-interactively under `-p`
  (no blocking on approvals) for M1.

```

```
