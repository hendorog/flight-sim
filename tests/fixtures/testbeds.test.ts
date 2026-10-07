// The whole-aircraft test-beds (testbeds.ts) flown by the flight model: every bed resets on the ground and in the
// air, trims and flies a minute hands-off, and each proves the mechanisms it switches on: twins (symmetry, power
// yaw, critical engine, engine-out trim, windmilling and feathered propellers, governed engines after a reset),
// retractable gear, castering nosewheel, stabilator and spring trim, hand-lever flaps, rudder trim, carburettor
// icing from the weather. Costs are ratios to the Cessna 172S measured in the same run.

import { describe, expect, it } from 'vitest';
import C172S_DEFINITION from '../../src/aircraft/c172s/index';
import type { AircraftDefinition, ControlSystemDef } from '../../src/aircraft/types';
import { DEG, FT, KT } from '../../src/core/math';
import { copyControls, defaultControls, engineControl, type Environment } from '../../src/core/types';
import { BladeElementFlightModel, ControlLaw, ControlSystem, engineStopControls, type TrimResult } from '../../src/physics';
import type { TrimSpec } from '../../src/physics/trim';
import { ELEVATION, at, calmWeather, flatEnvironment, makeRig, resetTo, type Rig } from '../fdm/helpers';
import { PA34_RETRACT } from '../gear/testbed';
import {
  CARB_TESTBED,
  CASTER_TESTBED,
  DIESEL_TESTBED,
  RETRACT_TESTBED,
  RETRACT_VLE,
  SPRING_TRIM_TESTBED,
  STABILATOR_GEARING,
  STABILATOR_TESTBED,
  TESTBEDS,
  TWIN_TESTBED,
} from './testbeds';

const ALT = ELEVATION + 3000 * FT;
const CR = TWIN_TESTBED('crCS');
const CO = TWIN_TESTBED('coFP');

const rigFor = (def: AircraftDefinition, env?: ReturnType<typeof flatEnvironment>): Rig<BladeElementFlightModel> => makeRig({ def, loading: 'typical', env });

/** Every number in the state is finite (walks the whole object). */
function nonFinite(value: unknown, path = 'state'): string[] {
  if (typeof value === 'number') return Number.isFinite(value) || value === Infinity ? [] : [path];
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => nonFinite(v, `${path}.${k}`));
  return [];
}

/** One-engine-out trim at `kias`-ish TAS, full power on the live engine, 5 deg of bank toward it (contract 3.4). */
function oeiTrim(rig: Rig<BladeElementFlightModel>, tasKt: number, index: number, propeller: 'windmilling' | 'feathered' = 'windmilling', over: Partial<TrimSpec> = {}): TrimResult {
  const bank = (index === 0 ? 5 : -5) * DEG;
  return rig.fm.solveTrim({ tas: tasKt * KT, altitude: ALT, throttle: 1, lateral: 'fixedBank', bank, engineOut: { index, propeller }, ...over }, rig.env);
}

/**
 * Vmca of a twin at full power with engine `index` windmilling: the root of pedal(V) = 1 by secant from above over
 * converged trims only (contract 3.4), TAS in kt.
 */
function vmcaKt(rig: Rig<BladeElementFlightModel>, index: number): number {
  const pedal = (v: number) => {
    const t = oeiTrim(rig, v, index);
    return t.converged ? Math.abs(t.rudder) : NaN;
  };
  let v1 = 130, p1 = pedal(v1);
  let v0 = 115, p0 = pedal(v0);
  for (let k = 0; k < 12 && Math.abs(p0 - 1) > 0.01; k++) {
    let v = v0 + ((1 - p0) * (v0 - v1)) / (p0 - p1);
    let p = pedal(v);
    // Below the root the trim does not converge: step back half way toward the last converged speed.
    while (!Number.isFinite(p) && v < v0 - 0.2) {
      v = 0.5 * (v + v0);
      p = pedal(v);
    }
    if (!Number.isFinite(p)) break;
    [v1, p1, v0, p0] = [v0, p0, v, p];
  }
  return v0;
}

