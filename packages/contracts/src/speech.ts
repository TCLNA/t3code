import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

// ── Speech-to-text ─────────────────────────────────────────────

/**
 * Result returned by the `POST /api/stt/transcribe` route. The request body
 * is raw `audio/wav` bytes (a single 16 kHz mono utterance), so there is no
 * JSON request schema — only this response shape.
 */
export const SpeechToTextResult = Schema.Struct({
  text: Schema.String,
  durationMs: Schema.optional(NonNegativeInt),
});
export type SpeechToTextResult = typeof SpeechToTextResult.Type;

// ── Text-to-speech ─────────────────────────────────────────────

/**
 * Request body for `POST /api/tts/synthesize`. One sentence-sized speakable
 * unit per request; the response body is raw `audio/wav` bytes.
 */
export const TextToSpeechRequest = Schema.Struct({
  text: TrimmedNonEmptyString,
  voice: Schema.optional(TrimmedNonEmptyString),
  speed: Schema.optional(Schema.Number),
});
export type TextToSpeechRequest = typeof TextToSpeechRequest.Type;

// ── Errors ─────────────────────────────────────────────────────

export const SpeechFailureReason = Schema.Literals([
  "not-configured",
  "binary-missing",
  "model-missing",
  "decode-failed",
  "process-failed",
]);
export type SpeechFailureReason = typeof SpeechFailureReason.Type;

export class SpeechToTextError extends Schema.TaggedErrorClass<SpeechToTextError>()(
  "SpeechToTextError",
  {
    reason: SpeechFailureReason,
    detail: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Speech-to-text failed (${this.reason})${this.detail ? `: ${this.detail}` : ""}`;
  }
}

export class TextToSpeechError extends Schema.TaggedErrorClass<TextToSpeechError>()(
  "TextToSpeechError",
  {
    reason: SpeechFailureReason,
    detail: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Text-to-speech failed (${this.reason})${this.detail ? `: ${this.detail}` : ""}`;
  }
}

// ── Speech humanization ────────────────────────────────────────

/**
 * Request body for `POST /api/tts/humanize`. One sentence-sized unit containing
 * [CODE:…], [PATH:…], [ARROW:…] markers; response is `{ humanized: string }`.
 */
export const SpeechHumanizeRequest = Schema.Struct({
  sentence: TrimmedNonEmptyString,
});
export type SpeechHumanizeRequest = typeof SpeechHumanizeRequest.Type;

export const SpeechHumanizeResult = Schema.Struct({
  humanized: Schema.String,
});
export type SpeechHumanizeResult = typeof SpeechHumanizeResult.Type;
