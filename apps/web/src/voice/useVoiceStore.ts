import { create } from "zustand";

export type AudioMode = "all" | "notify" | "none";

const AUDIO_MODE_KEY = "t3.voice.audioMode";
const BEEP_UNFOCUSED_KEY = "t3.voice.beepUnfocusedOnly";
const LEGACY_TTS_MUTED_KEY = "t3.voice.ttsMuted";

const AUDIO_MODE_CYCLE: Record<AudioMode, AudioMode> = {
  all: "notify",
  notify: "none",
  none: "all",
};

/** Advance to the next audio mode in the cycle. */
export function nextAudioMode(mode: AudioMode): AudioMode {
  return AUDIO_MODE_CYCLE[mode];
}

/** Resolve the effective audio mode from the stored value, migrating the legacy ttsMuted flag. */
export function migrateAudioMode(
  storedMode: string | null | undefined,
  legacyTtsMuted: string | null | undefined,
): AudioMode {
  if (storedMode === "all" || storedMode === "notify" || storedMode === "none") {
    return storedMode;
  }
  return legacyTtsMuted === "false" ? "all" : "notify";
}

function readAudioMode(): AudioMode {
  try {
    return migrateAudioMode(
      globalThis.localStorage?.getItem(AUDIO_MODE_KEY),
      globalThis.localStorage?.getItem(LEGACY_TTS_MUTED_KEY),
    );
  } catch {
    return "notify";
  }
}

function writeAudioMode(mode: AudioMode): void {
  try {
    globalThis.localStorage?.setItem(AUDIO_MODE_KEY, mode);
  } catch {
    // ignore persistence failures (private mode, etc.)
  }
}

function readBeepUnfocusedOnly(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(BEEP_UNFOCUSED_KEY);
    return raw === null || raw === undefined ? true : raw === "true";
  } catch {
    return true;
  }
}

function writeBeepUnfocusedOnly(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(BEEP_UNFOCUSED_KEY, value ? "true" : "false");
  } catch {
    // ignore persistence failures
  }
}

interface VoiceStoreState {
  /** Whether the composer is actively capturing/dictating. */
  recording: boolean;
  /** Audio mode: all sounds, notification beeps only, or none. Persisted. */
  audioMode: AudioMode;
  /** Derived from audioMode; kept in sync for TTS consumers. */
  ttsMuted: boolean;
  /** When true, beeps play only while the app is unfocused. Persisted. */
  beepUnfocusedOnly: boolean;
  /** Last error message, if any. */
  error: string | null;

  setRecording: (recording: boolean) => void;
  toggleRecording: () => void;
  setAudioMode: (mode: AudioMode) => void;
  cycleAudioMode: () => void;
  setBeepUnfocusedOnly: (value: boolean) => void;
  setError: (error: string | null) => void;
}

export const useVoiceStore = create<VoiceStoreState>((set) => {
  const initialMode = readAudioMode();
  return {
    recording: false,
    audioMode: initialMode,
    ttsMuted: initialMode !== "all",
    beepUnfocusedOnly: readBeepUnfocusedOnly(),
    error: null,

    setRecording: (recording) => set(recording ? { recording, error: null } : { recording }),
    toggleRecording: () => set((state) => ({ recording: !state.recording, error: null })),
    setAudioMode: (audioMode) => {
      writeAudioMode(audioMode);
      set({ audioMode, ttsMuted: audioMode !== "all" });
    },
    cycleAudioMode: () =>
      set((state) => {
        const audioMode = nextAudioMode(state.audioMode);
        writeAudioMode(audioMode);
        return { audioMode, ttsMuted: audioMode !== "all" };
      }),
    setBeepUnfocusedOnly: (beepUnfocusedOnly) => {
      writeBeepUnfocusedOnly(beepUnfocusedOnly);
      set({ beepUnfocusedOnly });
    },
    setError: (error) => set({ error }),
  };
});
