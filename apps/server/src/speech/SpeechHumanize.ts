/**
 * SpeechHumanize – LLM-based TTS text humanization via the Claude CLI.
 *
 * Expands [CODE:…], [PATH:…], and [ARROW:…] markers into natural spoken English
 * by delegating to `claude -p`. Returns the original sentence unchanged on any
 * failure (timeout, non-zero exit, spawn error) so audio is never blocked.
 *
 * @module SpeechHumanize
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProcessRunner } from "../processRunner.ts";

const SYSTEM_PROMPT = `You are a text preprocessor for text-to-speech. Transform the input sentence and return only the rewritten text — no explanation, no commentary.

Rules:
- [CODE:token] — expand into spoken English words:
    camelCase → space-separated words ("useVoiceStore" → "use voice store")
    snake_case → space-separated words ("my_fn" → "my fn")
    SCREAMING_CASE → lowercase words ("MAX_RETRY" → "max retry")
    PascalCase → space-separated words ("ChatComposer" → "chat composer");
    leading all-caps acronym segments stay as letters ("TtsPlayback" → "tee tee ess playback")
- [PATH:path] — speak naturally:
    Include 1–2 meaningful path segments if they add context (drop leading src/, apps/, packages/)
    Speak the file stem naturally (camelCase rules apply)
    Spell source-code-only extensions letter by letter: ts, tsx, jsx, mjs, cjs, py, rs, go, rb, kt, cpp, cs, sh, etc.
    Say well-known acronym extensions as their common spoken name: HTML, CSS, JSON, YAML, XML, SQL, PDF, SVG, PNG, JPEG, GIF, MP4 — never spell these out
- [ARROW:arrow] — replace with the most natural spoken word given surrounding context:
    -> and => are usually "to"; after ) they may be "returns"
    <- is usually "from"
    --> is usually "then" or "leading to"
    A neutral pause (comma) is acceptable if no word fits naturally
- Leave all other prose unchanged`;

export class SpeechHumanize extends Context.Service<
  SpeechHumanize,
  {
    readonly humanize: (sentence: string) => Effect.Effect<string, never>;
  }
>()("t3/speech/SpeechHumanize") {}

export const make = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner;

  const humanize: SpeechHumanize["Service"]["humanize"] = (sentence) =>
    Effect.gen(function* () {
      const prompt = `${SYSTEM_PROMPT}\n\nSentence to transform:\n${sentence}`;
      const result = yield* processRunner.run({
        command: "claude",
        args: [
          "-p",
          "--output-format",
          "text",
          "--model",
          "claude-haiku-4-5-20251001",
          "--dangerously-skip-permissions",
        ],
        stdin: prompt,
        timeout: "3 seconds",
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: 10 * 1024,
      });
      if (result.timedOut || result.code !== 0) return sentence;
      const out = result.stdout.trim();
      return out.length > 0 ? out : sentence;
    }).pipe(Effect.orElseSucceed(() => sentence));

  return SpeechHumanize.of({ humanize });
});

export const layer = Layer.effect(SpeechHumanize, make);
