import { Link } from "@tanstack/react-router";
import { FolderIcon, ListIcon, MicIcon, SettingsIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useThreadShells } from "~/state/entities";
import { useSimplifiedNavigate } from "./simplifiedNavigation";
import {
  SectionHeader,
  SessionCard,
  SimplifiedTabBar,
} from "./SimplifiedPrimitives";
import {
  classifySession,
  groupSessionsByStatus,
  type SessionGroupKey,
} from "./sessionsGrouping";

const GROUP_LABELS: Record<SessionGroupKey, string> = {
  needsYou: "Needs you",
  running: "Running",
  done: "Done",
};
const GROUP_ORDER: ReadonlyArray<SessionGroupKey> = ["needsYou", "running", "done"];

function statusLineFor(thread: {
  session: { status: string } | null;
  hasPendingUserInput: boolean;
}): string {
  if (thread.hasPendingUserInput) return "needs your input";
  const status = thread.session?.status;
  return status ? status : "idle";
}

export default function SessionsHomeScreen() {
  const threads = useThreadShells();
  const navigate = useSimplifiedNavigate();
  const [tab, setTab] = useState<"sessions" | "projects">("sessions");

  const grouped = useMemo(
    () => groupSessionsByStatus(threads, 0),
    [threads],
  );

  const byProject = useMemo(() => {
    const map = new Map<string, typeof threads[number][]>();
    for (const thread of threads) {
      const key = thread.projectId as unknown as string;
      const list = map.get(key) ?? [];
      list.push(thread);
      map.set(key, list);
    }
    return map;
  }, [threads]);

  const openThread = (thread: (typeof threads)[number]) => {
    navigate({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: thread.environmentId,
        threadId: thread.id,
      },
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold text-foreground">Sessions</div>
          <div className="text-xs text-muted-foreground">
            {threads.length} {threads.length === 1 ? "agent" : "agents"}
          </div>
        </div>
        <Link
          to="/settings/general"
          aria-label="Open settings"
          className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
        >
          <SettingsIcon className="size-4" />
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {threads.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            No sessions yet.
          </div>
        ) : tab === "sessions" ? (
          GROUP_ORDER.map((key) => {
            const list = grouped[key];
            if (list.length === 0) return null;
            return (
              <section key={key}>
                <SectionHeader label={GROUP_LABELS[key]} count={list.length} />
                {list.map((thread) => (
                  <SessionCard
                    key={thread.id}
                    projectName={String(thread.projectId)}
                    title={thread.title || "Untitled session"}
                    statusLine={statusLineFor(thread)}
                    statusVariant={classifySession(thread)}
                    onClick={() => openThread(thread)}
                  />
                ))}
              </section>
            );
          })
        ) : (
          [...byProject.entries()].map(([projectId, list]) => (
            <section key={projectId}>
              <SectionHeader label={projectId} count={list.length} />
              {list.map((thread) => (
                <SessionCard
                  key={thread.id}
                  projectName={String(thread.projectId)}
                  title={thread.title || "Untitled session"}
                  statusLine={statusLineFor(thread)}
                  statusVariant={classifySession(thread)}
                  onClick={() => openThread(thread)}
                />
              ))}
            </section>
          ))
        )}
      </div>

      <div className="px-4 pb-3">
        <Link
          to="/"
          className="flex w-full items-center gap-3 rounded-full bg-primary px-4 py-3 text-primary-foreground"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-primary-foreground/20">
            <MicIcon className="size-4" />
          </span>
          <span className="text-sm font-semibold">Start new session</span>
        </Link>
      </div>

      <SimplifiedTabBar
        active={tab}
        onSelect={(key) => setTab(key as "sessions" | "projects")}
        tabs={[
          { key: "sessions", label: "Sessions", icon: <ListIcon className="size-5" /> },
          { key: "projects", label: "Projects", icon: <FolderIcon className="size-5" /> },
        ]}
      />
    </div>
  );
}
