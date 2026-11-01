// The aircraft hot swap, physics half (src/sim/aircraftSwap.ts, SimPhysics.setAircraft): switching type keeps the
// exact flight state (position, velocity, attitude, body rates in the air; north/east, heading and ground velocity
// on the ground) and the clock, keeps the identity of the controls, render state and environment objects, leaves no
// key of the old type behind in either, and flies on for 2 s without NaN: C172S <-> R44 and C172S -> PA-34 -> C172S
// in the cruise, an R44 hover into a C172S (which falls, but cleanly), a C172S taxiing into a C152, cold and
// running on the ground, a running R44 on the ground into a C172S and back. A type that cannot be built or trimmed
// leaves the old aircraft flying exactly as it was.

import { describe, expect, it } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { KT, type Vec3 } from '../../src/core/math';
import { cloneControls, defaultControls, defaultWeather, type AircraftId, type ControlInputs } from '../../src/core/types';
import type { ScenarioId } from '../../src/core/context';
import { captureSwapState, swapScenario, type SwapState } from '../../src/sim/aircraftSwap';
import { hoverScenario } from '../../src/sim/rotorcraft/starts';
import { SimPhysics } from '../../src/sim/SimPhysics';

async function flying(id: AircraftId, scenario: ScenarioId): Promise<SimPhysics> {
  const p = new SimPhysics({ weather: defaultWeather(), aircraft: await loadAircraft(id) });
  p.reset(scenario);
  p.step(1);
  return p;
}

