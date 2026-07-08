import { type ReactNode } from "react";

import { cn } from "~/lib/utils";

export function SimplifiedHeader({
  title,
  subtitle,
  left,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
      {left}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{title}</div>
        {subtitle ? (
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>
      {right}
    </header>
  );
}

export function SessionStatusDot({
  variant,
}: {
  variant: "needsYou" | "running" | "done";
}) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        variant === "needsYou" && "bg-warning animate-pulse",
        variant === "running" && "bg-primary animate-pulse",
        variant === "done" && "bg-success",
      )}
      aria-hidden
    />
  );
}

export function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-4 pb-2 text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
      <span>{label}</span>
      <span className="text-muted-foreground/60">· {count}</span>
    </div>
  );
}

export function SessionCard({
  projectName,
  title,
  statusLine,
  statusVariant,
  onClick,
}: {
  projectName: string;
  title: string;
  statusLine: string;
  statusVariant: "needsYou" | "running" | "done";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-4 mb-2 flex w-[calc(100%-2rem)] flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent"
    >
      <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
        <SessionStatusDot variant={statusVariant} />
        <span className="truncate">{projectName}</span>
      </div>
      <div className="truncate text-sm font-semibold text-foreground">{title}</div>
      <div className="truncate text-xs text-muted-foreground">{statusLine}</div>
    </button>
  );
}

export function SimplifiedTabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: ReadonlyArray<{ key: string; label: string; icon: ReactNode }>;
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <nav className="flex shrink-0 border-t border-border">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onSelect(tab.key)}
          className={cn(
            "flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium",
            tab.key === active ? "text-primary" : "text-muted-foreground",
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

export function MessageBubble({
  role,
  children,
}: {
  role: "user" | "assistant";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
        role === "user"
          ? "self-end rounded-br-sm bg-primary/15 text-foreground"
          : "self-start rounded-bl-sm bg-accent text-foreground",
      )}
    >
      {children}
    </div>
  );
}

export function ListeningBar({
  recording,
  onToggle,
  disabled,
}: {
  recording: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mx-4 mb-6 flex shrink-0 items-center gap-3 rounded-full border border-border bg-card px-4 py-2">
      <span className="flex-1 text-xs text-muted-foreground">
        {disabled ? "Voice input off" : recording ? "Listening…" : "Tap the mic to talk"}
      </span>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={recording ? "Stop recording" : "Start recording"}
        className={cn(
          "flex size-10 items-center justify-center rounded-full text-primary-foreground disabled:opacity-40",
          recording ? "bg-primary animate-pulse" : "bg-primary",
        )}
      >
        <MicGlyph />
      </button>
    </div>
  );
}

function MicGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
