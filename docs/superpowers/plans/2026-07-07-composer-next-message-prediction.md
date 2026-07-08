# Composer Next-Message Prediction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an assistant turn finishes and the composer is empty, guess the user's likely next message with an LLM, show it as ghost text in the empty composer, and let Right-arrow prefill it.

**Architecture:** A new `generateNextMessagePrediction` method is added to the existing `TextGeneration` Effect service (which shells out to a provider CLI with a JSON schema). A new WebSocket RPC `server.getPrediction` reads the thread's messages via `ProjectionSnapshotQuery` and calls the service using a model from settings. The web app fetches once per completed turn (dedupe by last message id), renders the result in the Lexical placeholder overlay slot, and accepts it on Right-arrow. Opt-in via a new `prediction` server-settings group (default OFF).

**Tech Stack:** TypeScript, Effect (`effect/Schema`, `effect/Effect`, `effect/unstable/rpc`), Lexical (contenteditable editor), React, Vitest (`vite-plus/test` for plain unit tests, `@effect/vitest` for Effect tests).

## Global Constraints

- Prediction is **opt-in**: `settings.prediction.enabled` defaults to `false`. No prediction RPC is issued when disabled.
- **Exactly one** prediction call per completed turn, deduped by `(threadId, lastMessageId)`. No idle re-prediction, no retries.
- Predictor is implemented for **Claude and Codex** drivers only. Grok/Cursor/OpenCode drivers return `{ prediction: "" }` (no ghost). All five drivers MUST implement the method because each returns `satisfies TextGeneration["Service"]`.
- An **empty** `prediction` string means "no suggestion" — never render a ghost or accept for it.
- Accept key is **Right-arrow only**, and only when the composer is empty. No Tab, no Escape, no hint affordance.
- Ghost text is shown ONLY when the editor value is empty (offset 0), reusing the placeholder overlay — never mid-text.
- Follow existing patterns exactly (Effect service/driver shape, RPC registration, settings schema, Lexical plugin structure). Do not restructure existing files.
- Server package name is `t3` (dir `apps/server`); web is `@t3tools/web`; contracts `@t3tools/contracts`; client runtime `@t3tools/client-runtime`.
- Run a single test file: `pnpm --filter <pkg> test <relative-path>`. Typecheck: `pnpm --filter <pkg> typecheck`.

---

### Task 1: Prediction settings schema

**Files:**
- Modify: `packages/contracts/src/settings.ts` (add `PredictionSettings`, wire into `ServerSettings` ~line 519, add to `ServerSettingsPatch` ~line 653)
- Test: `packages/contracts/src/settings.prediction.test.ts` (create)

**Interfaces:**
- Produces: `PredictionSettings` (`{ enabled: boolean; model: ModelSelection }`), reachable as `settings.prediction.enabled` / `settings.prediction.model` on `UnifiedSettings`. Patchable via `ServerSettingsPatch.prediction`.

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/settings.prediction.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ServerSettings, DEFAULT_SERVER_SETTINGS } from "./settings.ts";

