# Remote Pairing over HTTPS (Tailscale) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a trusted tailnet device pair with the t3code dev server over `https://<machine>.<tailnet>.ts.net` and stay authenticated, by serving everything on one HTTPS origin so the session cookie is same-origin.

**Architecture:** Tailscale serve terminates TLS and proxies to the Vite dev server (`:5733`), which already reverse-proxies `/api` etc. to the environment server (`:13773`). The web client is changed to send its API and WebSocket traffic to **its own origin** (through the Vite proxy) whenever it is served by a dev server, instead of directly to `:13773`. This makes the cookie same-origin on localhost, LAN, and the tailnet name alike.

**Tech Stack:** TypeScript, React, Vite 8 (`vite-plus`), Effect, Vitest, Tailscale.

## Global Constraints

- Package manager: `pnpm` via `vite-plus`. Run web tests with `pnpm --filter @t3tools/web test` (Vitest project `unit`).
- Do not change the auth model: one-time-token → `t3_session` cookie session stays as-is.
- Production builds (`import.meta.env.VITE_DEV_SERVER_URL` unset) and desktop (`resolveDesktopPrimaryTarget`) paths MUST NOT change behavior.
- `localhost` access MUST keep working from the same launch that enables tailnet access.
- Dev server binding stays `HOST=0.0.0.0 T3CODE_HOST=0.0.0.0` (Tailscale fronts it; localhost still reachable).
- WS path is `/ws`; ticket query param is `wsTicket`. Cookie is `t3_session`, `SameSite=Lax`.

---

## File Structure

- `apps/web/src/environments/primary/target.ts` — HTTP + new WS same-origin resolution (Changes 1 & 2a).
- `apps/web/src/environments/primary/target.test.ts` — **new** focused unit tests for the resolvers.
- `apps/web/src/connection/platform.ts` — primary connection registration uses same-origin http/ws (Change 2b).
- `apps/web/vite.config.ts` — `/ws` proxy + HMR `wss` under public-url mode (Change 2c).
- `scripts/dev-runner.ts` — `--public-url` flag (Change 3).
- `scripts/dev-runner.test.ts` — flag wiring test.
- `docs/remote-dev-tailscale.md` — **new** setup doc (Change 4).

---

### Task 1: Route HTTP to the page's own origin when served by a dev server

**Files:**
- Modify: `apps/web/src/environments/primary/target.ts` (`resolveHttpRequestBaseUrl`)
- Test: `apps/web/src/environments/primary/target.test.ts` (create)

**Interfaces:**
- Consumes: existing `PrimaryEnvironmentTarget`, `parseTargetUrl`, `import.meta.env.VITE_DEV_SERVER_URL`, `window.location`.
- Produces: `resolveHttpRequestBaseUrl(primaryTarget)` returns `window.location.origin` when the page is served by the dev server and the configured target is a different origin — for **any** host (loopback removed).

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/environments/primary/target.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

function setLocation(href: string) {
  vi.stubGlobal("window", { location: new URL(href) } as unknown as Window);
}

async function load() {
  vi.resetModules();
  return import("./target.ts");
}

