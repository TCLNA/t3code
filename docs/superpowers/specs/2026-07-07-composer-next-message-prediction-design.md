# Composer next-message prediction ("→ to prefill")

**Date:** 2026-07-07
**Status:** Design approved, pending implementation plan

## Summary

Add a Claude-Code-style input prediction to the chat composer. When an assistant
turn finishes and the composer is empty, the web app asks the server to guess the
user's likely next message using an LLM. The guess renders as **ghost text in the
empty composer** (reusing the existing placeholder overlay slot). Pressing
**Right-arrow** prefills the whole predicted text. Typing anything clears the ghost.

Exactly one prediction call is made per completed turn, cached per
`(threadId, lastTurnId)`. Nothing happens while the user types. The feature is
**opt-in** (settings default OFF) because each prediction costs a model call.

## Goals

- One-key (Right-arrow) prefill of an LLM-predicted next message when the composer
  is empty.
- Cheap and unobtrusive: one call per turn, cached, no idle re-prediction, no cost
  unless enabled.
- Reuse existing infrastructure (the `TextGeneration` auxiliary-completion service,
  Effect RPC over WebSocket, the settings schema, the Lexical placeholder overlay).

## Non-goals (YAGNI)

- History-based autosuggest (fish/zsh style). No prompt-history store is built.
- Streaming the prediction, word-by-word / partial acceptance, or multi-suggestion
  cycling.
- Idle re-prediction while focused, or on-demand trigger keys.
- Tab-to-accept, Escape-to-dismiss, or a discoverability hint. Right-arrow is the
  only accept key; typing hides the ghost naturally.
- Predictor support for Grok / Cursor / OpenCode drivers (they return empty → no
  ghost).

## Key design insight

Acceptance only happens when the composer is **empty**. An empty composer already
renders the placeholder via a `pointer-events-none absolute inset-0` overlay. The
ghost text therefore always sits at offset 0 — identical to the placeholder — so we
never deal with mid-text caret alignment. The prediction is effectively a special
placeholder shown in place of the normal one.

## Data flow

```
turn completes  +  composer empty  +  settings.prediction.enabled
        │
        ▼
web hook: getPrediction(threadId)  ──RPC──►  server (ws.ts handler)
                                               │  ProjectionSnapshotQuery.getThreadDetailById(threadId) → messages[]
                                               │  TextGeneration.generateNextMessagePrediction({ messages, modelSelection })
                                               │  provider CLI (-p --output-format json --json-schema) → { prediction }
        ◄───────────────────────────────────────┘
web: cache { (threadId,lastTurnId) → prediction }
     render prediction as ghost in empty composer (placeholder slot)
Right-arrow on empty box → $setComposerEditorPrompt(prediction), caret at end, clear cache entry
typing / send / new turn → ghost cleared
```

## Components

### 1. Server predictor (`apps/server/src/textGeneration/`)

Follows the existing auxiliary-completion pattern (thread titles, commit messages),
which spawns the provider CLI with a JSON schema and decodes a structured envelope.

- **`TextGeneration.ts`** — add `generateNextMessagePrediction` to the
  `TextGeneration` service interface. Input carries the recent `messages[]` and a
  `modelSelection: ModelSelection`; output is `{ prediction: string }`. An empty
  string means "not confident" and suppresses the ghost.
- **`ClaudeTextGeneration.ts`** and **`CodexTextGeneration.ts`** — implement the
  method by building argv with `--json-schema <PredictionSchema>` and
  `--model <resolved model>`, piping the prompt to stdin, and decoding
  `{ structured_output: { prediction } }`. Grok / Cursor / OpenCode drivers return
  `{ prediction: "" }` (no-op).
- **`TextGenerationPrompts.ts`** — add `buildPredictionPrompt(messages)`. Feeds the
  last N messages (cap ~10; truncate long message bodies) and instructs: "Predict
  the user's single most likely next message in this conversation. Output only that
  message text with no preamble. If it is unclear, output an empty string."
- Reuse the existing per-call timeout and error type (`TextGenerationError`).

### 2. RPC (`packages/contracts/src/rpc.ts`, `apps/server/src/ws.ts`, client-runtime)

Mirror `serverGetSettings`:

- `WS_METHODS.getPrediction = "orchestration.getPrediction"`.
- `WsGetPredictionRpc = Rpc.make(WS_METHODS.getPrediction, { payload: Schema.Struct({ threadId: ThreadId }), success: Schema.Struct({ prediction: Schema.String }), error: ... })`.
- Register in `WsRpcGroup`.
- Handler in `ws.ts` `.of({...})`: read the thread via `ProjectionSnapshotQuery`,
  read `settings.prediction.model`, call `TextGeneration.generateNextMessagePrediction`,
  return `{ prediction }`. Wrapped in `observeRpcEffect` like siblings. If the
  thread is missing or prediction disabled server-side, return `{ prediction: "" }`.