describe("PredictionSettings", () => {
  it("defaults prediction to disabled with a model selection", () => {
    expect(DEFAULT_SERVER_SETTINGS.prediction.enabled).toBe(false);
    expect(DEFAULT_SERVER_SETTINGS.prediction.model.instanceId).toBeTruthy();
    expect(typeof DEFAULT_SERVER_SETTINGS.prediction.model.model).toBe("string");
  });

  it("decodes an explicit enabled flag", () => {
    const decoded = Schema.decodeSync(ServerSettings)({ prediction: { enabled: true } });
    expect(decoded.prediction.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @t3tools/contracts test src/settings.prediction.test.ts`
Expected: FAIL — `prediction` does not exist on settings.

- [ ] **Step 3: Add the schema**

In `packages/contracts/src/settings.ts`, add the group after `ObservabilitySettings` (after line 363):

```ts
/**
 * LLM next-message prediction. When enabled, the server guesses the user's
 * likely next message after each completed turn so the composer can offer it
 * as ghost text. OFF by default because each prediction costs a model call.
 */
export const PredictionSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  model: ModelSelection.pipe(
    Schema.withDecodingDefault(
      Effect.succeed({
        instanceId: ProviderInstanceId.make("codex"),
        model: DEFAULT_GIT_TEXT_GENERATION_MODEL,
      }),
    ),
  ),
});
export type PredictionSettings = typeof PredictionSettings.Type;
```

Wire it into `ServerSettings` alongside `speech` (after line 519):

```ts
  speech: SpeechSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  prediction: PredictionSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
```

Add the patch entry to `ServerSettingsPatch` after the `speech` block (after line 638):

```ts
  prediction: Schema.optionalKey(
    Schema.Struct({
      enabled: Schema.optionalKey(Schema.Boolean),
      model: Schema.optionalKey(ModelSelectionPatch),
    }),
  ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @t3tools/contracts test src/settings.prediction.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @t3tools/contracts typecheck`
Expected: no errors. (`ModelSelectionPatch` is declared at line 569, before `ServerSettingsPatch`; `ModelSelection`, `ProviderInstanceId`, `DEFAULT_GIT_TEXT_GENERATION_MODEL`, and `Effect` are already imported/used in this file.)

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/settings.ts packages/contracts/src/settings.prediction.test.ts
git commit -m "feat(contracts): add prediction settings group"
```

---

### Task 2: Prediction prompt builder

**Files:**
- Modify: `apps/server/src/textGeneration/TextGenerationPrompts.ts` (add `buildPredictionPrompt` + input type)
- Test: `apps/server/src/textGeneration/TextGenerationPrompts.test.ts` (add cases)

**Interfaces:**
- Produces:
  ```ts
  interface PredictionMessage { role: "user" | "assistant" | "system"; text: string }
  interface PredictionPromptInput { messages: ReadonlyArray<PredictionMessage> }
  function buildPredictionPrompt(input: PredictionPromptInput):
    { prompt: string; outputSchema: Schema.Struct<{ prediction: typeof Schema.String }> }
  ```
- Consumes: `limitSection` (already imported in this file).

- [ ] **Step 1: Write the failing test**

Append to `apps/server/src/textGeneration/TextGenerationPrompts.test.ts`:

```ts
describe("buildPredictionPrompt", () => {
  it("includes recent messages and an empty-when-unclear instruction", () => {
    const result = buildPredictionPrompt({
      messages: [
        { role: "user", text: "add a login form" },
        { role: "assistant", text: "Done. Added LoginForm.tsx." },
      ],
    });

    expect(result.prompt).toContain("add a login form");
    expect(result.prompt).toContain("Done. Added LoginForm.tsx.");
    expect(result.prompt.toLowerCase()).toContain("empty string");
    expect(result.prompt).toContain("Return a JSON object with key: prediction.");
  });

  it("caps history to the last 10 messages", () => {
    const messages = Array.from({ length: 14 }, (_, i) => ({
      role: "user" as const,
      text: `message-${i}`,
    }));
    const result = buildPredictionPrompt({ messages });

    expect(result.prompt).not.toContain("message-3");
    expect(result.prompt).toContain("message-13");
  });
});
```

Add `buildPredictionPrompt` to the import block at the top of the test (lines 3-8).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter t3 test src/textGeneration/TextGenerationPrompts.test.ts`
Expected: FAIL — `buildPredictionPrompt` is not exported.

- [ ] **Step 3: Implement the builder**

Append to `apps/server/src/textGeneration/TextGenerationPrompts.ts`:

```ts
// ---------------------------------------------------------------------------
// Next-message prediction
// ---------------------------------------------------------------------------

export interface PredictionMessage {
  role: "user" | "assistant" | "system";
  text: string;
}

export interface PredictionPromptInput {
  messages: ReadonlyArray<PredictionMessage>;
}

const PREDICTION_MAX_MESSAGES = 10;
const PREDICTION_MAX_MESSAGE_CHARS = 2_000;

export function buildPredictionPrompt(input: PredictionPromptInput) {
  const recent = input.messages.slice(-PREDICTION_MAX_MESSAGES);
  const transcript = recent
    .map((message) => `${message.role}: ${limitSection(message.text, PREDICTION_MAX_MESSAGE_CHARS)}`)
    .join("\n\n");

  const prompt = [
    "You predict the user's most likely next message in a coding conversation.",
    "Return a JSON object with key: prediction.",
    "Rules:",
    "- prediction is the single next message the user would most plausibly type.",
    "- Write it as the user, in first person, with no preamble or quotes.",
    "- Keep it natural and concise.",
    "- If the next message is genuinely unclear, return an empty string.",
    "",
    "Conversation so far:",
    transcript,
  ].join("\n");

  const outputSchema = Schema.Struct({
    prediction: Schema.String,
  });

  return { prompt, outputSchema };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter t3 test src/textGeneration/TextGenerationPrompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/textGeneration/TextGenerationPrompts.ts apps/server/src/textGeneration/TextGenerationPrompts.test.ts
git commit -m "feat(server): add next-message prediction prompt builder"
```

---

### Task 3: TextGeneration service method + registry delegate

**Files:**
- Modify: `apps/server/src/textGeneration/TextGeneration.ts` (add input/result types, service method, delegate)
- Test: (covered by Task 4's driver test; no separate test here — folded in)

**Interfaces:**
- Produces:
  ```ts
  interface NextMessagePredictionInput {
    cwd: string;
    messages: ReadonlyArray<{ role: "user" | "assistant" | "system"; text: string }>;
    modelSelection: ModelSelection;
  }
  interface NextMessagePredictionResult { prediction: string }
  // on TextGeneration["Service"]:
  generateNextMessagePrediction(input: NextMessagePredictionInput):
    Effect.Effect<NextMessagePredictionResult, TextGenerationError>
  ```
- Consumes: `resolveInstance`, `ModelSelection`, `TextGenerationError` (already in file).

- [ ] **Step 1: Add types and interface entries**

In `apps/server/src/textGeneration/TextGeneration.ts`, after `ThreadTitleGenerationResult` (line 68) add:

```ts
export interface NextMessagePredictionInput {
  cwd: string;
  messages: ReadonlyArray<{ role: "user" | "assistant" | "system"; text: string }>;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface NextMessagePredictionResult {
  prediction: string;
}
```

Add to the plain `TextGenerationService` interface (after line 76):

```ts
  generateNextMessagePrediction(
    input: NextMessagePredictionInput,
  ): Promise<NextMessagePredictionResult>;
```

Add to the `Context.Service` shape (after the `generateThreadTitle` member, line 111):

```ts
    /**
     * Predict the user's likely next message from recent conversation context.
     */
    readonly generateNextMessagePrediction: (
      input: NextMessagePredictionInput,
    ) => Effect.Effect<NextMessagePredictionResult, TextGenerationError>;
```

- [ ] **Step 2: Extend the operation union and registry delegate**

Add `"generateNextMessagePrediction"` to the `TextGenerationOp` union (line 118-122):

```ts
type TextGenerationOp =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "generateNextMessagePrediction";
```

Add the delegate to `makeTextGenerationFromRegistry` (after the `generateThreadTitle` entry, line 161):

```ts
    generateNextMessagePrediction: (input) =>
      resolveInstance(
        registry,
        "generateNextMessagePrediction",
        input.modelSelection.instanceId,
      ).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generateNextMessagePrediction(input)),
      ),
```

- [ ] **Step 3: Typecheck (expect driver errors)**

Run: `pnpm --filter t3 typecheck`
Expected: FAIL — the 5 drivers no longer satisfy `TextGeneration["Service"]` (missing method). This is expected; Tasks 4 & 5 fix it. Do not commit yet.

- [ ] **Step 4: Commit after Task 4 & 5**

This task's commit is bundled with Task 4 (drivers must compile). Proceed directly to Task 4.

---

### Task 4: Claude & Codex driver implementations

**Files:**
- Modify: `apps/server/src/textGeneration/ClaudeTextGeneration.ts`
- Modify: `apps/server/src/textGeneration/CodexTextGeneration.ts`
- Test: `apps/server/src/textGeneration/ClaudeTextGeneration.test.ts` (add a prediction case following existing spawner-mock cases)

**Interfaces:**
- Consumes: `buildPredictionPrompt` (Task 2), `NextMessagePredictionInput/Result` (Task 3).
- Produces: working `generateNextMessagePrediction` on both drivers.

- [ ] **Step 1: Write the failing test**

Open `apps/server/src/textGeneration/ClaudeTextGeneration.test.ts`, read an existing test that mocks the spawner and asserts a decoded result (e.g. the `generateThreadTitle` case), and add an analogous case:

```ts
it.effect("generateNextMessagePrediction returns the predicted message", () =>
  Effect.gen(function* () {
    // Reuse this file's existing spawner mock helper that returns a
    // structured_output envelope. Provide { prediction: "run the tests" }.
    const textGeneration = yield* makeClaudeTextGenerationForTest({
      structuredOutput: { prediction: "run the tests" },
    });
    const result = yield* textGeneration.generateNextMessagePrediction({
      cwd: "/tmp",
      messages: [{ role: "assistant", text: "I added the feature." }],
      modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "claude-haiku-4-5" },
    });
    assert.strictEqual(result.prediction, "run the tests");
  }),
);
```

Match the exact mock helper name and imports already used in this test file (read the top of the file first — do not invent `makeClaudeTextGenerationForTest` if the file names it differently; use the file's actual helper).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter t3 test src/textGeneration/ClaudeTextGeneration.test.ts`
Expected: FAIL — method missing.

- [ ] **Step 3: Implement in Claude driver**

In `apps/server/src/textGeneration/ClaudeTextGeneration.ts`:

Add `buildPredictionPrompt` to the prompt import block (lines 22-27):

```ts
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPredictionPrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
```

Add `"generateNextMessagePrediction"` to BOTH `operation` unions in this file (in `encodeJsonForOperation` at line 84-88, and in `runClaudeJson`'s params at line 114-118).

Add the method before the `return {...}` block (after line 356):

```ts
  const generateNextMessagePrediction: TextGeneration.TextGeneration["Service"]["generateNextMessagePrediction"] =
    Effect.fn("ClaudeTextGeneration.generateNextMessagePrediction")(function* (input) {
      const { prompt, outputSchema } = buildPredictionPrompt({ messages: input.messages });

      const generated = yield* runClaudeJson({
        operation: "generateNextMessagePrediction",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return { prediction: generated.prediction.trim() };
    });
```

Add it to the returned object (line 358-363):

```ts
  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
    generateNextMessagePrediction,
  } satisfies TextGeneration.TextGeneration["Service"];
```

- [ ] **Step 4: Implement in Codex driver**

In `apps/server/src/textGeneration/CodexTextGeneration.ts`:

Add `buildPredictionPrompt` to the prompt import block (lines 19-24). Add `"generateNextMessagePrediction"` to the `operation` unions in `encodeJsonForOperation` (line 96-100), `materializeImageAttachments` (line 115-119), and `runCodexJson` params (line 157-161).

Add the method before the `return {...}` (after line 396):

```ts
  const generateNextMessagePrediction: TextGeneration.TextGeneration["Service"]["generateNextMessagePrediction"] =
    Effect.fn("CodexTextGeneration.generateNextMessagePrediction")(function* (input) {
      const { prompt, outputSchema } = buildPredictionPrompt({ messages: input.messages });

      const generated = yield* runCodexJson({
        operation: "generateNextMessagePrediction",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return { prediction: generated.prediction.trim() };
    });
```

Add `generateNextMessagePrediction` to the returned object (line 398-403).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter t3 test src/textGeneration/ClaudeTextGeneration.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit (bundles Task 3)**

```bash
git add apps/server/src/textGeneration/TextGeneration.ts apps/server/src/textGeneration/ClaudeTextGeneration.ts apps/server/src/textGeneration/CodexTextGeneration.ts apps/server/src/textGeneration/ClaudeTextGeneration.test.ts
git commit -m "feat(server): implement next-message prediction (service + claude/codex)"
```

---

### Task 5: Stub prediction in Grok / Cursor / OpenCode drivers

**Files:**
- Modify: `apps/server/src/textGeneration/GrokTextGeneration.ts`
- Modify: `apps/server/src/textGeneration/CursorTextGeneration.ts`
- Modify: `apps/server/src/textGeneration/OpenCodeTextGeneration.ts`

**Interfaces:**
- Produces: `generateNextMessagePrediction` returning `{ prediction: "" }` on each, so all drivers satisfy `TextGeneration["Service"]`.

- [ ] **Step 1: Add the stub to each driver**

For EACH of the three files, add this method before the returned service object, then add `generateNextMessagePrediction` to that returned object. Read each file first to confirm the exact `Effect.fn` label prefix used by its other methods (e.g. `"GrokTextGeneration.generateThreadTitle"`), and match it:

```ts
  const generateNextMessagePrediction: TextGeneration.TextGeneration["Service"]["generateNextMessagePrediction"] =
    Effect.fn("GrokTextGeneration.generateNextMessagePrediction")(function* (_input) {
      // Prediction is only implemented for Claude and Codex. Returning an empty
      // string suppresses the composer ghost text for this provider.
      return { prediction: "" };
    });
```

Adjust the label string per file (`Grok`/`Cursor`/`OpenCode`). If a driver imports `TextGeneration` under a different alias, match that alias.

- [ ] **Step 2: Typecheck the whole server**

Run: `pnpm --filter t3 typecheck`
Expected: PASS — all 5 drivers now satisfy the interface.

- [ ] **Step 3: Run the driver test suite**

Run: `pnpm --filter t3 test src/textGeneration/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/textGeneration/GrokTextGeneration.ts apps/server/src/textGeneration/CursorTextGeneration.ts apps/server/src/textGeneration/OpenCodeTextGeneration.ts
git commit -m "feat(server): stub next-message prediction for grok/cursor/opencode"
```

---

### Task 6: RPC contract for `server.getPrediction`

**Files:**
- Modify: `packages/contracts/src/rpc.ts` (add method name, `Rpc.make`, register in `WsRpcGroup`)

**Interfaces:**
- Produces: `WS_METHODS.serverGetPrediction = "server.getPrediction"`, `WsServerGetPredictionRpc` with `payload: { threadId: ThreadId }`, `success: { prediction: string }`.

- [ ] **Step 1: Confirm ThreadId is importable**

`ThreadId` is not currently imported in `rpc.ts`. Read the top imports; add `ThreadId` to the existing import from `@t3tools/contracts`' orchestration/id module (the same module `OrchestrationGetTurnDiffInput` and other payload types come from — grep for where `TurnId`/`ThreadId` are exported and import `ThreadId` alongside the existing schema imports). If a payload type already re-exports ThreadId, reuse it.

- [ ] **Step 2: Add the method name**

In `WS_METHODS` (after line 210, in the "Server meta" block):

```ts
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverGetPrediction: "server.getPrediction",
```

- [ ] **Step 3: Define the RPC**

After `WsServerUpdateSettingsRpc` (after line 285):

```ts
export const WsServerGetPredictionRpc = Rpc.make(WS_METHODS.serverGetPrediction, {
  payload: Schema.Struct({ threadId: ThreadId }),
  success: Schema.Struct({ prediction: Schema.String }),
  error: EnvironmentAuthorizationError,
});
```

- [ ] **Step 4: Register in the group**

In `WsRpcGroup = RpcGroup.make(...)` add after `WsServerUpdateSettingsRpc` (line 691):

```ts
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerGetPredictionRpc,
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @t3tools/contracts typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/rpc.ts
git commit -m "feat(contracts): add server.getPrediction rpc"
```

---

### Task 7: Server handler for `server.getPrediction`

**Files:**
- Modify: `apps/server/src/ws.ts` (import + acquire `TextGeneration`, add auth scope, add handler)

**Interfaces:**
- Consumes: `WS_METHODS.serverGetPrediction`, `TextGeneration`, `projectionSnapshotQuery.getThreadDetailById`, `serverSettings.getSettings`, `AuthOrchestrationReadScope`.
- Produces: handler returning `{ prediction: string }`; `{ prediction: "" }` when disabled, thread missing, or on predictor failure.

- [ ] **Step 1: Import and acquire the service**

Add near the other textGeneration-free imports at the top of `apps/server/src/ws.ts`:

```ts
import * as TextGeneration from "./textGeneration/TextGeneration.ts";
```

In the service acquisition block (around line 398-440), add:

```ts
      const textGeneration = yield* TextGeneration.TextGeneration;
```

(`TextGeneration.layer` is already provided app-wide in `server.ts` line ~205, so the service resolves.)

- [ ] **Step 2: Register the auth scope**

In the `RPC_REQUIRED_SCOPE` map (around line 292), add after the `serverGetSettings` entry:

```ts
  [WS_METHODS.serverGetSettings, AuthOrchestrationReadScope],
  [WS_METHODS.serverUpdateSettings, AuthOrchestrationOperateScope],
  [WS_METHODS.serverGetPrediction, AuthOrchestrationReadScope],
```

- [ ] **Step 3: Add the handler**

In the `.of({...})` handlers object, after the `serverUpdateSettings` handler (after line 1299):

```ts
        [WS_METHODS.serverGetPrediction]: ({ threadId }) =>
          observeRpcEffect(
            WS_METHODS.serverGetPrediction,
            Effect.gen(function* () {
              const settings = yield* serverSettings.getSettings;
              if (!settings.prediction.enabled) {
                return { prediction: "" };
              }
              const thread = yield* projectionSnapshotQuery.getThreadDetailById(threadId);
              if (Option.isNone(thread)) {
                return { prediction: "" };
              }
              const messages = thread.value.messages.map((message) => ({
                role: message.role,
                text: message.text,
              }));
              if (messages.length === 0) {
                return { prediction: "" };
              }
              const result = yield* textGeneration
                .generateNextMessagePrediction({
                  cwd: thread.value.worktreePath ?? config.workspaceRoot,
                  messages,
                  modelSelection: settings.prediction.model,
                })
                .pipe(Effect.orElseSucceed(() => ({ prediction: "" })));
              return { prediction: result.prediction };
            }).pipe(
              Effect.catchAll(() => Effect.succeed({ prediction: "" })),
            ),
            {
              "rpc.aggregate": "server",
            },
          ),
```

Notes for the implementer:
- `Option` is already imported in `ws.ts` (used at line 1494).
- Confirm the correct cwd source: `thread.value.worktreePath` is used elsewhere in this file (line 1517). If `OrchestrationThread` lacks `worktreePath`, fall back to `config.workspaceRoot` only, or resolve the project shell like the `assetsCreateUrl` handler does (lines 1499-1517). Prefer the simplest field that compiles; the predictor does not depend on cwd contents.
- The final `catchAll` guarantees the RPC never rejects — failures degrade to no ghost.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter t3 typecheck`
Expected: PASS. If `getThreadDetailById`'s error type isn't covered by `catchAll`, the `Effect.orElseSucceed`/`catchAll` combination still resolves it — verify no residual error channel remains.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ws.ts
git commit -m "feat(server): handle server.getPrediction rpc"
```

---

### Task 8: Client-runtime command

**Files:**
- Modify: `packages/client-runtime/src/state/server.ts` (add `getPrediction` command)

**Interfaces:**
- Produces: `serverEnvironment.getPrediction` — an environment RPC command dispatching `WS_METHODS.serverGetPrediction` with `{ threadId }`, resolving `{ prediction }`.

- [ ] **Step 1: Add the command**

In `packages/client-runtime/src/state/server.ts`, inside the returned object (after the `updateSettings` command, line 188):

```ts
    getPrediction: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:server:get-prediction",
      tag: WS_METHODS.serverGetPrediction,
    }),
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @t3tools/client-runtime typecheck`
Expected: PASS. (`WS_METHODS` and `createEnvironmentRpcCommand` are already imported in this file.)

- [ ] **Step 3: Commit**

```bash
git add packages/client-runtime/src/state/server.ts
git commit -m "feat(client-runtime): add getPrediction command"
```

---

### Task 9: Settings UI toggle

**Files:**
- Modify: `apps/web/src/components/settings/SettingsPanels.tsx` (add a Switch row bound to `settings.prediction.enabled`)

**Interfaces:**
- Consumes: `usePrimarySettings()`, `useUpdatePrimarySettings()` (already used in this file), `settings.prediction.enabled`.

- [ ] **Step 1: Add the toggle**

Read the `enableAssistantStreaming` Switch block in `SettingsPanels.tsx` (around lines 661-664) to match the surrounding row markup exactly, then add an adjacent row:

```tsx
<Switch
  checked={settings.prediction.enabled}
  onCheckedChange={(checked) =>
    updateSettings({
      prediction: { ...settings.prediction, enabled: Boolean(checked) },
    })
  }
/>
```

Wrap it in the same label/description row structure the neighboring settings use. Label: "Predict next message". Description: "Suggest your likely next message as ghost text after each turn (press → to accept)."

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @t3tools/web typecheck`
Expected: PASS. `splitPatch` routes `prediction` to the server store automatically because it is a `ServerSettings` field.

- [ ] **Step 3: Manual verification note**

The model field (`settings.prediction.model`) is left at its default for this task; a model picker can be added later. The toggle is the minimum to enable the feature. (Recorded here so the reviewer knows the omission is intentional, per YAGNI in the spec.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/settings/SettingsPanels.tsx
git commit -m "feat(web): add prediction enable toggle to settings"
```

---

### Task 10: Prediction fetch/cache hook

**Files:**
- Create: `apps/web/src/voice/../prediction/usePrediction.ts` → use `apps/web/src/prediction/usePrediction.ts`
- Create: `apps/web/src/prediction/predictionCache.ts` (pure dedupe logic)
- Test: `apps/web/src/prediction/predictionCache.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // predictionCache.ts — pure, unit-testable
  interface PredictionState { key: string | null; prediction: string }
  function nextPredictionKey(threadId: string | null, lastMessageId: string | null): string | null
  function shouldFetchPrediction(args: {
    enabled: boolean; phase: SessionPhase; prevPhase: SessionPhase;
    promptIsEmpty: boolean; key: string | null; cachedKey: string | null;
  }): boolean
  ```
  ```ts
  // usePrediction.ts
  function usePrediction(args: {
    enabled: boolean; environmentId: EnvironmentId; threadId: ThreadId | null;
    lastMessageId: string | null; phase: SessionPhase; promptIsEmpty: boolean;
  }): { prediction: string; clear: () => void }
  ```
- Consumes: `serverEnvironment.getPrediction` command via the existing atom-command hook pattern (mirror `apps/web/src/hooks/useSettings.ts:244` `useAtomCommand(serverEnvironment.updateSettings, ...)`).

- [ ] **Step 1: Write the failing test for the pure logic**

Create `apps/web/src/prediction/predictionCache.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { nextPredictionKey, shouldFetchPrediction } from "./predictionCache.ts";

describe("nextPredictionKey", () => {
  it("is null without a thread or message", () => {
    expect(nextPredictionKey(null, "m1")).toBeNull();
    expect(nextPredictionKey("t1", null)).toBeNull();
  });
  it("combines thread and message id", () => {
    expect(nextPredictionKey("t1", "m9")).toBe("t1:m9");
  });
});

describe("shouldFetchPrediction", () => {
  const base = {
    enabled: true,
    phase: "ready" as const,
    prevPhase: "running" as const,
    promptIsEmpty: true,
    key: "t1:m9",
    cachedKey: null,
  };
  it("fetches on running→ready when empty and enabled", () => {
    expect(shouldFetchPrediction(base)).toBe(true);
  });
  it("does not fetch when disabled", () => {
    expect(shouldFetchPrediction({ ...base, enabled: false })).toBe(false);
  });
  it("does not fetch when the composer has text", () => {
    expect(shouldFetchPrediction({ ...base, promptIsEmpty: false })).toBe(false);
  });
  it("does not refetch the same turn key", () => {
    expect(shouldFetchPrediction({ ...base, cachedKey: "t1:m9" })).toBe(false);
  });
  it("does not fetch without a turn boundary", () => {
    expect(shouldFetchPrediction({ ...base, prevPhase: "ready" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @t3tools/web test src/prediction/predictionCache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure logic**

Create `apps/web/src/prediction/predictionCache.ts`:

```ts
import type { SessionPhase } from "../types.ts";

export function nextPredictionKey(
  threadId: string | null,
  lastMessageId: string | null,
): string | null {
  if (!threadId || !lastMessageId) return null;
  return `${threadId}:${lastMessageId}`;
}

export function shouldFetchPrediction(args: {
  enabled: boolean;
  phase: SessionPhase;
  prevPhase: SessionPhase;
  promptIsEmpty: boolean;
  key: string | null;
  cachedKey: string | null;
}): boolean {
  if (!args.enabled) return false;
  if (!args.promptIsEmpty) return false;
  if (args.key === null) return false;
  if (args.key === args.cachedKey) return false;
  // Turn just finished: transitioned out of "running" into "ready".
  return args.prevPhase === "running" && args.phase === "ready";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @t3tools/web test src/prediction/predictionCache.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the hook**

Create `apps/web/src/prediction/usePrediction.ts`. Read `apps/web/src/hooks/useSettings.ts` around line 244 first to copy the exact `useAtomCommand(serverEnvironment.getPrediction, ...)` invocation shape and how `environmentId` is passed. Then:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { SessionPhase } from "../types.ts";
import { nextPredictionKey, shouldFetchPrediction } from "./predictionCache.ts";
// import the getPrediction command + useAtomCommand exactly as useSettings.ts imports updateSettings

export function usePrediction(args: {
  enabled: boolean;
  environmentId: EnvironmentId;
  threadId: ThreadId | null;
  lastMessageId: string | null;
  phase: SessionPhase;
  promptIsEmpty: boolean;
}): { prediction: string; clear: () => void } {
  const [prediction, setPrediction] = useState("");
  const cachedKeyRef = useRef<string | null>(null);
  const prevPhaseRef = useRef<SessionPhase>(args.phase);
  // const runGetPrediction = useAtomCommand(serverEnvironment.getPrediction);

  const clear = useCallback(() => setPrediction(""), []);

  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = args.phase;
    const key = nextPredictionKey(args.threadId, args.lastMessageId);
    if (
      !shouldFetchPrediction({
        enabled: args.enabled,
        phase: args.phase,
        prevPhase,
        promptIsEmpty: args.promptIsEmpty,
        key,
        cachedKey: cachedKeyRef.current,
      }) ||
      key === null ||
      args.threadId === null
    ) {
      return;
    }
    cachedKeyRef.current = key;
    let cancelled = false;
    void (async () => {
      try {
        const result = await runGetPrediction({
          environmentId: args.environmentId,
          payload: { threadId: args.threadId },
        });
        if (!cancelled && result?.prediction) setPrediction(result.prediction);
      } catch {
        // Silent: no ghost on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    args.enabled,
    args.environmentId,
    args.threadId,
    args.lastMessageId,
    args.phase,
    args.promptIsEmpty,
  ]);

  // Clear the ghost as soon as the composer is no longer empty.
  useEffect(() => {
    if (!args.promptIsEmpty && prediction) setPrediction("");
  }, [args.promptIsEmpty, prediction]);

  return { prediction, clear };
}
```

Replace the commented lines with the real command hook once you've matched `useSettings.ts`. The exact `runGetPrediction` call signature must match `useAtomCommand`'s returned function shape in this codebase.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @t3tools/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/prediction/
git commit -m "feat(web): add next-message prediction fetch/cache hook"
```

---

### Task 11: Ghost text + Right-arrow accept in the Lexical editor

**Files:**
- Modify: `apps/web/src/components/ComposerPromptEditor.tsx`

**Interfaces:**
- Produces: two new optional props on `ComposerPromptEditorProps` — `ghostText?: string` and `onAcceptGhost?: () => void`. The editor renders `ghostText` in the placeholder slot when the value is empty, and calls `onAcceptGhost` on Right-arrow when the editor is empty and a ghost exists.
- Consumes: `$getComposerRootLength` (line 710), the existing `ComposerInlineTokenArrowPlugin` (line 959).

- [ ] **Step 1: Add the props**

In `ComposerPromptEditorProps` (line 873-895) add:

```ts
  ghostText?: string;
  onAcceptGhost?: () => void;
```

Destructure them in both `ComposerPromptEditorInner` (the internal component that renders the JSX at line 1606) and the outer `ComposerPromptEditor` wrapper (line 1643-1656), threading `ghostText`/`onAcceptGhost` down to the inner component alongside the existing props.

- [ ] **Step 2: Extend the arrow plugin to accept the ghost**

Change `ComposerInlineTokenArrowPlugin` (line 959) to take props and check the ghost on Right-arrow. Add parameters:

```ts
function ComposerInlineTokenArrowPlugin(props: {
  ghostText?: string;
  onAcceptGhost?: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const ghostRef = useRef(props.ghostText ?? "");
  const acceptRef = useRef(props.onAcceptGhost);
  ghostRef.current = props.ghostText ?? "";
  acceptRef.current = props.onAcceptGhost;

  useEffect(() => {
    // ... existing unregisterLeft ...
    const unregisterRight = editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      (event) => {
        // Accept ghost text when the editor is empty and a suggestion exists.
        let isEmpty = false;
        editor.getEditorState().read(() => {
          isEmpty = $getComposerRootLength() === 0;
        });
        if (isEmpty && ghostRef.current.length > 0 && acceptRef.current) {
          event?.preventDefault();
          event?.stopPropagation();
          acceptRef.current();
          return true;
        }
        // ... existing token-skip logic unchanged ...
      },
      COMMAND_PRIORITY_HIGH,
    );
    return () => {
      unregisterLeft();
      unregisterRight();
    };
  }, [editor]);

  return null;
}
```

Keep the existing token-skip body after the new empty-ghost check. Add `useRef` to the React import if not already present.

Update the plugin's render site (line 1634) to pass props:

```tsx
<ComposerInlineTokenArrowPlugin
  {...(ghostText ? { ghostText } : {})}
  {...(onAcceptGhost ? { onAcceptGhost } : {})}
/>
```

- [ ] **Step 3: Render the ghost in the placeholder slot**

Change the `placeholder` prop of `PlainTextPlugin` (lines 1622-1628) so an empty editor with a ghost shows the ghost:

```tsx
          placeholder={
            terminalContexts.length > 0 ? null : (
              <div className="pointer-events-none absolute inset-0 text-[16px] leading-relaxed text-muted-foreground/35 sm:text-[14px]">
                {value.length === 0 && ghostText ? ghostText : placeholder}
              </div>
            )
          }
```

(`value` is a prop of the component and is `""` exactly when empty; the ghost only shows at offset 0. This is the "ghost == placeholder" simplification.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @t3tools/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ComposerPromptEditor.tsx
git commit -m "feat(web): render prediction ghost text + right-arrow accept in editor"
```

---

### Task 12: Wire prediction into ChatComposer

**Files:**
- Modify: `apps/web/src/components/chat/ChatComposer.tsx`

**Interfaces:**
- Consumes: `usePrediction` (Task 10), `ghostText`/`onAcceptGhost` props (Task 11), existing `setPrompt` (line 1166), `composerEditorRef`/`composerRef` handles, `phase`, `activeThreadId`, `activeThread`, `environmentId`, `prompt`.

- [ ] **Step 1: Derive inputs and call the hook**

In `ChatComposer` (after the prompt/state setup, near line 895), add:

```tsx
  const lastMessageId = activeThread?.messages?.at(-1)?.id ?? null;
  const { prediction, clear: clearPrediction } = usePrediction({
    enabled: settings.prediction.enabled,
    environmentId,
    threadId: activeThreadId,
    lastMessageId,
    phase,
    promptIsEmpty: prompt.length === 0,
  });
```

Confirm `activeThread.messages` exists on the `Thread` type; if the field name differs (e.g. it is nested), read `apps/web/src/types.ts` / the `EnvironmentThread` type and use the correct accessor for "the id of the latest message". If no per-message id is available, use the latest turn identifier instead — any value that changes once per turn works as the dedupe key.

- [ ] **Step 2: Implement accept**

Add the accept handler (near `onComposerCommandKey`, line 1748):

```tsx
  const onAcceptGhostPrediction = useCallback(() => {
    if (!prediction) return;
    setPrompt(prediction);
    clearPrediction();
    // Move the caret to the end of the freshly-filled prompt.
    requestAnimationFrame(() => composerRef.current?.focusAtEnd());
  }, [prediction, setPrompt, clearPrediction, composerRef]);
```

`composerRef.current?.focusAtEnd()` uses the existing `ChatComposerHandle.focusAtEnd` (declared in this file's handle interface, line 400). Setting the draft prompt flows back into the editor via the controlled `value` prop, so no direct Lexical mutation is needed.

- [ ] **Step 3: Pass props to the editor**

At the `<ComposerPromptEditor .../>` render (line 2419), add — but ONLY when the composer is a normal prompt (not approval / pending / plan states, so the ghost never overrides those placeholders):

```tsx
                onCommandKeyDown={onComposerCommandKey}
                {...(!isComposerApprovalState && !activePendingProgress && !showPlanFollowUpPrompt
                  ? { ghostText: prediction, onAcceptGhost: onAcceptGhostPrediction }
                  : {})}
```

- [ ] **Step 4: Clear the ghost on send**

The hook already clears when the composer becomes non-empty, and re-predicts only on the next turn boundary. No extra send wiring is required. Verify by reading `onSend` in `ChatView.tsx` (line 3888) that it clears the prompt (line 4081) — that empties the composer, and `usePrediction`'s empty-check effect clears any stale ghost.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @t3tools/web typecheck`
Expected: PASS.

- [ ] **Step 6: Run the web unit tests**

Run: `pnpm --filter @t3tools/web test`
Expected: PASS (no regressions in composer-logic / composer-editor tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/chat/ChatComposer.tsx
git commit -m "feat(web): wire next-message prediction into chat composer"
```

---

### Task 13: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Build/typecheck the whole repo**

Run: `pnpm --filter @t3tools/contracts typecheck && pnpm --filter t3 typecheck && pnpm --filter @t3tools/client-runtime typecheck && pnpm --filter @t3tools/web typecheck`
Expected: all PASS.

- [ ] **Step 2: Enable the feature**

Start the app (see project run skill / README). In Settings, toggle **Predict next message** on. Confirm `settings.json` gains `"prediction": { "enabled": true }` (server-authoritative).

- [ ] **Step 3: Drive the flow**

Send a message, let the assistant turn finish, and leave the composer empty. Confirm ghost text appears in the empty composer within a few seconds. Press **Right-arrow**: the ghost text fills the composer and the caret is at the end. Type a character before accepting: confirm the ghost disappears. Start another turn: confirm a new prediction is requested (not the cached one).

- [ ] **Step 4: Confirm opt-out**

Toggle the setting off. Confirm no ghost appears and no `server.getPrediction` calls are made after a turn (observe via server logs / network).

- [ ] **Step 5: Commit any doc updates**

If behavior differs from the plan, note deviations and update this plan file, then commit.

---

## Self-Review

**Spec coverage:**
- LLM prediction source → Tasks 2-5, 7. ✓
- Trigger "after each assistant turn" (running→ready, empty) → Task 10 `shouldFetchPrediction`. ✓
- Configurable model in settings (default fast) → Task 1 (`prediction.model`), consumed in Task 7. Model-picker UI intentionally deferred (Task 9 Step 3 note; spec YAGNI). ✓
- Ghost in empty composer + Right-arrow accept → Tasks 11, 12. ✓
- Claude + Codex only; others stub → Tasks 4, 5. ✓
- One call per turn, cached, no retries, silent failure → Tasks 7 (catchAll), 10 (dedupe). ✓
- Settings default OFF → Task 1. ✓
- Redaction pass-through verified → confirmed in brainstorming (spread), no task needed. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"-style placeholders. Two steps intentionally instruct the implementer to *read a specific file to confirm an exact name* (test mock helper in Task 4; message-id accessor in Task 12; `useAtomCommand` shape in Task 10) — these are guardrails against guessing symbol names, not deferred work, and each gives the concrete fallback.

**Type consistency:** `generateNextMessagePrediction` / `NextMessagePredictionInput` / `NextMessagePredictionResult` used identically across Tasks 3-5, 7. `{ prediction: string }` is the single wire/return shape across Tasks 2, 3, 6, 7, 8. `prediction.enabled`/`prediction.model` consistent across Tasks 1, 7, 9, 12. `shouldFetchPrediction`/`nextPredictionKey` signatures match between Task 10 test and impl. `ghostText`/`onAcceptGhost` consistent between Tasks 11 and 12.
