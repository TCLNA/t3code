# t3rs Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single Rust binary that serves a server-rendered HTMX web GUI for the `claude` CLI — projects, multiple concurrent live-streaming sessions, and SQLite-backed history that survives restarts.

**Architecture:** `axum` HTTP server (Tokio) with three module boundaries: `agent` (owns `claude` child processes, emits normalized `AgentEvent`s), `web` (renders maud HTML, serves SSE), `db` (sqlx SQLite). One `SessionActor` per live session fans agent output over a `tokio::broadcast` channel that any number of SSE connections tail. The append-only `events` table is both the render source and the SSE replay log.

**Tech Stack:** Rust 1.96, axum 0.8, tokio 1, sqlx 0.8 (sqlite), maud 0.27, serde/serde_json 1, uuid 1, dashmap 6, thiserror 2, tracing 0.1, tower-http 0.6, HTMX (vendored) + SSE extension.

**Spec:** `docs/superpowers/specs/2026-07-25-t3rs-rust-htmx-clone-design.md`

## Global Constraints

- **Location:** the new crate lives at `apps/t3rs/` inside this repo (sibling to the Node apps). It is a standalone `cargo` project; it does not join the pnpm workspace.
- **axum 0.8 path syntax:** route params are `/{id}`, NOT `/:id`. Handlers extract with `Path(id): Path<String>`.
- **No wall-clock in logic:** all timestamps come through a `Clock` trait (`now_millis() -> i64`); production uses `SystemClock`, tests use a fixed clock. UUIDs likewise come through an `Ids` trait so tests are deterministic.
- **Persist-before-broadcast:** an `AgentEvent` is written to `events` BEFORE it is sent on the broadcast channel. Never broadcast an unpersisted event.
- **agent:: has no HTTP/HTML; web:: has no process knowledge; db:: has no business logic.** Keep these boundaries.
- **Every commit compiles and `cargo test` passes.** Warnings-as-noise is fine; failing tests are not.
- **Claude spawn flags (verified against installed CLI v2.1.219):** `claude -p --input-format stream-json --output-format stream-json --verbose --permission-mode acceptEdits [--resume <id>]`, with `Command::current_dir(project.path)`.

---

## File Structure

Created across the plan (all under `apps/t3rs/`):

```
Cargo.toml
migrations/0001_init.sql
tests/fixtures/claude_stream_basic.jsonl     # real captured Claude output
src/
  main.rs            # startup: config, pool, migrations, registry, router, serve
  config.rs          # Config, from_env()
  clock.rs           # Clock + Ids traits, System/Uuid impls, fixed test impls
  error.rs           # AppError, IntoResponse
  db/
    mod.rs           # connect_and_migrate() -> SqlitePool
    projects.rs      # Project, insert/list/get
    sessions.rs      # Session, SessionStatus, insert/list/get/set_status/set_claude_id
    events.rs        # StoredEvent, append, list_by_session, list_after
  agent/
    mod.rs           # AgentEvent, re-exports
    protocol.rs      # RawEvent (serde of claude stream-json), OutgoingUser
    normalize.rs     # normalize(RawEvent) -> Option<AgentEvent>
    process.rs       # AgentProcess trait, ClaudeProcess, spawn params
    actor.rs         # SessionActor, SessionHandle, SessionCommand
    registry.rs      # Registry (DashMap<String, SessionHandle>)
  web/
    mod.rs           # AppState, router()
    render.rs        # maud: layout + every fragment
    pages.rs         # GET /, /projects/{id}, /sessions/{id}
    projects.rs      # POST /projects
    sessions.rs      # POST /sessions, /sessions/{id}/messages, /stop
    stream.rs        # GET /sessions/{id}/events (SSE)
  assets/
    htmx.min.js      # vendored
    sse.js           # vendored htmx SSE extension
    app.css          # hand-written
```

---

### Task 1: Crate skeleton, config, clock, hello page, static assets, and a real Claude fixture

**Files:**

- Create: `apps/t3rs/Cargo.toml`, `apps/t3rs/src/main.rs`, `apps/t3rs/src/config.rs`, `apps/t3rs/src/clock.rs`
- Create: `apps/t3rs/src/assets/app.css`, `apps/t3rs/src/assets/htmx.min.js`, `apps/t3rs/src/assets/sse.js`
- Create: `apps/t3rs/tests/fixtures/claude_stream_basic.jsonl`

**Interfaces:**

- Produces: `Config { bind: SocketAddr, db_path: String, claude_bin: String, default_project: Option<String> }` with `Config::from_env() -> Config`.
- Produces: `trait Clock { fn now_millis(&self) -> i64; }` with `SystemClock`; `trait Ids { fn new_id(&self) -> String; }` with `UuidIds`; and test doubles `FixedClock(i64)`, `SeqIds(AtomicU64)`.

- [ ] **Step 1: Create `Cargo.toml` with pinned deps**

```toml
[package]
name = "t3rs"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = { version = "0.8", features = ["macros"] }
tokio = { version = "1", features = ["full"] }
tower-http = { version = "0.6", features = ["fs", "trace"] }
sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite", "macros", "migrate"] }
maud = "0.27"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4"] }
dashmap = "6"
thiserror = "2"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
futures = "0.3"

[dev-dependencies]
tower = { version = "0.5", features = ["util"] }
http-body-util = "0.1"
```

- [ ] **Step 2: Write `src/clock.rs` with a failing test**

```rust
pub trait Clock: Send + Sync {
    fn now_millis(&self) -> i64;
}
pub trait Ids: Send + Sync {
    fn new_id(&self) -> String;
}

pub struct SystemClock;
impl Clock for SystemClock {
    fn now_millis(&self) -> i64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64
    }
}

pub struct UuidIds;
impl Ids for UuidIds {
    fn new_id(&self) -> String {
        uuid::Uuid::new_v4().to_string()
    }
}

#[cfg(test)]
pub struct FixedClock(pub i64);
#[cfg(test)]
impl Clock for FixedClock {
    fn now_millis(&self) -> i64 { self.0 }
}

#[cfg(test)]
pub struct SeqIds(pub std::sync::atomic::AtomicU64);
#[cfg(test)]
impl Ids for SeqIds {
    fn new_id(&self) -> String {
        let n = self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        format!("id-{n}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;

    #[test]
    fn seq_ids_are_monotonic() {
        let ids = SeqIds(AtomicU64::new(0));
        assert_eq!(ids.new_id(), "id-0");
        assert_eq!(ids.new_id(), "id-1");
    }

    #[test]
    fn fixed_clock_returns_its_value() {
        assert_eq!(FixedClock(42).now_millis(), 42);
    }
}
```

- [ ] **Step 3: Run `cargo test` in `apps/t3rs` — expect it to fail to compile (no `config.rs`/`main.rs` yet)**

Run: `cd apps/t3rs && cargo test`
Expected: compile error (missing modules referenced by main). This is fine; proceed to add them, then this task's tests pass together.

- [ ] **Step 4: Write `src/config.rs`**

```rust
use std::net::SocketAddr;

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: SocketAddr,
    pub db_path: String,
    pub claude_bin: String,
    pub default_project: Option<String>,
}

impl Config {
    pub fn from_env() -> Config {
        let bind = std::env::var("T3RS_BIND")
            .unwrap_or_else(|_| "127.0.0.1:3773".into())
            .parse()
            .expect("T3RS_BIND must be host:port");
        Config {
            bind,
            db_path: std::env::var("T3RS_DB").unwrap_or_else(|_| "t3rs.sqlite".into()),
            claude_bin: std::env::var("T3RS_CLAUDE_BIN").unwrap_or_else(|_| "claude".into()),
            default_project: std::env::var("T3RS_DEFAULT_PROJECT").ok(),
        }
    }
}
```

- [ ] **Step 5: Write minimal `src/main.rs` (hello page + static assets)**

```rust
mod clock;
mod config;

use axum::{routing::get, Router};
use tower_http::services::ServeDir;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter(
        tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "t3rs=info".into()),
    ).init();

    let cfg = config::Config::from_env();
    let app = Router::new()
        .route("/", get(|| async { "t3rs alive" }))
        .nest_service("/assets", ServeDir::new("src/assets"));

    let listener = tokio::net::TcpListener::bind(cfg.bind).await.unwrap();
    tracing::info!("listening on http://{}", cfg.bind);
    axum::serve(listener, app).await.unwrap();
}
```

- [ ] **Step 6: Vendor frontend assets**

Download into `src/assets/`: `htmx.min.js` (htmx 2.x) from `https://unpkg.com/htmx.org/dist/htmx.min.js` and the SSE extension `sse.js` from `https://unpkg.com/htmx-ext-sse/sse.js`. Write a minimal `app.css` (dark background, sans stack, `#transcript { display:flex; flex-direction:column; gap:.5rem }`). Exact styling is polished in Task 10.

Run (from `apps/t3rs`):

```bash
mkdir -p src/assets
curl -fsSL https://unpkg.com/htmx.org/dist/htmx.min.js -o src/assets/htmx.min.js
curl -fsSL https://unpkg.com/htmx-ext-sse/sse.js -o src/assets/sse.js
```

- [ ] **Step 7: Capture a real Claude stream fixture**

Run in a throwaway temp dir so no real files are touched:

