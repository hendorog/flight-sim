// Flight School starts (section 2.8) and the SimPhysics hooks they use (section 6.1): every start builds
// the right Scenario, resetTo() flies it from equilibrium, and the five free-flight scenarios are unchanged.

import { describe, expect, it, vi } from 'vitest';

// Module 1's AREAS / predicates / refs may still be wave-0 stubs while this module lands: use the spec's
// values (copilotFallbacks.ts) only in that case.
vi.mock('../../src/training/geo/areas', async (orig) => {
  const real = await orig<typeof import('../../src/training/geo/areas')>();
  const h = await import('./copilotFallbacks');
  return h.isStub(() => real.AREAS.trainingArea) ? { ...real, AREAS: h.FALLBACK_AREAS } : real;
});
vi.mock('../../src/training/engine/predicates', async (orig) => {
  const real = await orig<typeof import('../../src/training/engine/predicates')>();
  const h = await import('./copilotFallbacks');
  return h.isStub(() => real.compile({ const: true })) ? { ...real, compile: h.miniCompile } : real;
});
vi.mock('../../src/training/engine/refs', async (orig) => {
  const real = await orig<typeof import('../../src/training/engine/refs')>();
  const h = await import('./copilotFallbacks');
  return h.isStub(() => real.resolveRef(1, {} as never)) ? { ...real, resolveRef: h.miniResolveRef } : real;
});

import type { ScenarioId } from '../../src/core/context';
import { DEG, FT, KT, NM, wrapTwoPi } from '../../src/core/math';
import { defaultWeather } from '../../src/core/types';
import { AIRPORT, runwayCoords, runwayDirection, runwayThreshold } from '../../src/core/world';
import { DEFAULT_PAYLOAD } from '../../src/physics';
import { AIM_POINT, DOWNWIND_OFFSET, GLIDE_PATH, PATTERN_ALTITUDE, SCENARIO_IDS, buildScenario, kiasToTas } from '../../src/sim/scenarios';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { baseScenario, buildStart, type StartOptions, type StartSpec } from '../../src/sim/starts';
import { C172S } from '../../src/training/aircraft/c172s';
import { AREAS } from '../../src/training/geo/areas';
import { HOLD_SHORT, LINE_UP, PARKING } from '../../src/world/airport/layout';
import { Rig, calmWeather } from './copilotHarness';

const sim = (): SimPhysics => new SimPhysics({ weather: calmWeather() });
const deg = (rad: number): number => rad / DEG;
const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

describe('baseScenario', () => {
  it('maps every start kind onto the free-flight scenario of section 2.8', () => {
    const cases: [StartSpec, ScenarioId][] = [
      [{ kind: 'scenario', id: 'downwind' }, 'downwind'],
      [{ kind: 'ground', spot: 'parking', engine: 'cold' }, 'apron'],
      [{ kind: 'ground', spot: 'holdA1', engine: 'running' }, 'apron'],
      [{ kind: 'ground', spot: 'holdA2', engine: 'running' }, 'apron'],
      [{ kind: 'ground', spot: 'lineup07', engine: 'running' }, 'runway'],
      [{ kind: 'air', at: 'trainingArea', altFt: 3500, altRef: 'msl', hdgDeg: 100, kias: 100 }, 'cruise'],
      [{ kind: 'attitude', at: 'trainingArea', altFt: 4000, kias: 60, pitchDeg: 25, bankDeg: 30, hdgDeg: 100 }, 'cruise'],
      [{ kind: 'final', distNm: 3, kias: 75, flapsDeg: 20 }, 'final'],
      [{ kind: 'circuit', leg: 'downwind', position: 'abeamMid', kias: 90 }, 'downwind'],
    ];
    for (const [spec, id] of cases) expect(baseScenario(spec), JSON.stringify(spec)).toBe(id);
    const sc = buildStart({ kind: 'final', distNm: 2, kias: 70, flapsDeg: 20 }, sim().env);
    expect(sc.id).toBe('final');
  });
});

