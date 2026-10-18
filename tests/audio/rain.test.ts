// The precipitation voice of the worklet (aircraftSynth.js rainSound, parameter 'rain'): silent and without effect
// on any other sample at 0, audible on the airframe stem only, louder with the level.

import { describe, expect, it } from 'vitest';
import { PC12_AUDIO } from '../../src/aircraft/pc12/audio';
import { STEM } from '../../src/audio/params';
import { rms, SynthHost } from './workletHost';

const cruise = { rpm: 2400, firing: 1, load: 0.8, throttle: 0.8, propLoad: 1, tipMach: 0.76, windLevel: 1, windFreq: 700, gyro: 1, fan: 1 };

/** Samples of the stems `a` that are not the same number in `b`. */
function differing(a: Float32Array[], b: Float32Array[]): number {
  let n = 0;
  for (let s = 0; s < a.length; s++) for (let i = 0; i < a[s].length; i++) if (!Object.is(a[s][i], b[s][i])) n++;
  return n;
}

describe('precipitation voice', () => {
  it('rain 0 sent explicitly plays sample for sample as a host that never sends it', () => {
    const a = new SynthHost().set(cruise).render(1);
    const b = new SynthHost().set({ ...cruise, rain: 0 }).render(1);
    expect(differing(a, b)).toBe(0);
  });

  it('a type with appended voices (PC-12) is unchanged by rain 0', () => {
    const a = new SynthHost(PC12_AUDIO).set(cruise).render(0.5);
    const b = new SynthHost(PC12_AUDIO).set({ ...cruise, rain: 0 }).render(0.5);
    expect(differing(a, b)).toBe(0);
  });

  it('rain is heard on the airframe stem only and grows with the level', () => {
    const quiet = { rpm: 0, firing: 0 };
    const dry = new SynthHost().set(quiet).render(1);
    const light = new SynthHost().set({ ...quiet, rain: 0.2 }).render(1);
    const heavy = new SynthHost().set({ ...quiet, rain: 1 }).render(1);
    expect(rms(dry[STEM.airframe])).toBe(0);
    const lightRms = rms(light[STEM.airframe], 4800);
    const heavyRms = rms(heavy[STEM.airframe], 4800);
    expect(lightRms).toBeGreaterThan(1e-3);
    expect(heavyRms).toBeGreaterThan(3 * lightRms);
    // The other stems do not hear it.
    for (const s of [STEM.engine, STEM.prop, STEM.cabin]) expect(differing([dry[s]], [heavy[s]])).toBe(0);
  });

  it('heavy rain stays below the wind noise of a 97 kt cruise on the airframe stem', () => {
    const wind = new SynthHost().set({ windLevel: 1, windFreq: 700 }).render(1);
    const rain = new SynthHost().set({ rain: 1 }).render(1);
    const w = rms(wind[STEM.airframe], 4800);
    const r = rms(rain[STEM.airframe], 4800);
    expect(r).toBeLessThan(0.85 * w);
    expect(r).toBeGreaterThan(0.2 * w);
  });

  it('rain that stops fades out within a second and leaves the airframe stem silent', () => {
    const host = new SynthHost().set({ rain: 1 });
    host.render(0.5);
    host.set({ rain: 0 });
    const out = host.render(1);
    expect(rms(out[STEM.airframe], 24000)).toBe(0);
  });
});
