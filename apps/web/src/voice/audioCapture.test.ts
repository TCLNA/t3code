import { afterEach, describe, expect, it } from "vite-plus/test";

import { VoiceCaptureController } from "./audioCapture";

/**
 * Regression test for the stop-before-start race: `stop()` fired while the
 * async `start()` is still awaiting getUserMedia/addModule must tear down the
 * resources start() eventually creates, rather than leaking a live
 * AudioContext + worklet that keeps firing utterances.
 */

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const originals = {
  navigator: globalThis.navigator,
  AudioContext: (globalThis as Record<string, unknown>).AudioContext,
  AudioWorkletNode: (globalThis as Record<string, unknown>).AudioWorkletNode,
};

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: originals.navigator,
    configurable: true,
  });
  (globalThis as Record<string, unknown>).AudioContext = originals.AudioContext;
  (globalThis as Record<string, unknown>).AudioWorkletNode = originals.AudioWorkletNode;
});

describe("VoiceCaptureController stop-before-start race", () => {
  it("tears down the context when stop() precedes start() resolution", async () => {
    let trackStopped = false;
    const stream = {
      getTracks: () => [{ stop: () => (trackStopped = true) }],
    };

    const getUserMedia = deferred<typeof stream>();
    Object.defineProperty(globalThis, "navigator", {
      value: { mediaDevices: { getUserMedia: () => getUserMedia.promise } },
      configurable: true,
    });

    let contextClosed = false;
    let contextsCreated = 0;
    class FakeAudioContext {
      state = "running";
      destination = {};
      audioWorklet = { addModule: async () => undefined };
      constructor() {
        contextsCreated += 1;
      }
      createMediaStreamSource() {
        return { connect: () => undefined, disconnect: () => undefined };
      }
      createGain() {
        return { gain: { value: 1 }, connect: () => ({ connect: () => undefined }) };
      }
      async close() {
        contextClosed = true;
      }
    }
    (globalThis as Record<string, unknown>).AudioContext = FakeAudioContext;
    (globalThis as Record<string, unknown>).AudioWorkletNode = class {
      port = { onmessage: null, close: () => undefined };
      connect() {
        return { connect: () => undefined };
      }
      disconnect() {}
    };

    const controller = new VoiceCaptureController({});
    const started = controller.start();

    // stop() arrives before getUserMedia resolves (StrictMode unmount).
    await controller.stop();

    // start() now resolves — it must NOT leave a live context behind.
    getUserMedia.resolve(stream);
    await started;

    expect(contextsCreated).toBe(1);
    expect(contextClosed).toBe(true);
    expect(trackStopped).toBe(true);
  });
});