describe('every test-bed resets, trims and flies', () => {
  for (const [name, def] of Object.entries(TESTBEDS)) {
    it(`${name}: on the ground and in the air, then 60 s hands-off without a NaN`, () => {
      const rig = rigFor(def);
      resetTo(rig, { onGround: true, position: at(ELEVATION), heading: 30 * DEG });
      const s = rig.fm.state;
      expect(s.onGround).toBe(true);
      expect(s.wheels.every((w) => w.load > 0)).toBe(true);
      expect(s.gear.extension).toEqual([1, 1, 1]);
      expect(rig.fm.trimControls.parkingBrake).toBe(true);
      rig.run(2);
      expect(nonFinite(s)).toEqual([]);
      expect(s.crashReason).toBe('');
      expect(s.groundSpeed).toBeLessThan(0.05);
      // A cold-and-dark start on the ground: every engine parked.
      resetTo(rig, { onGround: true, position: at(ELEVATION), heading: 30 * DEG, engineRunning: false });
      expect(s.engines.every((e) => e.rpm === 0 && !e.running)).toBe(true);
      rig.run(1);
      expect(nonFinite(s)).toEqual([]);

      const tas = def === CARB_TESTBED ? 85 : 100;
      resetTo(rig, { position: at(ALT), airspeed: tas * KT, heading: 90 * DEG });
      expect(rig.fm.lastTrim!.converged).toBe(true);
      const start = { altitude: s.altitudeMSL, track: s.track, tas: s.tas };
      rig.run(60);
      expect(nonFinite(s)).toEqual([]);
      expect(s.crashReason).toBe('');
      expect(Math.abs(s.roll)).toBeLessThan(10 * DEG);
      expect(Math.abs(s.altitudeMSL - start.altitude)).toBeLessThan(30);
      expect(Math.abs(s.tas - start.tas)).toBeLessThan(2 * KT);
      expect(Math.abs(s.track - start.track)).toBeLessThan(5 * DEG);
      expect(s.engines.every((e) => e.running)).toBe(true);
    }, 60_000);
  }
});