/** Paths where `a` and `b` differ in shape: a key on one side only, or arrays of different lengths. */
function shapeDiff(a: unknown, b: unknown, path = ''): string[] {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return [];
  const out: string[] = [];
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) out.push(`${path}.length ${a.length} != ${b.length}`);
  const ka = Object.keys(a), kb = new Set(Object.keys(b));
  for (const k of ka) if (!kb.has(k)) out.push(`${path}.${k} only in the first`);
  for (const k of kb) if (!(k in a)) out.push(`${path}.${k} only in the second`);
  for (const k of ka) if (kb.has(k)) out.push(...shapeDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`));
  return out;
}

/** Every number in `v` (deeply) is finite. */
function noNaN(v: unknown, path = ''): string[] {
  if (typeof v === 'number') return Number.isNaN(v) ? [path] : [];
  if (v === null || typeof v !== 'object') return [];
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => noNaN(x, `${path}.${k}`));
}

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

interface Swapped { p: SimPhysics; before: SwapState; notes: string[] }

/** Swap `p` to `id`, checking identities, shapes, the exact state (in the air) and the clock at the swap. */
async function swap(p: SimPhysics, id: AircraftId): Promise<Swapped> {
  const def = await loadAircraft(id);
  const controls = p.controls, rs = p.renderState, env = p.env, damage = p.hailDamage;
  const before = captureSwapState(p);
  const notes = p.setAircraft(def, before);
  expect(p.definition).toBe(def);
  expect(p.fm.definition).toBe(def);
  expect(p.controls).toBe(controls);
  expect(p.renderState).toBe(rs);
  expect(p.env).toBe(env);
  expect(p.hailDamage).toBe(damage);
  const s = p.fm.state;
  expect(s.aircraft).toBe(id);
  expect(rs.aircraft).toBe(id);
  // The clock continues.
  expect(s.time).toBeCloseTo(before.time, 9);
  expect(p.time).toBeCloseTo(before.time, 9);
  // Nothing of the old type left behind.
  expect(shapeDiff(rs, s)).toEqual([]);
  expect('rotorcraft' in rs).toBe(def.rotorcraft !== undefined);
  expect(rs.engines).toHaveLength(def.engineCount);
  const allowed = new Set([...Object.keys(defaultControls(def)), ...Object.keys(p.fm.trimControls), ...Object.keys(def.sim.presets.airborne)]);
  expect(Object.keys(controls).filter((k) => !allowed.has(k))).toEqual([]);
  expect(controls.engines).toHaveLength(def.engineCount);
  if (!def.rotorcraft) expect(controls.collective).toBeUndefined();
  if (def.rotorcraft) expect(controls.collective).toBeTypeOf('number');
  expect(noNaN(s)).toEqual([]);
  expect(noNaN(rs)).toEqual([]);
  // The pilot's knobs.
  expect(controls.kollsmanHpa).toBe(before.knobs.kollsmanHpa);
  expect(controls.headingBugDeg).toBe(before.knobs.headingBugDeg);
  expect(controls.obsDeg).toBe(before.knobs.obsDeg);
  if (!before.onGround && !notes.some((n) => n.includes('raised'))) {
    expect(dist(s.position, before.position)).toBeLessThan(1e-9);
    expect(dist(s.velocity, before.velocity)).toBeLessThan(1e-9);
    expect(dist(s.angularVelocity, before.angularVelocity)).toBeLessThan(1e-9);
    const q = s.orientation, q0 = before.orientation;
    expect(Math.abs(q.w * q0.w + q.x * q0.x + q.y * q0.y + q.z * q0.z)).toBeCloseTo(1, 9);
  }
  return { p, before, notes };
}

/** After 2 s: no NaN, the clock 2 s on, and (in the air) the position where the old velocity takes it, within what 1 g does. */
function flyOn({ p, before }: Swapped, seconds = 2): void {
  p.step(seconds);
  const s = p.fm.state;
  expect(noNaN(s)).toEqual([]);
  expect(noNaN(p.renderState)).toEqual([]);
  expect(shapeDiff(p.renderState, s)).toEqual([]);
  expect(s.time).toBeCloseTo(before.time + seconds, 6);
  const v = before.velocity;
  const dead = { x: before.position.x + v.x * seconds, y: before.position.y + v.y * seconds, z: before.position.z + v.z * seconds };
  expect(dist(s.position, dead)).toBeLessThan(0.5 * 9.81 * seconds * seconds);
}

describe('aircraft hot swap in the air', () => {
  it('C172S cruise -> R44 keeps the state; the R44 trims at its never-exceed speed and flies on', async () => {
    const r = await swap(await flying('c172s', 'cruise'), 'r44');
    // 110 KIAS at 4500 ft is under the R44's 130 KIAS: no clamp.
    expect(r.before.tas / KT).toBeGreaterThan(100);
    flyOn(r);
    const s = r.p.fm.state;
    expect(s.crashed).toBe(false);
    expect(s.rotorcraft!.rotorRpm).toBeGreaterThan(0.9 * r.p.definition.rotorcraft!.referenceRpm);
    expect(s.engine.running).toBe(true);
  });

  it('R44 cruise -> C172S keeps the state and flies on with the engine running', async () => {
    const r = await swap(await flying('r44', 'cruise'), 'c172s');
    expect(r.p.controls.rotorClutchCommand).toBeUndefined();
    flyOn(r);
    const s = r.p.fm.state;
    expect(s.crashed).toBe(false);
    expect(s.engine.running).toBe(true);
    expect(s.engines[0].rpm).toBeGreaterThan(1800);
  });

  it('C172S cruise -> PA-34 (gear up, both engines) -> C172S leaves no second engine behind', async () => {
    const r = await swap(await flying('c172s', 'cruise'), 'pa34');
    expect(r.p.fm.state.engines.every((e) => e.running)).toBe(true);
    expect(r.p.fm.state.gear.extension.every((x) => x === 0)).toBe(true);
    flyOn(r);
    expect(r.p.fm.state.crashed).toBe(false);
    const back = await swap(r.p, 'c172s');
    expect(back.p.renderState.engines).toHaveLength(1);
    expect(back.p.renderState.propellers).toHaveLength(1);
    expect(back.p.controls.engines).toHaveLength(1);
    flyOn(back);
    expect(back.p.fm.state.crashed).toBe(false);
  });

  it('an R44 hover -> C172S: the aeroplane drops out of the hover without NaN', async () => {
    const def = await loadAircraft('r44');
    const p = new SimPhysics({ weather: defaultWeather(), aircraft: def });
    p.resetTo(hoverScenario(p.env, def.rotorcraft!));
    p.step(1);
    const r = await swap(p, 'c172s');
    expect(r.notes.some((n) => n.includes('slower'))).toBe(true);
    flyOn(r);
  });

  it('re-engages the autoflight it found engaged', async () => {
    const p = await flying('c172s', 'cruise');
    p.setAutoflight(true);
    const r = await swap(p, 'pa34');
    expect(r.p.autoflight.engaged).toBe(true);
    flyOn(r);
  });

  it('swapScenario clamps the trim speed into the new envelope and says so', async () => {
    const p = await flying('c172s', 'cruise');
    const st = { ...captureSwapState(p), tas: 150 * KT, ias: 140 * KT };
    const { scenario, notes } = swapScenario(st, await loadAircraft('r22'), p.env);
    expect(notes.join()).toContain('never-exceed');
    expect(scenario.ic.airspeed).toBeLessThan(110 * KT);
    expect(scenario.ic.onGround).toBe(false);
  });
});

describe('aircraft hot swap on the ground', () => {
  it('C172S taxiing -> C152 keeps north/east, heading and ground speed and taxies on', async () => {
    const p = await flying('c172s', 'runway');
    p.controls.parkingBrake = false;
    p.controls.throttle = 0.35;
    p.controls.flaps = 1 / 3;
    p.step(8);
    const s0 = p.fm.state;
    expect(s0.onGround).toBe(true);
    expect(s0.groundSpeed).toBeGreaterThan(2);
    const r = await swap(p, 'c152');
    const s = r.p.fm.state;
    expect(s.position.x).toBe(r.before.position.x);
    expect(s.position.y).toBe(r.before.position.y);
    expect(s.heading).toBeCloseTo(r.before.heading, 9);
    expect(s.groundSpeed).toBeCloseTo(r.before.groundSpeed, 6);
    expect(r.p.controls.throttle).toBe(0.35);
    expect(r.p.controls.parkingBrake).toBe(false);
    // Flap 10 on the C172S is flap 10 on the C152.
    expect(r.p.controls.flaps * r.p.definition.controls.flaps.maxDeflection * 180 / Math.PI).toBeCloseTo(10, 6);
    expect(s.engine.running).toBe(true);
    flyOn(r);
    expect(r.p.fm.state.onGround).toBe(true);
    expect(r.p.fm.state.crashed).toBe(false);
    expect(r.p.fm.state.groundSpeed).toBeGreaterThan(1);
  });

  it('cold and dark C172S -> C152 stays cold, dark and parked', async () => {
    const r = await swap(await flying('c172s', 'apron'), 'c152');
    expect(r.p.fm.state.engine.running).toBe(false);
    expect(r.p.controls.masterBattery).toBe(false);
    expect(r.p.controls.parkingBrake).toBe(true);
    flyOn(r);
    expect(r.p.fm.state.groundSpeed).toBeLessThan(0.1);
    expect(r.p.fm.state.crashed).toBe(false);
  });

  it('a running R44 on the ground -> C172S -> R44: engine and rotor running, on the ground throughout', async () => {
    const r = await swap(await flying('r44', 'runway'), 'c172s');
    expect(r.p.fm.state.engine.running).toBe(true);
    expect(r.p.fm.state.onGround).toBe(true);
    flyOn(r);
    expect(r.p.fm.state.crashed).toBe(false);
    expect(r.p.fm.state.groundSpeed).toBeLessThan(0.5);
    const back = await swap(r.p, 'r44');
    expect(back.p.controls.collective).toBe(0);
    expect(back.p.fm.state.rotorcraft!.rotorRpm).toBeGreaterThan(0.9 * back.p.definition.rotorcraft!.referenceRpm);
    flyOn(back);
    expect(back.p.fm.state.onGround).toBe(true);
    expect(back.p.fm.state.crashed).toBe(false);
  });
});

describe('a swap that fails', () => {
  async function check(bad: AircraftDefinition): Promise<void> {
    const p = await flying('c172s', 'cruise');
    const fm = p.fm, def = p.definition, af = p.autoflight;
    const controls: ControlInputs = cloneControls(p.controls);
    const s0 = JSON.parse(JSON.stringify(p.fm.state)) as unknown;
    const t0 = p.time;
    expect(() => p.setAircraft(bad)).toThrow();
    expect(p.fm).toBe(fm);
    expect(p.definition).toBe(def);
    expect(p.autoflight).toBe(af);
    expect(p.controls).toEqual(controls);
    expect(JSON.parse(JSON.stringify(p.fm.state))).toEqual(s0);
    expect(p.time).toBe(t0);
    expect(shapeDiff(p.renderState, p.fm.state)).toEqual([]);
    p.step(1);
    expect(p.fm.state.crashed).toBe(false);
    expect(p.fm.state.time).toBeCloseTo(t0 + 1, 6);
  }

  it('a type that cannot be built leaves the old aircraft intact', async () => {
    const r44 = await loadAircraft('r44');
    await check({ ...r44, aero: () => { throw new Error('no aerodynamics'); } });
  });

  it('a type that cannot be trimmed leaves the old aircraft intact', async () => {
    const pa34 = await loadAircraft('pa34');
    await check({ ...pa34, mass: { ...pa34.mass, loadings: { ...pa34.mass.loadings, typical: undefined as never } } });
  });
});
