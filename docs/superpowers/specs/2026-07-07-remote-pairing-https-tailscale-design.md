# Remote pairing over HTTPS (Tailscale serve) — design

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan
**Scope:** Make the t3code web app pairable from a remote device over Tailscale, using a single HTTPS origin so the session cookie is same-origin and sticks.

## Problem

Pairing works locally via `http://localhost:5733` but fails from a remote device over the Tailscale IP. Root cause (fully diagnosed):

- The web page is served from the Vite dev server (`:5733`); the app calls the environment API directly at `:13773` (a **different origin**).
- `resolveHttpRequestBaseUrl` (`apps/web/src/environments/primary/target.ts`) only routes HTTP through the same-origin Vite proxy when the host is **loopback** (`isLoopbackHostname`). For any non-loopback host (Tailscale IP / MagicDNS name) it returns the configured `VITE_HTTP_URL` (`:13773`) → cross-origin.
- The exchange sets `Set-Cookie: t3_session` with correct CORS, but browsers (observed: Firefox) do not persist/send that cookie cross-origin over plain HTTP, so `fetchSessionState` comes back unauthenticated and the app bounces back to `/pair`.
- Server-side the pairing actually succeeds (a valid 30-day `auth_sessions` row is created); the failure is purely that the cookie never sticks in the browser.

A separate, cosmetic issue: the `/pair` page submits the one-time token **twice** under React StrictMode (dev) — request 1 = `200` (consumes token, sets cookie), request 2 = `401 invalid_credential` — and the 401 paints "Invalid pairing token" over the success. This is out of scope to fix here but noted (see "Non-goals").

## Goal

From a trusted device on the tailnet, open `https://<machine>.<tailnet>.ts.net`, pair once, and stay authenticated — using the existing one-time-token → cookie-session model. `localhost` access must keep working from a single dev-server launch.

## Approach (chosen: A — client routes to its own origin)

Serve everything through **one HTTPS origin** fronted by Tailscale serve, and make the web client send its API/WS calls to **its own origin** (through the Vite proxy) instead of directly to `:13773`. Same-origin + `Secure` (HTTPS) → the cookie sticks on any device.

Rejected alternatives:
- **B (config only):** feed the tailnet URL into `VITE_HTTP_URL`/`VITE_WS_URL`. Brittle (must match exactly), and breaks `localhost` access from the same launch.
- **C (bearer-token web client):** origin-agnostic but the largest change; abandons the cookie model for no benefit given trusted-device scope.

## Topology

```
Browser ──https──▶ tailscale serve (:443, TLS) ──▶ Vite dev server (:5733)
                                                     ├─ app assets
                                                     ├─ /api, /.well-known, /attachments ─proxy─▶ server :13773 (http)
                                                     └─ app WebSocket path (wss)          ─proxy─▶ server :13773 (ws)
```

`https://<machine>.<tailnet>.ts.net` is the single origin. Vite listens locally (`HOST=0.0.0.0`); Tailscale fronts it. Because the page is HTTPS, the runtime WebSocket must be `wss://` (an insecure `ws://` from an HTTPS page is blocked as mixed content) — so the app WS also rides the HTTPS origin via a Vite WS proxy.

## Changes

### Change 1 — client routes HTTP to its own origin (core fix)
File: `apps/web/src/environments/primary/target.ts`, `resolveHttpRequestBaseUrl`.

Replace the loopback gate with a "served by a dev server" signal. When `VITE_DEV_SERVER_URL` is set (the dev signal) and the configured target would be cross-origin from the current page, return `window.location.origin` (route through the Vite proxy) — for **any** host, not just loopback.

- Effect: localhost, LAN, and the tailnet name all self-proxy HTTP; no cookie ever goes cross-origin.
- Production build (`VITE_DEV_SERVER_URL` unset) and desktop paths are unchanged (`resolveDesktopPrimaryTarget` still takes precedence).
- The `isLoopbackHostname` helper may become unused here; leave it if referenced elsewhere, otherwise remove.

