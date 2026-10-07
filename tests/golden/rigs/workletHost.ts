// FROZEN rig of the golden tests (see README.md). Copied from tests/audio/workletHost.ts of the untouched
// tree. It sends the worklet nothing but parameter blocks (no configuration message): the synthesiser's
// default configuration must stay the Cessna 172S, sample for sample (contract 3.8).
//
// Runs the synthesis worklet source in node by providing the AudioWorkletGlobalScope pieces it uses.

import { P, PARAM_COUNT, STEM_COUNT, type SynthParamName } from '../../../src/audio/params';
import { SYNTH_SOURCE } from '../../../src/audio/synthSource';

export const SR = 48000;
export const BLOCK = 128;

interface Processor {
  port: { onmessage: ((e: { data: unknown }) => void) | null };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

export class SynthHost {
  private readonly proc: Processor;
  readonly params = new Float32Array(PARAM_COUNT);

  constructor() {
    let ctor: (new () => Processor) | null = null;
    class AudioWorkletProcessor {
      port = { onmessage: null as ((e: { data: unknown }) => void) | null };
    }
    const register = (_name: string, c: new () => Processor): void => {
      ctor = c;
    };
    new Function('sampleRate', 'AudioWorkletProcessor', 'registerProcessor', SYNTH_SOURCE)(SR, AudioWorkletProcessor, register);
    if (!ctor) throw new Error('processor not registered');
    this.proc = new (ctor as new () => Processor)();
  }

  set(values: Partial<Record<SynthParamName, number>>): this {
    for (const [k, v] of Object.entries(values)) this.params[P[k as SynthParamName]] = v as number;
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
