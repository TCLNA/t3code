import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/unstable/reactivity";
import { createElement } from "react";

export let appAtomRegistry = AtomRegistry.make();

export function AppAtomRegistryProvider({ children }: React.PropsWithChildren) {
  return createElement(RegistryContext.Provider, { value: appAtomRegistry }, children);
}

export function resetAppAtomRegistryForTests() {
  appAtomRegistry.dispose();
  appAtomRegistry = AtomRegistry.make();
}

if (import.meta.hot) {
  // appAtomRegistry is a module-level singleton wired into React via context. A partial
  // Fast Refresh update would create a new registry while the old one (and everything
  // atomed onto it) leaks, desyncing the UI. Force a full reload instead.
  import.meta.hot.accept(() => {
    import.meta.hot?.invalidate();
  });
}
