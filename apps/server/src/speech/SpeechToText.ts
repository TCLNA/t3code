/**
 * SpeechToText - local speech-to-text via whisper.cpp.
 *
 * Spawns the whisper.cpp `whisper-cli` (a.k.a. `main`) binary through
 * `ProcessRunner`, transcribing a single 16 kHz mono WAV utterance. Binary and
 * model paths come from the persisted server settings (`speech.*`), with
 * `T3_WHISPER_BIN` / `T3_WHISPER_MODEL` env fallbacks. The feature is OFF by
 * default; handlers fail with a typed `SpeechToTextError` when disabled or when
 * the model path is missing.
 *
 * @module SpeechToText
 */
import { SpeechToTextError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { ProcessRunner } from "../processRunner.ts";
import { ServerSettingsService } from "../serverSettings.ts";

export interface SpeechToTextInput {
  readonly wavBytes: Uint8Array;
  readonly language?: string | undefined;
}

export interface SpeechToTextOutput {
  readonly text: string;
}

export class SpeechToText extends Context.Service<
  SpeechToText,
  {
    readonly transcribe: (
      input: SpeechToTextInput,
    ) => Effect.Effect<SpeechToTextOutput, SpeechToTextError>;
  }
>()("t3/speech/SpeechToText") {}

const resolveConfigValue = (value: string | undefined, envKey: string): string => {
  const trimmed = value?.trim();
  if (trimmed) return trimmed;
  const fromEnv = process.env[envKey]?.trim();
  return fromEnv ?? "";
};

/**
 * Strip whisper.cpp non-speech annotations from a transcript.
 *
 * whisper emits sound events wrapped in square brackets (`[BLANK_AUDIO]`,
 * `[Music]`, `[silence]`) or parentheses (`(keyboard clicking)`,
 * `(door opening)`) rather than as spoken words. Remove those bracketed
 * segments and collapse the whitespace they leave behind.
 */
export const stripNonSpeechAnnotations = (text: string): string =>
  text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processRunner = yield* ProcessRunner;
  const settingsService = yield* ServerSettingsService;

  const transcribe: SpeechToText["Service"]["transcribe"] = (input) =>
    Effect.scoped(
      Effect.gen(function* () {
        const settings = yield* settingsService.getSettings.pipe(
          Effect.mapError(
            (cause) =>
              new SpeechToTextError({
                reason: "not-configured",
                detail: "Failed to read server settings.",
                cause,
              }),
          ),
        );
        const speech = settings.speech;
        if (!speech.sttEnabled) {
          return yield* Effect.fail(
            new SpeechToTextError({
              reason: "not-configured",
              detail: "Speech-to-text is disabled in settings.",
            }),
          );
        }

        const binary = resolveConfigValue(speech.whisperBinaryPath, "T3_WHISPER_BIN") || "whisper-cli";
        const model = resolveConfigValue(speech.whisperModelPath, "T3_WHISPER_MODEL");
        if (!model) {
          return yield* Effect.fail(
            new SpeechToTextError({
              reason: "model-missing",
              detail: "No whisper.cpp model path configured.",
            }),
          );
        }

        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-stt-" }).pipe(
          Effect.mapError(
            (cause) =>
              new SpeechToTextError({
                reason: "process-failed",
                detail: "Failed to create temp directory.",
                cause,
              }),
          ),
        );
        const wavPath = path.join(dir, "input.wav");
        const outBase = path.join(dir, "out");

        yield* fs.writeFile(wavPath, input.wavBytes).pipe(
          Effect.mapError(
            (cause) =>
              new SpeechToTextError({
                reason: "process-failed",
                detail: "Failed to write temp WAV.",
                cause,
              }),
          ),
        );

        const language = input.language?.trim();
        const args = [
          "-m",
          model,
          "-f",
          wavPath,
          "-otxt",
          "-nt",
          "-of",
          outBase,
          ...(language ? ["-l", language] : []),
        ];

        const result = yield* processRunner
          .run({
            command: binary,
            args,
            timeout: "120 seconds",
            maxOutputBytes: 4 * 1024 * 1024,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new SpeechToTextError({
                  reason: cause._tag === "ProcessSpawnError" ? "binary-missing" : "process-failed",
                  detail: `whisper-cli failed to run ('${binary}').`,
                  cause,
                }),
            ),
          );

        if (result.code !== 0) {
          return yield* Effect.fail(
            new SpeechToTextError({
              reason: "process-failed",
              detail: `whisper-cli exited with code ${result.code}: ${result.stderr.slice(0, 500)}`,
            }),
          );
        }

        const transcript = yield* fs
          .readFileString(`${outBase}.txt`)
          .pipe(Effect.orElseSucceed(() => result.stdout));

        return { text: stripNonSpeechAnnotations(transcript) };
      }),
    );

  return SpeechToText.of({ transcribe });
});

export const layer = Layer.effect(SpeechToText, make);
