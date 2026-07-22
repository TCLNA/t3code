import { describe, expect, it } from "vite-plus/test";

import { resolveNotificationBeep } from "./notificationBeeps";

describe("resolveNotificationBeep", () => {
  it("beeps done on Working -> Completed in notify mode", () => {
    expect(resolveNotificationBeep("Working", "Completed", "notify")).toBe("done");
  });

  it("suppresses done beep in all mode (TTS narrates)", () => {
    expect(resolveNotificationBeep("Working", "Completed", "all")).toBeNull();
  });

  it("beeps needs-input on Working -> input labels in all and notify", () => {
    for (const label of ["Awaiting Input", "Pending Approval", "Plan Ready"] as const) {
      expect(resolveNotificationBeep("Working", label, "all")).toBe("needs-input");
      expect(resolveNotificationBeep("Working", label, "notify")).toBe("needs-input");
    }
  });

  it("never beeps in none mode", () => {
    expect(resolveNotificationBeep("Working", "Completed", "none")).toBeNull();
    expect(resolveNotificationBeep("Working", "Awaiting Input", "none")).toBeNull();
  });

  it("only fires on a Working -> settled edge", () => {
    expect(resolveNotificationBeep("Completed", "Awaiting Input", "notify")).toBeNull();
    expect(resolveNotificationBeep(null, "Completed", "notify")).toBeNull();
    expect(resolveNotificationBeep("Working", "Working", "notify")).toBeNull();
  });

  it("returns null for non-beep next labels", () => {
    expect(resolveNotificationBeep("Working", "Connecting", "notify")).toBeNull();
    expect(resolveNotificationBeep("Working", null, "notify")).toBeNull();
  });
});