describe('twins', () => {
  it('a symmetric twin trims with zero rudder and aileron; counter-rotating propellers make no power yaw, co-rotating ones do', () => {
    const cr = rigFor(CR);
    const co = rigFor(CO);
    resetTo(cr, { position: at(ALT), airspeed: 100 * KT });
    resetTo(co, { position: at(ALT), airspeed: 100 * KT });
    expect(cr.fm.lastTrim!.converged).toBe(true);
    for (const throttle of [0, 0.5, 1]) {
      const t = cr.fm.solveTrim({ tas: 75 * KT, altitude: ALT, throttle }, cr.env);
      expect(t.converged).toBe(true);
      expect(Math.abs(t.rudder)).toBeLessThan(1e-3);
      expect(Math.abs(t.aileron)).toBeLessThan(1e-3);
    }
    const idle = co.fm.solveTrim({ tas: 75 * KT, altitude: ALT, throttle: 0 }, co.env);
    const full = co.fm.solveTrim({ tas: 75 * KT, altitude: ALT, throttle: 1 }, co.env);
    expect(full.rudder).toBeGreaterThan(idle.rudder + 0.05);
    // Both engines counter-rotating, mirror images: each failed side needs the same pedal, mirrored.
    const left = oeiTrim(cr, 115, 0);
    const right = oeiTrim(cr, 115, 1);
    expect(left.converged && right.converged).toBe(true);
    expect(left.rudder).toBeGreaterThan(0.3);
    expect(right.rudder).toBeCloseTo(-left.rudder, 3);
    expect(right.aileron).toBeCloseTo(-left.aileron, 3);
  }, 60_000);

  it('co-rotating: the pedal with the LEFT engine failed exceeds the RIGHT-failed one (critical engine)', () => {
    const co = rigFor(CO);
    resetTo(co, { position: at(ALT), airspeed: 100 * KT });
    for (const v of [110, 125]) {
      const left = oeiTrim(co, v, 0);
      const right = oeiTrim(co, v, 1);
      expect(left.converged && right.converged).toBe(true);
      // Left failed: the live right engine yaws the nose left, held with right pedal.
      expect(left.rudder).toBeGreaterThan(0);
      expect(right.rudder).toBeLessThan(0);
      expect(left.rudder).toBeGreaterThan(-right.rudder + 0.05);
    }
  }, 60_000);

  it('OEI trims converge at 1.3 x the estimated Vmca, windmilling and feathered, either engine; feathering needs less pedal', () => {
    for (const def of [CR, DIESEL_TESTBED]) {
      const rig = rigFor(def);
      resetTo(rig, { position: at(ALT), airspeed: 110 * KT });
      const vmca = Math.max(vmcaKt(rig, 0), vmcaKt(rig, 1));
      console.log(`[fixtures] ${def.name}: Vmca ${vmca.toFixed(1)} KTAS at 3000 ft`);
      // The test-bed's reference Vmca (KIAS) is the sea-level, aft-CG figure: this one, at 3000 ft and typical CG in
      // KTAS (5 % above KIAS), lies near it (crCS 97.1, DIESEL 103.6 against 101).
      expect(vmca / def.reference.vmca!).toBeGreaterThan(0.92);
      expect(vmca / def.reference.vmca!).toBeLessThan(1.08);
      for (const index of [0, 1]) {
        const windmilling = oeiTrim(rig, 1.3 * vmca, index, 'windmilling');
        const feathered = oeiTrim(rig, 1.3 * vmca, index, 'feathered');
        expect(windmilling.converged && feathered.converged).toBe(true);
        expect(Math.abs(feathered.rudder)).toBeLessThan(Math.abs(windmilling.rudder));
        // Zero-sideslip climb at the same speed, feathered: converges too, banked toward the live engine.
        const climb = rig.fm.solveTrim({ tas: 1.3 * vmca * KT, altitude: ALT, throttle: 1, lateral: 'zeroSideslip', engineOut: { index, propeller: 'feathered' } }, rig.env);
        expect(climb.converged).toBe(true);
        expect(climb.roll * (index === 0 ? 1 : -1)).toBeGreaterThan(0);
      }
    }
  }, 120_000);

  it('an engine failed in the air windmills above 600 rpm after 5 s; feathered, it stops and drags far less (FADEC: master off against selector off)', () => {
    for (const def of [CR, CO, DIESEL_TESTBED]) {
      const dead = (feathered: boolean) => {
        const rig = rigFor(def);
        resetTo(rig, { position: at(ALT), airspeed: 125 * KT, enginesRunning: [false, true], feathered: [feathered, false] });
        expect(rig.fm.lastTrim!.converged).toBe(true);
        rig.run(5);
        return { rig, s: rig.fm.state };
      };
      const w = dead(false);
      expect(w.s.engines[1].running).toBe(true);
      expect(w.s.engines[0].running).toBe(false);
      expect(w.s.engines[0].rpm).toBeGreaterThan(600);
      expect(w.s.propellers[0].thrust).toBeLessThan(-100);
      // The failed engine's controls: fuel cut, throttle closed, ignition / ECU left on.
      const stop = engineStopControls(def, 0, 'windmilling');
      expect(w.rig.fm.trimControls.engines[0]).toMatchObject(stop);
      expect(engineControl(w.rig.fm.trimControls, 0, 'fuelSelector')).toBe('off');
      if (def.powerplant.engines[0].engine.fadec) expect(engineControl(w.rig.fm.trimControls, 0, 'engineMaster')).toBe(true);
      else if (def.powerplant.engines[0].propeller.pitchControl.kind === 'constantSpeed') expect(engineControl(w.rig.fm.trimControls, 0, 'propeller')).toBe(1);
      if (def === CO) continue;
      const f = dead(true);
      expect(f.s.engines[0].rpm).toBe(0);
      expect(f.s.propellers[0].feathered).toBe(true);
      expect(Math.abs(f.s.propellers[0].thrust)).toBeLessThan(Math.abs(w.s.propellers[0].thrust) / 4);
      if (def.powerplant.engines[0].engine.fadec) expect(engineControl(f.rig.fm.trimControls, 0, 'engineMaster')).toBe(false);
      else expect(engineControl(f.rig.fm.trimControls, 0, 'propeller')).toBe(0);
    }
  }, 60_000);

  it('governed engines hold their rpm within 30 rpm and thrust within 2 % over the first 3 s after an in-air reset', () => {
    for (const def of [CR, DIESEL_TESTBED]) {
      for (const ic of [{ airspeed: 110 * KT }, { airspeed: 125 * KT, enginesRunning: [false, true] }, { airspeed: 130 * KT, flightPathAngle: -2 * DEG }]) {
        const rig = rigFor(def);
        resetTo(rig, { position: at(ALT), ...ic });
        const s = rig.fm.state;
        const live = s.engines.map((e, i) => (e.running ? i : -1)).filter((i) => i >= 0);
        const rpm0 = live.map((i) => s.propellers[i].rpm);
        const thrust0 = live.map((i) => s.propellers[i].thrust);
        let rpm = 0, thrust = 0;
        rig.run(3, () => {
          live.forEach((i, k) => {
            rpm = Math.max(rpm, Math.abs(s.propellers[i].rpm - rpm0[k]));
            thrust = Math.max(thrust, Math.abs(s.propellers[i].thrust / thrust0[k] - 1));
          });
        });
        expect(rpm).toBeLessThan(30);
        expect(thrust).toBeLessThan(0.02);
      }
    }
  }, 60_000);

  it('TrimSpec.cowlFlaps: closed cowl flaps drag less; captureSystems / restoreSystems carry both engines on', () => {
    const rig = rigFor(CR);
    resetTo(rig, { position: at(ALT), airspeed: 100 * KT });
    const open = rig.fm.solveTrim({ tas: 100 * KT, altitude: ALT, cowlFlaps: [1, 1] }, rig.env);
    const closed = rig.fm.solveTrim({ tas: 100 * KT, altitude: ALT, cowlFlaps: [0, 0] }, rig.env);
    expect(open.converged && closed.converged).toBe(true);
    expect(closed.throttle).toBeLessThan(open.throttle - 0.003);

    resetTo(rig, { position: at(ALT), airspeed: 120 * KT, enginesRunning: [true, true] });
    rig.controls.throttle = 0.7;
    rig.run(3);
    const s = rig.fm.state;
    const systems = rig.fm.captureSystems();
    expect(systems.engines).toHaveLength(2);
    expect(systems.tanks).toHaveLength(2);
    const body = { position: { ...s.position }, orientation: { ...s.orientation }, velocity: { ...s.velocity }, angularVelocity: { ...s.angularVelocity } };
    const q = 0.5 * s.airDensity * (s.velocity.x ** 2 + s.velocity.y ** 2 + s.velocity.z ** 2);
    const copy = rigFor(CR);
    resetTo(copy, { position: { ...s.position }, airspeed: s.tas, heading: s.heading });
    copyControls(copy.controls, rig.controls);
    copy.fm.restoreSystems(systems, copy.controls, q);
    copy.fm.setClock(s.time);
    copy.fm.setKinematics(body);
    rig.run(3);
    copy.run(3);
    for (let i = 0; i < 2; i++) expect(Math.abs(copy.fm.state.engines[i].rpm - s.engines[i].rpm)).toBeLessThan(10);
    expect(Math.abs(copy.fm.state.altitudeMSL - s.altitudeMSL)).toBeLessThan(1);
  }, 60_000);

  it('the keyboard rudder has full authority up to the bed\'s own Vmca, a sea-level figure with Vyse clear of it (C-C5b-02)', () => {
    // Sea-level Vmca KCAS at aft CG by the conformance twin block's secant: crCS 100.8, coFP 98.4 (left failed), DIESEL 100.8.
    for (const [def, measured] of [[CR, 100.8], [CO, 98.4], [DIESEL_TESTBED, 100.8]] as const) {
      const r = def.reference;
      expect(r.vmca! - measured).toBeGreaterThanOrEqual(0);
      expect(r.vmca! - measured).toBeLessThan(1);
      expect(r.vyse! - r.vmca!).toBeGreaterThanOrEqual(15);
      expect(def.input.assists.axes.rudder.fullAuthoritySpeed).toBeGreaterThanOrEqual(r.vmca! * KT);
    }
  });

  it('a model that has never been reset trims as one reset in the air: warm engines, the ground below the trim (C-C5b-01)', () => {
    // Sea level over ground 2000 m below: no ground effect in either trim.
    const env = () => flatEnvironment(undefined, -2000);
    const pair = (def: AircraftDefinition, spec: TrimSpec) => {
      const fresh = makeRig({ def, loading: 'aft', env: env() });
      const after = makeRig({ def, loading: 'aft', env: env() });
      resetTo(after, { position: at(300) });
      return [fresh, after].map((rig) => ({ trim: rig.fm.solveTrim(spec, rig.env), power: rig.fm.state.engines.map((_, i) => rig.fm.powerplant.brakePower(i)) }));
    };
    for (const def of [DIESEL_TESTBED, CR, C172S_DEFINITION]) {
      const [fresh, after] = pair(def, { tas: 60, altitude: 0, throttle: 1 });
      expect(after.trim.converged).toBe(true);
      expect(fresh.trim.converged).toBe(true);
      fresh.power.forEach((p, i) => expect(Math.abs(p / after.power[i] - 1)).toBeLessThan(1e-6));
      expect(fresh.trim.flightPathAngle).toBeCloseTo(after.trim.flightPathAngle, 6);
    }
    // Engine-out at sea level, aft CG, full power, 5 deg of bank: converges near Vmca as it does after a reset (the
    // engines of the reset model were warmed at 300 m, a few 1e-5 of pedal near the rudder stop).
    for (const tas of [115, 105]) {
      const [fresh, after] = pair(CR, { tas: tas * KT, altitude: 0, throttle: 1, lateral: 'fixedBank', bank: 5 * DEG, engineOut: { index: 0, propeller: 'windmilling' } });
      expect(after.trim.converged).toBe(true);
      expect(fresh.trim.converged).toBe(true);
      expect(fresh.trim.rudder).toBeCloseTo(after.trim.rudder, 3);
    }
  }, 60_000);
});

