# Sidebar "AI done" row wash

## Goal

When an assistant turn finishes, play a one-shot animated wash across the
thread's row in the sidebar — the menu item that is the parent of the
working / awaiting-input status badge. Gives an ambient "the AI stopped"
signal without the user watching the thread.

## Scope

- Only the sidebar thread row (`SidebarThreadRow`). No chat-view, composer, or
  app-wide effects.
- No new dependencies. Uses Tailwind v4 + a custom CSS keyframe token, matching
  the existing `--animate-status-pulse` / `--animate-status-ping` pattern.

## Trigger

Fire once on the status transition **`Working` → any settled label**, where
settled = `Completed | Awaiting Input | Plan Ready | Pending Approval`.

- Excludes `Working → Connecting` (still active) and `Working → null`.
- Any-settled matches the user's choice: broadest "AI stopped" signal, including
  turns that error/interrupt into a settled pill.

Pure helper in `apps/web/src/components/Sidebar.logic.ts`:

```ts
export function shouldRippleOnStatusChange(
  prev: ThreadStatusPill["label"] | null,
  next: ThreadStatusPill["label"] | null,
): boolean;
```

Returns `true` iff `prev === "Working"` and `next` is a settled label. Unit
tested in `Sidebar.logic.test.ts`.

## Rendering

`SidebarThreadRow` (`apps/web/src/components/Sidebar.tsx:377`) already:

- computes `threadStatus: ThreadStatusPill | null`,
- renders the badge on `SidebarMenuSubButton`, which is `relative isolate`.

Add:

- `wasWorkingRef = useRef(false)` and a `washKey` state.
- `useEffect` keyed on `threadStatus?.label`: if
  `shouldRippleOnStatusChange(prevLabel, label)` then `setWashKey(k => k + 1)`;
  always update `wasWorkingRef`.
- Overlay inside the row button, keyed by `washKey` so each finish replays:

```tsx
{
  washKey > 0 && (
    <span
      key={washKey}
      aria-hidden
      className={`pointer-events-none absolute inset-0 -z-10 rounded-md
      bg-[linear-gradient(90deg,transparent,currentColor,transparent)]
      bg-[length:50%_100%] bg-no-repeat ${threadStatus.colorClass}`}
      style={{ animation: "var(--animate-row-done-wash)" }}
      onAnimationEnd={() => setWashKey(0)}
    />
  );
}
```

Using `currentColor` (via the resulting status's `colorClass`) means the wash
auto-matches the new state's color — amber for Awaiting Input, green for
Completed, etc.

## CSS (`apps/web/src/index.css`)

```css
--animate-row-done-wash: t3-row-done-wash 900ms ease-out both;

@keyframes t3-row-done-wash {
  0% {
    opacity: 0;
    background-position: -100% 0;
  }
  18% {
    opacity: 0.45;
  }
  100% {
    opacity: 0;
    background-position: 200% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  /* overlay renders with no animation → effectively invisible */
}
```

Reduced-motion: the overlay ends at opacity 0; under reduced motion the
animation is suppressed so nothing flashes.

## Testing

- Unit: `shouldRippleOnStatusChange` truth table — Working→Completed (true),
  Working→Awaiting Input (true), Working→Plan Ready (true),
  Working→Pending Approval (true), Working→Connecting (false),
  Working→null (false), Awaiting Input→Completed (false), null→Working (false).
- Manual: run the web app, start a turn, watch the row wash when it settles.

## Non-goals

- No sound, no toast, no persistence.
- No animation on the chat message itself.
