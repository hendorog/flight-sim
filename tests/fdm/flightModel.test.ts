// The flight model built from a definition (src/physics/flightModel.ts) and the components it is built from:
// the C172S flies the same, number for number, whichever way it is built, and what a definition says (mass
// convention, control law, air-data rows, autopilot gains, limits, inertia) is what the model does.

import { describe, expect, it } from 'vitest';
import C172S_DEFINITION from '../../src/aircraft/c172s/index';
import { C172S_AIR_DATA, C172S_AUTOPILOT, C172S_CONTROLS, C172S_MASS } from '../../src/aircraft/c172s/systems';
import { placeholderDefinition } from '../../src/aircraft/placeholder';
import type { AircraftDefinition, ControlSystemDef, MassDef } from '../../src/aircraft/types';
import { DEG, FT, G0, KT } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { copyControls, defaultControls, type AircraftState } from '../../src/core/types';
import {
  Autopilot,
  BladeElementFlightModel,
  C172FlightModel,
  ControlLaw,
  ControlSystem,
  createAirData,
  createFlightModel,
  createFlightModelFor,
  createMassModel,
  defaultAutopilotSettings,
  indicatedAirspeed,
  massProperties,
  pitchControlsFor,
  surfaceTargets,
  type Loading,
} from '../../src/physics';
import { ISA_SEA_LEVEL } from '../../src/physics/atmosphere';
import { C172_POWERPLANT } from '../../src/physics/propulsion/c172Powerplant';
import { ELEVATION, LOADING, at, makeRig, resetTo, type Rig } from './helpers';

/** The state with the identity field left out (a placeholder flies the C172S under another id). */
function physical(s: AircraftState): Omit<AircraftState, 'aircraft'> {
  const { aircraft: _, ...rest } = structuredClone(s);
  return rest;
}

/** A take-off roll with the nose raised from 8 s, then, reset in the air, a throttle change and an aileron pulse. */
function flyScript(rig: Rig<BladeElementFlightModel>): AircraftState[] {
  const states: AircraftState[] = [];
  resetTo(rig, { onGround: true, position: at(ELEVATION), heading: 30 * DEG });
  rig.run(12, (t) => {
    const c = rig.controls;
    c.parkingBrake = false;
    c.throttle = 1;
    c.elevator = t > 8 ? 0.4 : 0;
  });
  states.push(structuredClone(rig.fm.state));
  resetTo(rig, { position: at(ELEVATION + 2000 * FT), airspeed: 95 * KT, heading: 200 * DEG });
  rig.run(8, (t) => {
    const c = rig.controls;
    c.throttle = 0.6;
    c.aileron = t > 2 && t < 3 ? 0.3 : 0;
  });
  states.push(structuredClone(rig.fm.state));
  return states;
}

/** `def` with some of its parts replaced (a test-only variant of the C172S). */
function variant(over: Partial<AircraftDefinition>): AircraftDefinition {
  return { ...C172S_DEFINITION, ...over };
}