- Client command exposed in `packages/client-runtime/src/state/server.ts` via
  `createEnvironmentRpcCommand`, consumed in the web hook (below).

### 3. Settings (`packages/contracts/src/settings.ts`, web)

- New server-side group:
  ```
  PredictionSettings = Schema.Struct({
    enabled: Schema.Boolean (decoding default false),
    model:   ModelSelection (decoding default = a fast model, e.g. Claude Haiku),
  })
  ```
- Add `prediction: PredictionSettings (decoding default {})` into `ServerSettings`.
- Add the matching partial into `ServerSettingsPatch`:
  `prediction: Schema.optionalKey(Schema.Struct({ enabled: Schema.optionalKey(Schema.Boolean), model: Schema.optionalKey(ModelSelectionPatch) }))`.
- **Verify** the new `prediction` group is NOT stripped by
  `redactServerSettingsForClient` — the web needs to read `enabled`/`model`.
- Web UI: a `Switch` row in `SettingsPanels.tsx` (copy the `enableAssistantStreaming`
  block) bound to `settings.prediction.enabled`; optionally a model picker bound to
  `settings.prediction.model`. `splitPatch` routes `prediction` to the server store
  automatically since it is a `ServerSettings` field.

### 4. Client fetch + cache orchestration (web)

A small hook/store scoped to the active thread:

- **Trigger:** thread phase transitions to idle/done AND the composer prompt is
  empty AND `settings.prediction.enabled`.
- **Dedupe:** key `(threadId, lastTurnId)`. Fetch at most once per turn; reuse the
  cached result. Clear the entry on send or when a new turn starts.
- Fire-and-forget. On RPC failure or empty-string result, no ghost is shown. No
  retries.
- Exposes the current prediction string for the active empty composer to the
  `ChatComposer` → `ComposerPromptEditor`.

### 5. Ghost-text UI + accept (`ComposerPromptEditor.tsx`, `ChatComposer.tsx`)

- `ComposerPromptEditor` gains a `ghostText?: string` prop and an
  `onAcceptGhost?: () => void` prop. When the editor is **empty**, render `ghostText`
  in the placeholder overlay slot (`pointer-events-none absolute inset-0`,
  `text-muted-foreground/35`) instead of the normal placeholder. Non-empty editor →
  normal placeholder behavior, ghost hidden.
- **Accept:** extend `ComposerInlineTokenArrowPlugin` (already intercepts
  `KEY_ARROW_RIGHT_COMMAND` at high priority). When the editor is empty and a ghost
  exists, `preventDefault` and invoke `onAcceptGhost`. Otherwise fall through to the
  existing token-skip behavior.
- `onAcceptGhost` in `ChatComposer` calls the editor handle to set the full prompt
  (`$setComposerEditorPrompt` path via the existing controlled `value`/`cursor`
  model), places the caret at the end, and clears the cache entry.

## Error handling

- RPC failure, timeout, missing thread, or empty prediction → no ghost, silent. The
  composer behaves exactly as today.
- Right-arrow with text present, or next to an inline chip → unchanged token-skip
  behavior (no regression).
- Feature disabled (default) → no calls made, no client subscription active.

## Testing

- **Server:** unit-test `buildPredictionPrompt` (message capping/truncation) and the
  driver decode of `{ structured_output: { prediction } }`, including empty-string
  suppression.
- **Client logic:** the dedupe/cache hook — fetches once per turn, reuses cache,
  clears on send and on new turn, no fetch when disabled or when composer non-empty.
- **Editor:** ghost renders only when empty; Right-arrow on empty box accepts and
  fills the prompt; Right-arrow with text present still performs token-skip
  (regression guard); typing hides the ghost.

## Key files to touch

| Concern | File |
| --- | --- |
| Predictor service | `apps/server/src/textGeneration/TextGeneration.ts` |
| Claude driver | `apps/server/src/textGeneration/ClaudeTextGeneration.ts` |
| Codex driver | `apps/server/src/textGeneration/CodexTextGeneration.ts` |
| Prediction prompt | `apps/server/src/textGeneration/TextGenerationPrompts.ts` |
| RPC contract | `packages/contracts/src/rpc.ts` |
| RPC handler | `apps/server/src/ws.ts` |
| Thread read model | `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts` |
| Client command | `packages/client-runtime/src/state/server.ts` |
| Settings schema | `packages/contracts/src/settings.ts` |
| Settings UI | `apps/web/src/components/settings/SettingsPanels.tsx` |
| Fetch/cache hook | new file under `apps/web/src/` (composer-adjacent) |
| Ghost UI + accept | `apps/web/src/components/ComposerPromptEditor.tsx`, `apps/web/src/components/chat/ChatComposer.tsx` |
