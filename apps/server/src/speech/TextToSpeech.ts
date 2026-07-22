/**
 * TextToSpeech - local text-to-speech via Kokoro.
 *
 * Kokoro ships no native binary, so this spawns a small adapter command
 * (configured as `speech.kokoroCommand`, e.g. `python kokoro_adapter.py`)
 * through `ProcessRunner`. The adapter reads the text to speak on stdin and
 * writes a WAV file to the `--out <path>` argument we pass it. We read those
 * bytes back with `FileSystem.readFile` (binary-safe) rather than piping WAV
 * through stdout, because `ProcessRunner` decodes stdout as UTF-8.
 *
 * OFF by default; fails with a typed `TextToSpeechError` when disabled or when
 * no adapter command is configured.
 *
 * @module TextToSpeech
 */
import { TextToSpeechError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { ProcessRunner } from "../processRunner.ts";
import { ServerSettingsService } from "../serverSettings.ts";

export interface TextToSpeechInput {
  readonly text: string;
  readonly voice?: string | undefined;
  readonly speed?: number | undefined;
}

export interface TextToSpeechOutput {
  readonly wavBytes: Uint8Array;
}

export class TextToSpeech extends Context.Service<
  TextToSpeech,
  {
    readonly synthesize: (
      input: TextToSpeechInput,
    ) => Effect.Effect<TextToSpeechOutput, TextToSpeechError>;
  }
>()("t3/speech/TextToSpeech") {}

const resolveConfigValue = (
  value: string | undefined,
  envKey: string,
  env: Record<string, string | undefined> = process.env,
): string => {
  const trimmed = value?.trim();
  if (trimmed) return trimmed;
  const fromEnv = env[envKey]?.trim();
  return fromEnv ?? "";
};

export interface TtsCommandInputs {
  readonly ttsEngine?: "kokoro" | "chatterbox" | undefined;
  readonly kokoroCommand?: string | undefined;
  readonly chatterboxCommand?: string | undefined;
}

/** Pick the TTS command + env fallback for the configured engine. */
export const resolveTtsCommand = (
  speech: TtsCommandInputs,
  env: Record<string, string | undefined> = process.env,
): { readonly engine: "kokoro" | "chatterbox"; readonly command: string } => {
  const engine = speech.ttsEngine ?? "kokoro";
  const command =
    engine === "chatterbox"
      ? resolveConfigValue(speech.chatterboxCommand, "T3_CHATTERBOX_CMD", env)
      : resolveConfigValue(speech.kokoroCommand, "T3_KOKORO_CMD", env);
  return { engine, command };
};

/** Split a configured command string into an executable and leading args. */
const splitCommand = (
  command: string,
): { readonly executable: string; readonly preArgs: string[] } => {
  const parts = command
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  const [executable, ...preArgs] = parts;
  return { executable: executable ?? "", preArgs };
};

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processRunner = yield* ProcessRunner;
  const settingsService = yield* ServerSettingsService;

  const synthesize: TextToSpeech["Service"]["synthesize"] = (input) =>
    Effect.scoped(
      Effect.gen(function* () {
        const settings = yield* settingsService.getSettings.pipe(
          Effect.mapError(
            (cause) =>
              new TextToSpeechError({
                reason: "not-configured",
                detail: "Failed to read server settings.",
                cause,
              }),
          ),
        );
        const speech = settings.speech;
        if (!speech.ttsEnabled) {
          return yield* Effect.fail(
            new TextToSpeechError({
              reason: "not-configured",
              detail: "Text-to-speech is disabled in settings.",
            }),
          );
        }

        const { engine, command } = resolveTtsCommand(speech);
        if (!command) {
          return yield* Effect.fail(
            new TextToSpeechError({
              reason: "binary-missing",
              detail: `No ${engine} command configured.`,
            }),
          );
        }

        const model = resolveConfigValue(speech.kokoroModelPath, "T3_KOKORO_MODEL");
        const voice =
          input.voice?.trim() ||
          resolveConfigValue(speech.kokoroVoice, "T3_KOKORO_VOICE") ||
          "af_heart";

        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-tts-" }).pipe(
          Effect.mapError(
            (cause) =>
              new TextToSpeechError({
                reason: "process-failed",
                detail: "Failed to create temp directory.",
                cause,
              }),
          ),
        );
        const outPath = path.join(dir, "out.wav");

        const { executable, preArgs } = splitCommand(command);
        const args = [
          ...preArgs,
          "--out",
          outPath,
          "--voice",
          voice,
          ...(model ? ["--model", model] : []),
          ...(input.speed !== undefined ? ["--speed", String(input.speed)] : []),
        ];

        const result = yield* processRunner
          .run({
            command: executable,
            args,
            stdin: input.text,
            timeout: "120 seconds",
            maxOutputBytes: 4 * 1024 * 1024,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new TextToSpeechError({
                  reason: cause._tag === "ProcessSpawnError" ? "binary-missing" : "process-failed",
                  detail: `Kokoro adapter failed to run ('${executable}').`,
                  cause,
                }),
            ),
          );

        if (result.code !== 0) {
          return yield* Effect.fail(
            new TextToSpeechError({
              reason: "process-failed",
              detail: `Kokoro adapter exited with code ${result.code}: ${result.stderr.slice(0, 500)}`,
            }),
          );
        }

        const wavBytes = yield* fs.readFile(outPath).pipe(
          Effect.mapError(
            (cause) =>
              new TextToSpeechError({
                reason: "decode-failed",
                detail: "Kokoro adapter did not produce a WAV file.",
                cause,
              }),
          ),
        );

        return { wavBytes };
      }),
    );

  return TextToSpeech.of({ synthesize });
});

export const layer = Layer.effect(TextToSpeech, make);