describe('the C172S built from its definition', () => {
  it('C172FlightModel, createFlightModel(), createFlightModelFor(C172S_DEFINITION) and a placeholder fly the same, to the last bit', () => {
    const rigs = [
      makeRig(),
      makeRig({ def: C172S_DEFINITION }),
      makeRig({ def: placeholderDefinition('c152', { name: 'Cessna 152', shortName: 'C152', variant: 'test', icaoType: 'C152' }) }),
    ];
    expect(rigs[0].fm).toBeInstanceOf(C172FlightModel);
    expect(rigs[1].fm).toBeInstanceOf(BladeElementFlightModel);
    expect(createFlightModel()).toBeInstanceOf(C172FlightModel);
    expect(createFlightModelFor(C172S_DEFINITION).definition).toBe(C172S_DEFINITION);
    const [c172, built, placeholder] = rigs.map(flyScript);
    expect(rigs[2].fm.state.aircraft).toBe('c152');
    expect(c172[0].groundSpeed).toBeGreaterThan(25 * KT);
    expect(Math.abs(c172[1].roll)).toBeGreaterThan(1 * DEG);
    for (let i = 0; i < 2; i++) {
      expect(physical(built[i])).toEqual(physical(c172[i]));
      expect(physical(placeholder[i])).toEqual(physical(c172[i]));
    }
    expect(rigs[1].fm.trimControls).toEqual(rigs[0].fm.trimControls);
  }, 60_000);

  it('makeRig({ def }) takes the definition\'s loadings, maxGross being the rig\'s typical loading', () => {
    const a = makeRig();
    const b = makeRig({ def: C172S_DEFINITION });
    const c = makeRig({ def: C172S_DEFINITION, loading: 'forward' });
    const d = makeRig({ def: C172S_DEFINITION, loading: LOADING.aft });
    expect(b.fm.massProperties).toEqual(a.fm.massProperties);
    expect(c.fm.massProperties).toEqual(makeRig({ options: LOADING.forward }).fm.massProperties);
    expect(d.fm.massProperties).toEqual(makeRig({ options: LOADING.aft }).fm.massProperties);
  });

  it('the members of the interface do what the shell did through the private fields', () => {
    const env = makeRig().env;
    const via = (write: (fm: C172FlightModel) => void) => {
      const fm = new C172FlightModel();
      write(fm);
      fm.reset({ position: at(ELEVATION + 3000 * FT), heading: 0, airspeed: 100 * KT, onGround: false, engineRunning: true }, env);
      return fm;
    };
    const payloadPosition = { x: 0.3, y: 0, z: -0.05 };
    // setLoading: SimPhysics.applyLoading wrote the private `loading` field.
    const field = via((fm) => Object.assign((fm as unknown as { loading: { payload: number; payloadPosition: object } }).loading, { payload: 250, payloadPosition: { ...payloadPosition } }));
    const member = via((fm) => fm.setLoading({ payload: 250, payloadPosition }));
    expect(member.massProperties).toEqual(field.massProperties);
    expect(member.massProperties.mass).not.toBe(new C172FlightModel().massProperties.mass);
    // setClock: SimPhysics.restore wrote the private `time` field.
    member.setClock(123.5);
    expect((member as unknown as { time: number }).time).toBe(123.5);
    // rudderFree is the control system's.
    member.rudderFree = true;
    expect(member.controlSystem.rudderFree).toBe(true);
    member.controlSystem.rudderFree = false;
    expect(member.rudderFree).toBe(false);
    expect(member.powerplant).toBe(member.propulsion);
  });

  it('captureSystems / restoreSystems continue a flight exactly as SimPhysics.restore does with the legacy members', () => {
    const source = makeRig();
    resetTo(source, { position: at(ELEVATION + 3000 * FT), airspeed: 105 * KT, heading: 60 * DEG });
    source.controls.throttle = 0.8;
    source.controls.flaps = 1 / 3;
    source.run(4);
    const s = source.fm.state;
    const systems = source.fm.captureSystems();
    const body = { position: { ...s.position }, orientation: { ...s.orientation }, velocity: { ...s.velocity }, angularVelocity: { ...s.angularVelocity } };
    const q = 0.5 * s.airDensity * (s.velocity.x ** 2 + s.velocity.y ** 2 + s.velocity.z ** 2);
    const ic = { position: { ...s.position }, heading: s.heading, airspeed: s.tas, onGround: false, engineRunning: true, flaps: source.controls.flaps };
    expect(systems.engines).toHaveLength(1);
    expect(systems.tanks).toEqual([s.fuel.left, s.fuel.right]);
    expect(systems.gear.extension).toEqual([1, 1, 1]);

    // Today's path (sim/SimPhysics.ts restore()): the two-tank reset, the four temperatures, the surfaces, the clock.
    const legacy = makeRig();
    resetTo(legacy, ic);
    copyControls(legacy.controls, source.controls);
    const e = systems.engines[0];
    legacy.fm.propulsion.reset({ running: e.running, fuelLeft: systems.tanks[0], fuelRight: systems.tanks[1], rpm: e.rpm, oat: legacy.fm.state.oat, batteryCharge: systems.batteryCharge });
    const th = legacy.fm.propulsion.thermal;
    th.egt = e.egt;
    th.cht = e.cht;
    th.oilTemp = e.oilTemp;
    th.oilPressure = e.oilPressure;
    legacy.fm.controlSystem.setImmediate(legacy.controls, q);
    Object.assign(legacy.fm.controlSystem.surfaces, systems.surfaces);
    (legacy.fm as unknown as { time: number }).time = s.time;
    legacy.fm.setKinematics(body);

    const restored = makeRig();
    resetTo(restored, ic);
    copyControls(restored.controls, source.controls);
    restored.fm.restoreSystems(systems, restored.controls, q);
    restored.fm.setClock(s.time);
    restored.fm.setKinematics(body);

    legacy.run(3);
    restored.run(3);
    expect(restored.fm.state).toEqual(legacy.fm.state);
    // And the restored flight carries on where the source is.
    source.run(3);
    expect(Math.abs(restored.fm.state.altitudeMSL - source.fm.state.altitudeMSL)).toBeLessThan(1);
    expect(Math.abs(restored.fm.state.engine.rpm - source.fm.state.engine.rpm)).toBeLessThan(20);
  }, 30_000);

  it('refuses a definition whose parts disagree; builds every engine count, gear and control kind it may name', () => {
    // Two engines in the powerplant and one propeller station in the aero definition.
    const twin = variant({ engineCount: 2, powerplant: { ...C172_POWERPLANT, engines: [C172_POWERPLANT.engines[0], C172_POWERPLANT.engines[0]], fuel: { ...C172_POWERPLANT.fuel, feeds: [C172_POWERPLANT.fuel.feeds[0], C172_POWERPLANT.fuel.feeds[0]] } } });
    expect(() => new BladeElementFlightModel(twin)).toThrow(/aero propeller stations/);
    expect(() => new BladeElementFlightModel(variant({ engineCount: 2 }))).toThrow(/engines/);
    // A retractable gear in the geometry without a retraction system in gear().
    const retract = variant({ geometry: { ...C172S_DEFINITION.geometry, gear: { ...C172S_DEFINITION.geometry.gear, retractable: true } } });
    expect(() => new BladeElementFlightModel(retract)).toThrow(/retractable/);
    // The control kinds the C172S does not use are built (their behaviour: tests/fixtures/testbeds.test.ts).
    const spring: ControlSystemDef = { ...C172S_CONTROLS, pitchTrim: { kind: 'spring', springUp: -0.1, springDown: 0.1, springQ: 500 } };
    const stabilator: ControlSystemDef = { ...C172S_CONTROLS, pitchTrim: { kind: 'antiServoTab', tabDown: 0.2, tabUp: 0.1, floatRatio: 0.6, gearing: 1.5 } };
    expect(new ControlSystem(spring).law.trimTabDeflection(1)).toBe(0);
    expect(new ControlSystem(stabilator).law.trimTabDeflection(1)).toBe(0.2);
    expect(() => new ControlSystem({ ...C172S_CONTROLS, steering: { kind: 'castering' } })).not.toThrow();
    expect(() => new ControlSystem({ ...C172S_CONTROLS, steering: { kind: 'direct', restraintQ: 1500, refLoad: 2000 } })).not.toThrow();
    expect(() => new ControlSystem({ ...C172S_CONTROLS, flaps: { ...C172S_CONTROLS.flaps, drive: { kind: 'manual', rate: 1 } } })).not.toThrow();
  });

  it('a reset gives the same trim and flight whatever the model did before, to the last bit (C-C5a-01)', () => {
    const ic = { position: at(ELEVATION + 3000 * FT), airspeed: 110 * KT, heading: 1 };
    const fresh = makeRig();
    const used = makeRig();
    resetTo(used, { airspeed: 100 * KT });
    used.run(2);
    resetTo(used, { onGround: true, position: at(ELEVATION) });
    used.run(1);
    for (const rig of [fresh, used]) {
      resetTo(rig, ic);
      rig.run(2);
    }
    expect(used.fm.lastTrim).toEqual(fresh.fm.lastTrim);
    expect(used.fm.trimControls).toEqual(fresh.fm.trimControls);
    expect(used.fm.state).toEqual(fresh.fm.state);
  }, 30_000);
});

