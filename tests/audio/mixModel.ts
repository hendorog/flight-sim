// Offline model of the AudioSystem mix (src/audio/mix.ts) in node: Web Audio biquads (per the spec's
// formulas), gains, distance attenuation, air absorption and the equal-power panner, so the tests can
// measure what the browser would send to the limiter. The mix is that of a sound profile (default: the
// Cessna 172S), built by the same mixFor() AudioSystem uses.

import { C172S_AUDIO } from '../../src/aircraft/c172s/audio';
import { airAbsorptionCutoff, distanceGain } from '../../src/audio/mapping';
import { mixFor, type BiquadSpec, type StemRoute } from '../../src/audio/mix';
import type { AudioProfile } from '../../src/audio/profile';
import { SR } from './workletHost';

/** Web Audio BiquadFilterNode (Audio EQ Cookbook with the spec's Q conventions). */
export function biquad(x: Float32Array, f: BiquadSpec): Float32Array {
  const w0 = (2 * Math.PI * f.frequency) / SR;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (f.type === 'lowpass' || f.type === 'highpass') {
    const alpha = sin / (2 * Math.pow(10, f.Q / 20)); // Q in dB for these types
    if (f.type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    }
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (f.type === 'peaking') {
    const A = Math.pow(10, (f.gainDb ?? 0) / 40);
    const alpha = sin / (2 * f.Q);
    b0 = 1 + alpha * A;
    b1 = -2 * cos;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cos;
    a2 = 1 - alpha / A;
  } else {
    // Shelves: the Web Audio nodes ignore Q (shelf slope 1).
    const A = Math.pow(10, (f.gainDb ?? 0) / 40);
    const beta = sin * Math.SQRT2 * Math.sqrt(A);
    const low = f.type === 'lowshelf' ? 1 : -1;
    b0 = A * (A + 1 - low * (A - 1) * cos + beta);
    b1 = low * 2 * A * (A - 1 - low * (A + 1) * cos);
    b2 = A * (A + 1 - low * (A - 1) * cos - beta);
    a0 = A + 1 + low * (A - 1) * cos + beta;
    a1 = low * -2 * (A - 1 + low * (A + 1) * cos);
    a2 = A + 1 + low * (A - 1) * cos - beta;
  }
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

function mixRoutes(stems: Float32Array[], routes: StemRoute[]): Float32Array {
  const out = new Float32Array(stems[0].length);
  for (const r of routes) {
    let s = stems[r.stem];
    for (const f of r.filters) s = biquad(s, f);
    for (let i = 0; i < out.length; i++) out[i] += s[i] * r.gain;
  }
  return out;
}

/** What reaches the master (per channel, before volume and limiter) in the cockpit. */
export function interiorMix(stems: Float32Array[], profile: AudioProfile = C172S_AUDIO): Float32Array {
  const mix = mixFor(profile);
  let x = mixRoutes(stems, mix.interiorRoutes);
  for (let i = 0; i < x.length; i++) x[i] *= mix.interiorLevel;
  for (const f of mix.interiorBus) x = biquad(x, f);
  return x;
}

/** What reaches the master (per channel, centre-panned) from outside at `distance` metres. */
export function exteriorMix(stems: Float32Array[], distance: number, profile: AudioProfile = C172S_AUDIO): Float32Array {
  const mix = mixFor(profile);
  let x = mixRoutes(stems, mix.exteriorRoutes);
  x = biquad(x, { type: 'lowpass', frequency: airAbsorptionCutoff(distance), Q: 0.5 });
  const g = mix.exteriorLevel * distanceGain(distance) * Math.SQRT1_2; // equal-power panner at centre
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

export const dbfs = (v: number): number => 20 * Math.log10(Math.max(v, 1e-9));
