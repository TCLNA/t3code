import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_CLIENT_SETTINGS } from "./settings.ts";

describe("simplifiedMobileView client setting", () => {
  it("defaults to false", () => {
    expect(DEFAULT_CLIENT_SETTINGS.simplifiedMobileView).toBe(false);
  });
});