describe('what the definition says is what the model does', () => {
  it('the limits: a lower flaps-extended load factor breaks the wing only with the flaps out, a lower dive speed at that speed', () => {
    const fly = (def: AircraftDefinition, flaps: number, airspeed: number) => {
      const rig = makeRig({ def });
      resetTo(rig, { position: at(ELEVATION + 3000 * FT), airspeed, flaps });
      rig.run(1);
      return rig.fm.state.crashReason;
    };
    // An ultimate load of 0.75 g with any flap out: level flight is beyond it.
    const flapLimited = variant({ limits: { ...C172S_DEFINITION.limits, loadFactorPositiveFlaps: 0.5 } });
    expect(fly(flapLimited, 0, 90 * KT)).toBe('');
    expect(fly(flapLimited, 1 / 3, 80 * KT)).toMatch(/^Structural failure: wing overstressed at 1\.0 g/);
    const slow = variant({ limits: { ...C172S_DEFINITION.limits, diveSpeedCas: 90 * KT } });
    expect(fly(slow, 0, 85 * KT)).toBe('');
    expect(fly(slow, 0, 100 * KT)).toMatch(/^Structural failure: overspeed at 9\d KCAS/);
  }, 30_000);

  it('a non-zero Ixz couples roll into yaw with its sign: a rolling moment yaws the nose with Ixz > 0 toward + r', () => {
    const yawAfterAileron = (Ixz: number) => {
      const def = variant({ mass: { ...C172S_MASS, inertia: { ...C172S_MASS.inertia, Ixz } } });
      const rig = makeRig({ def });
      resetTo(rig, { position: at(ELEVATION + 3000 * FT), airspeed: 100 * KT });
      rig.controls.aileron += 0.5;
      rig.run(0.25);
      return rig.fm.state.angularVelocity.z;
    };
    const none = yawAfterAileron(0);
    const plus = yawAfterAileron(300);
    const minus = yawAfterAileron(-300);
    expect(plus).toBeGreaterThan(none);
    expect(minus).toBeLessThan(none);
    const IxzAtCg = makeRig({ def: variant({ mass: { ...C172S_MASS, inertia: { ...C172S_MASS.inertia, Ixz: 300 } } }) }).fm.massProperties.inertia.Ixz;
    expect(IxzAtCg - makeRig().fm.massProperties.inertia.Ixz).toBeCloseTo(300, 9);
  }, 30_000);

  it('the mass model: the inertia about the CG with the empty CG stated gives the same aircraft as about the reference point', () => {
    const c172 = createMassModel();
    const tanks = C172_POWERPLANT.fuel.tanks;
    // The C172S's empty CG, and its inertia about the CG of its inertia loading.
    const emptyOnly = c172.properties({ payload: 0, payloadPosition: { x: 0, y: 0, z: 0 }, tanks: [0, 0] });
    const atLoading = c172.properties({ ...C172S_MASS.inertiaLoading, tanks: tanks.map((t) => t.capacity) });
    const byCg: MassDef = { ...C172S_MASS, emptyCg: emptyOnly.cgOffset, inertia: { about: 'cg', ...atLoading.inertia } };
    const other = createMassModel(byCg, tanks);
    for (const kind of ['typical', 'forward', 'aft', 'maxGross'] as const) {
      const a = c172.properties(c172.loadingFor(kind));
      const b = other.properties(other.loadingFor(kind));
      expect(b.mass).toBe(a.mass);
      for (const k of ['x', 'y', 'z'] as const) expect(b.cgOffset[k]).toBeCloseTo(a.cgOffset[k], 12);
      for (const k of ['Ixx', 'Iyy', 'Izz', 'Ixz'] as const) expect(b.inertia[k]).toBeCloseTo(a.inertia[k], 8);
    }
    expect(() => createMassModel({ ...byCg, emptyCg: undefined }, tanks)).toThrow(/empty CG/);
    // The legacy function is the C172S model, and maxGross weighs the maximum take-off mass with full tanks.
    const legacy: Loading = { ...LOADING.aft, fuelLeft: 50, fuelRight: 60 };
    expect(massProperties(legacy)).toEqual(c172.properties({ ...LOADING.aft, tanks: [50, 60] }));
    expect(c172.properties(c172.loadingFor('maxGross')).mass).toBeCloseTo(C172S_MASS.maxTakeoff, 9);
    expect(c172.maxGrossPayload).toBe(LOADING.typical.payload);
  });

  it('the control law follows its definition: trim travel, float, rigging, and an electric trim that needs the bus', () => {
    const cfg: ControlSystemDef = {
      ...C172S_CONTROLS,
      pitchTrim: { kind: 'tab', tabDown: 10 * DEG, tabUp: 15 * DEG, floatRatio: 0.5 },
      aileron: { ...C172S_CONTROLS.aileron, rigging: 0 },
      trimDrive: { kind: 'electric', minVolts: 20 },
    };
    const law = new ControlLaw(cfg);
    expect(law.trimTabDeflection(1)).toBe(10 * DEG);
    expect(law.trimTabDeflection(-1)).toBe(-15 * DEG);
    // The C172S's free functions are its law; with a definition they are that definition's.
    const out = { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0, elevatorTrim: 0, rudderTrim: 0 };
    const c = { ...defaultControls(), elevatorTrim: 0.4 };
    expect(surfaceTargets(c, 1000, { ...out }, 0, null, cfg)).toEqual(law.surfaceTargets(c, 1000, { ...out }));
    expect(surfaceTargets(c, 1000, { ...out })).toEqual(new ControlLaw().surfaceTargets(c, 1000, { ...out }));
    expect(law.surfaceTargets(c, 0, { ...out }).elevator).toBeCloseTo(-0.5 * 0.4 * 10 * DEG, 15);
    expect(law.surfaceTargets(defaultControls(), 0, { ...out }).aileronLeft).toBe(0);
    // pitchControlsFor round-trips through surfaceTargets with the definition's trim.
    const pc = pitchControlsFor(-0.03, 0, cfg);
    expect(law.surfaceTargets({ ...defaultControls(), ...pc }, 0, { ...out }).elevator).toBeCloseTo(-0.03, 12);
    // The electric trim stands still on a dead bus; the trim wheel of the C172S does not need one.
    const electric = new ControlSystem(cfg);
    const wheel = new ControlSystem();
    for (const cs of [electric, wheel]) cs.update(0.5, { ...defaultControls(), elevatorTrim: 1 }, 1000, 12);
    expect(electric.surfaces.elevatorTrim).toBe(0);
    expect(wheel.surfaces.elevatorTrim).toBeGreaterThan(0);
    electric.update(0.5, { ...defaultControls(), elevatorTrim: 1 }, 1000, 28);
    expect(electric.surfaces.elevatorTrim).toBeGreaterThan(0);
  });

  it('the airspeed indicator: every calibration row is met, linear in flap degrees between rows; no rows is IAS = CAS', () => {
    const area = 12;
    const rows = {
      calibration: [
        { flapDeg: 0, cas: [50, 70, 100], ias: [45, 70, 102] },
        { flapDeg: 15, cas: [45, 60, 80], ias: [38, 58, 80] },
        { flapDeg: 25, cas: [42, 55, 75], ias: [35, 54, 76] },
        { flapDeg: 40, cas: [40, 50, 70], ias: [30, 50, 72] },
      ],
      referenceMass: 900,
      asiAliveKt: [20, 35] as const,
    };
    const travel = 40 * DEG;
    const ad = createAirData(rows, area, travel);
    const clAt = (casKt: number) => (rows.referenceMass * G0) / (0.5 * ISA_SEA_LEVEL.density * (casKt * KT) ** 2 * area);
    for (const row of rows.calibration) {
      row.cas.forEach((casKt, k) => expect(ad.indicatedAirspeed(casKt * KT, row.flapDeg * DEG, clAt(casKt)) / KT).toBeCloseTo(row.ias[k], 9));
    }
    // Half way between the 15 and 25 degree rows at one lift coefficient: the mean of the two errors.
    const cl = clAt(60);
    const err = (deg: number) => 1 - ad.indicatedAirspeed(60 * KT, deg * DEG, cl) / (60 * KT);
    expect(err(20)).toBeCloseTo((err(15) + err(25)) / 2, 12);
    expect(err(50)).toBe(err(40));
    expect(createAirData({ ...rows, calibration: [] }, area, travel).indicatedAirspeed(33, 0.2, 0.8)).toBe(33);
    // The C172S's legacy function is its air data.
    const c172 = createAirData(C172S_AIR_DATA, C172S_DEFINITION.geometry.wing.area, C172S_CONTROLS.flaps.maxDeflection);
    for (const [cas, flaps, clv] of [[40, 0, 1.2], [30, 0.1, 0.9], [25, 0.3, 1.5], [60, 0.52, 0.3]]) {
      expect(c172.indicatedAirspeed(cas, flaps, clv)).toBe(indicatedAirspeed(cas, flaps, clv));
    }
  });

  it('the autopilot flies with the gains it is given and takes its settings\' defaults from them', () => {
    const gains = { ...C172S_AUTOPILOT, rollKp: 2 * C172S_AUTOPILOT.rollKp, defaults: { airspeed: 40, verticalSpeed: 2.5, maxBank: 20 * DEG } };
    expect(new Autopilot(gains).settings).toEqual({ ...defaultAutopilotSettings(), airspeed: 40, verticalSpeed: 2.5, maxBank: 20 * DEG });
    const state = makeMockState();
    state.roll = 5 * DEG;
    state.angularVelocity.x = 0;
    const command = (ap: Autopilot) => {
      const c = defaultControls();
      ap.update(0.02, state, c);
      return c.aileron;
    };
    const base = command(new Autopilot());
    const doubled = command(new Autopilot(gains));
    expect(base).toBeLessThan(0);
    expect(doubled).toBeCloseTo(2 * base, 9);
  });
});