describe('buildStart geometry', () => {
  const env = sim().env;

  it('puts ground starts on the airport layout spots, running or cold', () => {
    const spots: [StartSpec & { kind: 'ground' }, { north: number; east: number; heading: number }][] = [
      [{ kind: 'ground', spot: 'parking', engine: 'cold' }, PARKING],
      [{ kind: 'ground', spot: 'holdA1', engine: 'running' }, HOLD_SHORT.find((h) => h.name === 'A1')!],
      [{ kind: 'ground', spot: 'holdA2', engine: 'running' }, HOLD_SHORT.find((h) => h.name === 'A2')!],
      [{ kind: 'ground', spot: 'lineup07', engine: 'running' }, LINE_UP.find((l) => l.runway === '07')!],
    ];
    for (const [spec, p] of spots) {
      const sc = buildStart(spec, env);
      expect(sc.ic.onGround).toBe(true);
      expect(sc.ic.position.x).toBe(p.north);
      expect(sc.ic.position.y).toBe(p.east);
      expect(sc.ic.heading).toBe(p.heading);
      expect(sc.ic.engineRunning).toBe(spec.engine === 'running');
      expect(sc.controls?.masterBattery).toBe(spec.engine === 'running');
    }
    expect(buildStart({ kind: 'ground', spot: 'lineup07', engine: 'running' }, env).autoflight.kind).toBe('takeoff');
    expect(buildStart({ kind: 'ground', spot: 'holdA1', engine: 'running' }, env).autoflight.kind).toBe('parked');
  });

  it('places air starts over the area at the altitude (MSL or above the field), heading and IAS', () => {
    const a = AREAS.trainingArea;
    const sc = buildStart({ kind: 'air', at: 'trainingArea', altFt: 3500, altRef: 'msl', hdgDeg: 100, kias: { vspeed: 'Vcruise' }, flapsDeg: 10, gammaDeg: 2 }, env);
    expect(sc.ic.position.x).toBe(a.north);
    expect(sc.ic.position.y).toBe(a.east);
    expect(-sc.ic.position.z / FT).toBeCloseTo(3500, 6);
    expect(deg(sc.ic.heading)).toBeCloseTo(100, 9);
    expect(sc.ic.airspeed).toBeCloseTo(kiasToTas(C172S.vspeeds.Vcruise, 3500 * FT, env), 9);
    expect(sc.ic.flaps).toBeCloseTo(1 / 3, 12);
    expect(sc.ic.flightPathAngle).toBeCloseTo(2 * DEG, 12);
    const field = buildStart({ kind: 'air', at: { north: 100, east: 200 }, altFt: 3000, altRef: 'field', hdgDeg: 250, kias: 68 }, env);
    expect(-field.ic.position.z).toBeCloseTo(AIRPORT.elevation + 3000 * FT, 6);
    expect(field.ic.position).toMatchObject({ x: 100, y: 200 });
  });

  it('puts final starts on the 3 degree path, offset as asked', () => {
    const sc = buildStart({ kind: 'final', distNm: 1, kias: 85, flapsDeg: 10, heightOffsetFt: 150 }, env);
    const thr = runwayThreshold(0);
    const dir = runwayDirection();
    const dist = 1 * NM;
    expect(sc.ic.position.x).toBeCloseTo(thr.x - dir.x * dist, 6);
    expect(sc.ic.position.y).toBeCloseTo(thr.y - dir.y * dist, 6);
    const height = -sc.ic.position.z - AIRPORT.elevation;
    expect(height).toBeCloseTo((dist + AIM_POINT) * Math.tan(GLIDE_PATH) + 150 * FT, 6);
    expect(sc.ic.heading).toBe(AIRPORT.runway.heading);
    expect(sc.ic.flaps).toBeCloseTo(1 / 3, 12);
    expect(sc.autoflight).toEqual({ kind: 'approach', kias: 85 });
  });

  it('puts circuit starts on the left-hand circuit for 07', () => {
    for (const [position, along] of [['early', 800], ['abeamMid', 0], ['abeamThr', -900]] as const) {
      const sc = buildStart({ kind: 'circuit', leg: 'downwind', position, kias: 90 }, env);
      const rc = runwayCoords(sc.ic.position.x, sc.ic.position.y);
      expect(rc.across).toBeCloseTo(-DOWNWIND_OFFSET, 6);
      expect(rc.along).toBeCloseTo(along, 6);
      expect(-sc.ic.position.z).toBeCloseTo(PATTERN_ALTITUDE, 6);
      expect(deg(sc.ic.heading)).toBeCloseTo(250, 9);
    }
    let lastAcross = -Infinity;
    for (const position of ['early', 'abeamMid', 'abeamThr'] as const) {
      const sc = buildStart({ kind: 'circuit', leg: 'base', position, kias: 70 }, env);
      const rc = runwayCoords(sc.ic.position.x, sc.ic.position.y);
      expect(rc.along).toBeCloseTo(-AIRPORT.runway.length / 2 - 1500, 6);
      expect(rc.across).toBeLessThan(0);
      expect(rc.across).toBeGreaterThan(lastAcross);
      lastAcross = rc.across;
      expect(deg(sc.ic.heading)).toBeCloseTo(160, 9);
      expect(sc.ic.flaps).toBeCloseTo(2 / 3, 12);
    }
  });

  it('resolves V-speed refs, uses a lesson resolver when given, and refuses what it cannot resolve', () => {
    const spec: StartSpec = { kind: 'air', at: 'trainingArea', altFt: 3500, altRef: 'msl', hdgDeg: 100, kias: { var: 'entrySpeed' } };
    expect(() => buildStart(spec, env)).toThrow(/needs a lesson resolver/);
    const sc = buildStart(spec, env, {}, (r) => (typeof r === 'object' && 'var' in r ? 92 : NaN));
    expect(sc.ic.airspeed).toBeCloseTo(kiasToTas(92, 3500 * FT, env), 9);
    expect(() => buildStart({ ...spec, kias: -5 } as StartSpec, env)).toThrow(/airspeed/);
    expect(() => buildStart({ kind: 'scenario', id: 'cruise' }, env)).toThrow(/reset\(id\)/);
  });

  it('applies options: payload (default forward), fuel, controls; records the start', () => {
    const spec: StartSpec = { kind: 'ground', spot: 'holdA1', engine: 'running' };
    const sc = buildStart(spec, env, { fuelFraction: 0.5, controls: { pitotHeat: true } });
    expect(sc.payload).toBe('forward');
    expect(sc.ic.fuelFraction).toBe(0.5);
    expect(sc.controls?.pitotHeat).toBe(true);
    expect(sc.controls?.lights?.taxi).toBe(true);
    expect(sc.start).toEqual(spec);
    expect(buildStart(spec, env, { payload: 'typical' }).payload).toBe('typical');
  });
});

