import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ServerSettings, DEFAULT_SERVER_SETTINGS } from "./settings.ts";

describe("PredictionSettings", () => {
  it("defaults prediction to disabled with a model selection", () => {
    expect(DEFAULT_SERVER_SETTINGS.prediction.enabled).toBe(false);
    expect(DEFAULT_SERVER_SETTINGS.prediction.model.instanceId).toBeTruthy();
    expect(typeof DEFAULT_SERVER_SETTINGS.prediction.model.model).toBe("string");
  });

  it("decodes an explicit enabled flag", () => {
    const decoded = Schema.decodeSync(ServerSettings)({ prediction: { enabled: true } });
    expect(decoded.prediction.enabled).toBe(true);
  });
});
