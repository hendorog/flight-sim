// The C172S training profile (section 2.1) must agree with the flight model's data (src/core/c172.ts):
// lessons, the copilot and the physics may never disagree about a speed, a flap detent or a limit.

import { describe, expect, it } from 'vitest';
import { C172 } from '../../src/core/c172';
import { DEG } from '../../src/core/math';
import { C172S, flapDegForLever, flapLeverFor, registrationFor } from '../../src/training/aircraft/c172s';
import { DEFAULT_AIRCRAFT, getAircraftType } from '../../src/training/aircraft/registry';
import type { ChecklistId, Pred, VSpeedId } from '../../src/training/types';

/** Every signal id a predicate names (for the checklist checks). */
function signalsOf(p: Pred, out = new Set<string>()): Set<string> {
  if ('sig' in p) out.add(typeof p.sig === 'string' ? p.sig : `var:${p.sig.var}`);
  if ('all' in p) p.all.forEach((q) => signalsOf(q, out));
  if ('any' in p) p.any.forEach((q) => signalsOf(q, out));
  if ('not' in p) signalsOf(p.not, out);
  if ('held' in p) signalsOf(p.held, out);
  if ('ever' in p) signalsOf(p.ever, out);
  return out;
}

describe('C172S profile', () => {
  it('shares every POH value the flight model also holds', () => {
    const shared: [VSpeedId, number][] = [
      ['Vx', C172.poh.vxKias],
      ['Vy', C172.poh.vyKias],
      ['Vglide', C172.poh.bestGlideKias],
      ['VfeFull', C172.poh.vfeKias],
      ['Vno', C172.poh.vnoKias],
      ['Vne', C172.poh.vneKias],
    ];
    for (const [id, v] of shared) expect(C172S.vspeeds[id], id).toBe(v);
    // core/c172.ts gives the stall speeds in KCAS (53 / 48); the POH KIAS figures are lower (position error).
    expect(C172S.vspeeds.Vs1).toBeLessThanOrEqual(C172.poh.stallCleanKcas);
    expect(C172S.vspeeds.Vs0).toBeLessThanOrEqual(C172.poh.stallFullFlapKcas);
  });

  it('has the section 2.1 V-speeds and settings', () => {
    expect(C172S.vspeeds).toMatchObject({
      Vs0: 40, Vs1: 48, Vr: 55, Vx: 62, Vy: 74, Vcc: 85, Vglide: 68, Va: 105, Vfe10: 110, VfeFull: 85, Vno: 129, Vne: 163,
      Vapp: 70, VappFlapsUp: 75, Vref: 65, VshortField: 61, Vcruise: 105, Vslow: 55, VsteepTurn: 95, Vdescent: 90, Vdownwind: 90, Vtaxi: 15,
    });
    expect(Object.keys(C172S.vspeeds)).toHaveLength(22);
    expect(C172S.settings).toMatchObject({
      patternAglFt: 1000, cruiseRpm: 2300, descentRpm: 1900, circuitRpm: 2200, runupRpm: 1800, magDropMaxRpm: 150, magDiffMaxRpm: 50,
      approachFlapLever: 1, takeoffFlapLever: 0, shortFieldFlapLever: 1 / 3, maxDemoCrosswindKt: 15,
    });
    expect(C172S.limits).toEqual({ gPos: 3.8, gNeg: -1.52, maxDemoCrosswindKt: 15 });
  });

  it('maps flap detents to the flight model lever (thirds of travel, 30 degrees full)', () => {
    expect(C172S.flapDetentsDeg).toEqual([0, 10, 20, 30]);
    expect(C172.wing.flap.maxDeflection).toBeCloseTo(30 * DEG, 10);
    for (const d of C172S.flapDetentsDeg) {
      expect(C172S.flapLeverForDeg[d]).toBeCloseTo(d / 30, 12);
      expect(flapLeverFor(C172S, d)).toBeCloseTo(d / 30, 12);
      expect(flapDegForLever(C172S, d / 30)).toBeCloseTo(d, 9);
    }
    expect(flapLeverFor(C172S, 15)).toBeCloseTo(0.5, 12);
    expect(flapLeverFor(C172S, -5)).toBe(0);
    expect(flapLeverFor(C172S, 40)).toBe(1);
  });

  it('carries the section 3.8 default envelope', () => {
    expect(C172S.envelope).toEqual({
      maxBankDeg: 60, maxPitchUpDeg: 25, maxPitchDownDeg: -25, maxKias: 140, maxG: 3.3, minG: 0, minAglFt: 1000,
      lowAndSlow: { aglFt: 300, belowKias: { vspeed: 'Vs1', add: 5 } }, maxSinkFpmBelow200: 1000, stallAllowed: false, runwayExcursionM: 13,
    });
    expect(C172S.envelope.maxKias).toBe(C172S.vspeeds.Vno + 11);
  });

  it('has every named checklist with unique items, and checks only name known signals', () => {
    const ids: ChecklistId[] = ['beforeStart', 'engineStart', 'afterStart', 'runup', 'beforeTakeoff', 'afterTakeoff', 'hasell', 'downwind', 'final',
      'afterLanding', 'shutdown', 'engineFailure', 'forcedLandingSecurity', 'nightLights'];
    const core = new Set(['fuelSel', 'mixture', 'mags', 'fuelPump', 'parkingBrake', 'lightLanding', 'avionics', 'master', 'lightBeacon', 'throttle',
      'engineRunning', 'oilPsi', 'rpm', 'alternator', 'lightNav', 'flapsDeg', 'suctionInHg', 'trim', 'lightStrobe', 'aglFt']);
    for (const id of ids) {
      const list = C172S.checklists[id];
      expect(list, id).toBeDefined();
      expect(list.id).toBe(id);
      expect(list.items.length).toBeGreaterThan(0);
      expect(new Set(list.items.map((i) => i.id)).size, `${id} item ids`).toBe(list.items.length);
      for (const it of list.items) {
        expect(it.challenge.length).toBeGreaterThan(0);
        expect(it.response.length).toBeGreaterThan(0);
        if (it.check) for (const s of signalsOf(it.check)) expect(core.has(s), `${id}.${it.id}: ${s}`).toBe(true);
      }
    }
    // The criticals the spec names: fuel selector and mixture (downwind), flaps for take-off.
    const critical = (id: ChecklistId) => C172S.checklists[id].items.filter((i) => i.critical).map((i) => i.id);
    expect(critical('downwind')).toEqual(expect.arrayContaining(['fuelSelector', 'mixture']));
    expect(critical('beforeTakeoff')).toEqual(expect.arrayContaining(['flaps']));
    // L12 touch drills: exactly fuel BOTH, mixture RICH, mags BOTH, pump ON.
    expect(C172S.checklists.engineFailure.items.map((i) => i.id)).toEqual(['fuelSelector', 'mixture', 'mags', 'fuelPump']);
    expect(C172S.checklists.hasell.items.some((i) => i.lookout)).toBe(true);
  });

  it('is the default registered type, with a registration per authority', () => {
    expect(DEFAULT_AIRCRAFT).toBe('c172s');
    expect(getAircraftType()).toBe(C172S);
    expect(getAircraftType('c172s')).toBe(C172S);
    expect(() => getAircraftType('pa28')).toThrow(/unknown aircraft type/);
    expect(registrationFor('easa')).toBe('G-FSCK');
    expect(registrationFor('faa')).toBe('N172FS');
    expect(C172S.registration).toBe('N172FS');
    // Plain JSON data (resume, export and the linter rely on it).
    expect(JSON.parse(JSON.stringify(C172S))).toEqual(C172S);
  });
});
