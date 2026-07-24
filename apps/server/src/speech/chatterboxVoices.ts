// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as Effect from "effect/Effect";

/** Map directory filenames to sorted, de-duped Chatterbox voice names. */
export function voiceNamesFromFilenames(files: readonly string[]): string[] {
  const names = new Set<string>();
  for (const file of files) {
    if (file.toLowerCase().endsWith(".wav")) {
      names.add(file.slice(0, file.length - ".wav".length));
    }
  }
  return [...names].sort();
}

/** Scan a directory for *.wav voice clips. Never fails: any error → []. */
export const scanChatterboxVoices = (dir: string): Effect.Effect<string[]> => {
  const trimmed = dir.trim();
  if (!trimmed) return Effect.succeed([]);
  return Effect.tryPromise(() => NodeFSP.readdir(trimmed)).pipe(
    Effect.map(voiceNamesFromFilenames),
    Effect.orElseSucceed(() => []),
  );
};
