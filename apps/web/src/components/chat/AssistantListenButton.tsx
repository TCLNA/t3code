import { useAtomValue } from "@effect/atom-react";
import { markdownToSpeakable } from "@t3tools/shared/speakableText";
import { Volume2Icon } from "lucide-react";

import { Button } from "../ui/button";
import { primaryServerSettingsAtom } from "~/state/server";
import { useVoiceTts } from "~/voice/VoiceTtsProvider";

export function AssistantListenButton({ text }: { text: string }) {
  const settings = useAtomValue(primaryServerSettingsAtom);
  const voiceTts = useVoiceTts();
  if (!settings.speech.ttsEnabled) return null;
  const speakable = markdownToSpeakable(text).trim();
  if (speakable.length === 0) return null;
  return (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      aria-label="Listen to response"
      className="text-muted-foreground hover:text-foreground"
      onClick={() => voiceTts.speak(text)}
    >
      <Volume2Icon className="size-3" />
    </Button>
  );
}
