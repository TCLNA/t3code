import { type ScopedThreadRef } from "@t3tools/contracts";
import { ChevronLeftIcon, MessageSquareIcon, MicIcon } from "lucide-react";
import { useState } from "react";

import { useThreadShell } from "~/state/entities";
import { useSimplifiedNavigate } from "./simplifiedNavigation";
import { SimplifiedHeader } from "./SimplifiedPrimitives";
import { TranscriptScreen } from "./TranscriptScreen";
import { VoiceConversationScreen } from "./VoiceConversationScreen";

export default function SimplifiedThreadScreen({
  threadRef,
}: {
  threadRef: ScopedThreadRef;
}) {
  const shell = useThreadShell(threadRef);
  const navigate = useSimplifiedNavigate();
  const [view, setView] = useState<"voice" | "transcript">("voice");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SimplifiedHeader
        left={
          <button
            type="button"
            aria-label="Back to sessions"
            onClick={() => navigate({ to: "/" })}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
        }
        title={shell?.title || "Session"}
        subtitle={shell?.session?.status ?? undefined}
        right={
          <button
            type="button"
            aria-label={view === "voice" ? "Open transcript" : "Open voice view"}
            onClick={() => setView((v) => (v === "voice" ? "transcript" : "voice"))}
            className="flex size-9 items-center justify-center rounded-full text-primary hover:bg-accent"
          >
            {view === "voice" ? (
              <MessageSquareIcon className="size-4" />
            ) : (
              <MicIcon className="size-4" />
            )}
          </button>
        }
      />
      {view === "voice" ? (
        <VoiceConversationScreen threadRef={threadRef} />
      ) : (
        <TranscriptScreen threadRef={threadRef} />
      )}
    </div>
  );
}
