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
