// The radios' tuning (src/instruments/dynamics/radios.ts): COM1 tuning and swapping, the airband raster, the stations
// a frequency reaches, and the resume snapshot keeping COM1.

import { afterAll, describe, expect, it } from 'vitest';
import {
  com1Changed, DEFAULT_TUNING, HOME_GROUND, radioRevision, radioTuning, resetRadios, setCom1, stationOn, swapCom1, tuneCom1, validCom,
} from '../../src/instruments/dynamics/radios';
import { generatedAirfields, HOME_AIRFIELD } from '../../src/world/airfields';
import { setWorldSeed } from '../../src/world/worldSeed';
import { setEra } from '../../src/world/era/eraState';
import { defaultWeather } from '../../src/core/types';
import { parseSnapshot } from '../../src/sim/resume';
import { SimPhysics } from '../../src/sim/SimPhysics';
// The generated airfields are sited when the terrain module loads.
import '../../src/world/terrain/heightfield';

afterAll(() => resetRadios());

describe('radio tuning', () => {
  setEra('present');
  setWorldSeed(0);

  it('tunes COM1 like a flip-flop radio and bumps the revision', () => {
    resetRadios();
    const r0 = radioRevision();
    tuneCom1(122.7);
    expect(radioTuning().com1).toEqual([122.7, DEFAULT_TUNING.com1[0]]);
    expect(radioRevision()).toBeGreaterThan(r0);
    swapCom1();
    expect(radioTuning().com1).toEqual([DEFAULT_TUNING.com1[0], 122.7]);
    expect(com1Changed()).toBe(true);
    resetRadios();
    expect(com1Changed()).toBe(false);
  });

  it('keeps to the 25 kHz airband raster', () => {
    expect(validCom(122.7251)).toBe(122.725);
    expect(validCom(117.9)).toBeNull();
    expect(validCom(137)).toBeNull();
    resetRadios();
    tuneCom1(108.0);
    expect(com1Changed()).toBe(false);
    setCom1([999, 122.7]);
    expect(radioTuning().com1).toEqual([DEFAULT_TUNING.com1[0], 122.7]);
  });

  it('reaches the home tower and ground, and the nearest generated field on a shared frequency', () => {
    expect(stationOn(HOME_AIRFIELD.frequency, 0, 0)).toMatchObject({ kind: 'tower', field: { code: HOME_AIRFIELD.code } });
    expect(stationOn(HOME_GROUND, 0, 0)?.kind).toBe('ground');
    expect(stationOn(130.0, 0, 0)).toBeNull();
    for (const f of generatedAirfields()) {
      const s = stationOn(f.frequency, f.north, f.east);
      expect(s?.kind).toBe('traffic');
      expect(s?.field.code).toBe(f.code);
    }
  });

  it('a restored flight gets its COM1 back; a snapshot without one resets the radio', () => {
    const w = defaultWeather();
    const p = new SimPhysics({ weather: w });
    p.reset('cruise');
    const snap = p.captureSnapshot({ weather: w, cameraMode: 'chase', quality: 'high', renderScale: null, resume: true, now: 1_800_000_000_000 });
    const back = parseSnapshot(JSON.stringify({ ...snap, com1: [122.725, 118.3] }));
    expect(back?.com1).toEqual([122.725, 118.3]);
    resetRadios();
    p.restore(back!);
    expect(radioTuning().com1).toEqual([122.725, 118.3]);
    p.restore(snap);
    expect(com1Changed()).toBe(false);
    expect(parseSnapshot(JSON.stringify({ ...snap, com1: ['x', 1] }))).toBeNull();
  });
});