```bash
cd "$(mktemp -d)"
claude -p --output-format stream-json --verbose --permission-mode acceptEdits \
  "Reply with exactly the word: pong" \
  > /home/thomas/Lab/t3code/apps/t3rs/tests/fixtures/claude_stream_basic.jsonl
```

Inspect the file: confirm it is newline-delimited JSON with at least a `type:"system"` init line (containing a `session_id`), one or more `type:"assistant"` lines, and a final `type:"result"` line. This fixture pins the protocol in Task 2. If the shape differs from the spec's §4.3 assumptions, note it in the task's commit message so Task 2 matches reality.

- [ ] **Step 8: Run and verify the server boots**

Run: `cargo run` then `curl -s localhost:3773` → `t3rs alive`; `curl -sI localhost:3773/assets/app.css` → `200`. Stop the server. Run `cargo test` → the `clock` tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/t3rs
git commit -m "feat(t3rs): crate skeleton, config, clock, static assets, claude fixture"
```

---

### Task 2: Claude protocol types + event normalization (TDD against the fixture)

**Files:**

- Create: `apps/t3rs/src/agent/mod.rs`, `apps/t3rs/src/agent/protocol.rs`, `apps/t3rs/src/agent/normalize.rs`
- Modify: `apps/t3rs/src/main.rs` (add `mod agent;`)

**Interfaces:**

- Produces: `enum AgentEvent { SessionInit { claude_session_id: String, model: String }, AssistantText { text: String }, ToolUse { id: String, name: String, input: serde_json::Value }, ToolResult { id: String, ok: bool, content: String }, Result { ok: bool, summary: Option<String> }, Error { message: String } }` — `#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq)]`.
- Produces: `AgentEvent::kind(&self) -> &'static str` returning `"session_init"|"assistant"|"tool_use"|"tool_result"|"result"|"error"` (also `"user"` is a valid stored kind produced by the actor, not by normalize).
- Produces: `fn normalize(raw: RawEvent) -> Vec<AgentEvent>` (a single raw assistant line may contain both text and tool_use blocks → multiple events; unknown lines → empty vec).
- Produces: `struct OutgoingUser` with `OutgoingUser::text(s: &str) -> serde_json::Value` returning the exact stdin JSON for a user turn.

- [ ] **Step 1: Write `agent/protocol.rs` modeling the fixture**

Open `tests/fixtures/claude_stream_basic.jsonl` and model exactly what's there. Expected shape (adjust field names to the real fixture):

```rust
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RawEvent {
    System(RawSystem),
    Assistant(RawAssistant),
    User(serde_json::Value),
    Result(RawResult),
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Deserialize)]
pub struct RawSystem {
    #[serde(default)]
    pub subtype: Option<String>,     // "init"
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RawAssistant {
    pub message: RawMessage,
}

#[derive(Debug, Deserialize)]
pub struct RawMessage {
    #[serde(default)]
    pub content: Vec<RawBlock>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RawBlock {
    Text { text: String },
    ToolUse { id: String, name: String, input: serde_json::Value },
    ToolResult { tool_use_id: String, #[serde(default)] content: serde_json::Value, #[serde(default)] is_error: bool },
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Deserialize)]
pub struct RawResult {
    #[serde(default)]
    pub is_error: bool,
    #[serde(default)]
    pub result: Option<String>,
}

pub struct OutgoingUser;
impl OutgoingUser {
    pub fn text(s: &str) -> serde_json::Value {
        serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": [{ "type": "text", "text": s }] }
        })
    }
}
```

- [ ] **Step 2: Write the failing normalize test using the fixture**

```rust
// in agent/normalize.rs
#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::protocol::RawEvent;

    fn parse_fixture() -> Vec<crate::agent::AgentEvent> {
        let raw = include_str!("../../tests/fixtures/claude_stream_basic.jsonl");
        raw.lines()
            .filter(|l| !l.trim().is_empty())
            .flat_map(|l| {
                let ev: RawEvent = serde_json::from_str(l)
                    .unwrap_or(RawEvent::Unknown);
                normalize(ev)
            })
            .collect()
    }

    #[test]
    fn fixture_yields_init_then_text_then_result() {
        let evs = parse_fixture();
        assert!(matches!(evs.first(), Some(crate::agent::AgentEvent::SessionInit { .. })),
            "first event should be SessionInit, got {evs:?}");
        assert!(evs.iter().any(|e| matches!(e, crate::agent::AgentEvent::AssistantText { text } if text.contains("pong"))),
            "should contain assistant text 'pong'");
        assert!(matches!(evs.last(), Some(crate::agent::AgentEvent::Result { .. })),
            "last event should be Result");
    }

    #[test]
    fn unknown_lines_normalize_to_nothing() {
        assert!(normalize(RawEvent::Unknown).is_empty());
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cargo test -p t3rs normalize`
Expected: FAIL — `normalize` and `AgentEvent` not defined.

- [ ] **Step 4: Write `agent/mod.rs` (AgentEvent) and `agent/normalize.rs`**

```rust
// agent/mod.rs
pub mod normalize;
pub mod protocol;
pub use normalize::normalize;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentEvent {
    SessionInit { claude_session_id: String, model: String },
    AssistantText { text: String },
    ToolUse { id: String, name: String, input: serde_json::Value },
    ToolResult { id: String, ok: bool, content: String },
    Result { ok: bool, summary: Option<String> },
    Error { message: String },
}

impl AgentEvent {
    pub fn kind(&self) -> &'static str {
        match self {
            AgentEvent::SessionInit { .. } => "session_init",
            AgentEvent::AssistantText { .. } => "assistant",
            AgentEvent::ToolUse { .. } => "tool_use",
            AgentEvent::ToolResult { .. } => "tool_result",
            AgentEvent::Result { .. } => "result",
            AgentEvent::Error { .. } => "error",
        }
    }
}
```

```rust
// agent/normalize.rs
use crate::agent::protocol::{RawBlock, RawEvent};
use crate::agent::AgentEvent;

pub fn normalize(raw: RawEvent) -> Vec<AgentEvent> {
    match raw {
        RawEvent::System(s) if s.subtype.as_deref() == Some("init") => {
            match s.session_id {
                Some(id) => vec![AgentEvent::SessionInit {
                    claude_session_id: id,
                    model: s.model.unwrap_or_default(),
                }],
                None => vec![],
            }
        }
        RawEvent::System(_) => vec![],
        RawEvent::Assistant(a) => a.message.content.into_iter().filter_map(|b| match b {
            RawBlock::Text { text } => Some(AgentEvent::AssistantText { text }),
            RawBlock::ToolUse { id, name, input } => Some(AgentEvent::ToolUse { id, name, input }),
            RawBlock::ToolResult { tool_use_id, content, is_error } => Some(AgentEvent::ToolResult {
                id: tool_use_id,
                ok: !is_error,
                content: content_to_string(&content),
            }),
            RawBlock::Unknown => None,
        }).collect(),
        RawEvent::User(_) => vec![], // tool_results echoed as user turns; handled above if present
        RawEvent::Result(r) => vec![AgentEvent::Result {
            ok: !r.is_error,
            summary: r.result,
        }],
        RawEvent::Unknown => vec![],
    }
}

fn content_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}
```

Add `mod agent;` to `main.rs`.

- [ ] **Step 5: Run to verify pass**

Run: `cargo test -p t3rs`
Expected: PASS (both normalize tests + Task 1 clock tests).
If `fixture_yields_init_then_text_then_result` fails, the real fixture shape differs from the model — adjust `protocol.rs` field names/tags to match the actual JSONL, not the other way around.

- [ ] **Step 6: Commit**

```bash
git add apps/t3rs
git commit -m "feat(t3rs): claude stream-json protocol + event normalization"
```

---

### Task 3: Database layer (pool, migration, projects, sessions, events)

**Files:**

- Create: `apps/t3rs/migrations/0001_init.sql`, `apps/t3rs/src/db/mod.rs`, `apps/t3rs/src/db/projects.rs`, `apps/t3rs/src/db/sessions.rs`, `apps/t3rs/src/db/events.rs`
- Modify: `apps/t3rs/src/main.rs` (add `mod db;`)

**Interfaces:**

- Produces: `async fn db::connect_and_migrate(db_path: &str) -> sqlx::Result<sqlx::SqlitePool>`.
- Produces: `struct Project { id, path, name, created_at }`; `async fn projects::insert(pool, &Project)`, `projects::list(pool) -> Vec<Project>`, `projects::get(pool, id) -> Option<Project>`.
- Produces: `enum SessionStatus { Idle, Running, Error }` (`as_str`/`from_str`); `struct Session { id, project_id, title, claude_session_id: Option<String>, status: SessionStatus, created_at, updated_at }`; `sessions::insert`, `list`, `list_by_project`, `get`, `set_status(pool, id, status, now)`, `set_claude_id(pool, id, claude_id, now)`.
- Produces: `struct StoredEvent { id: i64, session_id: String, seq: i64, event: AgentEvent, created_at: i64 }`; `events::append(pool, session_id, seq, &AgentEvent, now) -> StoredEvent`; `events::next_seq(pool, session_id) -> i64`; `events::list_by_session(pool, id) -> Vec<StoredEvent>`; `events::list_after(pool, id, after_global_id) -> Vec<StoredEvent>`.

- [ ] **Step 1: Write the migration `migrations/0001_init.sql`**

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE sessions (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id),
  title             TEXT NOT NULL,
  claude_session_id TEXT,
  status            TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  seq         INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_events_session_seq ON events(session_id, seq);
