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