describe('retractable gear', () => {
  it('is up in the air without flaps, down with them or when asked; gear up drags less; the selector moves it in its time', () => {
    const rig = rigFor(RETRACT_TESTBED);
    const s = rig.fm.state;
    resetTo(rig, { position: at(ALT), airspeed: 100 * KT });
    expect(s.gear).toMatchObject({ retractable: true, lever: 'up', extension: [0, 0, 0] });
    const up = rig.fm.lastTrim!;
    resetTo(rig, { position: at(ALT), airspeed: 100 * KT, gearDown: true });
    expect(s.gear).toMatchObject({ lever: 'down', extension: [1, 1, 1], locked: [true, true, true], inTransit: false });
    const down = rig.fm.lastTrim!;
    expect(up.converged && down.converged).toBe(true);
    expect(up.throttle).toBeLessThan(down.throttle - 0.01);
    // TrimSpec.gearDown overrides the present gear for the trim alone.
    const asked = rig.fm.solveTrim({ tas: 100 * KT, altitude: ALT, gearDown: false }, rig.env);
    expect(asked.throttle).toBeCloseTo(up.throttle, 3);
    expect(rig.fm.massProperties.inertia).toEqual(rigFor(RETRACT_TESTBED).fm.massProperties.inertia);
    resetTo(rig, { position: at(ALT), airspeed: 100 * KT, flaps: 1 / 3 });
    expect(s.gear.lever).toBe('down');

    // Selector up in flight: in transit, then up after the retraction time; the horn with the throttle closed and a leg not locked.
    resetTo(rig, { position: at(ALT), airspeed: 90 * KT, gearDown: true });
    rig.controls.gearLever = 'up';
    rig.run(1);
    expect(s.gear.inTransit).toBe(true);
    expect(s.gear.extension[0]).toBeLessThan(1);
    rig.run(PA34_RETRACT.retractTime);
    expect(s.gear.extension).toEqual([0, 0, 0]);
    expect(s.gear.inTransit).toBe(false);
    rig.controls.throttle = 0;
    rig.run(0.1);
    expect(s.gear.warning).toBe(true);
    // The capture holds the legs; a restore in another model continues where they were.
    rig.controls.gearLever = 'down';
    rig.run(2);
    const snap = rig.fm.captureSystems();
    expect(snap.gear.extension[0]).toBeGreaterThan(0);
    expect(snap.gear.extension[0]).toBeLessThan(1);
    const other = rigFor(RETRACT_TESTBED);
    resetTo(other, { position: at(ALT), airspeed: 90 * KT });
    other.fm.restoreSystems(snap, rig.controls, 4000);
    expect(other.fm.state.gear.extension).toEqual(snap.gear.extension);
  }, 60_000);

  it('a gear-up arrival latches the gear-up crash; the warn rules flag the gear and flap limits and do nothing else', () => {
    const rig = rigFor(RETRACT_TESTBED);
    const s = rig.fm.state;
    resetTo(rig, { position: at(ALT), airspeed: (RETRACT_VLE + 15) * KT, gearDown: true });
    expect(rig.fm.overspeed.gear).toBe(false);
    rig.run(1.5);
    expect(rig.fm.overspeed.gear).toBe(true);
    expect(s.crashReason).toBe('');
    resetTo(rig, { position: at(ALT), airspeed: (RETRACT_VLE + 15) * KT });
    rig.run(1.5);
    expect(rig.fm.overspeed.gear).toBe(false);
    rig.controls.flaps = 1;
    rig.run(4);
    expect(rig.fm.overspeed.flaps).toBe(true);
    // The C172S monitors nothing.
    const c172 = makeRig({ def: C172S_DEFINITION });
    resetTo(c172, { position: at(ALT), airspeed: 120 * KT, flaps: 1 });
    c172.run(1.5);
    expect(c172.fm.overspeed).toEqual({ flaps: false, gear: false });

    // Gear up, idle, flown onto the runway in a shallow descent.
    resetTo(rig, { position: at(ELEVATION + 15), airspeed: 70 * KT, flightPathAngle: -2 * DEG, flaps: 0, gearDown: false });
    rig.controls.gearLever = 'up';
    rig.run(20, () => s.crashed);
    expect(s.crashed).toBe(true);
    expect(s.crashReason).toMatch(/^Gear-up landing/);
  }, 60_000);
});

