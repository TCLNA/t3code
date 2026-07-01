import { useAtomValue } from "@effect/atom-react";
import { useParams } from "@tanstack/react-router";
import { markdownToSpeakable, segmentSpeakable } from "@t3tools/shared/speakableText";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";

import { useThreadMessages } from "~/state/entities";
import { primaryServerSettingsAtom } from "~/state/server";
import { resolveThreadRouteTarget } from "~/threadRoutes";

import { TtsPlaybackController } from "./ttsPlayback";
import { useVoiceStore } from "./useVoiceStore";

interface VoiceTtsValue {
  speak: (text: string) => void;
  stop: () => void;
}

const VoiceTtsContext = createContext<VoiceTtsValue | null>(null);

export function useVoiceTts(): VoiceTtsValue {
  const value = useContext(VoiceTtsContext);
  // Safe no-op fallback so consumers work even if the provider is absent.
  return value ?? { speak: () => {}, stop: () => {} };
}

export function VoiceTtsProvider({ children }: { children: React.ReactNode }) {
  const settings = useAtomValue(primaryServerSettingsAtom);
  const speech = settings.speech;
  const ttsMuted = useVoiceStore((s) => s.ttsMuted);

  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const threadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const messages = useThreadMessages(threadRef);

  const playbackRef = useRef<TtsPlaybackController | null>(null);
  const speechRef = useRef(speech);
  speechRef.current = speech;

  // Lazily create the single playback controller.
  useEffect(() => {
    const playback = new TtsPlaybackController({
      getVoice: () => speechRef.current.kokoroVoice || undefined,
    });
    playbackRef.current = playback;
    return () => {
      void playback.dispose();
      playbackRef.current = null;
    };
  }, []);

  // Per-message sentence tracker (mirrors the old useVoiceSession logic).
  const spokenRef = useRef<{ messageId: string | null; spokenCount: number; done: boolean }>({
    messageId: null,
    spokenCount: 0,
    done: false,
  });

  useEffect(() => {
    if (!speechRef.current.ttsEnabled || ttsMuted) return;
    const playback = playbackRef.current;
    if (!playback) return;

    let assistant: (typeof messages)[number] | undefined;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]!.role === "assistant") {
        assistant = messages[i];
        break;
      }
    }
    if (!assistant) return;

    const tracker = spokenRef.current;
    if (assistant.id !== tracker.messageId) {
      tracker.messageId = assistant.id;
      tracker.spokenCount = 0;
      // Only narrate replies we first see while they are streaming; never
      // replay an already-completed message on mount/navigation.
      tracker.done = !assistant.streaming;
    }
    if (tracker.done) return;

    const spoken = markdownToSpeakable(assistant.text);
    const { units, remainder } = segmentSpeakable(spoken);
    for (let i = tracker.spokenCount; i < units.length; i += 1) {
      playback.enqueue(playback.nextIndex(), units[i]!);
    }
    tracker.spokenCount = units.length;

    if (!assistant.streaming) {
      const tail = remainder.trim();
      if (tail.length > 0) playback.enqueue(playback.nextIndex(), tail);
      tracker.done = true;
    }
  }, [messages, ttsMuted]);

  // Muting stops any in-flight playback.
  useEffect(() => {
    if (ttsMuted) playbackRef.current?.stop();
  }, [ttsMuted]);

  const value = useMemo<VoiceTtsValue>(
    () => ({
      speak: (text: string) => {
        const playback = playbackRef.current;
        if (!playback) return;
        const spoken = markdownToSpeakable(text).trim();
        if (spoken.length === 0) return;
        playback.stop();
        playback.enqueue(playback.nextIndex(), spoken);
      },
      stop: () => playbackRef.current?.stop(),
    }),
    [],
  );

  return <VoiceTtsContext.Provider value={value}>{children}</VoiceTtsContext.Provider>;
}