### Change 2 — runtime WebSocket over the same HTTPS origin
Files: `apps/web/vite.config.ts` (proxy + HMR), client `wsBaseUrl` resolution in `target.ts`.

- Add a proxy entry for the app's runtime WebSocket path with `ws: true` → `http://127.0.0.1:13773` (confirm the exact WS path during planning; it is the path used by `Socket.layerWebSocket(connection.socketUrl, …)` in `packages/client-runtime/src/rpc/session.ts`).
- Make `wsBaseUrl` resolve to the page origin as `wss://` when served by the dev server (mirror Change 1 for WS), so no mixed-content and no cross-origin.
- Set Vite HMR to `protocol: "wss"`, `clientPort: 443` when served behind TLS so hot reload works through Tailscale. This must not regress plain-`localhost:5733` HMR — gate on the public-URL flag (Change 3).

### Change 3 — dev-runner `--public-url` flag
File: `scripts/dev-runner.ts`.

Add an optional `--public-url <https url>` flag (fallback config `T3CODE_PUBLIC_URL`). When set:
- `VITE_DEV_SERVER_URL` and `VITE_WS_URL` are derived from it (`https://…` / `wss://…`).
- Signals the TLS-fronted mode used to gate HMR `wss`/clientPort (Change 2).
- `HOST`/`T3CODE_HOST` binding is unchanged (keep `0.0.0.0` so Tailscale + localhost both reach it).

### Change 4 — Tailscale serve setup (docs, no app code)
Document (and optionally a helper script) the one-time setup:
```
tailscale serve --bg --https=443 http://127.0.0.1:5733
```
Note MagicDNS/HTTPS certs must be enabled on the tailnet. Add to the remote-dev docs.

### Server
No change expected. CORS already allows the dev origin (`devOrigin` from `VITE_DEV_SERVER_URL`); once traffic is same-origin, CORS is moot for these calls. The cookie is already `SameSite=Lax`; same-origin + HTTPS makes it stick. Confirm during planning whether the cookie needs `Secure` set under HTTPS (it should be fine same-origin, but verify).

## Testing

- **Unit:** add focused tests for `resolveHttpRequestBaseUrl` covering: (a) loopback served-by-dev → window origin (unchanged behavior), (b) **non-loopback served-by-dev → window origin** (new), (c) production / `VITE_DEV_SERVER_URL` unset → configured target unchanged, (d) desktop bootstrap precedence unchanged. Extend/adjust `bootstrap.test.ts` / `authBootstrap.test.ts` as needed.
- **WS resolution:** unit test that `wsBaseUrl` becomes `wss://<page-origin>` when served behind the public URL.
- **Manual end-to-end (the real acceptance):** from a second tailnet device, open `https://<machine>.<tailnet>.ts.net`, pair with a one-time token, confirm the app loads authenticated and the WebSocket connects (`auth_sessions.last_connected_at` becomes non-null). Also re-verify `http://localhost:5733` still pairs from the host.

## Non-goals

- Fixing the StrictMode double-submit (`200` then `401`) on `/pair`. It's cosmetic once the cookie sticks. Can be a follow-up (guard the auto-submit against remount, or clear the URL token before the first await).
- Untrusted / multi-tenant remote access hardening. Scope is the user's own trusted devices.
- Tailscale Funnel (public internet exposure). Tailnet-only.

## Open questions to resolve in planning

1. Exact app WebSocket path/URL shape to proxy (read `session.ts` `socketUrl`).
2. Whether one launch can cleanly serve both `localhost` (loopback proxy) and the tailnet HTTPS origin, or whether the tailnet mode is a distinct `--public-url` launch. Current lean: `--public-url` launch is the remote mode; localhost still works within it because Change 1 self-proxies any origin.
3. Whether HMR `wss` behind Tailscale needs `clientPort: 443` specifically or can auto-detect.
