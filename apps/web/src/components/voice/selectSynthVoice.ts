export interface SynthVoiceInputs {
  readonly ttsEngine?: "kokoro" | "chatterbox" | undefined;
  readonly kokoroVoice?: string | undefined;
  readonly chatterboxVoice?: string | undefined;
}

/** The voice string to send with a synth request, or undefined if none set. */
export function selectSynthVoice(speech: SynthVoiceInputs): string | undefined {
  const voice =
    (speech.ttsEngine ?? "kokoro") === "chatterbox" ? speech.chatterboxVoice : speech.kokoroVoice;
  return voice && voice.length > 0 ? voice : undefined;
}