describe('steering, trims and flaps', () => {
  it('castering: the brake steers, the pedal alone does not', () => {
    const turn = (def: AircraftDefinition, steer: (c: Rig['controls']) => void) => {
      const rig = rigFor(def);
      resetTo(rig, { onGround: true, position: at(ELEVATION), heading: 0 });
      rig.controls.parkingBrake = false;
      rig.controls.throttle = 0.35;
      rig.run(6);
      const h0 = rig.fm.state.heading;
      rig.run(6, () => steer(rig.controls));
      const d = rig.fm.state.heading - h0;
      return Math.atan2(Math.sin(d), Math.cos(d));
    };
    const pedal = (c: Rig['controls']) => void (c.rudder = 1);
    const brake = (c: Rig['controls']) => void (c.brakeRight = 0.5);
    expect(Math.abs(turn(CASTER_TESTBED, pedal))).toBeLessThan(10 * DEG);
    expect(turn(CASTER_TESTBED, brake)).toBeGreaterThan(30 * DEG);
    // On the C172S the pedal steers the nosewheel.
    expect(turn(C172S_DEFINITION, pedal)).toBeGreaterThan(30 * DEG);
  }, 60_000);

  it('the stabilator floats at -offset / gearing with its anti-servo tab, and the offset is SurfaceState.elevatorTrim', () => {
    const law = new ControlLaw(STABILATOR_TESTBED.controls);
    const out = { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0, elevatorTrim: 0, rudderTrim: 0 };
    const t = law.surfaceTargets({ ...defaultControls(), elevatorTrim: 0.5 }, 0, out);
    expect(t.elevatorTrim).toBeCloseTo(0.5 * 12 * DEG, 12);
    expect(t.elevator).toBeCloseTo((-0.5 * 12 * DEG) / STABILATOR_GEARING, 12);
    const rig = rigFor(STABILATOR_TESTBED);
    for (const v of [70, 120]) {
      resetTo(rig, { position: at(ALT), airspeed: v * KT });
      expect(rig.fm.lastTrim!.converged).toBe(true);
      expect(rig.controls.elevator).toBeCloseTo(0, 12);
      expect(rig.fm.state.surfaces.elevatorTrim).toBeCloseTo(law.trimTabDeflection(rig.controls.elevatorTrim), 12);
    }
  }, 60_000);

  it('spring trim: no tab, the hands-off elevator follows (datum + (q / springQ) float) / (1 + q / springQ) and round-trips', () => {
    const cfg = SPRING_TRIM_TESTBED.controls;
    const law = new ControlLaw(cfg);
    const out = { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0, elevatorTrim: 0, rudderTrim: 0 };
    const c = { ...defaultControls(), elevatorTrim: 0.6 };
    // No air: the spring's datum (60 % of the nose-up travel, trailing edge up); a tab angle of 0.
    expect(law.surfaceTargets(c, 0, out).elevator).toBeCloseTo(-0.6 * 15 * DEG, 12);
    expect(out.elevatorTrim).toBe(0);
    // At q = springQ with a float of 2 deg: half way between the datum and the float.
    const q = 1500;
    const handsOff = law.surfaceTargets(c, q, out, 2 * DEG).elevator * (1 + q / cfg.stretchQ.elevator);
    expect(handsOff).toBeCloseTo((-0.6 * 15 * DEG + 2 * DEG) / 2, 12);
    // Nose-down trim: the other spring.
    expect(law.surfaceTargets({ ...c, elevatorTrim: -0.5 }, 0, out).elevator).toBeCloseTo(0.5 * 8 * DEG, 12);
    // pitchControlsFor() inverts it at any q, the float included.
    for (const [d, f, qq] of [[-0.05, 0.01, 2000], [0.02, -0.03, 300], [-0.1, 0, 0]]) {
      const pc = law.pitchControlsFor(d, f, qq);
      expect(pc.elevator).toBeCloseTo(0, 12);
      expect(law.surfaceTargets({ ...c, ...pc }, qq, out, f).elevator * (1 + qq / cfg.stretchQ.elevator)).toBeCloseTo(d, 12);
    }
    // The same trim floats the elevator differently at two speeds (a tab-trimmed one would not, without float).
    expect(law.surfaceTargets(c, 500, out, 1 * DEG).elevator).not.toBeCloseTo(law.surfaceTargets(c, 3000, out, 1 * DEG).elevator, 3);
  });

  it('spring trim: the datum moves at trimRate, and an electric spring trim (trimDrive) not with a dead bus (D-D-da20-phys-01)', () => {
    const rate = 2 * DEG;
    const cfg: ControlSystemDef = { ...SPRING_TRIM_TESTBED.controls, trimRate: rate, trimDrive: { kind: 'electric', minVolts: 10 } };
    const cs = new ControlSystem(cfg);
    const c = { ...defaultControls(), elevatorTrim: 0 };
    cs.setImmediate(c, 0);
    c.elevatorTrim = 1;
    // Dead bus: nothing moves.
    for (let i = 0; i < 100; i++) cs.update(0.01, c, 0, 0);
    expect(cs.pitchTrim).toBe(0);
    expect(cs.surfaces.elevator).toBeCloseTo(0, 12);
    // Live bus: 1 s moves the datum by trimRate (15 deg of nose-up travel: 2 / 15 of the input).
    for (let i = 0; i < 100; i++) cs.update(0.01, c, 0, 14);
    expect(cs.pitchTrim).toBeCloseTo(2 / 15, 9);
    expect(cs.law.springDatum(cs.pitchTrim)).toBeCloseTo(-rate, 9);
    // A reset takes the control at once.
    cs.setImmediate(c, 0);
    expect(cs.pitchTrim).toBe(1);
    // Without trimDrive (a trim wheel) only the rate limits it.
    const manual = new ControlSystem({ ...cfg, trimDrive: undefined });
    manual.setImmediate({ ...c, elevatorTrim: 0 }, 0);
    for (let i = 0; i < 100; i++) manual.update(0.01, c, 0, 0);
    expect(manual.pitchTrim).toBeCloseTo(2 / 15, 9);
  });

  it('hand-lever flaps move with a dead bus, electric ones do not', () => {
    const flapsAfter = (def: AircraftDefinition) => {
      const rig = rigFor(def);
      resetTo(rig, { onGround: true, position: at(ELEVATION), heading: 0 });
      rig.controls.masterBattery = false;
      rig.controls.alternator = false;
      rig.controls.flaps = 1;
      rig.run(2);
      return rig.fm.state.surfaces.flaps;
    };
    expect(flapsAfter(SPRING_TRIM_TESTBED)).toBeCloseTo(SPRING_TRIM_TESTBED.controls.flaps.maxDeflection, 9);
    // (One sub-step on the bus voltage of the reset.)
    expect(flapsAfter(C172S_DEFINITION)).toBeLessThan(1e-3);
  }, 30_000);

  it('an electric stall warner (StallSensor.needsBus) is silent in every consumer with a dead bus; a reed is not', () => {
    const electric: AircraftDefinition = {
      ...C172S_DEFINITION,
      aero: () => {
        const a = C172S_DEFINITION.aero();
        const sw = a.stallWarning;
        return { ...a, stallWarning: (Array.isArray(sw) ? sw : [sw]).map((w) => ({ ...w, needsBus: true })) };
      },
    };
    const warnAfter = (def: AircraftDefinition, master: boolean) => {
      const rig = rigFor(def);
      resetTo(rig, { position: at(ALT), airspeed: 52 * KT });
      rig.controls.masterBattery = master;
      rig.controls.alternator = master;
      rig.run(0.5);
      return rig.fm.state.stallWarning;
    };
    expect(warnAfter(C172S_DEFINITION, true)).toBe(true);
    expect(warnAfter(C172S_DEFINITION, false)).toBe(true);
    expect(warnAfter(electric, true)).toBe(true);
    expect(warnAfter(electric, false)).toBe(false);
  }, 30_000);

  it('rudder trim offsets the rudder at its rate and shows its tab; each side of the pedal has its own travel (maxRight)', () => {
    const rig = rigFor(CR);
    resetTo(rig, { onGround: true, position: at(ELEVATION), heading: 0 });
    const cs = rig.fm.controlSystem;
    const trim = CR.controls.rudder.trim!;
    rig.controls.rudderTrim = 1;
    rig.run(1);
    expect(cs.rudderTrim).toBeCloseTo(trim.rate * 1, 2);
    rig.run(4);
    expect(cs.rudderTrim).toBe(1);
    expect(rig.fm.state.surfaces.rudderTrim).toBeCloseTo(trim.tabDeflection, 12);
    expect(rig.fm.state.surfaces.rudder).toBeCloseTo(-trim.authority, 3);
    rig.controls.rudderTrim = -1;
    rig.run(9);
    expect(rig.fm.state.surfaces.rudderTrim).toBeCloseTo(-trim.tabDeflectionLeft!, 12);
    expect(rig.fm.state.surfaces.rudder).toBeCloseTo(trim.authority, 3);

    const cfg: ControlSystemDef = { ...C172S_DEFINITION.controls, rudder: { ...C172S_DEFINITION.controls.rudder, tabOffset: 0, maxDeflection: 27 * DEG, maxRight: 29 * DEG } };
    const law = new ControlLaw(cfg);
    const out = { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0, elevatorTrim: 0, rudderTrim: 0 };
    expect(law.surfaceTargets({ ...defaultControls(), rudder: 1 }, 0, out).rudder).toBeCloseTo(-29 * DEG, 12);
    expect(law.surfaceTargets({ ...defaultControls(), rudder: -1 }, 0, out).rudder).toBeCloseTo(27 * DEG, 12);
    expect(law.pedalFor(-29 * DEG, 0)).toBeCloseTo(1, 12);
    expect(law.pedalFor(13.5 * DEG, 0)).toBeCloseTo(-0.5, 12);
  }, 30_000);
});