describe('SimPhysics.resetTo and the free-flight scenarios', () => {
  it('reset(id) is resetTo(buildScenario(id)) and keeps the pre-refactor start conditions', () => {
    const env = sim().env;
    // The 'final' and 'downwind' starts as they were computed before startOnFinal / startOnDownwind existed.
    const thr = runwayThreshold(0);
    const dir = runwayDirection();
    const h = (3 * NM + AIM_POINT) * Math.tan(GLIDE_PATH);
    const fin = buildScenario('final', env).ic;
    expect(fin).toEqual({
      position: { x: thr.x - dir.x * 3 * NM, y: thr.y - dir.y * 3 * NM, z: -(AIRPORT.elevation + h) },
      heading: AIRPORT.runway.heading, airspeed: kiasToTas(70, AIRPORT.elevation + h, env), onGround: false, engineRunning: true, flaps: 2 / 3, flightPathAngle: -GLIDE_PATH,
    });
    const hdg = AIRPORT.runway.heading;
    const dw = buildScenario('downwind', env).ic;
    expect(dw).toEqual({
      position: { x: AIRPORT.runway.center.north + DOWNWIND_OFFSET * Math.sin(hdg), y: AIRPORT.runway.center.east - DOWNWIND_OFFSET * Math.cos(hdg), z: -PATTERN_ALTITUDE },
      heading: wrapTwoPi(hdg + Math.PI), airspeed: kiasToTas(90, PATTERN_ALTITUDE, env), onGround: false, engineRunning: true,
    });
    for (const id of SCENARIO_IDS) {
      const a = sim();
      const b = sim();
      a.reset(id);
      b.resetTo(buildScenario(id, b.env));
      expect(a.state.position, id).toEqual(b.state.position);
      expect(a.state.orientation, id).toEqual(b.state.orientation);
      expect(a.controls, id).toEqual(b.controls);
      expect(a.fm.massProperties.mass).toBe(b.fm.massProperties.mass);
    }
  });

  it('loads the forward payload for lesson starts and the typical one again for free flight', () => {
    const p = sim();
    p.reset('cruise');
    const typical = { ...p.fm.massProperties.cgOffset, mass: p.fm.massProperties.mass };
    p.resetTo(buildStart({ kind: 'air', at: 'trainingArea', altFt: 4500, altRef: 'msl', hdgDeg: 100, kias: 90 }, p.env));
    const fwd = p.fm.massProperties;
    expect(fwd.cgOffset.x).toBeGreaterThan(typical.x + 0.02);
    expect(fwd.mass).toBeCloseTo(typical.mass - (DEFAULT_PAYLOAD - 160), 6);
    p.reset('cruise');
    expect(p.fm.massProperties.cgOffset.x).toBeCloseTo(typical.x, 12);
    expect(p.fm.massProperties.mass).toBeCloseTo(typical.mass, 9);
  });

  it('applies the fuel fraction and the start in the resume snapshot', () => {
    const p = sim();
    const spec: StartSpec = { kind: 'final', distNm: 3, kias: 75, flapsDeg: 20 };
    p.resetTo(buildStart(spec, p.env, { fuelFraction: 0.8 }));
    expect(p.state.fuel.left / p.state.fuel.capacityEach).toBeCloseTo(0.8, 6);
    const view = { weather: defaultWeather(), cameraMode: 'cockpit' as const, quality: 'high' as const, renderScale: null, resume: true };
    expect((p.captureSnapshot(view) as { start?: unknown }).start).toEqual(spec);
    p.reset('final');
    expect((p.captureSnapshot(view) as { start?: unknown }).start).toBeUndefined();
  });

  it('rotates attitude starts to the requested pitch and bank, airspeed along the nose', () => {
    const p = sim();
    p.resetTo(buildStart({ kind: 'attitude', at: 'trainingArea', altFt: 4000, kias: 100, pitchDeg: -20, bankDeg: 45, hdgDeg: 100 }, p.env));
    expect(deg(p.state.pitch)).toBeCloseTo(-20, 1);
    expect(deg(p.state.roll)).toBeCloseTo(45, 1);
    expect(Math.abs(deg(p.state.heading) - 100)).toBeLessThan(0.5);
    expect(p.state.ias / KT).toBeGreaterThan(95);
    expect(p.state.ias / KT).toBeLessThan(105);
  });
});

