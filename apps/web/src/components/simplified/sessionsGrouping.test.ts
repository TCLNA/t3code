import { describe, expect, it } from "vite-plus/test";
import { classifySession, groupSessionsByStatus } from "./sessionsGrouping";

const base = {
  hasPendingUserInput: false,
  hasPendingApprovals: false,
  hasActionableProposedPlan: false,
  session: null,
  updatedAt: "2026-07-07T10:00:00.000Z",
};

describe("classifySession", () => {
  it("classifies pending user input as needsYou", () => {
    expect(classifySession({ ...base, hasPendingUserInput: true })).toBe("needsYou");
  });
  it("classifies pending approvals as needsYou", () => {
    expect(classifySession({ ...base, hasPendingApprovals: true })).toBe("needsYou");
  });
  it("classifies a running session as running", () => {
    expect(classifySession({ ...base, session: { status: "running" } })).toBe("running");
  });
  it("classifies a starting session as running", () => {
    expect(classifySession({ ...base, session: { status: "starting" } })).toBe("running");
  });
  it("classifies everything else as done", () => {
    expect(classifySession({ ...base, session: { status: "stopped" } })).toBe("done");
    expect(classifySession(base)).toBe("done");
  });
});

describe("groupSessionsByStatus", () => {
  it("buckets and preserves order", () => {
    const nowMs = Date.parse("2026-07-07T12:00:00.000Z");
    const threads = [
      { id: "a", ...base, hasPendingUserInput: true },
      { id: "b", ...base, session: { status: "running" } },
      { id: "c", ...base },
    ];
    const grouped = groupSessionsByStatus(threads, nowMs);
    expect(grouped.needsYou.map((t) => t.id)).toEqual(["a"]);
    expect(grouped.running.map((t) => t.id)).toEqual(["b"]);
    expect(grouped.done.map((t) => t.id)).toEqual(["c"]);
  });
});