```

- [ ] **Step 2: Write `db/mod.rs` with a failing migration test**

```rust
pub mod events;
pub mod projects;
pub mod sessions;

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

pub async fn connect_and_migrate(db_path: &str) -> sqlx::Result<SqlitePool> {
    let url = format!("sqlite://{db_path}?mode=rwc");
    let pool = SqlitePoolOptions::new().max_connections(5).connect(&url).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

#[cfg(test)]
pub async fn test_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn migrations_create_projects_table() {
        let pool = super::test_pool().await;
        let n: i64 = sqlx::query_scalar("SELECT count(*) FROM projects")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(n, 0);
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cargo test -p t3rs db::`
Expected: FAIL to compile — `events`/`projects`/`sessions` modules missing.

- [ ] **Step 4: Write `db/projects.rs`**

```rust
use sqlx::SqlitePool;

#[derive(Clone, Debug, sqlx::FromRow, PartialEq)]
pub struct Project {
    pub id: String,
    pub path: String,
    pub name: String,
    pub created_at: i64,
}

pub async fn insert(pool: &SqlitePool, p: &Project) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO projects (id, path, name, created_at) VALUES (?, ?, ?, ?)")
        .bind(&p.id).bind(&p.path).bind(&p.name).bind(p.created_at)
        .execute(pool).await?;
    Ok(())
}

pub async fn list(pool: &SqlitePool) -> sqlx::Result<Vec<Project>> {
    sqlx::query_as::<_, Project>("SELECT id, path, name, created_at FROM projects ORDER BY name")
        .fetch_all(pool).await
}

pub async fn get(pool: &SqlitePool, id: &str) -> sqlx::Result<Option<Project>> {
    sqlx::query_as::<_, Project>("SELECT id, path, name, created_at FROM projects WHERE id = ?")
        .bind(id).fetch_optional(pool).await
}
```

- [ ] **Step 5: Write `db/sessions.rs`**

```rust
use sqlx::SqlitePool;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionStatus { Idle, Running, Error }
impl SessionStatus {
    pub fn as_str(&self) -> &'static str {
        match self { Self::Idle => "idle", Self::Running => "running", Self::Error => "error" }
    }
    pub fn from_str(s: &str) -> SessionStatus {
        match s { "running" => Self::Running, "error" => Self::Error, _ => Self::Idle }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub claude_session_id: Option<String>,
    pub status: SessionStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(sqlx::FromRow)]
struct SessionRow {
    id: String, project_id: String, title: String,
    claude_session_id: Option<String>, status: String,
    created_at: i64, updated_at: i64,
}
impl From<SessionRow> for Session {
    fn from(r: SessionRow) -> Self {
        Session {
            id: r.id, project_id: r.project_id, title: r.title,
            claude_session_id: r.claude_session_id,
            status: SessionStatus::from_str(&r.status),
            created_at: r.created_at, updated_at: r.updated_at,
        }
    }
}

const COLS: &str = "id, project_id, title, claude_session_id, status, created_at, updated_at";

pub async fn insert(pool: &SqlitePool, s: &Session) -> sqlx::Result<()> {
    sqlx::query(&format!("INSERT INTO sessions ({COLS}) VALUES (?, ?, ?, ?, ?, ?, ?)"))
        .bind(&s.id).bind(&s.project_id).bind(&s.title)
        .bind(&s.claude_session_id).bind(s.status.as_str())
        .bind(s.created_at).bind(s.updated_at)
        .execute(pool).await?;
    Ok(())
}

pub async fn get(pool: &SqlitePool, id: &str) -> sqlx::Result<Option<Session>> {
    Ok(sqlx::query_as::<_, SessionRow>(&format!("SELECT {COLS} FROM sessions WHERE id = ?"))
        .bind(id).fetch_optional(pool).await?.map(Into::into))
}

pub async fn list(pool: &SqlitePool) -> sqlx::Result<Vec<Session>> {
    Ok(sqlx::query_as::<_, SessionRow>(&format!("SELECT {COLS} FROM sessions ORDER BY updated_at DESC"))
        .fetch_all(pool).await?.into_iter().map(Into::into).collect())
}

pub async fn list_by_project(pool: &SqlitePool, project_id: &str) -> sqlx::Result<Vec<Session>> {
    Ok(sqlx::query_as::<_, SessionRow>(&format!("SELECT {COLS} FROM sessions WHERE project_id = ? ORDER BY updated_at DESC"))
        .bind(project_id).fetch_all(pool).await?.into_iter().map(Into::into).collect())
}

pub async fn set_status(pool: &SqlitePool, id: &str, status: SessionStatus, now: i64) -> sqlx::Result<()> {
    sqlx::query("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?")
        .bind(status.as_str()).bind(now).bind(id).execute(pool).await?;
    Ok(())
}

pub async fn set_claude_id(pool: &SqlitePool, id: &str, claude_id: &str, now: i64) -> sqlx::Result<()> {
    sqlx::query("UPDATE sessions SET claude_session_id = ?, updated_at = ? WHERE id = ?")
        .bind(claude_id).bind(now).bind(id).execute(pool).await?;
    Ok(())
}
```

- [ ] **Step 6: Write `db/events.rs`**

```rust
use crate::agent::AgentEvent;
use sqlx::SqlitePool;

#[derive(Clone, Debug, PartialEq)]
pub struct StoredEvent {
    pub id: i64,
    pub session_id: String,
    pub seq: i64,
    pub event: AgentEvent,
    pub created_at: i64,
}

#[derive(sqlx::FromRow)]
struct EventRow { id: i64, session_id: String, seq: i64, payload: String, created_at: i64 }
impl TryFrom<EventRow> for StoredEvent {
    type Error = serde_json::Error;
    fn try_from(r: EventRow) -> Result<Self, Self::Error> {
        Ok(StoredEvent {
            id: r.id, session_id: r.session_id, seq: r.seq,
            event: serde_json::from_str(&r.payload)?,
            created_at: r.created_at,
        })
    }
}

pub async fn next_seq(pool: &SqlitePool, session_id: &str) -> sqlx::Result<i64> {
    let max: Option<i64> = sqlx::query_scalar("SELECT MAX(seq) FROM events WHERE session_id = ?")
        .bind(session_id).fetch_one(pool).await?;
    Ok(max.map(|m| m + 1).unwrap_or(0))
}

pub async fn append(pool: &SqlitePool, session_id: &str, seq: i64, event: &AgentEvent, now: i64)
    -> sqlx::Result<StoredEvent> {
    let payload = serde_json::to_string(event).expect("AgentEvent serializes");
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO events (session_id, seq, kind, payload, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
        .bind(session_id).bind(seq).bind(event.kind()).bind(&payload).bind(now)
        .fetch_one(pool).await?;
    Ok(StoredEvent { id, session_id: session_id.to_string(), seq, event: event.clone(), created_at: now })
}

pub async fn list_by_session(pool: &SqlitePool, session_id: &str) -> sqlx::Result<Vec<StoredEvent>> {
    rows(sqlx::query_as::<_, EventRow>(
        "SELECT id, session_id, seq, payload, created_at FROM events WHERE session_id = ? ORDER BY seq")
        .bind(session_id).fetch_all(pool).await?)
}

pub async fn list_after(pool: &SqlitePool, session_id: &str, after_id: i64) -> sqlx::Result<Vec<StoredEvent>> {
    rows(sqlx::query_as::<_, EventRow>(
        "SELECT id, session_id, seq, payload, created_at FROM events WHERE session_id = ? AND id > ? ORDER BY id")
        .bind(session_id).bind(after_id).fetch_all(pool).await?)
}

fn rows(rows: Vec<EventRow>) -> sqlx::Result<Vec<StoredEvent>> {
    rows.into_iter().map(|r| StoredEvent::try_from(r).map_err(|e| sqlx::Error::Decode(Box::new(e)))).collect()
}
```

- [ ] **Step 7: Add round-trip tests to `db/events.rs`**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::AgentEvent;

    #[tokio::test]
    async fn append_and_replay_preserves_order_and_after_filter() {
        let pool = crate::db::test_pool().await;
        crate::db::projects::insert(&pool, &crate::db::projects::Project {
            id: "p1".into(), path: "/tmp/x".into(), name: "x".into(), created_at: 1,
        }).await.unwrap();
        crate::db::sessions::insert(&pool, &crate::db::sessions::Session {
            id: "s1".into(), project_id: "p1".into(), title: "t".into(),
            claude_session_id: None, status: crate::db::sessions::SessionStatus::Idle,
            created_at: 1, updated_at: 1,
        }).await.unwrap();

        let e0 = append(&pool, "s1", 0, &AgentEvent::AssistantText { text: "a".into() }, 10).await.unwrap();
        let _e1 = append(&pool, "s1", 1, &AgentEvent::AssistantText { text: "b".into() }, 11).await.unwrap();

        let all = list_by_session(&pool, "s1").await.unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].seq, 0);
        assert_eq!(next_seq(&pool, "s1").await.unwrap(), 2);

        let after = list_after(&pool, "s1", e0.id).await.unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].event, AgentEvent::AssistantText { text: "b".into() });
    }
}
```

- [ ] **Step 8: Add `mod db;` to `main.rs`, run tests**

Run: `cargo test -p t3rs db::`
Expected: PASS (migration test + events round-trip). Wire `connect_and_migrate` into `main.rs` startup (store the pool for later; unused for now is fine with `let _pool = ...` or add to a temporary state).

- [ ] **Step 9: Commit**

```bash
git add apps/t3rs
git commit -m "feat(t3rs): sqlite layer — projects, sessions, append-only events"
```

---

### Task 4: Agent process abstraction (trait + scripted fake + real Claude)

**Files:**

- Create: `apps/t3rs/src/agent/process.rs`
- Modify: `apps/t3rs/src/agent/mod.rs` (`pub mod process;`)

**Interfaces:**

- Produces: `struct SpawnParams { claude_bin: String, cwd: String, resume: Option<String> }`.
- Produces: `trait AgentProcess: Send` with `async fn send_user(&mut self, text: &str) -> std::io::Result<()>` and `fn events(&mut self) -> tokio::sync::mpsc::Receiver<AgentEvent>` (called once; returns the raw-normalized event stream, ending when the child's stdout closes).
- Produces: `struct ClaudeProcess` implementing `AgentProcess` over a real child; `fn spawn_claude(params: SpawnParams) -> std::io::Result<ClaudeProcess>`.
- Produces (test): `struct FakeProcess` built from a `Vec<AgentEvent>` script, so the actor can be tested without a real CLI.

- [ ] **Step 1: Write the trait and a failing FakeProcess test**

```rust
use crate::agent::{normalize, protocol::{OutgoingUser, RawEvent}, AgentEvent};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::mpsc;

pub struct SpawnParams {
    pub claude_bin: String,
    pub cwd: String,
    pub resume: Option<String>,
}

pub trait AgentProcess: Send {
    fn send_user(&mut self, text: &str)
        -> impl std::future::Future<Output = std::io::Result<()>> + Send;
    fn take_events(&mut self) -> mpsc::Receiver<AgentEvent>;
}

#[cfg(test)]
pub struct FakeProcess {
    pub script: Vec<AgentEvent>,
    rx: Option<mpsc::Receiver<AgentEvent>>,
    tx: mpsc::Sender<AgentEvent>,
}
#[cfg(test)]
impl FakeProcess {
    pub fn new(script: Vec<AgentEvent>) -> Self {
        let (tx, rx) = mpsc::channel(64);
        FakeProcess { script, rx: Some(rx), tx }
    }
}
#[cfg(test)]
impl AgentProcess for FakeProcess {
    async fn send_user(&mut self, _text: &str) -> std::io::Result<()> {
        for ev in self.script.clone() {
            let _ = self.tx.send(ev).await;
        }
        Ok(())
    }
    fn take_events(&mut self) -> mpsc::Receiver<AgentEvent> {
        self.rx.take().expect("take_events called once")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fake_process_emits_scripted_events_after_send() {
        let mut p = FakeProcess::new(vec![
            AgentEvent::SessionInit { claude_session_id: "c1".into(), model: "m".into() },
            AgentEvent::AssistantText { text: "hi".into() },
            AgentEvent::Result { ok: true, summary: None },
        ]);
        let mut rx = p.take_events();
        p.send_user("hello").await.unwrap();
        let mut got = vec![];
        while let Some(e) = rx.recv().await { got.push(e); }
        assert_eq!(got.len(), 3);
        assert!(matches!(got[0], AgentEvent::SessionInit { .. }));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p t3rs process::`
Expected: FAIL to compile (module not declared). Add `pub mod process;` to `agent/mod.rs`, then FAIL until code compiles; then the fake test passes.

- [ ] **Step 3: Implement `ClaudeProcess` + `spawn_claude`**

```rust
pub struct ClaudeProcess {
    child: Child,
    stdin: ChildStdin,
    rx: Option<mpsc::Receiver<AgentEvent>>,
}

pub fn spawn_claude(params: SpawnParams) -> std::io::Result<ClaudeProcess> {
    use std::process::Stdio;
    let mut cmd = tokio::process::Command::new(&params.claude_bin);
    cmd.arg("-p")
        .args(["--input-format", "stream-json"])
        .args(["--output-format", "stream-json"])
        .arg("--verbose")
        .args(["--permission-mode", "acceptEdits"])
        .current_dir(&params.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(id) = &params.resume {
        cmd.args(["--resume", id]);
    }
    let mut child = cmd.spawn()?;
    let stdin = child.stdin.take().expect("stdin piped");
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let (tx, rx) = mpsc::channel(256);

    // stdout -> normalized events
    let tx2 = tx.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() { continue; }
            let raw: RawEvent = serde_json::from_str(&line).unwrap_or(RawEvent::Unknown);
            for ev in normalize(raw) {
                if tx2.send(ev).await.is_err() { return; }
            }
        }
    });
    // stderr -> tracing (+ surface nothing here; actor handles exit)
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::warn!(target: "claude.stderr", "{line}");
        }
    });

    Ok(ClaudeProcess { child, stdin, rx: Some(rx) })
}

impl AgentProcess for ClaudeProcess {
    async fn send_user(&mut self, text: &str) -> std::io::Result<()> {
        let line = OutgoingUser::text(text).to_string();
        self.stdin.write_all(line.as_bytes()).await?;
        self.stdin.write_all(b"\n").await?;
        self.stdin.flush().await
    }
    fn take_events(&mut self) -> mpsc::Receiver<AgentEvent> {
        self.rx.take().expect("take_events called once")
    }
}

impl ClaudeProcess {
    pub async fn kill(&mut self) {
        let _ = self.child.start_kill();
    }
}
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p t3rs process::`
Expected: PASS (fake test). `ClaudeProcess` is compile-checked but not unit-tested here (covered by the Task 10 ignored smoke test).

- [ ] **Step 5: Commit**

```bash
git add apps/t3rs
git commit -m "feat(t3rs): AgentProcess trait, real ClaudeProcess, scripted fake"
```

---

### Task 5: SessionActor + registry (lifecycle over the fake process)

**Files:**

- Create: `apps/t3rs/src/agent/actor.rs`, `apps/t3rs/src/agent/registry.rs`
- Modify: `apps/t3rs/src/agent/mod.rs`

**Interfaces:**

- Produces: `enum SessionCommand { SendPrompt(String), Stop }`.
- Produces: `struct SessionHandle { pub cmd_tx: mpsc::Sender<SessionCommand>, pub broadcast_tx: broadcast::Sender<StoredEvent> }` (Clone).
- Produces: `struct Registry` wrapping `DashMap<String, SessionHandle>` with `Registry::new()`, `get(&self, session_id) -> Option<SessionHandle>`, and `async fn ensure(&self, deps, session_id) -> SessionHandle` (spawns an actor if absent). `deps` bundles `pool`, `config`, `clock`, `ids`.
- Consumes: `db::events`, `db::sessions`, `AgentProcess`/`spawn_claude`, `Clock`.

- [ ] **Step 1: Write `agent/actor.rs` — the actor loop**

```rust
use crate::agent::process::{spawn_claude, AgentProcess, ClaudeProcess, SpawnParams};
use crate::agent::AgentEvent;
use crate::clock::Clock;
use crate::db::{self, events::StoredEvent, sessions::SessionStatus};
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};

pub enum SessionCommand { SendPrompt(String), Stop }

#[derive(Clone)]
pub struct SessionHandle {
    pub cmd_tx: mpsc::Sender<SessionCommand>,
    pub broadcast_tx: broadcast::Sender<StoredEvent>,
}

pub struct ActorDeps {
    pub pool: SqlitePool,
    pub claude_bin: String,
    pub clock: Arc<dyn Clock>,
}

/// Spawn the actor task; returns a handle. `spawn_fn` builds the process
/// (real for prod, fake for tests), given the resume id.
pub fn spawn_actor<P, F>(
    session_id: String,
    cwd: String,
    deps: Arc<ActorDeps>,
    mut spawn_fn: F,
) -> SessionHandle
where
    P: AgentProcess + 'static,
    F: FnMut(SpawnParams) -> P + Send + 'static,
{
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<SessionCommand>(16);
    let (broadcast_tx, _) = broadcast::channel::<StoredEvent>(256);
    let btx = broadcast_tx.clone();

    tokio::spawn(async move {
        let mut proc: Option<P> = None;
        let mut evt_rx: Option<mpsc::Receiver<AgentEvent>> = None;

        loop {
            tokio::select! {
                cmd = cmd_rx.recv() => match cmd {
                    Some(SessionCommand::SendPrompt(text)) => {
                        // record the user's turn first
                        persist_and_emit(&deps, &btx, &session_id,
                            &AgentEvent::AssistantText { text: String::new() }, // placeholder replaced below
                        ).await;
                        // NOTE: emit as a dedicated user kind:
                        emit_user(&deps, &btx, &session_id, &text).await;

                        let resume = current_claude_id(&deps.pool, &session_id).await;
                        let mut p = spawn_fn(SpawnParams {
                            claude_bin: deps.claude_bin.clone(),
                            cwd: cwd.clone(),
                            resume,
                        });
                        evt_rx = Some(p.take_events());
                        let _ = p.send_user(&text).await;
                        proc = Some(p);
                        let now = deps.clock.now_millis();
                        let _ = db::sessions::set_status(&deps.pool, &session_id, SessionStatus::Running, now).await;
                    }
                    Some(SessionCommand::Stop) | None => {
                        proc = None; evt_rx = None;
                        let now = deps.clock.now_millis();
                        let _ = db::sessions::set_status(&deps.pool, &session_id, SessionStatus::Idle, now).await;
                        if cmd.is_none() { break; }
                    }
                },
                Some(ev) = async { match evt_rx.as_mut() { Some(rx) => rx.recv().await, None => None } } => {
                    if let AgentEvent::SessionInit { claude_session_id, .. } = &ev {
                        let now = deps.clock.now_millis();
                        let _ = db::sessions::set_claude_id(&deps.pool, &session_id, claude_session_id, now).await;
                    }
                    let is_result = matches!(ev, AgentEvent::Result { .. });
                    persist_and_emit(&deps, &btx, &session_id, &ev).await;
                    if is_result {
                        let now = deps.clock.now_millis();
                        let _ = db::sessions::set_status(&deps.pool, &session_id, SessionStatus::Idle, now).await;
                        proc = None; evt_rx = None;
                    }
                }
            }
        }
    });

    SessionHandle { cmd_tx, broadcast_tx }
}

async fn current_claude_id(pool: &SqlitePool, session_id: &str) -> Option<String> {
    db::sessions::get(pool, session_id).await.ok().flatten().and_then(|s| s.claude_session_id)
}

async fn persist_and_emit(deps: &ActorDeps, btx: &broadcast::Sender<StoredEvent>, session_id: &str, ev: &AgentEvent) {
    let seq = db::events::next_seq(&deps.pool, session_id).await.unwrap_or(0);
    let now = deps.clock.now_millis();
    if let Ok(stored) = db::events::append(&deps.pool, session_id, seq, ev, now).await {
        let _ = btx.send(stored); // ok if no subscribers
    }
}

async fn emit_user(deps: &ActorDeps, btx: &broadcast::Sender<StoredEvent>, session_id: &str, text: &str) {
    // stored as an assistant-shaped event with a 'user' marker; simplest: reuse AgentEvent
    // by adding a dedicated variant is cleaner — see Step 2.
    let _ = (deps, btx, session_id, text);
}
```

> **Step 1 refinement:** the placeholder `emit_user`/duplicate call above is intentionally called out. Implement it cleanly by adding a `User { text: String }` variant to `AgentEvent` (kind `"user"`) in `agent/mod.rs`, remove the placeholder `AssistantText`-with-empty-string line, and have `SendPrompt` call `persist_and_emit(&deps, &btx, &session_id, &AgentEvent::User { text: text.clone() })`. Update `AgentEvent::kind` and the normalize tests remain unaffected (normalize never produces `User`).

- [ ] **Step 2: Add the `User` variant to `AgentEvent`**

In `agent/mod.rs`, add `User { text: String }` to the enum and `AgentEvent::User { .. } => "user"` to `kind()`. Replace the Step-1 placeholder in the actor with a single `persist_and_emit(... &AgentEvent::User { text: text.clone() })` at the start of `SendPrompt` handling; delete `emit_user`.

- [ ] **Step 3: Write `agent/registry.rs`**

```rust
use crate::agent::actor::{spawn_actor, ActorDeps, SessionHandle};
use crate::agent::process::{spawn_claude, SpawnParams};
use dashmap::DashMap;
use std::sync::Arc;

pub struct Registry {
    live: DashMap<String, SessionHandle>,
}

impl Registry {
    pub fn new() -> Self { Registry { live: DashMap::new() } }

    pub fn get(&self, session_id: &str) -> Option<SessionHandle> {
        self.live.get(session_id).map(|h| h.clone())
    }

    /// Return the live handle, spawning a real-claude-backed actor if absent.
    pub fn ensure(&self, session_id: &str, cwd: String, deps: Arc<ActorDeps>) -> SessionHandle {
        if let Some(h) = self.get(session_id) { return h; }
        let handle = spawn_actor(
            session_id.to_string(), cwd, deps,
            |params: SpawnParams| spawn_claude(params).expect("spawn claude"),
        );
        self.live.insert(session_id.to_string(), handle.clone());
        handle
    }
}
```

- [ ] **Step 4: Write the actor test (over the fake process)**

```rust
// in agent/actor.rs
#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::process::FakeProcess;
    use crate::clock::FixedClock;

    async fn setup() -> (SqlitePool, Arc<ActorDeps>) {
        let pool = crate::db::test_pool().await;
        crate::db::projects::insert(&pool, &crate::db::projects::Project {
            id: "p1".into(), path: "/tmp".into(), name: "p".into(), created_at: 0 }).await.unwrap();
        crate::db::sessions::insert(&pool, &crate::db::sessions::Session {
            id: "s1".into(), project_id: "p1".into(), title: "t".into(),
            claude_session_id: None, status: SessionStatus::Idle, created_at: 0, updated_at: 0 }).await.unwrap();
        let deps = Arc::new(ActorDeps { pool: pool.clone(), claude_bin: "claude".into(), clock: Arc::new(FixedClock(5)) });
        (pool, deps)
    }

    #[tokio::test]
    async fn send_prompt_persists_user_init_text_result_and_sets_claude_id() {
        let (pool, deps) = setup().await;
        let script = vec![
            AgentEvent::SessionInit { claude_session_id: "c-123".into(), model: "m".into() },
            AgentEvent::AssistantText { text: "pong".into() },
            AgentEvent::Result { ok: true, summary: None },
        ];
        let handle = spawn_actor("s1".into(), "/tmp".into(), deps.clone(),
            move |_p| FakeProcess::new(script.clone()));
        let mut sub = handle.broadcast_tx.subscribe();
        handle.cmd_tx.send(SessionCommand::SendPrompt("hello".into())).await.unwrap();

        // collect until Result
        let mut kinds = vec![];
        loop {
            let ev = tokio::time::timeout(std::time::Duration::from_secs(2), sub.recv())
                .await.expect("no timeout").unwrap();
            kinds.push(ev.event.kind());
            if ev.event.kind() == "result" { break; }
        }
        assert_eq!(kinds, vec!["user", "session_init", "assistant", "result"]);

        let stored = crate::db::events::list_by_session(&pool, "s1").await.unwrap();
        assert_eq!(stored.len(), 4);
        let s = crate::db::sessions::get(&pool, "s1").await.unwrap().unwrap();
        assert_eq!(s.claude_session_id.as_deref(), Some("c-123"));
        assert_eq!(s.status, SessionStatus::Idle);
    }
}
```

- [ ] **Step 5: Run the actor test**

Run: `cargo test -p t3rs actor::`
Expected: PASS. If ordering flakes, confirm `persist_and_emit` awaits the DB write before `btx.send` (persist-before-broadcast is what makes ordering deterministic).

- [ ] **Step 6: Wire `mod actor; mod registry;` into `agent/mod.rs`, add `pub use`s, commit**

```bash
git add apps/t3rs
git commit -m "feat(t3rs): SessionActor lifecycle + registry over fake process"
```

---

### Task 6: Web read paths — AppState, maud layout/fragments, home/project/session pages

**Files:**

- Create: `apps/t3rs/src/web/mod.rs`, `apps/t3rs/src/web/render.rs`, `apps/t3rs/src/web/pages.rs`, `apps/t3rs/src/error.rs`
- Modify: `apps/t3rs/src/main.rs` (build `AppState`, mount `web::router`)

**Interfaces:**

- Produces: `struct AppState { pub pool: SqlitePool, pub registry: Arc<Registry>, pub config: Arc<Config>, pub clock: Arc<dyn Clock>, pub ids: Arc<dyn Ids> }` (Clone).
- Produces: `fn web::router(state: AppState) -> axum::Router`.
- Produces render fns: `layout(title, body) -> Markup`, `session_view(session, project, events) -> Markup`, and per-event `fragment(ev: &StoredEvent) -> Markup` plus `turn_status(status) -> Markup`.
- Produces: `enum AppError { NotFound, BadRequest(String), Db(sqlx::Error), Internal(String) }` with `IntoResponse` (HTML fragment when `HX-Request` header present, else full page).

- [ ] **Step 1: Write `error.rs`**

```rust
use axum::http::{HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Response};

#[derive(Debug)]
pub enum AppError { NotFound, BadRequest(String), Db(sqlx::Error), Internal(String) }

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self { AppError::Db(e) }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (code, msg) = match self {
            AppError::NotFound => (StatusCode::NOT_FOUND, "not found".to_string()),
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            AppError::Db(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")),
            AppError::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m),
        };
        (code, Html(format!("<div class=\"error\">{}</div>", html_escape(&msg)))).into_response()
    }
}

pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

// note: HeaderMap-based fragment-vs-page selection can be added later;
// for M1 the fragment form is acceptable for every error surface.
let _ = std::marker::PhantomData::<HeaderMap>;
```

> Remove the trailing `let _ =` marker line — it is illustrative only. Keep `html_escape` public; `render.rs` reuses it.

- [ ] **Step 2: Write `render.rs` with a failing fragment test**

```rust
use crate::agent::AgentEvent;
use crate::db::events::StoredEvent;
use crate::db::projects::Project;
use crate::db::sessions::{Session, SessionStatus};
use maud::{html, Markup, DOCTYPE, PreEscaped};

pub fn layout(title: &str, body: Markup) -> Markup {
    html! {
        (DOCTYPE)
        html {
            head {
                meta charset="utf-8";
                title { (title) }
                link rel="stylesheet" href="/assets/app.css";
                script src="/assets/htmx.min.js" {}
                script src="/assets/sse.js" {}
            }
            body { (body) }
        }
    }
}

pub fn fragment(ev: &StoredEvent) -> Markup {
    match &ev.event {
        AgentEvent::User { text } => html! { div."msg"."user" { (text) } },
        AgentEvent::AssistantText { text } => html! { div."msg"."assistant" { (text) } },
        AgentEvent::ToolUse { name, input, .. } => html! {
            div."tool-use" { span."tool-name" { (name) } pre { (input.to_string()) } }
        },
        AgentEvent::ToolResult { ok, content, .. } => html! {
            div."tool-result".(if *ok {"ok"} else {"err"}) { pre { (content) } }
        },
        AgentEvent::Result { ok, summary } => html! {
            div."result".(if *ok {"ok"} else {"err"}) { (summary.clone().unwrap_or_default()) }
        },
        AgentEvent::Error { message } => html! { div."error" { (message) } },
        AgentEvent::SessionInit { .. } => html! {}, // not rendered
    }
}

pub fn turn_status(status: SessionStatus) -> Markup {
    html! {
        div #turn-status hx-swap-oob="true" data-status=(status.as_str()) {
            @if status == SessionStatus::Running { span { "working…" } }
            @else { span { "idle" } }
        }
    }
}

pub fn session_view(session: &Session, project: &Project, events: &[StoredEvent]) -> Markup {
    layout(&session.title, html! {
        header { h1 { (session.title) } small { (project.name) } (turn_status(session.status)) }
        div #transcript hx-ext="sse" sse-connect=(format!("/sessions/{}/events", session.id))
            sse-swap="message" hx-swap="beforeend" {
            @for ev in events { (fragment(ev)) }
        }
        form hx-post=(format!("/sessions/{}/messages", session.id)) hx-swap="none" {
            textarea name="text" placeholder="Message…" {}
            button type="submit" { "Send" }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::AgentEvent;

    #[test]
    fn assistant_fragment_contains_text() {
        let ev = StoredEvent { id: 1, session_id: "s".into(), seq: 0,
            event: AgentEvent::AssistantText { text: "pong".into() }, created_at: 0 };
        let out = fragment(&ev).into_string();
        assert!(out.contains("assistant"));
        assert!(out.contains("pong"));
    }
}
```

- [ ] **Step 3: Run to verify the render test fails then passes**

Run: `cargo test -p t3rs render::`
Expected: FAIL (module not wired) → after adding `mod web; mod error;` and `pub mod render;`, PASS.

- [ ] **Step 4: Write `web/mod.rs` (AppState + router) and `web/pages.rs`**

```rust
// web/mod.rs
pub mod pages;
pub mod render;

use crate::agent::registry::Registry;
use crate::clock::{Clock, Ids};
use crate::config::Config;
use axum::routing::get;
use axum::Router;
use sqlx::SqlitePool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub registry: Arc<Registry>,
    pub config: Arc<Config>,
    pub clock: Arc<dyn Clock>,
    pub ids: Arc<dyn Ids>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get(pages::home))
        .route("/projects/{id}", get(pages::project_view))
        .route("/sessions/{id}", get(pages::session_view))
        .with_state(state)
        .nest_service("/assets", tower_http::services::ServeDir::new("src/assets"))
}
```

```rust
// web/pages.rs
use crate::db;
use crate::error::AppError;
use crate::web::render;
use crate::web::AppState;
use axum::extract::{Path, State};
use axum::response::Html;

pub async fn home(State(st): State<AppState>) -> Result<Html<String>, AppError> {
    let projects = db::projects::list(&st.pool).await?;
    let sessions = db::sessions::list(&st.pool).await?;
    Ok(Html(render::home(&projects, &sessions).into_string()))
}

pub async fn project_view(State(st): State<AppState>, Path(id): Path<String>) -> Result<Html<String>, AppError> {
    let project = db::projects::get(&st.pool, &id).await?.ok_or(AppError::NotFound)?;
    let sessions = db::sessions::list_by_project(&st.pool, &id).await?;
    Ok(Html(render::project_view(&project, &sessions).into_string()))
}

pub async fn session_view(State(st): State<AppState>, Path(id): Path<String>) -> Result<Html<String>, AppError> {
    let session = db::sessions::get(&st.pool, &id).await?.ok_or(AppError::NotFound)?;
    let project = db::projects::get(&st.pool, &session.project_id).await?.ok_or(AppError::NotFound)?;
    let events = db::events::list_by_session(&st.pool, &id).await?;
    Ok(Html(render::session_view(&session, &project, &events).into_string()))
}
```

Add `home(projects, sessions)` and `project_view(project, sessions)` render fns to `render.rs` (sidebar list of projects → their sessions, plus a "new session" form posting to `/sessions` with a `project_id` hidden field and a `text` textarea; a "new project" form posting to `/projects` with a `path` field).

- [ ] **Step 5: Build `AppState` in `main.rs`, mount router, seed default project**

In `main.rs`: after `connect_and_migrate`, build `AppState { pool, registry: Arc::new(Registry::new()), config: Arc::new(cfg.clone()), clock: Arc::new(SystemClock), ids: Arc::new(UuidIds) }`. If `cfg.default_project` is set and not already present, insert it (name = basename). Replace the hello route with `web::router(state)`.

- [ ] **Step 6: Add an axum handler test (oneshot) for the home page**

```rust
// web/pages.rs tests
#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::registry::Registry;
    use crate::clock::{SystemClock, UuidIds};
    use crate::config::Config;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use std::sync::Arc;
    use tower::ServiceExt;

    async fn test_state() -> AppState {
        let pool = crate::db::test_pool().await;
        AppState {
            pool, registry: Arc::new(Registry::new()),
            config: Arc::new(Config { bind: "127.0.0.1:0".parse().unwrap(),
                db_path: ":memory:".into(), claude_bin: "claude".into(), default_project: None }),
            clock: Arc::new(SystemClock), ids: Arc::new(UuidIds),
        }
    }

    #[tokio::test]
    async fn home_renders_200() {
        let app = crate::web::router(test_state().await);
        let res = app.oneshot(Request::get("/").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = res.into_body().collect().await.unwrap().to_bytes();
        assert!(String::from_utf8_lossy(&body).contains("<html"));
    }
}
```

- [ ] **Step 7: Run tests + manual boot**

Run: `cargo test -p t3rs` → all pass. `cargo run`, open `http://localhost:3773` → home page renders (empty project list). Commit.

```bash
git add apps/t3rs
git commit -m "feat(t3rs): web read paths — AppState, maud layout, home/project/session pages"
```

---

### Task 7: Create flows — add project, create session (spawns actor + first turn)

**Files:**

- Create: `apps/t3rs/src/web/projects.rs`, `apps/t3rs/src/web/sessions.rs`
- Modify: `apps/t3rs/src/web/mod.rs` (routes), `apps/t3rs/src/web/render.rs` (forms already added in Task 6)

**Interfaces:**

- Produces: `POST /projects` (form `path`) → creates a `Project` (id via `ids`, name = basename, `created_at` via `clock`), 303-redirect to `/`.
- Produces: `POST /sessions` (form `project_id`, `text`) → creates a `Session` (status `Idle`, title = first ~60 chars of `text`), calls `registry.ensure(...)`, sends `SessionCommand::SendPrompt(text)`, 303-redirect to `/sessions/{id}`.
- Consumes: `Registry::ensure`, `ActorDeps`.

- [ ] **Step 1: Write `web/projects.rs`**

```rust
use crate::db::projects::{insert, Project};
use crate::error::AppError;
use crate::web::AppState;
use axum::extract::State;
use axum::response::Redirect;
use axum::Form;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct NewProject { pub path: String }

pub async fn create(State(st): State<AppState>, Form(f): Form<NewProject>) -> Result<Redirect, AppError> {
    let path = f.path.trim().to_string();
    if path.is_empty() { return Err(AppError::BadRequest("path required".into())); }
    let name = std::path::Path::new(&path)
        .file_name().and_then(|s| s.to_str()).unwrap_or(&path).to_string();
    let p = Project { id: st.ids.new_id(), path, name, created_at: st.clock.now_millis() };
    insert(&st.pool, &p).await?;
    Ok(Redirect::to("/"))
}
```

- [ ] **Step 2: Write `web/sessions.rs` (create + helper to build ActorDeps)**

```rust
use crate::agent::actor::{ActorDeps, SessionCommand};
use crate::db;
use crate::db::sessions::{Session, SessionStatus};
use crate::error::AppError;
use crate::web::AppState;
use axum::extract::State;
use axum::response::Redirect;
use axum::Form;
use serde::Deserialize;
use std::sync::Arc;

pub fn actor_deps(st: &AppState) -> Arc<ActorDeps> {
    Arc::new(ActorDeps {
        pool: st.pool.clone(),
        claude_bin: st.config.claude_bin.clone(),
        clock: st.clock.clone(),
    })
}

fn title_from(text: &str) -> String {
    let t = text.trim();
    t.chars().take(60).collect::<String>() + if t.chars().count() > 60 { "…" } else { "" }
}

#[derive(Deserialize)]
pub struct NewSession { pub project_id: String, pub text: String }

pub async fn create(State(st): State<AppState>, Form(f): Form<NewSession>) -> Result<Redirect, AppError> {
    let project = db::projects::get(&st.pool, &f.project_id).await?.ok_or(AppError::NotFound)?;
    if f.text.trim().is_empty() { return Err(AppError::BadRequest("message required".into())); }
    let now = st.clock.now_millis();
    let session = Session {
        id: st.ids.new_id(), project_id: project.id.clone(), title: title_from(&f.text),
        claude_session_id: None, status: SessionStatus::Idle, created_at: now, updated_at: now,
    };
    db::sessions::insert(&st.pool, &session).await?;

    let handle = st.registry.ensure(&session.id, project.path.clone(), actor_deps(&st));
    handle.cmd_tx.send(SessionCommand::SendPrompt(f.text))
        .await.map_err(|_| AppError::Internal("actor unavailable".into()))?;

    Ok(Redirect::to(&format!("/sessions/{}", session.id)))
}
```

- [ ] **Step 3: Add routes and a create-session test**

Add to `web/mod.rs` router: `.route("/projects", post(projects::create))` and `.route("/sessions", post(sessions::create))` (import `axum::routing::post`).

```rust
// web/sessions.rs tests
#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    #[tokio::test]
    async fn create_project_then_session_redirects() {
        let st = crate::web::pages::tests::test_state().await; // reuse helper (make it pub(crate))
        let app = crate::web::router(st.clone());

        // create project
        let res = app.clone().oneshot(Request::post("/projects")
            .header("content-type", "application/x-www-form-urlencoded")
            .body(Body::from("path=/tmp/demo")).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::SEE_OTHER);

        let pid = crate::db::projects::list(&st.pool).await.unwrap()[0].id.clone();

        // create session — note this will try to spawn real `claude`; guard below
        let res = app.oneshot(Request::post("/sessions")
            .header("content-type", "application/x-www-form-urlencoded")
            .body(Body::from(format!("project_id={pid}&text=hello"))).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::SEE_OTHER);
        assert_eq!(crate::db::sessions::list(&st.pool).await.unwrap().len(), 1);
    }
}
```

> **Real-spawn caveat:** `registry.ensure` spawns real `claude`. In the test above the session row is created before the spawn and the redirect returns immediately, so the assertion holds even if `claude` isn't installed in CI (the child spawn happens in the actor task; a spawn failure only logs). To keep this test hermetic, gate it with `#[cfg_attr(not(feature = "live-claude"), ignore)]` OR make `Registry` hold an injectable spawn closure (preferred): add `Registry::new_with_spawner(...)` used by tests to inject `FakeProcess`. Choose the injectable-spawner route — it makes Task 8/9 tests hermetic too. Update `Registry` accordingly and mark the ignore only on the Task 10 smoke test.

- [ ] **Step 4: Make `Registry` spawner-injectable**

Refactor `Registry` to store `spawner: Arc<dyn Fn(SpawnParams) -> Box<dyn AgentProcess> + Send + Sync>` and have `ensure` use it. Provide `Registry::live()` (real `spawn_claude`) and `Registry::with_spawner(f)` (tests). Update `spawn_actor` to accept `P = Box<dyn AgentProcess>` (add `impl AgentProcess for Box<dyn AgentProcess>` forwarding). This keeps prod behavior identical and every web/actor test hermetic.

- [ ] **Step 5: Run tests**

Run: `cargo test -p t3rs`
Expected: PASS, hermetic (no real `claude` needed). Manual: `cargo run`, add a project via the form, start a session, confirm redirect to the session page (streaming wired in Task 8).

- [ ] **Step 6: Commit**

```bash
git add apps/t3rs
git commit -m "feat(t3rs): create project + create session flows, injectable spawner"
```

---

### Task 8: SSE streaming endpoint + live transcript (HTMX)

**Files:**

- Create: `apps/t3rs/src/web/stream.rs`
- Modify: `apps/t3rs/src/web/mod.rs` (route), `apps/t3rs/src/web/render.rs` (turn_status OOB already present)

**Interfaces:**

- Produces: `GET /sessions/{id}/events` → `Sse<impl Stream<Item = Result<Event, Infallible>>>`. On connect: read `Last-Event-ID` header (default 0), replay `events::list_after(pool, id, last)` as `message` frames, then tail `registry.get(id)?.broadcast_tx.subscribe()`. Each frame: `Event::default().id(stored.id.to_string()).event("message").data(rendered_html)` plus, for `user`/`result` events, follow-up `turn_status` OOB embedded in the same frame's HTML.
- Consumes: `render::fragment`, `render::turn_status`, `db::events::list_after`, `Registry::get`.

- [ ] **Step 1: Write `web/stream.rs`**

```rust
use crate::db;
use crate::web::render;
use crate::web::AppState;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::sse::{Event, Sse};
use axum::response::IntoResponse;
use futures::stream::{self, Stream, StreamExt};
use std::convert::Infallible;

pub async fn events(
    State(st): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let last: i64 = headers.get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let session_opt = db::sessions::get(&st.pool, &id).await.ok().flatten();
    let backlog = db::events::list_after(&st.pool, &id, last).await.unwrap_or_default();

    // subscribe to live (if an actor is running); otherwise stream backlog only
    let live = st.registry.get(&id).map(|h| h.broadcast_tx.subscribe());

    let backlog_stream = stream::iter(backlog.into_iter().map(to_event));

    let stream: std::pin::Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> = match live {
        Some(mut rx) => {
            let live_stream = async_stream::stream! {
                loop {
                    match rx.recv().await {
                        Ok(ev) => yield to_event(ev),
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            };
            Box::pin(backlog_stream.chain(live_stream))
        }
        None => Box::pin(backlog_stream),
    };
    let _ = session_opt;
    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}

fn to_event(stored: crate::db::events::StoredEvent) -> Result<Event, Infallible> {
    let mut html = render::fragment(&stored).into_string();
    // piggy-back turn-status OOB on user/result frames
    match &stored.event {
        crate::agent::AgentEvent::User { .. } =>
            html.push_str(&render::turn_status(crate::db::sessions::SessionStatus::Running).into_string()),
        crate::agent::AgentEvent::Result { .. } | crate::agent::AgentEvent::Error { .. } =>
            html.push_str(&render::turn_status(crate::db::sessions::SessionStatus::Idle).into_string()),
        _ => {}
    }
    Ok(Event::default().id(stored.id.to_string()).event("message").data(html))
}
```

Add deps to `Cargo.toml`: `async-stream = "0.3"`. Add route: `.route("/sessions/{id}/events", get(stream::events))`.

- [ ] **Step 2: Write an SSE backlog test (hermetic, no live actor)**

```rust
// web/stream.rs tests
#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    #[tokio::test]
    async fn events_replays_persisted_backlog_as_sse() {
        let st = crate::web::pages::tests::test_state().await;
        // seed project/session/events
        crate::db::projects::insert(&st.pool, &crate::db::projects::Project {
            id: "p".into(), path: "/tmp".into(), name: "p".into(), created_at: 0 }).await.unwrap();
        crate::db::sessions::insert(&st.pool, &crate::db::sessions::Session {
            id: "s".into(), project_id: "p".into(), title: "t".into(), claude_session_id: None,
            status: crate::db::sessions::SessionStatus::Idle, created_at: 0, updated_at: 0 }).await.unwrap();
        crate::db::events::append(&st.pool, "s", 0,
            &crate::agent::AgentEvent::AssistantText { text: "pong".into() }, 0).await.unwrap();

        let app = crate::web::router(st);
        let res = app.oneshot(Request::get("/sessions/s/events")
            .body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.headers().get("content-type").unwrap(), "text/event-stream");
        // With no live actor the stream is finite (backlog only) and completes.
        let body = res.into_body().collect().await.unwrap().to_bytes();
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("event:message"));
        assert!(text.contains("pong"));
        assert!(text.contains("id:1"));
    }
}
```

- [ ] **Step 3: Run**

Run: `cargo test -p t3rs stream::`
Expected: PASS. (Backlog-only stream is finite because no live subscription is attached, so `collect()` terminates.)

- [ ] **Step 4: Manual end-to-end streaming check**

`cargo run`. Add a project pointing at a real dir, start a session with prompt "say pong". The session page should show your user bubble immediately (via SSE), then the assistant "pong", then idle status — all without reload. If nothing streams, check the browser console for the SSE extension loading and that `sse-connect` points at the right URL.

- [ ] **Step 5: Commit**

```bash
git add apps/t3rs
git commit -m "feat(t3rs): SSE stream endpoint with backlog replay + live tail"
```

---

### Task 9: Send prompt / stop on existing sessions + resume

**Files:**

- Modify: `apps/t3rs/src/web/sessions.rs` (add `messages`, `stop` handlers), `apps/t3rs/src/web/mod.rs` (routes)

**Interfaces:**

- Produces: `POST /sessions/{id}/messages` (form `text`) → `ensure` actor (spawns with `--resume` if `claude_session_id` present), send `SendPrompt`, return `StatusCode::NO_CONTENT` (204). The user bubble + stream arrive via SSE.
- Produces: `POST /sessions/{id}/stop` → `registry.get(id)` then send `SessionCommand::Stop`; return 204.

- [ ] **Step 1: Add handlers to `web/sessions.rs`**

```rust
use axum::extract::Path;
use axum::http::StatusCode;

#[derive(Deserialize)]
pub struct SendMessage { pub text: String }

pub async fn messages(State(st): State<AppState>, Path(id): Path<String>, Form(f): Form<SendMessage>)
    -> Result<StatusCode, AppError> {
    let session = db::sessions::get(&st.pool, &id).await?.ok_or(AppError::NotFound)?;
    if f.text.trim().is_empty() { return Err(AppError::BadRequest("message required".into())); }
    let project = db::projects::get(&st.pool, &session.project_id).await?.ok_or(AppError::NotFound)?;
    let handle = st.registry.ensure(&id, project.path, actor_deps(&st));
    handle.cmd_tx.send(SessionCommand::SendPrompt(f.text))
        .await.map_err(|_| AppError::Internal("actor unavailable".into()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn stop(State(st): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, AppError> {
    if let Some(handle) = st.registry.get(&id) {
        let _ = handle.cmd_tx.send(SessionCommand::Stop).await;
    }
    Ok(StatusCode::NO_CONTENT)
}
```

Routes: `.route("/sessions/{id}/messages", post(sessions::messages))`, `.route("/sessions/{id}/stop", post(sessions::stop))`.

- [ ] **Step 2: Resume verification test (injected fake asserts `--resume` id is passed)**

```rust
// web/sessions.rs tests — uses the injectable spawner from Task 7 Step 4
#[tokio::test]
async fn messages_on_existing_session_resumes_with_claude_id() {
    use crate::agent::process::{FakeProcess, SpawnParams};
    use std::sync::{Arc, Mutex};

    let captured: Arc<Mutex<Option<Option<String>>>> = Arc::new(Mutex::new(None));
    let cap2 = captured.clone();
    let registry = crate::agent::registry::Registry::with_spawner(move |params: SpawnParams| {
        *cap2.lock().unwrap() = Some(params.resume.clone());
        Box::new(FakeProcess::new(vec![
            crate::agent::AgentEvent::Result { ok: true, summary: None },
        ])) as Box<dyn crate::agent::process::AgentProcess>
    });

    let mut st = crate::web::pages::tests::test_state().await;
    st.registry = Arc::new(registry);

    crate::db::projects::insert(&st.pool, &crate::db::projects::Project {
        id: "p".into(), path: "/tmp".into(), name: "p".into(), created_at: 0 }).await.unwrap();
    crate::db::sessions::insert(&st.pool, &crate::db::sessions::Session {
        id: "s".into(), project_id: "p".into(), title: "t".into(),
        claude_session_id: Some("resume-me".into()),
        status: crate::db::sessions::SessionStatus::Idle, created_at: 0, updated_at: 0 }).await.unwrap();

    let app = crate::web::router(st.clone());
    use axum::body::Body; use axum::http::Request; use tower::ServiceExt;
    let res = app.oneshot(Request::post("/sessions/s/messages")
        .header("content-type", "application/x-www-form-urlencoded")
        .body(Body::from("text=again")).unwrap()).await.unwrap();
    assert_eq!(res.status(), axum::http::StatusCode::NO_CONTENT);

    // give the actor task a tick to spawn
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert_eq!(*captured.lock().unwrap(), Some(Some("resume-me".to_string())));
}
```

- [ ] **Step 3: Run**

Run: `cargo test -p t3rs sessions::`
Expected: PASS — confirms an existing session resumes with its stored `claude_session_id`.

- [ ] **Step 4: Manual multi-turn + restart check**

`cargo run`; start a session, send a first prompt, wait for idle, send a second prompt in the same session — the agent should keep context (resume working). Stop the server (Ctrl-C), restart, reopen the same session URL — full history renders from SQLite. Sending another message resumes again.

- [ ] **Step 5: Commit**

```bash
git add apps/t3rs
git commit -m "feat(t3rs): send-message + stop handlers, session resume"
```

---

### Task 10: Polish — styling, error surfaces, README, live smoke test

**Files:**

- Modify: `apps/t3rs/src/assets/app.css`
- Create: `apps/t3rs/README.md`, `apps/t3rs/tests/live_smoke.rs`

**Interfaces:** none new.

- [ ] **Step 1: Style pass in `app.css`**

Dark terminal aesthetic: sidebar + main two-column grid, message bubbles (`.msg.user` right-aligned/accent, `.msg.assistant` left), `.tool-use`/`.tool-result` as bordered cards (collapsible via `<details>` if desired), `#turn-status` a small pill, sticky composer at the bottom. Keep it one file, no build step.

- [ ] **Step 2: Write `README.md`**

Document: what it is (spite-driven Node-free T3 Code core), prerequisites (`claude` CLI installed + authed, Rust 1.96), `cargo run`, env vars (`T3RS_BIND`, `T3RS_DB`, `T3RS_CLAUDE_BIN`, `T3RS_DEFAULT_PROJECT`), and the milestone-1 scope + known limitations (single user, `acceptEdits` permission mode, one provider).

- [ ] **Step 3: Write an ignored live smoke test**

```rust
// tests/live_smoke.rs
#[tokio::test]
#[ignore = "requires real claude CLI + auth; run with --ignored"]
async fn real_claude_streams_a_turn_to_completion() {
    // Spawn a real ClaudeProcess in a temp dir, send "reply with pong",
    // collect events until Result, assert an AssistantText contained "pong".
    use t3rs::agent::process::{spawn_claude, AgentProcess, SpawnParams};
    let dir = std::env::temp_dir();
    let mut p = spawn_claude(SpawnParams {
        claude_bin: "claude".into(),
        cwd: dir.to_string_lossy().into_owned(),
        resume: None,
    }).unwrap();
    let mut rx = p.take_events();
    p.send_user("Reply with exactly: pong").await.unwrap();
    let mut saw_pong = false;
    while let Some(ev) = rx.recv().await {
        if let t3rs::agent::AgentEvent::AssistantText { text } = &ev {
            if text.contains("pong") { saw_pong = true; }
        }
        if matches!(ev, t3rs::agent::AgentEvent::Result { .. }) { break; }
    }
    assert!(saw_pong);
}
```

This requires a `lib.rs` exposing the crate (add `src/lib.rs` re-exporting `pub mod agent; pub mod db; ...` and have `main.rs` use the lib), so integration tests can import `t3rs::`. Make that refactor here: convert to a `lib.rs` + thin `main.rs`.

- [ ] **Step 4: Run**

Run: `cargo test -p t3rs` (unit + integration, smoke skipped by default). Then, manually with credentials: `cargo test -p t3rs --test live_smoke -- --ignored` → PASS against real `claude`.

- [ ] **Step 5: Final manual acceptance against the spec's DoD**

Verify: add project ✓; multiple concurrent sessions across projects in the sidebar ✓; live streaming of assistant/tool/result ✓; restart survival + resume ✓. Note anything unmet in the README's limitations.

- [ ] **Step 6: Commit**

```bash
git add apps/t3rs
git commit -m "feat(t3rs): styling, README, lib.rs split, live smoke test — milestone 1 complete"
```

---

## Self-Review

**Spec coverage:**

- §1 DoD (projects, multi-session, live stream, restart+resume, single-user localhost) → Tasks 6–9; resume verified in Task 9 Step 2. ✓
- §2 architecture / crate layout → Tasks 1–8 create exactly the file structure listed. ✓
- §3 data model (projects/sessions/events, statuses, normalized payload) → Task 3. ✓
- §4 Claude integration (spawn flags, stdin/stdout, normalized `AgentEvent`, actor lifecycle) → Tasks 2, 4, 5. ✓
- §5 web/HTMX (routes table, SSE contract, 204-on-send, OOB status) → Tasks 6–9. ✓
- §6 error handling (`AppError`, tolerant parse loop, persist-before-broadcast, per-session isolation) → Task 6 (`error.rs`), Task 4 (tolerant parse), Task 5 (`persist_and_emit`). ✓
- §7 config → Task 1. ✓
- §8 testing (normalize table tests, db round-trip, actor over fake, axum oneshot, ignored smoke) → Tasks 2,3,5,6,10. ✓
- §9 build sequence → Tasks 1–10 map 1:1. ✓
- §11 open questions (stdin shape, cwd, permission mode) → resolved in Task 1 Step 7 (capture) and Task 4 (current_dir, acceptEdits). ✓

**Placeholder scan:** Two illustrative non-code lines are explicitly flagged for removal (the `let _ = PhantomData` marker in `error.rs` Step 1, and the placeholder `emit_user` in actor Step 1, replaced in Step 2). These are called out as refinements, not left as silent TODOs. No `TBD`/"handle edge cases"/"write tests for the above" remain — every test has real code.

**Type consistency:** `AgentEvent` variants (incl. `User` added in Task 5 Step 2) and `kind()` strings are consistent across normalize (Task 2), render (Task 6), stream (Task 8). `StoredEvent`, `SessionStatus`, `SessionHandle`, `SessionCommand`, `SpawnParams`, `ActorDeps`, `Registry::{get,ensure,with_spawner}` names match across Tasks 3–9. The `Registry` spawner refactor (Task 7 Step 4) makes `spawn_actor` generic over `Box<dyn AgentProcess>`, consistent with the injected fakes in Tasks 7 and 9.

**Known adjustment during execution:** `AgentProcess::send_user`/`take_events` use `impl Future`/associated-return in a trait; if object-safety bites when boxing (`Box<dyn AgentProcess>`), switch the trait to `#[async_trait]` (add the `async-trait` crate) or return `Pin<Box<dyn Future>>`. Task 7 Step 4 is the point where this is decided; prefer `async-trait` for readability.
