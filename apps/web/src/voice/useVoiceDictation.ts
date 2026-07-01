import { useEffect, useRef } from "react";

import { toastManager } from "~/components/ui/toast";

import { VoiceCaptureController } from "./audioCapture";
import { transcribeAudio } from "./sttClient";
import { useVoiceStore } from "./useVoiceStore";

/**
 * Drives composer dictation: while `recording` is true, capture mic audio with
 * VAD, transcribe each utterance, and insert it at the cursor. Starting a
 * recording stops any TTS playback (barge-in).
 */
export function useVoiceDictation({
  insertAtCursor,
  stopTts,
}: {
  insertAtCursor: (text: string) => void;
  stopTts: () => void;
}): void {
  const recording = useVoiceStore((s) => s.recording);
  const setRecording = useVoiceStore((s) => s.setRecording);
  const setError = useVoiceStore((s) => s.setError);

  const insertRef = useRef(insertAtCursor);
  insertRef.current = insertAtCursor;
  const stopTtsRef = useRef(stopTts);
  stopTtsRef.current = stopTts;

  useEffect(() => {
    if (!recording) return;
    stopTtsRef.current();

    const capture = new VoiceCaptureController(
      {
        onUtteranceEnd: (wav) => {
          void (async () => {
            try {
              const { text } = await transcribeAudio(wav);
              if (text.trim().length > 0) insertRef.current(text);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              setError(message);
              toastManager.add({
                type: "error",
                title: "Transcription failed",
                description: message,
              });
            }
          })();
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          setError(message);
          toastManager.add({ type: "error", title: "Microphone error", description: message });
          setRecording(false);
        },
      },
      { autoEndOnSilence: true },
    );

    void capture.start().catch(() => setRecording(false));
    return () => {
      void capture.stop();
    };
  }, [recording, setError, setRecording]);
}
