import { type ReactNode } from "react";

/**
 * Bare full-height mobile shell used when simplified mode is active.
 * No desktop sidebar; screens manage their own header/tab chrome.
 */
export function SimplifiedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-background text-foreground pt-safe pb-safe">
      {children}
    </div>
  );
}