// ---- every start the syllabus uses flies 30 s -------------------------------------------------------------

/** The starts of section 4.1 (lessons, repositions, challenges), with the options lessons use. */
const SYLLABUS_STARTS: [string, StartSpec, StartOptions?][] = [
  ['L01', { kind: 'air', at: 'trainingArea', altFt: 3500, altRef: 'msl', hdgDeg: 100, kias: 100 }],
  ['L02', { kind: 'ground', spot: 'parking', engine: 'cold' }],
  ['L03', { kind: 'air', at: 'trainingArea', altFt: 3500, altRef: 'msl', hdgDeg: 100, kias: { vspeed: 'Vcruise' } }],
  ['L04', { kind: 'air', at: 'trainingArea', altFt: 2500, altRef: 'msl', hdgDeg: 100, kias: { vspeed: 'Vcruise' } }, { payload: 'forward', fuelFraction: 0.8 }],
  ['L05', { kind: 'air', at: 'trainingArea', altFt: 3500, altRef: 'msl', hdgDeg: 100, kias: 100 }],
  ['L06', { kind: 'air', at: 'trainingArea', altFt: 4000, altRef: 'msl', hdgDeg: 100, kias: 90 }],
  ['L07', { kind: 'air', at: 'trainingArea', altFt: 4500, altRef: 'msl', hdgDeg: 100, kias: 90 }, { payload: 'forward' }],
  ['L08', { kind: 'ground', spot: 'lineup07', engine: 'running' }],
  ['L09', { kind: 'final', distNm: 3, kias: 75, flapsDeg: 20 }],
  ['L11 final', { kind: 'final', distNm: 1, kias: { vspeed: 'Vapp' }, flapsDeg: 20 }],
  ['L11 unstable', { kind: 'final', distNm: 1, kias: 85, flapsDeg: 10, heightOffsetFt: 150 }],
  ['L11/L12 downwind', { kind: 'circuit', leg: 'downwind', position: 'abeamMid', kias: { vspeed: 'Vdownwind' } }],
  ['downwind early', { kind: 'circuit', leg: 'downwind', position: 'early', kias: 90 }],
  ['downwind abeam threshold', { kind: 'circuit', leg: 'downwind', position: 'abeamThr', kias: 80, flapsDeg: 10 }],
  ['base early', { kind: 'circuit', leg: 'base', position: 'early', kias: 70, flapsDeg: 20 }],
  ['base late', { kind: 'circuit', leg: 'base', position: 'abeamThr', kias: 70, flapsDeg: 20 }],
  ['L14', { kind: 'ground', spot: 'holdA1', engine: 'running' }],
  ['holdA2', { kind: 'ground', spot: 'holdA2', engine: 'running' }],
  ['L15', { kind: 'air', at: 'trainingArea', altFt: 4000, altRef: 'msl', hdgDeg: 100, kias: { vspeed: 'VsteepTurn' } }],
  ['L16', { kind: 'air', at: 'pflHighKey', altFt: 3000, altRef: 'field', hdgDeg: 250, kias: { vspeed: 'Vglide' } }],
  // L16 assessed: abeam the field 2 NM out (deadside), 3,000 ft AAL; also the dead-stick challenge geometry.
  ['L16 assessed', { kind: 'air', at: { north: -2 * NM * Math.sin(70 * DEG), east: 2 * NM * Math.cos(70 * DEG) }, altFt: 3000, altRef: 'field', hdgDeg: 250, kias: 68 }],
  ['L19', { kind: 'air', at: 'trainingArea', altFt: 4000, altRef: 'msl', hdgDeg: 100, kias: 95 }],
  ['L19 nose high', { kind: 'attitude', at: 'trainingArea', altFt: 4000, kias: 60, pitchDeg: 25, bankDeg: 30, hdgDeg: 100 }],
  ['L19 nose low', { kind: 'attitude', at: 'trainingArea', altFt: 4000, kias: 100, pitchDeg: -20, bankDeg: 45, hdgDeg: 100 }],
  ['L21', { kind: 'ground', spot: 'parking', engine: 'cold' }],
  ['field overhead', { kind: 'air', at: 'fieldOverhead', altFt: 2000, altRef: 'field', hdgDeg: 250, kias: 90 }],
];

