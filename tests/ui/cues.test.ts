// The type-dependent cues without a DOM: switch toasts from a UiProfile (the C172S's identical to the legacy
// switchChanges), starter advice per engine, the speed-tape bands, the gear chip, the overspeed rules, the
// carburettor-heat chip and the engine-selection mark; and the C172S's own numbers now that ui.ts holds them.

import { describe, expect, it } from 'vitest';
import C172S_DEFINITION from '../../src/aircraft/c172s/index';
import { C172S_REFERENCE } from '../../src/aircraft/c172s/reference';
import { C172S_LIMITS } from '../../src/aircraft/c172s/systems';
import { C172S_UI } from '../../src/aircraft/c172s/ui';
import { C172 } from '../../src/core/c172';
import { DEG, KT } from '../../src/core/math';
import { defaultControls, fixedGearState, setEngineControl, type ControlInputs, type GearState, type MagnetoPosition } from '../../src/core/types';
import { IDLE_CUTOFF } from '../../src/physics/propulsion/combustion';
import { mixtureLabel, starterAdvice, switchChanges, switchMessages, switchReads, switchSnapshot } from '../../src/ui/cues';
import {
  BAND_GREEN,
  BAND_RED,
  BAND_WHITE,
  BAND_YELLOW,
  carbHeatOn,
  engineSelectionLabel,
  flapLimitCas,
  gearCue,
  gearLimitCas,
  LINE_BLUE,
  OverspeedTimer,
  speedBands,
  speedLines,
} from '../../src/ui/hudCues';
import { TWIN_TESTBED_UI, twinTestbedDefinition } from '../../src/ui/testbed';

