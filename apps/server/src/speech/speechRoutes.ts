/**
 * Raw HTTP routes for local voice mode.
 *
 * Audio is bulk binary, so it travels over dedicated authenticated HTTP routes
 * rather than the JSON-encoded RPC Socket:
 *   - `POST /api/stt/transcribe` — raw `audio/wav` body in, JSON transcript out.
 *   - `POST /api/tts/synthesize` — JSON `{ text, voice?, speed? }` in, `audio/wav` out.
 *
 * Both are gated with `authenticateRawRouteWithScope(AuthOrchestrationOperateScope)`
 * (Operate — they spawn processes), mirroring `otlpTracesProxyRouteLayer`.
 *
 * @module speechRoutes
 */
import { AuthOrchestrationOperateScope, TextToSpeechRequest, SpeechHumanizeRequest } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpServerRespondable,
} from "effect/unstable/http";

import { authenticateRawRouteWithScope } from "../http.ts";
import { SpeechToText } from "./SpeechToText.ts";
import { TextToSpeech } from "./TextToSpeech.ts";
import { SpeechHumanize } from "./SpeechHumanize.ts";

const STT_PATH = "/api/stt/transcribe";
const TTS_PATH = "/api/tts/synthesize";

const decodeTtsRequest = Schema.decodeUnknownEffect(TextToSpeechRequest);

const speechErrorStatus = (reason: string): number => {
  switch (reason) {
    case "not-configured":
    case "binary-missing":
    case "model-missing":
      return 503;
    case "decode-failed":
      return 502;
    default:
      return 500;
  }
};

const authErrorHandlers = {
  EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
  EnvironmentInternalError: HttpServerRespondable.toResponse,
  EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
} as const;

export const sttRouteLayer = HttpRouter.add(
  "POST",
  STT_PATH,
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const speechToText = yield* SpeechToText;

    const url = HttpServerRequest.toURL(request);
    const language = Option.isSome(url)
      ? (url.value.searchParams.get("language") ?? undefined)
      : undefined;

    const body = yield* request.arrayBuffer.pipe(
      Effect.orElseSucceed(() => new ArrayBuffer(0)),
    );
    const wavBytes = new Uint8Array(body);
    if (wavBytes.byteLength === 0) {
      return HttpServerResponse.text("Empty audio body.", { status: 400 });
    }

    return yield* speechToText.transcribe({ wavBytes, language }).pipe(
      Effect.map((result) => HttpServerResponse.jsonUnsafe(result, { status: 200 })),
      Effect.catchTag("SpeechToTextError", (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.reason, detail: error.detail ?? null },
            { status: speechErrorStatus(error.reason) },
          ),
        ),
      ),
    );
  }).pipe(Effect.catchTags(authErrorHandlers)),
);

export const ttsRouteLayer = HttpRouter.add(
  "POST",
  TTS_PATH,
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const textToSpeech = yield* TextToSpeech;

    const json = yield* request.json.pipe(Effect.orElseSucceed(() => null));
    const decoded = yield* decodeTtsRequest(json).pipe(Effect.option);
    if (Option.isNone(decoded)) {
      return HttpServerResponse.text("Invalid request body.", { status: 400 });
    }

    return yield* textToSpeech.synthesize(decoded.value).pipe(
      Effect.map((result) =>
        HttpServerResponse.uint8Array(result.wavBytes, {
          status: 200,
          contentType: "audio/wav",
        }),
      ),
      Effect.catchTag("TextToSpeechError", (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.reason, detail: error.detail ?? null },
            { status: speechErrorStatus(error.reason) },
          ),
        ),
      ),
    );
  }).pipe(Effect.catchTags(authErrorHandlers)),
);

const HUMANIZE_PATH = "/api/tts/humanize";

const decodeSpeechHumanizeRequest = Schema.decodeUnknownEffect(SpeechHumanizeRequest);

export const humanizeRouteLayer = HttpRouter.add(
  "POST",
  HUMANIZE_PATH,
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const speechHumanize = yield* SpeechHumanize;

    const json = yield* request.json.pipe(Effect.orElseSucceed(() => null));
    const decoded = yield* decodeSpeechHumanizeRequest(json).pipe(Effect.option);
    if (Option.isNone(decoded)) {
      return HttpServerResponse.text("Invalid request body.", { status: 400 });
    }

    const humanized = yield* speechHumanize.humanize(decoded.value.sentence);
    return HttpServerResponse.jsonUnsafe({ humanized }, { status: 200 });
  }).pipe(Effect.catchTags(authErrorHandlers)),
);
