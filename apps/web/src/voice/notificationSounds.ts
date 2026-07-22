import doneSoundUrl from "./sounds/complete.oga?url";
import needsInputSoundUrl from "./sounds/window-question.oga?url";
import type { BeepKind } from "./notificationBeeps";

const SOUND_URLS: Record<BeepKind, string> = {
  done: doneSoundUrl,
  "needs-input": needsInputSoundUrl,
};

const audioByKind = new Map<BeepKind, HTMLAudioElement>();

/** Play the notification beep for a kind. No-ops on autoplay/decode failure. */
export function playBeep(kind: BeepKind): void {
  try {
    let audio = audioByKind.get(kind);
    if (!audio) {
      audio = new Audio(SOUND_URLS[kind]);
      audioByKind.set(kind, audio);
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // ignore autoplay-policy rejections
    });
  } catch {
    // ignore construction/playback failures
  }
}
