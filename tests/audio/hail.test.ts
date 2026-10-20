// The hail voice of the worklet (aircraftSynth.js hailSound, parameters 'hail' and 'hailSize'): silent and without
// effect on any other sample at 0, on the airframe stem only, louder than rain, louder with the level and the size.

import { describe, expect, it } from 'vitest';
import { STEM } from '../../src/audio/params';
import { rms, SynthHost } from './workletHost';

const cruise = { rpm: 2400, firing: 1, load: 0.8, throttle: 0.8, propLoad: 1, tipMach: 0.76, windLevel: 1, windFreq: 700, gyro: 1, fan: 1 };

function differing(a: Float32Array[], b: Float32Array[]): number {
  let n = 0;
  for (let s = 0; s < a.length; s++) for (let i = 0; i < a[s].length; i++) if (!Object.is(a[s][i], b[s][i])) n++;
  return n;
}

describe('hail voice', () => {
  it('hail 0 sent explicitly plays sample for sample as a host that never sends it', () => {
    const a = new SynthHost().set(cruise).render(1);
    const b = new SynthHost().set({ ...cruise, hail: 0, hailSize: 30 }).render(1);
    expect(differing(a, b)).toBe(0);
  });

  it('is heard on the airframe stem only, louder and harsher than rain at the same level, and grows with level and size', () => {
    const quiet = { rpm: 0, firing: 0 };
    const dry = new SynthHost().set(quiet).render(1);
    const rain = new SynthHost().set({ ...quiet, rain: 0.6 }).render(1);
    const small = new SynthHost().set({ ...quiet, hail: 0.6, hailSize: 8 }).render(1);
    const large = new SynthHost().set({ ...quiet, hail: 0.6, hailSize: 45 }).render(1);
    const light = new SynthHost().set({ ...quiet, hail: 0.15, hailSize: 45 }).render(1);
    const r = (o: Float32Array[]) => rms(o[STEM.airframe], 4800);
    console.log(`[hail] airframe rms: rain0.6=${r(rain).toPrecision(3)} hail0.6/8mm=${r(small).toPrecision(3)} hail0.6/45mm=${r(large).toPrecision(3)} hail0.15/45mm=${r(light).toPrecision(3)}`);
    expect(rms(dry[STEM.airframe])).toBe(0);
    expect(r(small)).toBeGreaterThan(r(rain));
    expect(r(large)).toBeGreaterThan(r(small));
    expect(r(large)).toBeGreaterThan(r(light));
    for (const s of [STEM.engine, STEM.prop, STEM.cabin]) expect(differing([dry[s]], [large[s]])).toBe(0);
  });

  it('fades to silence within a second once the hail stops', () => {
    const host = new SynthHost().set({ hail: 1, hailSize: 30 });
    host.render(0.5);
    host.set({ hail: 0 });
    const out = host.render(1);
    expect(rms(out[STEM.airframe], 24000)).toBe(0);
  });
});