describe("resolveHttpRequestBaseUrl", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("routes non-loopback dev-served page through its own origin", async () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "https://box.tail1234.ts.net");
    vi.stubEnv("VITE_HTTP_URL", "http://127.0.0.1:13773");
    setLocation("https://box.tail1234.ts.net/pair");
    const { resolvePrimaryEnvironmentHttpUrl } = await load();
    expect(resolvePrimaryEnvironmentHttpUrl("/api/auth/session")).toBe(
      "https://box.tail1234.ts.net/api/auth/session",
    );
  });

  it("still routes loopback dev-served page through its own origin", async () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "http://localhost:5733");
    vi.stubEnv("VITE_HTTP_URL", "http://localhost:13773");
    setLocation("http://localhost:5733/pair");
    const { resolvePrimaryEnvironmentHttpUrl } = await load();
    expect(resolvePrimaryEnvironmentHttpUrl("/api/auth/session")).toBe(
      "http://localhost:5733/api/auth/session",
    );
  });

  it("uses the configured target when not served by the dev server", async () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "http://localhost:5733");
    vi.stubEnv("VITE_HTTP_URL", "http://192.0.2.9:13773");
    setLocation("https://app.example.com/pair");
    const { resolvePrimaryEnvironmentHttpUrl } = await load();
    expect(resolvePrimaryEnvironmentHttpUrl("/api/auth/session")).toBe(
      "http://192.0.2.9:13773/api/auth/session",
    );
  });

  it("uses the configured target when no dev server is set (production)", async () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "");
    vi.stubEnv("VITE_HTTP_URL", "https://api.example.com");
    setLocation("https://app.example.com/pair");
    const { resolvePrimaryEnvironmentHttpUrl } = await load();
    expect(resolvePrimaryEnvironmentHttpUrl("/api/auth/session")).toBe(
      "https://api.example.com/api/auth/session",
    );
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @t3tools/web test -- target.test`
Expected: FAIL — the non-loopback case returns `http://127.0.0.1:13773/...` (loopback gate).

- [ ] **Step 3: Implement — drop the loopback conditions**

In `resolveHttpRequestBaseUrl`, replace the guard block:

```ts
  if (
    !isCurrentOriginDevServer ||
    currentUrl.origin === targetUrl.origin ||
    !isLoopbackHostname(currentUrl.hostname) ||
    !isLoopbackHostname(targetUrl.hostname)
  ) {
    return httpBaseUrl;
  }

  return currentUrl.origin;
```

with:

```ts
  // When the page is served by our dev server, all API traffic must ride the
  // page's own origin (through the Vite proxy) so the session cookie is
  // same-origin — on loopback, LAN, and tailnet hosts alike. Only fall back to
  // the configured target when we are NOT the dev-served origin.
  if (!isCurrentOriginDevServer || currentUrl.origin === targetUrl.origin) {
    return httpBaseUrl;
  }

  return currentUrl.origin;
```

If `isLoopbackHostname` is now unused in this file, remove it and its `LOOPBACK_HOSTNAMES` set; if still exported/used elsewhere, leave it. Verify with: `grep -rn "isLoopbackHostname" apps/web/src`.

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @t3tools/web test -- target.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the existing bootstrap suites for regressions**

