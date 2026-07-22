# Design: Toggle to disable TTS humanization

**Date:** 2026-07-22
**Status:** Approved

## Problem

TTS text is passed through an LLM-based `humanize` step before synthesis. Each
speakable unit is POSTed to `/api/tts/humanize`, which shells out to the Claude
CLI (`claude-haiku-4-5-20251001`) to expand `[CODE:]`/`[PATH:]`/`[ARROW:]` markers
and read units/times/durations as words. There is no way to turn this off. When
disabled, users want plain text spoken without the per-unit LLM round-trip.

## Setting

Add `speech.humanizeEnabled: boolean`, default `true`, in
`packages/contracts/src/settings.ts`:

1. Add the field to the `SpeechSettings` struct following the `ttsEnabled`
   pattern — `Schema.Boolean` with `withDecodingDefault(Effect.succeed(true))`
   and a `providerSettingsForm: { control: "switch" }` annotation
   (title "Humanize TTS text", short description).
2. Add its key to the `order` array so it renders in the settings form.
3. Add `humanizeEnabled: Schema.optionalKey(Schema.Boolean)` to
   `ServerSettingsPatch.speech`.

`withDecodingDefault` keeps existing persisted settings valid; the default is
picked up by `DEFAULT_SERVER_SETTINGS` automatically.

## Gate: web-side (chosen)

The web client already holds speech settings via `primaryServerSettingsAtom`
(`VoiceTtsProvider.tsx:28`), so no delivery plumbing is needed.

`humanizeForSpeech` input carries the `[CODE:]`/`[PATH:]`/`[ARROW:]` markers
produced by `markdownToSpeakable`. "Disabled" therefore means **strip markers**
(`stripMarkers` from `@t3tools/shared/speakableText`), NOT raw passthrough —
raw markers would be spoken literally.

Centralize the decision so all three call sites share one path. Introduce a
single helper that, given the unit and the `humanizeEnabled` flag, returns
either `humanizeForSpeech(unit)` (on) or `Promise.resolve(stripMarkers(unit))`
(off). The three call sites in `VoiceTtsProvider.tsx` (lines ~93, ~105, ~141)
read `speechRef.current.humanizeEnabled` / `speech.humanizeEnabled` and go
through the helper.

When **off**: markers stripped, clean text to TTS, no network call, no LLM cost.
When **on**: behavior unchanged.

### Rejected alternative — server-side gate

Gate inside `SpeechHumanize` (return stripped text when off). Rejected: the web
client still POSTs every unit and blocks on the round-trip even when the feature
is off, wasting latency for no benefit.

## Server

No server changes. `SpeechHumanize` and `/api/tts/humanize` are untouched; when
the toggle is off the web simply stops calling the route.

## Testing

- Contracts: `settings.test.ts` — `humanizeEnabled` decodes to `true` by default,
  round-trips through the patch schema, and old settings without the key still
  decode.
- Web helper: with the flag off, the helper returns `stripMarkers(unit)` and
  makes no fetch; with it on, it delegates to `humanizeForSpeech`.
