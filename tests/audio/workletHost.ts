// Runs the synthesis worklet source in node by providing the AudioWorkletGlobalScope pieces it uses.

import { ENGINE_P, P, PARAM_COUNT, STEM_COUNT, type EngineParamName, type SynthParamName } from '../../src/audio/params';
import type { AudioProfile } from '../../src/audio/profile';
import { SYNTH_SOURCE } from '../../src/audio/synthSource';

export const SR = 48000;
export const BLOCK = 128;

interface Processor {
  port: { onmessage: ((e: { data: unknown }) => void) | null };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

let hosts = 0;

export class SynthHost {
  private readonly proc: Processor;
  readonly params = new Float32Array(PARAM_COUNT);

  /** `profile`: sent as the 'config' message a port would deliver (a copy); left out, the worklet's built-in Cessna 172S plays. */
  constructor(profile?: AudioProfile) {
    let ctor: (new () => Processor) | null = null;
    class AudioWorkletProcessor {
      port = { onmessage: null as ((e: { data: unknown }) => void) | null };
    }
    const register = (_name: string, c: new () => Processor): void => {
      ctor = c;
    };
    // Every host compiles a copy of its own (the serial number makes the text unique), as a page has one
    // processor of its own: V8 shares the type feedback of one source text between its instances, and hosts
    // playing different profiles then slow each other down several times over, which no browser ever sees.
    new Function('sampleRate', 'AudioWorkletProcessor', 'registerProcessor', `${SYNTH_SOURCE}\n// host ${++hosts}`)(SR, AudioWorkletProcessor, register);
    if (!ctor) throw new Error('processor not registered');
    this.proc = new (ctor as new () => Processor)();
    if (profile) this.message({ type: 'config', profile: structuredClone(profile) });
  }

  set(values: Partial<Record<SynthParamName, number>>): this {
    for (const [k, v] of Object.entries(values)) this.params[P[k as SynthParamName]] = v as number;
    this.proc.port.onmessage?.({ data: this.params.slice() });
    return this;
  }

  /** Set parameters of one engine's block (engine 0: the same parameters set() takes by these names). */
  setEngine(engine: number, values: Partial<Record<EngineParamName, number>>): this {
    for (const [k, v] of Object.entries(values)) this.params[ENGINE_P[engine][k as EngineParamName]] = v as number;
    this.proc.port.onmessage?.({ data: this.params.slice() });
    return this;
  }

  /** Send a whole parameter block (as AudioSystem does every frame). */
  setBlock(values: Float32Array): this {
    this.params.set(values.subarray(0, PARAM_COUNT));
    this.proc.port.onmessage?.({ data: this.params.slice() });
    return this;
  }

  private readonly blockOut = Array.from({ length: STEM_COUNT }, () => [new Float32Array(BLOCK)]);

  /** Process one 128-sample render quantum; the returned buffers are reused. */
  block(): Float32Array[] {
    this.proc.process([], this.blockOut);
    return this.blockOut.map((o) => o[0]);
  }

  message(data: unknown): void {
    this.proc.port.onmessage?.({ data });
  }

  /** Render `seconds` of audio; returns one Float32Array per stem. */
  render(seconds: number): Float32Array[] {
    const blocks = Math.ceil((seconds * SR) / BLOCK);
    const stems = Array.from({ length: STEM_COUNT }, () => new Float32Array(blocks * BLOCK));
    const outputs = Array.from({ length: STEM_COUNT }, () => [new Float32Array(BLOCK)]);
    for (let b = 0; b < blocks; b++) {
      this.proc.process([], outputs);
      for (let s = 0; s < STEM_COUNT; s++) stems[s].set(outputs[s][0], b * BLOCK);
    }
    return stems;
  }
}

export const rms = (x: Float32Array, from = 0, to = x.length): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};

export const peak = (x: Float32Array): number => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Largest sample-to-sample step in a range: the signature of a click. */
export const maxStep = (x: Float32Array, from = 1, to = x.length): number => {
  let m = 0;
  for (let i = Math.max(1, from); i < to; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
  return m;
};

/** RMS of consecutive windows of `seconds` (the loudness envelope, sampled at 1 / seconds Hz). */
export function envelope(x: Float32Array, seconds: number): Float32Array {
  const n = Math.round(seconds * SR);
  return Float32Array.from({ length: Math.floor(x.length / n) }, (_, w) => rms(x, w * n, (w + 1) * n));
}

/** Magnitude of a single DFT bin at frequency f (Goertzel), normalised by length: a sine of amplitude A reads A / 4. `rate`: samples per second of `x`. */
export function toneMagnitude(x: Float32Array, f: number, rate = SR): number {
  const w = (2 * Math.PI * f) / rate;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    // Hann window to limit leakage between nearby bins.
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1));
    const s0 = x[i] * win + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / x.length;
}