Run: `pnpm --filter @t3tools/web test -- bootstrap authBootstrap`
Expected: PASS. If a test hard-codes the old loopback-only behavior, update it to the new served-by-dev behavior (same-origin for any dev-served host).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/environments/primary/target.ts apps/web/src/environments/primary/target.test.ts
git commit -m "fix(web): route dev-served API traffic through the page origin"
```

---

### Task 2: Same-origin resolver for the WebSocket base URL

**Files:**
- Modify: `apps/web/src/environments/primary/target.ts`
- Test: `apps/web/src/environments/primary/target.test.ts`

**Interfaces:**
- Produces: exported `resolveWsRequestBaseUrl(primaryTarget: PrimaryEnvironmentTarget): string`. When the page is dev-served, returns the page origin with a `ws:`/`wss:` protocol matching the page (`http:`→`ws:`, `https:`→`wss:`); otherwise returns `primaryTarget.target.wsBaseUrl` unchanged.

- [ ] **Step 1: Write failing tests**

Append to `target.test.ts`:

```ts
describe("resolveWsRequestBaseUrl", () => {
  beforeEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("uses wss on the page origin when dev-served over https", async () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "https://box.tail1234.ts.net");
    vi.stubEnv("VITE_WS_URL", "ws://127.0.0.1:13773");
    setLocation("https://box.tail1234.ts.net/");
    const { resolveWsRequestBaseUrl, readPrimaryEnvironmentTarget } = await load();
    expect(resolveWsRequestBaseUrl(readPrimaryEnvironmentTarget())).toBe(
      "wss://box.tail1234.ts.net/",
    );
  });

  it("uses ws on the page origin when dev-served over http (localhost)", async () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "http://localhost:5733");
    vi.stubEnv("VITE_WS_URL", "ws://localhost:13773");
    setLocation("http://localhost:5733/");
    const { resolveWsRequestBaseUrl, readPrimaryEnvironmentTarget } = await load();
    expect(resolveWsRequestBaseUrl(readPrimaryEnvironmentTarget())).toBe(
      "ws://localhost:5733/",
    );
  });

  it("returns the configured ws base when not dev-served", async () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "");
    vi.stubEnv("VITE_WS_URL", "wss://api.example.com");
    setLocation("https://app.example.com/");
    const { resolveWsRequestBaseUrl, readPrimaryEnvironmentTarget } = await load();
    expect(resolveWsRequestBaseUrl(readPrimaryEnvironmentTarget())).toBe(
      "wss://api.example.com/",
    );
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @t3tools/web test -- target.test`
Expected: FAIL — `resolveWsRequestBaseUrl` is not exported.

- [ ] **Step 3: Implement `resolveWsRequestBaseUrl`**

Add after `resolveHttpRequestBaseUrl` in `target.ts`:

```ts
export function resolveWsRequestBaseUrl(primaryTarget: PrimaryEnvironmentTarget): string {
  const wsBaseUrl = primaryTarget.target.wsBaseUrl;
  const configuredDevServerUrl = import.meta.env.VITE_DEV_SERVER_URL?.trim();
  if (!configuredDevServerUrl) {
    return wsBaseUrl;
  }

  const currentUrl = parseTargetUrl({
    rawValue: window.location.href,
    source: "window-origin",
    urlKind: "window-location-url",
  });
  const devServerUrl = parseTargetUrl({
    rawValue: configuredDevServerUrl,
    baseUrl: currentUrl.origin,
    source: "configured",
    urlKind: "development-server-url",
  });

  const isCurrentOriginDevServer =
    (currentUrl.protocol === "http:" || currentUrl.protocol === "https:") &&
    currentUrl.origin === devServerUrl.origin;
  if (!isCurrentOriginDevServer) {
    return wsBaseUrl;
  }

  const wsUrl = new URL(currentUrl.origin);
  wsUrl.protocol = currentUrl.protocol === "https:" ? "wss:" : "ws:";
  return wsUrl.toString();
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @t3tools/web test -- target.test`
Expected: PASS (all resolver tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/environments/primary/target.ts apps/web/src/environments/primary/target.test.ts
git commit -m "feat(web): add same-origin WebSocket base resolver"
```

---

### Task 3: Primary connection registration uses same-origin http + ws

**Files:**
- Modify: `apps/web/src/connection/platform.ts` (`loadPrimaryConnectionRegistration`, ~line 286-299)
- Test: covered by manual end-to-end (Task 7); add no new unit test unless `platform.test.ts` exists.

**Interfaces:**
- Consumes: `resolveHttpRequestBaseUrl`, `resolveWsRequestBaseUrl` from `../environments/primary/target` (Tasks 1-2).
- Produces: `PrimaryConnectionTarget` whose `httpBaseUrl`/`wsBaseUrl` are the same-origin values, so the descriptor fetch, `/api/auth/websocket-ticket` request (cookie-authed), and the `/ws` socket all use the page origin.

- [ ] **Step 1: Import the resolvers**

At the top of `platform.ts`, add to the existing import from the primary target module (find the current import of `resolvePrimaryEnvironmentHttpUrl`/`readPrimaryEnvironmentTarget`; if none, add):

```ts
import {
  resolveHttpRequestBaseUrl,
  resolveWsRequestBaseUrl,
} from "../environments/primary/target";
```

Verify the exact existing import path/symbols first: `grep -n "environments/primary/target" apps/web/src/connection/platform.ts`.

- [ ] **Step 2: Use resolved URLs in `loadPrimaryConnectionRegistration`**

Replace the body that builds the registration:

```ts
  const descriptor = yield* fetchRemoteEnvironmentDescriptor({
    httpBaseUrl: resolved.target.httpBaseUrl,
  }).pipe(Effect.provide(primaryEnvironmentHttpLayer), Effect.mapError(mapRemoteEnvironmentError));
  return new PrimaryConnectionRegistration({
    target: new PrimaryConnectionTarget({
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      httpBaseUrl: resolved.target.httpBaseUrl,
      wsBaseUrl: resolved.target.wsBaseUrl,
    }),
  });
```

with:

```ts
  const requestHttpBaseUrl = resolveHttpRequestBaseUrl(resolved);
  const requestWsBaseUrl = resolveWsRequestBaseUrl(resolved);
  const descriptor = yield* fetchRemoteEnvironmentDescriptor({
    httpBaseUrl: requestHttpBaseUrl,
  }).pipe(Effect.provide(primaryEnvironmentHttpLayer), Effect.mapError(mapRemoteEnvironmentError));
  return new PrimaryConnectionRegistration({
    target: new PrimaryConnectionTarget({
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      httpBaseUrl: requestHttpBaseUrl,
      wsBaseUrl: requestWsBaseUrl,
    }),
  });
```

- [ ] **Step 3: Typecheck + web unit suite**

Run: `pnpm --filter @t3tools/web test`
Expected: PASS. (No behavioral unit test here; correctness is verified end-to-end in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/connection/platform.ts
git commit -m "fix(web): primary connection uses same-origin http/ws endpoints"
```

---

### Task 4: Vite proxies the `/ws` socket and supports HMR over TLS

**Files:**
- Modify: `apps/web/vite.config.ts` (proxy block + `hmr`)

**Interfaces:**
- Consumes: existing `devProxyTarget`, `host`, `port`. New: `publicUrl` from `process.env.T3CODE_PUBLIC_URL` (set by Task 5; read defensively so this task is independently testable).
- Produces: Vite forwards `/ws` (WebSocket upgrade) to the environment server; HMR uses `wss` on port 443 when a public HTTPS URL is configured.

- [ ] **Step 1: Add the `/ws` proxy entry**

In the `proxy` object (alongside `/api`), add:

```ts
              "/ws": {
                target: devProxyTarget,
                changeOrigin: true,
                ws: true,
              },
```

- [ ] **Step 2: Make HMR TLS-aware**

Just above the `server` block, add:

```ts
const publicUrl = process.env.T3CODE_PUBLIC_URL?.trim();
const publicHmr =
  publicUrl && publicUrl.startsWith("https:")
    ? { protocol: "wss" as const, host: new URL(publicUrl).hostname, clientPort: 443 }
    : { protocol: "ws" as const, host, clientPort: port };
```

Replace the existing `hmr` block’s `protocol`/`host`/`clientPort` fields with:

```ts
      hmr: {
        ...publicHmr,
      },
```

(Keep any surrounding comment.)

- [ ] **Step 3: Sanity check config loads**

Run: `pnpm --filter @t3tools/web exec vite --version`
Expected: prints a version with no config parse error. (Full HMR-over-TLS is validated in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/vite.config.ts
git commit -m "feat(web): proxy /ws socket and support HMR over TLS"
```

---

### Task 5: `dev-runner --public-url` flag

**Files:**
- Modify: `scripts/dev-runner.ts` (flag def + `createDevRunnerEnv`)
- Test: `scripts/dev-runner.test.ts`

**Interfaces:**
- Consumes: existing `CreateDevRunnerEnvInput`, `createDevRunnerEnv`.
- Produces: when `--public-url <https url>` (fallback `T3CODE_PUBLIC_URL`) is set and non-desktop, the emitted env has `VITE_DEV_SERVER_URL = <url>`, `VITE_WS_URL = wss://<host>` (or `ws://` for http), and `T3CODE_PUBLIC_URL = <url>`. `VITE_HTTP_URL` is unchanged (client self-proxies via Task 1).

- [ ] **Step 1: Write failing test**

Add to `scripts/dev-runner.test.ts` (follow the file's existing `createDevRunnerEnv` test pattern; adapt field access to how other tests call it):

```ts
it("wires public HTTPS url into dev-server + ws env", async () => {
  const env = await runCreateDevRunnerEnv({
    mode: "dev",
    host: "0.0.0.0",
    publicUrl: "https://box.tail1234.ts.net",
  });
  expect(env.VITE_DEV_SERVER_URL).toBe("https://box.tail1234.ts.net");
  expect(env.VITE_WS_URL).toBe("wss://box.tail1234.ts.net");
  expect(env.T3CODE_PUBLIC_URL).toBe("https://box.tail1234.ts.net");
});
```

(If the suite has no `runCreateDevRunnerEnv` helper, copy the setup used by the nearest existing env test verbatim and add `publicUrl` to its input.)

- [ ] **Step 2: Run, verify fail**

Run: `pnpm exec vitest run scripts/dev-runner.test.ts`
Expected: FAIL — `publicUrl` not accepted / env fields undefined.

- [ ] **Step 3: Add the flag**

In the flags object next to `host`:

```ts
  publicUrl: Flag.string("public-url").pipe(
    Flag.withDescription(
      "Public base URL the app is reached at (e.g. https://<machine>.<tailnet>.ts.net); forwards to VITE_DEV_SERVER_URL/VITE_WS_URL and T3CODE_PUBLIC_URL.",
    ),
    Flag.withFallbackConfig(optionalStringConfig("T3CODE_PUBLIC_URL")),
  ),
```

Add `publicUrl` to `CreateDevRunnerEnvInput` (`readonly publicUrl: string | undefined;`) and pass `publicUrl: input.publicUrl` where `createDevRunnerEnv` is called in the handler (mirror how `host` is threaded).

- [ ] **Step 4: Set the env in `createDevRunnerEnv`**

In the non-desktop branch, after the existing `VITE_HTTP_URL`/`VITE_WS_URL` assignments:

```ts
    if (!isDesktopMode && publicUrl !== undefined) {
      const publicUrlTrimmed = publicUrl.trim();
      const parsed = new URL(publicUrlTrimmed);
      output.VITE_DEV_SERVER_URL = publicUrlTrimmed;
      output.VITE_WS_URL = `${parsed.protocol === "https:" ? "wss:" : "ws:"}//${parsed.host}`;
      output.T3CODE_PUBLIC_URL = publicUrlTrimmed;
    }
```

Add `publicUrl` to the destructured params of `createDevRunnerEnv` (alongside `host`).

- [ ] **Step 5: Run, verify pass**

Run: `pnpm exec vitest run scripts/dev-runner.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/dev-runner.ts scripts/dev-runner.test.ts
git commit -m "feat(dev-runner): add --public-url for TLS-fronted remote access"
```

---

### Task 6: Server allows the public origin for CORS (defensive)

**Files:**
- Modify: `apps/server/src/http.ts` (the `HttpRouter.cors({ allowedOrigins: [devOrigin, ...] })` at ~line 55)

**Interfaces:**
- Consumes: `VITE_DEV_SERVER_URL` (already the source of `devOrigin`).
- Produces: with `--public-url` set, `VITE_DEV_SERVER_URL` is the tailnet HTTPS origin, so `devOrigin` already covers it. This task only verifies/locks that, since same-origin traffic makes CORS moot but preflights may still occur.

- [ ] **Step 1: Confirm `devOrigin` derives from `VITE_DEV_SERVER_URL`**

Run: `grep -n "devOrigin" apps/server/src/http.ts`
Read the derivation. If `devOrigin` already reads `VITE_DEV_SERVER_URL`, **no code change is needed** — check the box and skip to Step 3.

- [ ] **Step 2: (Only if needed) include the public origin**

If `devOrigin` is hard-wired to a loopback/host value rather than `VITE_DEV_SERVER_URL`, add the public origin:

```ts
const publicOrigin = process.env.T3CODE_PUBLIC_URL?.trim();
// ...allowedOrigins: [devOrigin, ...(publicOrigin ? [publicOrigin] : []), ...DESKTOP_RENDERER_ORIGINS]
```

- [ ] **Step 3: Server unit suite**

Run: `pnpm --filter @t3tools/server test -- http`
Expected: PASS.

- [ ] **Step 4: Commit (only if changed)**

```bash
git add apps/server/src/http.ts
git commit -m "chore(server): ensure public origin is CORS-allowed under --public-url"
```

---

### Task 7: Tailscale serve setup + end-to-end verification

**Files:**
- Create: `docs/remote-dev-tailscale.md`

**Interfaces:** none (docs + manual acceptance).

- [ ] **Step 1: Write the setup doc**

Create `docs/remote-dev-tailscale.md`:

```markdown
# Remote dev over Tailscale (HTTPS)

Serve the dev app on a real HTTPS origin so pairing works from any tailnet device.

## One-time
- Enable MagicDNS + HTTPS certificates in the tailnet admin console.
- Get the machine's name: `tailscale status --json | jq -r .Self.DNSName` (strip trailing dot), e.g. `box.tail1234.ts.net`.

## Run
```bash
# 1. Start the dev server bound to all interfaces, told its public URL:
HOST=0.0.0.0 T3CODE_HOST=0.0.0.0 \
  pnpm run dev --public-url https://box.tail1234.ts.net

# 2. In another terminal, front it with TLS:
tailscale serve --bg --https=443 http://127.0.0.1:5733
```

## Pair
```bash
cd apps/server
T3CODE_HOME=/home/thomas/.t3 node src/bin.ts auth pairing create \
  --ttl 12h \
  --dev-url https://box.tail1234.ts.net \
  --base-url https://box.tail1234.ts.net
```
Open the printed `Pair URL` on the remote device. It stays authenticated (same-origin Secure cookie).

## Stop serving
`tailscale serve --https=443 off`
```

- [ ] **Step 2: Manual end-to-end (acceptance)**

1. Start dev with `--public-url https://<you>.ts.net` and `tailscale serve` per the doc.
2. From a **second** tailnet device, open `https://<you>.ts.net`, pair with a fresh token.
3. Confirm the app loads authenticated and stays (no bounce to `/pair`).
4. Confirm the WebSocket connects: run the sqlite check and verify `last_connected_at` is non-null for the new session:

```bash
node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync("/home/thomas/.t3/dev/state.sqlite",{readOnly:true});console.log(d.prepare("SELECT client_browser,last_connected_at FROM auth_sessions ORDER BY rowid DESC LIMIT 3").all());'
```

5. Regression: from the host, open `http://localhost:5733`, pair, confirm it still works.

- [ ] **Step 3: Commit the doc**

```bash
git add docs/remote-dev-tailscale.md
git commit -m "docs: remote dev over Tailscale (HTTPS) setup"
```

---

## Open questions to resolve during execution

1. **Task 3 assumption:** the primary (cookie) WS ticket request uses the connection registration's `httpBaseUrl`. Verified indirectly (`service.ts:146` uses `token.endpoint.httpBaseUrl`, and the registration is the endpoint source). If the cookie path issues the ticket via a different base, extend Task 3 to route that call same-origin too.
2. **HMR clientPort:** Task 4 assumes Tailscale serve on 443. If a different `--https` port is used, `clientPort` must match — parameterize from `publicUrl` port if present.
3. **`isLoopbackHostname` removal:** confirm no other importer before deleting (Task 1 Step 3).
