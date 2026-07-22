export type TtsEngine = "kokoro" | "chatterbox";

export const TTS_ENGINE_OPTIONS: ReadonlyArray<{ value: TtsEngine; label: string }> = [
  { value: "kokoro", label: "Kokoro" },
  { value: "chatterbox", label: "Chatterbox" },
];

/** Shown in place of the Kokoro voice list when Chatterbox is selected. */
export const CHATTERBOX_VOICE_NOTE = "Chatterbox uses its configured voice.";

/** The Kokoro voice list only applies to the Kokoro engine. */
export function shouldShowKokoroVoices(engine: TtsEngine | undefined): boolean {
  return (engine ?? "kokoro") !== "chatterbox";
}
