// Job completion (src/career/runtime/completion.ts, COMPLETION_RULES) on synthetic frames at the seed-0 fields:
// nothing is decided before the job has flown and landed (a shutdown at the origin, brake set, for a minute does
// nothing); an aeroplane completes 3 s after the parking brake is set with the engines off, or after 12 s without
// it, with the brake hint from 5 s; a helicopter completes after 3 s with no brake; the destination's apron counts
// even beyond the across limit (home); another field stops the job there; 10 s shut down at no field is an
// outlanding; a site leg completes after 30 s on the ground within 60 m; moving or an engine running resets the
// count; one 0.25 s frame and twenty 0.0125 s frames decide at the same time; the state round-trips.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fieldStand } from '../../src/career/geo';
import { CompletionTracker, type CompletionDecision, type CompletionInput } from '../../src/career/runtime/completion';
import { setGpsTarget } from '../../src/instruments/dynamics/navigation';
import { setStartField } from '../../src/sim/startField';
import { airfields, fieldPoint, HOME_AIRFIELD, type Airfield } from '../../src/world/airfields';
import { PARKING } from '../../src/world/airport/layout';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

let FIELDS: readonly Airfield[] = [];
let DEST: Airfield;
let OTHER: Airfield;

beforeAll(() => {
  setEra('present');
  setWorldSeed(0);
  FIELDS = airfields();
  DEST = FIELDS.find((f) => f.kind === 'sealed')!;
  OTHER = FIELDS.find((f) => f.kind === 'grass')!;
});
afterAll(() => {
  setStartField(null);
  setGpsTarget(null);
  setWorldSeed(0);
});

/** A landed, shut-down, stopped aeroplane at a point. */
function landed(p: { north: number; east: number }, over: Partial<CompletionInput> = {}): CompletionInput {
  return { phase: 'landed', everAirborne: true, onGround: true, gsMs: 0, enginesStopped: true, parkingBrake: false, helicopter: false, north: p.north, east: p.east, ...over };
}

/** Run frames of `dt` for `seconds`; returns the first decision and the time it came (s), or null. */
function run(t: CompletionTracker, x: CompletionInput, seconds: number, dt = 0.25): { d: CompletionDecision; at: number } | null {
  const n = Math.round(seconds / dt);
  for (let i = 1; i <= n; i++) {
    const d = t.update(x, dt);
    if (d) return { d, at: i * dt };
  }
  return null;
}

const toDest = (): CompletionTracker => new CompletionTracker({ kind: 'field', code: DEST.code }, FIELDS);

describe('completion', () => {
  it('decides nothing before the job has flown, however long it stands shut down with the brake set', () => {
    const stand = fieldStand(DEST);
    expect(run(toDest(), landed(stand, { everAirborne: false, phase: 'ground', parkingBrake: true }), 60)).toBeNull();
    expect(run(toDest(), landed(stand, { everAirborne: false, phase: 'dispatched', parkingBrake: true }), 60)).toBeNull();
    // Flown but not yet landed (the phase machine's call): nothing either.
    expect(run(toDest(), landed(stand, { phase: 'airborne', parkingBrake: true }), 60)).toBeNull();
  });

  it('completes 3 s after the parking brake is set with the engines off', () => {
    const r = run(toDest(), landed(fieldStand(DEST), { parkingBrake: true }), 30);
    expect(r?.at).toBe(3);
    expect(r?.d).toEqual({ kind: 'completed', field: DEST.code, area: 'apron' });
  });

  it('completes after 12 s without the brake, asking for it from 5 s', () => {
    const t = toDest();
    const x = landed(fieldStand(DEST));
    expect(run(t, x, 4.75)).toBeNull();
    expect(t.brakeHint(x)).toBe(false);
    expect(run(t, x, 0.25)).toBeNull();
    expect(t.brakeHint(x)).toBe(true);
    const r = run(t, x, 30);
    expect(r?.at).toBe(7);
    expect(r?.d.kind).toBe('completed');
    expect(t.brakeHint({ ...x, parkingBrake: true })).toBe(false);
  });

  it('completes a helicopter after 3 s with no brake', () => {
    const r = run(toDest(), landed(fieldStand(DEST), { helicopter: true }), 30);
    expect(r?.at).toBe(3);
    expect(r?.d.kind).toBe('completed');
  });

  it('reports the area: stopped on the runway still completes', () => {
    const r = run(toDest(), landed({ north: DEST.north, east: DEST.east }, { parkingBrake: true }), 30);
    expect(r?.d).toEqual({ kind: 'completed', field: DEST.code, area: 'runway' });
    const grass = run(toDest(), landed(fieldPoint(DEST, DEST.length / 2 + 150, 0), { parkingBrake: true }), 30);
    expect(grass?.d).toEqual({ kind: 'completed', field: DEST.code, area: 'inside' });
  });

  it('completes on the home apron, beyond the across limit, at the PARKING stand', () => {
    const t = new CompletionTracker({ kind: 'field', code: HOME_AIRFIELD.code }, FIELDS);
    expect(run(t, landed(PARKING, { parkingBrake: true }), 30)?.d).toEqual({ kind: 'completed', field: HOME_AIRFIELD.code, area: 'apron' });
  });

  it('stops the job at another field', () => {
    const r = run(toDest(), landed(fieldStand(OTHER), { parkingBrake: true }), 30);
    expect(r?.d).toEqual({ kind: 'stopped', field: OTHER.code, area: 'apron' });
  });

  it('outlands after 10 s shut down at no field, brake or not', () => {
    const p = fieldPoint(DEST, 0, 3000);
    const r = run(toDest(), landed(p, { parkingBrake: true }), 30);
    expect(r).toEqual({ d: { kind: 'outlanded' }, at: 10 });
  });

  it('completes a site leg after 30 s on the ground within 60 m, engine running', () => {
    const site = fieldPoint(DEST, 0, 3000);
    const t = new CompletionTracker({ kind: 'site', id: 's1', name: 'Hilltop', north: site.north, east: site.east, elevation: 300 }, FIELDS);
    const r = run(t, landed({ north: site.north + 40, east: site.east }, { helicopter: true, enginesStopped: false }), 60);
    expect(r).toEqual({ d: { kind: 'completed', field: null, area: 'site' }, at: 30 });
  });

  it('starts the count again when the aircraft moves or an engine runs', () => {
    const t = toDest();
    const x = landed(fieldStand(DEST), { parkingBrake: true });
    expect(run(t, x, 2.5)).toBeNull();
    expect(run(t, { ...x, gsMs: 1 }, 0.25)).toBeNull();
    expect(run(t, x, 2.75)).toBeNull();
    expect(run(t, { ...x, enginesStopped: false }, 0.25)).toBeNull();
    expect(run(t, x, 3)?.at).toBe(3);
  });

  it('decides at the same time with one 0.25 s frame or twenty 0.0125 s frames', () => {
    const x = landed(fieldStand(DEST));
    expect(run(toDest(), x, 30, 0.25)?.at).toBe(12);
    expect(run(toDest(), x, 30, 0.0125)?.at).toBeCloseTo(12, 9);
  });

  it('round-trips its state', () => {
    const a = toDest();
    const x = landed(fieldStand(DEST));
    run(a, x, 6);
    const b = toDest();
    expect(b.restoreState(JSON.parse(JSON.stringify(a.exportState())))).toBe(true);
    expect(run(b, x, 30)?.at).toBe(6);
    expect(b.restoreState({ stillS: -1, brakeS: 0, outS: 0, siteS: 0 })).toBe(false);
  });
});
