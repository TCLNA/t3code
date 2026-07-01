/**
 * Ordered text-to-speech playback queue.
 *
 * Sentence units are enqueued by monotonic index and synthesized concurrently,
 * but always PLAYED in index order (early-arriving later units wait). While a
 * unit plays, an AnalyserNode feeds a smoothed amplitude to `onLevel` so the
 * orb reacts to the voice. `stop()` aborts in-flight synthesis and playback —
 * used for mute and barge-in.
 */
import { synthesizeSpeech } from "./ttsClient";

export interface TtsPlaybackCallbacks {
  readonly onLevel?: (level: number) => void;
  readonly onPlayingChange?: (playing: boolean) => void;
  readonly onError?: (error: unknown) => void;
  readonly getVoice?: () => string | undefined;
}

interface PendingUnit {
  readonly promise: Promise<ArrayBuffer | null>;
  readonly abort: AbortController;
}

export class TtsPlaybackController {
  private context: AudioContext | undefined;
  private analyser: AnalyserNode | undefined;
  private currentSource: AudioBufferSourceNode | undefined;
  /** Resolves the in-flight playBuffer await so stop() can never wedge the pump. */
  private endCurrentPlayback: (() => void) | undefined;
  private levelRaf = 0;

  private readonly units = new Map<number, PendingUnit>();
  private playCursor = 0;
  private enqueueCursor = 0;
  private pumping = false;
  private stopped = false;

  constructor(private readonly callbacks: TtsPlaybackCallbacks) {}

  /** Next index to assign — lets callers enqueue in stream order. */
  nextIndex(): number {
    const index = this.enqueueCursor;
    this.enqueueCursor += 1;
    return index;
  }

  enqueue(index: number, text: string): void {
    if (this.stopped) return;
    const abort = new AbortController();
    const promise = synthesizeSpeech(text, {
      ...(this.callbacks.getVoice?.() ? { voice: this.callbacks.getVoice()! } : {}),
      signal: abort.signal,
    })
      .catch((error) => {
        if (!abort.signal.aborted) this.callbacks.onError?.(error);
        return null;
      });
    this.units.set(index, { promise, abort });
    void this.pump();
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.connect(this.context.destination);
    }
    return this.context;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (!this.stopped) {
        const unit = this.units.get(this.playCursor);
        if (!unit) break;
        const bytes = await unit.promise;
        this.units.delete(this.playCursor);
        this.playCursor += 1;
        if (this.stopped || !bytes || bytes.byteLength === 0) continue;
        await this.playBuffer(bytes);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async playBuffer(bytes: ArrayBuffer): Promise<void> {
    const context = this.ensureContext();
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await context.decodeAudioData(bytes.slice(0));
    } catch (error) {
      this.callbacks.onError?.(error);
      return;
    }
    if (this.stopped) return;

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    if (this.analyser) source.connect(this.analyser);
    this.currentSource = source;
    this.callbacks.onPlayingChange?.(true);
    this.startLevelLoop();

    await new Promise<void>((resolve) => {
      this.endCurrentPlayback = resolve;
      source.onended = () => resolve();
      source.start();
    });
    this.endCurrentPlayback = undefined;

    this.currentSource = undefined;
    if (this.units.size === 0 || this.stopped) {
      this.stopLevelLoop();
      this.callbacks.onPlayingChange?.(false);
    }
  }

  private startLevelLoop(): void {
    if (!this.analyser || this.levelRaf) return;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i]! - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      this.callbacks.onLevel?.(Math.min(1, rms * 3));
      this.levelRaf = requestAnimationFrame(tick);
    };
    this.levelRaf = requestAnimationFrame(tick);
  }

  private stopLevelLoop(): void {
    if (this.levelRaf) cancelAnimationFrame(this.levelRaf);
    this.levelRaf = 0;
    this.callbacks.onLevel?.(0);
  }

  /** Abort all synthesis + playback and reset (mute / barge-in / close). */
  stop(): void {
    this.stopped = true;
    for (const unit of this.units.values()) unit.abort.abort();
    this.units.clear();
    if (this.currentSource) {
      try {
        this.currentSource.onended = null;
        this.currentSource.stop();
      } catch {
        // already stopped
      }
      this.currentSource = undefined;
    }
    // Release any pump awaiting the (now-cancelled) source so it doesn't hang.
    this.endCurrentPlayback?.();
    this.endCurrentPlayback = undefined;
    this.stopLevelLoop();
    this.callbacks.onPlayingChange?.(false);
    this.playCursor = 0;
    this.enqueueCursor = 0;
    this.stopped = false;
  }

  async dispose(): Promise<void> {
    this.stop();
    if (this.context && this.context.state !== "closed") {
      await this.context.close().catch(() => undefined);
    }
    this.context = undefined;
    this.analyser = undefined;
  }
}
