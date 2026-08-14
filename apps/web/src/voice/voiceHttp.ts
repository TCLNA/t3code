/**
 * Authenticated fetch to the primary environment for the voice routes.
 *
 * Mirrors `environments/primary/httpLayer.ts`: a same-origin browser sends the
 * session cookie (`credentials: "include"`); anything else (desktop bridge,
 * remote) attaches the desktop primary bearer token.
 */
import { readDesktopPrimaryBearerToken } from "../environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary/target";

function isSameOriginBrowserPrimary(): boolean {
  if (
    typeof window === "undefined" ||
    window.desktopBridge !== undefined ||
    !window.location.origin.startsWith("http")
  ) {
    return false;
  }
  return new URL(resolvePrimaryEnvironmentHttpUrl("/")).origin === window.location.origin;
}

export async function voiceFetch(path: string, init: RequestInit): Promise<Response> {
  const url = resolvePrimaryEnvironmentHttpUrl(path);
  if (isSameOriginBrowserPrimary()) {
    return fetch(url, { ...init, credentials: "include" });
  }
  const token = await readDesktopPrimaryBearerToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers, credentials: "omit" });
}