/** A small deterministic generator, so the random walks below are the same on every run. */
function lcg(seed: number): () => number {
  let x = seed;
  return () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

describe('the C172S profile after the inversion', () => {
  it('cuts the mixture off where the engine does', () => {
    const c = defaultControls();
    c.mixture = IDLE_CUTOFF - 1e-9;
    expect(C172S_UI.starterAdvice(c, 0)).toMatch(/IDLE CUT-OFF/);
    c.mixture = IDLE_CUTOFF;
    expect(C172S_UI.starterAdvice(c, 0)).toMatch(/too lean/);
    expect(starterAdvice(c)).toBe(C172S_UI.starterAdvice(c, 0));
    expect(mixtureLabel(IDLE_CUTOFF)).toBe('Mixture 2%');
  });

  it('announces through the profile exactly what switchChanges announced', () => {
    const rnd = lcg(7);
    const flip = (c: ControlInputs): void => {
      const k = Math.floor(rnd() * 12);
      if (k === 0) c.masterBattery = !c.masterBattery;
      else if (k === 1) c.alternator = !c.alternator;
      else if (k === 2) c.avionics = !c.avionics;
      else if (k === 3) c.magnetos = Math.floor(rnd() * 4) as MagnetoPosition;
      else if (k === 4) c.fuelPump = !c.fuelPump;
      else if (k === 5) c.fuelSelector = (['off', 'left', 'right', 'both'] as const)[Math.floor(rnd() * 4)];
      else if (k === 6) c.pitotHeat = !c.pitotHeat;
      else {
        const l = (['nav', 'beacon', 'strobe', 'landing', 'taxi'] as const)[k - 7];
        c.lights[l] = !c.lights[l];
      }
    };
    let prev = defaultControls();
    for (let i = 0; i < 2000; i++) {
      const cur = structuredClone(prev);
      const n = 1 + Math.floor(rnd() * 3);
      for (let j = 0; j < n; j++) flip(cur);
      const legacy = switchChanges(switchSnapshot(prev), switchSnapshot(cur));
      expect(switchMessages(C172S_UI, switchReads(C172S_UI, prev), switchReads(C172S_UI, cur))).toEqual(legacy);
      prev = cur;
    }
  });

  it('merges the master halves and names the half that changed alone', () => {
    const a = defaultControls();
    a.masterBattery = a.alternator = true;
    const b = structuredClone(a);
    b.alternator = false;
    expect(switchMessages(C172S_UI, switchReads(C172S_UI, a), switchReads(C172S_UI, b))).toEqual(['Alternator OFF']);
    b.masterBattery = false;
    expect(switchMessages(C172S_UI, switchReads(C172S_UI, a), switchReads(C172S_UI, b))).toEqual(['Master switch OFF']);
  });

  it('reuses the read-out buffer it is given', () => {
    const out: string[] = [];
    expect(switchReads(C172S_UI, defaultControls(), out)).toBe(out);
    expect(out).toHaveLength(C172S_UI.switches.length);
  });
});

describe('a twin profile', () => {
  it('announces each engine\'s own switch, and advises on the engine that is cranked', () => {
    const def = twinTestbedDefinition(C172S_DEFINITION);
    const a = defaultControls(def);
    const b = defaultControls(def);
    setEngineControl(b, 1, 'magnetos', 0);
    setEngineControl(b, 0, 'fuelPump', !a.fuelPump);
    expect(switchMessages(TWIN_TESTBED_UI, switchReads(TWIN_TESTBED_UI, a), switchReads(TWIN_TESTBED_UI, b))).toEqual([
      'Right magnetos 0',
      `Left fuel pump ${a.fuelPump ? 'OFF' : 'ON'}`,
    ]);
    setEngineControl(b, 1, 'fuelSelector', 'off');
    expect(TWIN_TESTBED_UI.starterAdvice(b, 0)).toBeNull();
    expect(TWIN_TESTBED_UI.starterAdvice(b, 1)).toMatch(/R fuel selector is OFF/);
  });
});

describe('speed tape', () => {
  it('draws the C172S arcs at the numbers it always had', () => {
    expect(speedBands(C172S_REFERENCE)).toEqual([
      { from: 48, to: C172.poh.vnoKias, color: BAND_GREEN },
      { from: C172.poh.vnoKias, to: C172.poh.vneKias, color: BAND_YELLOW },
      { from: C172.poh.vneKias, to: 400, color: BAND_RED },
      { from: 40, to: C172.poh.vfeKias, color: BAND_WHITE, inner: true },
    ]);
    expect(speedLines(C172S_REFERENCE)).toEqual([]);
  });

  it('marks a twin\'s blue line and red radial', () => {
    expect(speedLines({ ...C172S_REFERENCE, vyse: 88, vmca: 66 })).toEqual([
      { kias: 88, color: LINE_BLUE },
      { kias: 66, color: BAND_RED },
    ]);
  });
});

describe('gear chip', () => {
  const g = (o: Partial<GearState>): GearState => ({ ...fixedGearState(), retractable: true, ...o });

  it('three greens, in transit, unsafe, and nothing on fixed gear or with the gear up', () => {
    expect(gearCue(fixedGearState())).toBeNull();
    expect(gearCue(undefined)).toBeNull();
    expect(gearCue(g({}))).toEqual({ text: 'GEAR ● ● ●', level: 'ok' });
    expect(gearCue(g({ lever: 'up', extension: [0.4, 0.5, 0.5], locked: [false, false, false], inTransit: true }))).toEqual({ text: 'GEAR IN TRANSIT', level: 'warn' });
    expect(gearCue(g({ lever: 'up', extension: [0, 0, 0], locked: [false, false, false] }))).toBeNull();
    expect(gearCue(g({ lever: 'up', extension: [0, 0, 0], locked: [false, false, false], warning: true }))?.level).toBe('alert');
    // Lever down, nothing moving, a leg not locked: unsafe.
    expect(gearCue(g({ extension: [1, 0.97, 1], locked: [true, false, true] }))).toEqual({ text: 'GEAR UNSAFE', level: 'alert' });
  });
});

describe('overspeed', () => {
  const twin = twinTestbedDefinition(C172S_DEFINITION);
  const detents = C172S_DEFINITION.controls.flaps.detents;

  it('holds the flaps to the limit of the first detent at or beyond them', () => {
    expect(flapLimitCas(C172S_LIMITS, detents, 0)).toBe(Infinity);
    expect(flapLimitCas(C172S_LIMITS, detents, detents[1])).toBe(110 * KT);
    expect(flapLimitCas(C172S_LIMITS, detents, (detents[1] + detents[2]) / 2)).toBe(85 * KT);
    expect(flapLimitCas(C172S_LIMITS, detents, detents[3] + 0.2 * DEG)).toBe(85 * KT);
  });

  it('applies Vle down, Vlo extend or retract while the gear moves, nothing when up or fixed', () => {
    const down: GearState = { ...fixedGearState(), retractable: true };
    expect(gearLimitCas(twin.limits, fixedGearState())).toBe(Infinity);
    expect(gearLimitCas(twin.limits, down)).toBe(130 * KT);
    expect(gearLimitCas(twin.limits, { ...down, lever: 'up', inTransit: true })).toBe(110 * KT);
    expect(gearLimitCas(twin.limits, { ...down, lever: 'down', inTransit: true })).toBe(130 * KT);
    expect(gearLimitCas(twin.limits, { ...down, lever: 'up', extension: [0, 0, 0] })).toBe(Infinity);
  });

  it('warns only beyond the margin for longer than the time, and never under the rule "none"', () => {
    const t = new OverspeedTimer({ consequence: 'warn', margin: 0.05, time: 1 });
    expect(t.step(5, 104.9, 100)).toBe(false);
    expect(t.step(0.6, 106, 100)).toBe(false);
    expect(t.step(0.6, 106, 100)).toBe(true);
    expect(t.step(0.01, 104, 100)).toBe(false);
    expect(t.step(0.6, 106, 100)).toBe(false);
    const none = new OverspeedTimer(C172S_LIMITS.flapOverspeed);
    for (let i = 0; i < 100; i++) expect(none.step(1, 1000, 1)).toBe(false);
  });
});

describe('carburettor heat and engine selection', () => {
  it('reads carburettor heat on any engine', () => {
    const c = defaultControls(twinTestbedDefinition(C172S_DEFINITION));
    expect(carbHeatOn(c, 2)).toBe(false);
    setEngineControl(c, 1, 'carbHeat', 1);
    expect(carbHeatOn(c, 2)).toBe(true);
    expect(carbHeatOn(c, 1)).toBe(false);
  });

  it('marks L, R or BOTH', () => {
    expect([0, 1, 'all', undefined].map((s) => engineSelectionLabel(s as 'all' | 0 | 1 | undefined))).toEqual(['L', 'R', 'BOTH', 'BOTH']);
  });
});
