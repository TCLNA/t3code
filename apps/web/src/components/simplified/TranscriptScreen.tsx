import { type ScopedThreadRef } from "@t3tools/contracts";

import { useThreadMessages } from "~/state/entities";
import { useVoiceStore } from "~/voice/useVoiceStore";
import { ListeningBar, MessageBubble } from "./SimplifiedPrimitives";

export function TranscriptScreen({ threadRef }: { threadRef: ScopedThreadRef }) {
  const messages = useThreadMessages(threadRef);
  const recording = useVoiceStore((s) => s.recording);
  const toggleRecording = useVoiceStore((s) => s.toggleRecording);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No messages yet.
          </div>
        ) : (
          messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => (
              <MessageBubble key={m.id} role={m.role === "user" ? "user" : "assistant"}>
                {m.text}
              </MessageBubble>
            ))
        )}
      </div>
      <ListeningBar recording={recording} onToggle={toggleRecording} />
    </div>
  );
}
