import { type ScopedThreadRef } from "@t3tools/contracts";

import { useThreadMessages } from "~/state/entities";
import { useVoiceStore } from "~/voice/useVoiceStore";
import { ListeningBar } from "./SimplifiedPrimitives";

export function VoiceConversationScreen({ threadRef }: { threadRef: ScopedThreadRef }) {
  const messages = useThreadMessages(threadRef);
  const recording = useVoiceStore((s) => s.recording);
  const toggleRecording = useVoiceStore((s) => s.toggleRecording);

  const latestAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top half — assistant */}
      <div className="flex shrink-0 basis-1/2 flex-col justify-center gap-3 border-b border-border px-5 py-6">
        <div className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
          {recording ? "Listening" : "Étourmi"}
        </div>
        <p className="line-clamp-6 text-xl leading-snug font-medium text-foreground">
          {latestAssistant?.text ?? "Ready when you are."}
        </p>
      </div>

      {/* Bottom half — user */}
      <div className="flex min-h-0 flex-1 flex-col justify-end">
        <ListeningBar recording={recording} onToggle={toggleRecording} />
      </div>
    </div>
  );
}
