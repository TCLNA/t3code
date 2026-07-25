# Foldable question panel

## Problem

The pending-question panel (`ComposerPendingUserInputPanel`) docks at the top of the
composer, which sits at the bottom of the screen. When a question has many options or
long option descriptions, the panel grows tall and covers the conversation text above
it. The user cannot read the conversation while a large question is pending.

## Goal

Let the user fold (collapse) the question panel so it shrinks to a slim header bar,
revealing the conversation above. Folding is a manual, per-question convenience — it
does not change how questions are answered.

## Behavior

- Add a fold toggle to the panel's header row (the row holding the `header` label and
  the `n/m` progress badge). Use a chevron icon indicating the current state.
- **Expanded (default):** current layout — question text, the multi-select hint, and
  the options list.
- **Folded:** only the header row remains visible (the `header` label, the progress
  badge when present, and the chevron). The question text, hint, and options list are
  hidden. A folded panel stays slim no matter how large the options are.
- The **entire header row is clickable** and toggles between folded and expanded (both
  directions). The chevron rotates/changes to reflect state.

## State

- Local `useState` inside `ComposerPendingUserInputCard`: `isFolded`, default `false`
  (expanded).
- Per-question reset: whenever `activeQuestion.id` changes, reset to expanded so every
  new question is shown in full. No persistence across questions or threads.

## Keyboard interaction

- The existing number-key (1–9) option shortcuts and single-select auto-advance are
  unchanged while expanded.
- **While folded, number-key shortcuts are ignored** (there are no visible options to
  select). Folding purely gets the panel out of the way; it does not answer.

## Scope

- Single file: `apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx`.
- No contract, `pendingUserInput.ts`, or session-logic changes. Purely presentational
  state internal to the card component.
- The panel is rendered in both the desktop composer branch and the mobile-collapsed
  branch of `ChatComposer.tsx`; the fold is internal to the component, so it applies
  wherever the panel renders. The mobile branch already has its own compaction, so the
  primary benefit is the desktop/expanded panel.

## Testing

- The change is presentational (local UI state + conditional rendering); there is no
  pure helper worth a dedicated logic test. Verify visually: fold hides options and
  reveals the conversation, header stays clickable, a new question resets to expanded,
  and number keys do nothing while folded.