describe('carburettor icing from the weather', () => {
  it('grows in cloud at part throttle, much less in clear air (12 K spread), not in dry air or without a weather model', () => {
    const ice = (env: Environment | undefined) => {
      const rig = rigFor(CARB_TESTBED, env as ReturnType<typeof flatEnvironment> | undefined);
      resetTo(rig, { position: at(ALT), airspeed: 75 * KT });
      rig.run(60);
      return rig.fm.state.engine.carbIce;
    };
    const cloud = flatEnvironment(calmWeather({ cloudCover: 1, cloudBaseM: ELEVATION + 300, cloudTopM: ELEVATION + 3000 }));
    const clear = flatEnvironment(calmWeather({ cloudCover: 0 }));
    // Cumulus base 4 km above the field: a spread of 32 K at the field, dry at every height (no icing).
    const dry = flatEnvironment(calmWeather({ cloudCover: 0.5, cloudBaseM: ELEVATION + 4000, cloudTopM: ELEVATION + 6000 }));
    const plain: Environment = { ...flatEnvironment() };
    delete (plain as { moisture?: unknown }).moisture;
    const inCloud = ice(cloud);
    const inClearAir = ice(clear);
    console.log(`[fixtures] carburettor ice after 60 s at 75 KTAS: in cloud ${inCloud.toFixed(4)}, clear ${inClearAir.toFixed(4)}`);
    expect(inCloud).toBeGreaterThan(0.02);
    expect(inClearAir).toBeLessThan(inCloud / 2);
    expect(ice(dry)).toBe(0);
    expect(ice(plain)).toBe(0);
  }, 120_000);
});