/** Lesson starts of SYLLABUS (module 6) when it has landed: lesson starts, phase retries, setup repositions. */
async function syllabusStarts(): Promise<[string, StartSpec, StartOptions?][]> {
  try {
    const { SYLLABUS } = await import('../../src/training/content/syllabus/index');
    const out: [string, StartSpec, StartOptions?][] = [];
    for (const l of SYLLABUS) {
      out.push([l.id, l.start, l.startOptions]);
      for (const ph of l.flow) {
        if (ph.retryFrom) out.push([`${l.id}.${ph.id}.retryFrom`, ph.retryFrom, l.startOptions]);
        for (const st of ph.steps) if (st.kind === 'setup' && st.reposition) out.push([`${l.id}.${st.id}`, st.reposition, l.startOptions]);
      }
    }
    return out;
  } catch {
    return []; // still the wave-0 placeholder
  }
}

describe('every syllabus start trims and flies 30 s', () => {
  const fly = (name: string, spec: StartSpec, opts?: StartOptions): void => {
    if (spec.kind === 'scenario') {
      const r = new Rig(spec.id, { weather: defaultWeather() });
      r.fly(30);
      expect(r.env.crashed, name).toBe(false);
      return;
    }
    const r = new Rig(spec, { weather: { ...defaultWeather(), windDirectionDeg: 90, windSpeedKt: 7 }, startOptions: opts });
    const s = r.s;
    const alt0 = s.altitudeMSL;
    const pos0 = { ...s.position };
    // Unusual-attitude starts exist to be recovered from at once: the copilot does it here.
    if (spec.kind === 'attitude') r.pilot.recover();
    r.fly(30);
    expect(r.env.crashed, `${name} crashed`).toBe(false);
    for (const v of [s.position.x, s.position.y, s.position.z, s.ias, s.roll, s.pitch]) expect(Number.isFinite(v), name).toBe(true);
    if (spec.kind === 'ground') {
      // Parked on the brakes: still there, engine as started.
      expect(Math.hypot(s.position.x - pos0.x, s.position.y - pos0.y), name).toBeLessThan(0.5);
      expect(s.engine.running, name).toBe(spec.engine === 'running');
    } else if (spec.kind === 'attitude') {
      expect(r.pilot.stable || Math.abs(deg(s.roll)) < 10, `${name} recovered`).toBe(true);
    } else {
      // Trimmed hands-off: still flying, near the start's altitude path, wings near level.
      expect(s.onGround, name).toBe(false);
      expect(r.env.maxAbsBank, `${name} bank`).toBeLessThan(20);
      const expectedDrop = spec.kind === 'final' ? 30 * s.groundSpeed * Math.tan(GLIDE_PATH) : spec.kind === 'circuit' && spec.leg === 'base' ? 30 * s.groundSpeed * Math.tan(3 * DEG) : 0;
      expect(Math.abs(alt0 - expectedDrop - s.altitudeMSL) / FT, `${name} altitude`).toBeLessThan(250);
      const hdgErr = Math.abs(wrap180(deg(s.heading) - deg(buildStart(spec, r.p.env, opts).ic.heading)));
      // Hands-off in turbulence the spiral mode wanders the heading; only a gross departure is a failure. In the
      // landing configuration (flap 30, ~60 KIAS) the spiral is mildly divergent, time to double ~15-20 s either
      // way (as in most light singles; Part 23 does not require spiral stability), and the descent through the
      // 7 kt wind's log-law / veering profile keeps nudging the bank: the L18 short final drifts ~50 deg in 30 s
      // at no more than ~11 deg of bank. Trimmed in still air the same start holds its heading within 0.1 deg.
      expect(hdgErr, `${name} heading`).toBeLessThan(60);
    }
  };

  it.each(SYLLABUS_STARTS)('%s', (name, spec, opts) => fly(name, spec, opts), 60000);

  it('and every start in SYLLABUS (when module 6 has landed)', async () => {
    for (const [name, spec, opts] of await syllabusStarts()) fly(name, spec, opts);
  }, 600000);
});
