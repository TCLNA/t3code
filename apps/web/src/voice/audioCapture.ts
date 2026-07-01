/**
 * Microphone capture for voice mode.
 *
 * Captures mic audio, downsamples to 16 kHz mono Int16 PCM in an AudioWorklet
 * (see `public/voice-worklet.js`), and exposes:
 *   - a smoothed amplitude level for the animated orb,
 *   - a lightweight energy-based voice-activity detector that fires
 *     `onUtteranceEnd` with an encoded 16 kHz mono WAV when the speaker pauses,
 *   - manual finishUtterance() to complete the current utterance.
 *
 * Kept framework-agnostic (no React) so it can be unit-reasoned in isolation.
 */

const TARGET_SAMPLE_RATE = 16000;

export interface VoiceCaptureCallbacks {
  /** Smoothed 0..1 input level, emitted continuously for the orb. */
  readonly onLevel?: (level: number) => void;
  /** Fired when speech is detected to have started (VAD). */
  readonly onSpeechStart?: () => void;
  readonly onUtteranceEnd?: (wav: Uint8Array) => void;
  readonly onError?: (error: unknown) => void;
}

export interface VoiceCaptureOptions {
  /** RMS threshold above which audio counts as speech. */
  readonly speechThreshold?: number;
  /** Silence (ms) after speech before an utterance is considered complete. */
  readonly silenceHangoverMs?: number;
  /** Minimum utterance length (ms) to bother transcribing. */
  readonly minUtteranceMs?: number;
  /** When false, VAD does not auto-finish; caller drives finishUtterance(). */
  readonly autoEndOnSilence?: boolean;
}

interface WorkletMessage {
  readonly pcm: Int16Array;
  readonly rms: number;
}

function encodeWavFromPcm(chunks: Int16Array[], sampleRate: number): Uint8Array {
  let totalSamples = 0;
  for (const chunk of chunks) totalSamples += chunk.length;
  const dataBytes = totalSamples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      view.setInt16(offset, chunk[i]!, true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

export class VoiceCaptureController {
  private context: AudioContext | undefined;
  private stream: MediaStream | undefined;
  private node: AudioWorkletNode | undefined;
  private source: MediaStreamAudioSourceNode | undefined;

  private readonly callbacks: VoiceCaptureCallbacks;
  private readonly speechThreshold: number;
  private readonly silenceHangoverMs: number;
  private readonly minUtteranceMs: number;
  private autoEndOnSilence: boolean;

  private chunks: Int16Array[] = [];
  private speaking = false;
  private smoothedLevel = 0;
  private lastVoiceAt = 0;
  private utteranceStartAt = 0;
  /** Set by stop() so an in-flight start() tears down instead of going live. */
  private disposed = false;

  constructor(callbacks: VoiceCaptureCallbacks, options?: VoiceCaptureOptions) {
    this.callbacks = callbacks;
    this.speechThreshold = options?.speechThreshold ?? 0.02;
    this.silenceHangoverMs = options?.silenceHangoverMs ?? 900;
    this.minUtteranceMs = options?.minUtteranceMs ?? 350;
    this.autoEndOnSilence = options?.autoEndOnSilence ?? false;
  }

  get level(): number {
    return this.smoothedLevel;
  }

  setAutoEndOnSilence(value: boolean): void {
    this.autoEndOnSilence = value;
  }

  async start(): Promise<void> {
    this.disposed = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const context = new AudioContext();
      await context.audioWorklet.addModule("/voice-worklet.js");
      // stop() may have run while we were awaiting above; if so, tear down the
      // resources we just created instead of leaving a live context that keeps
      // firing utterances (and inserting dictated text more than once).
      if (this.disposed) {
        for (const track of stream.getTracks()) track.stop();
        if (context.state !== "closed") await context.close().catch(() => undefined);
        return;
      }
      this.stream = stream;
      this.context = context;
      this.source = context.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(context, "voice-capture-processor");
      this.node.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
        this.handleFrame(event.data);
      };
      this.source.connect(this.node);
      // Keep the worklet pulling by connecting to a muted destination.
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      this.node.connect(silentGain).connect(context.destination);
    } catch (error) {
      this.callbacks.onError?.(error);
      throw error;
    }
  }

  private now(): number {
    return this.context ? this.context.currentTime * 1000 : 0;
  }

  private handleFrame(message: WorkletMessage): void {
    const { pcm, rms } = message;
    this.smoothedLevel = this.smoothedLevel * 0.8 + Math.min(1, rms * 8) * 0.2;
    this.callbacks.onLevel?.(this.smoothedLevel);

    const isVoice = rms >= this.speechThreshold;
    const now = this.now();

    if (isVoice) {
      if (!this.speaking) {
        this.speaking = true;
        this.utteranceStartAt = now;
        this.chunks = [];
        this.callbacks.onSpeechStart?.();
      }
      this.lastVoiceAt = now;
    }

    if (this.speaking) {
      // Copy the frame — the transferred buffer is reused by the worklet.
      this.chunks.push(new Int16Array(pcm));
      if (
        this.autoEndOnSilence &&
        !isVoice &&
        now - this.lastVoiceAt >= this.silenceHangoverMs
      ) {
        this.finishUtterance();
      }
    }
  }

  /** Complete the current utterance (called by the VAD silence path). */
  finishUtterance(): void {
    if (!this.speaking && this.chunks.length === 0) return;
    const durationMs = this.now() - this.utteranceStartAt;
    const chunks = this.chunks;
    this.chunks = [];
    this.speaking = false;
    if (chunks.length === 0 || durationMs < this.minUtteranceMs) return;
    const wav = encodeWavFromPcm(chunks, TARGET_SAMPLE_RATE);
    this.callbacks.onUtteranceEnd?.(wav);
  }

  async stop(): Promise<void> {
    this.disposed = true;
    this.node?.port.close();
    this.node?.disconnect();
    this.source?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    if (this.context && this.context.state !== "closed") {
      await this.context.close().catch(() => undefined);
    }
    this.node = undefined;
    this.source = undefined;
    this.stream = undefined;
    this.context = undefined;
    this.chunks = [];
    this.speaking = false;
    this.smoothedLevel = 0;
  }
}