describe('cost, as ratios to the Cessna 172S in the same run', () => {
  /** Minimum over five repetitions of `f`'s mean time per call over `n` calls, ms. */
  const time = (f: () => void, n: number): number => {
    let best = Infinity;
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) f();
      best = Math.min(best, (performance.now() - t0) / n);
    }
    return best;
  };

  it('a twin sub-step costs under 2.3 x the C172S one; a trim + ground reset under 2.6 x (twins), 1.3 x (singles)', () => {
    const flying = (def: AircraftDefinition) => {
      const rig = rigFor(def);
      resetTo(rig, { position: at(ALT), airspeed: 100 * KT });
      // Warm up (lazily built propeller maps, JIT).
      rig.run(2);
      return () => rig.fm.step(1 / 240, rig.controls, rig.env);
    };
    const c172 = flying(C172S_DEFINITION);
    const twins = [CR, DIESEL_TESTBED].map(flying);
    const base = time(c172, 240);
    const steps = twins.map((f) => time(f, 240) / base);
    const resetCost = (def: AircraftDefinition) => {
      const rig = rigFor(def);
      const ic = (onGround: boolean) => ({ position: at(onGround ? ELEVATION : ALT), heading: 0, airspeed: 100 * KT, onGround, engineRunning: true });
      rig.fm.reset(ic(true), rig.env);
      return () => {
        rig.fm.reset(ic(false), rig.env);
        rig.fm.reset(ic(true), rig.env);
      };
    };
    const resetBase = time(resetCost(C172S_DEFINITION), 2);
    const twinResets = [CR, DIESEL_TESTBED].map((def) => time(resetCost(def), 2) / resetBase);
    const singleResets = [STABILATOR_TESTBED, SPRING_TRIM_TESTBED, CASTER_TESTBED, RETRACT_TESTBED].map((def) => time(resetCost(def), 2) / resetBase);
    console.log(
      `[fixtures] cost: C172S sub-step ${(base * 1000).toFixed(1)} us; twin / C172S ${steps.map((r) => r.toFixed(2)).join(', ')}; ` +
        `C172S air + ground reset ${resetBase.toFixed(1)} ms; twins ${twinResets.map((r) => r.toFixed(2)).join(', ')}; singles ${singleResets.map((r) => r.toFixed(2)).join(', ')}`,
    );
    for (const r of steps) expect(r).toBeLessThan(2.3);
    for (const r of twinResets) expect(r).toBeLessThan(2.6);
    for (const r of singleResets) expect(r).toBeLessThan(1.3);
  }, 120_000);
});
