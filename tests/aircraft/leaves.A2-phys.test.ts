// The Cessna 172S systems and powerplant definitions (src/aircraft/c172s/systems.ts,
// src/physics/propulsion/c172Powerplant.ts): every member IS the constant the physics code computes with
// (toBe, not a tolerance), the few numbers that are written in the definitions themselves are pinned, and what
// the definitions say about the aircraft is true of the models they describe (the calibration rows, the
// reference loading of the inertia, the fuel selector, the flap detents).

import { describe, expect, it } from 'vitest';
import { C172_POWERPLANT as POWERPLANT_FROM_AIRCRAFT } from '../../src/aircraft/c172s/powerplant';
import { C172S_AIR_DATA, C172S_AUTOPILOT, C172S_CONTROLS, C172S_LIMITS, C172S_MASS } from '../../src/aircraft/c172s/systems';
import { C172S_REFERENCE } from '../../src/aircraft/c172s/reference';
import systemsSource from '../../src/aircraft/c172s/systems.ts?raw';
import { C172 } from '../../src/core/c172';
import { DEG, G0, KT } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, type FuelSelector } from '../../src/core/types';
import { FLAP_DETENTS } from '../../src/input/virtualYoke';
import { BUS_DEAD_VOLTS } from '../../src/instruments/dynamics/engineSystems';
import * as airData from '../../src/physics/airData';
import { ISA_SEA_LEVEL } from '../../src/physics/atmosphere';
import * as autopilot from '../../src/physics/autopilot';
import * as flightModel from '../../src/physics/c172FlightModel';
import * as controlSystem from '../../src/physics/controlSystem';
import * as massModel from '../../src/physics/massModel';
import * as airfoil from '../../src/physics/propulsion/airfoil';
import * as bladeGeometry from '../../src/physics/propulsion/bladeGeometry';
import { C172_POWERPLANT } from '../../src/physics/propulsion/c172Powerplant';
import powerplantSource from '../../src/physics/propulsion/c172Powerplant.ts?raw';
import * as combustion from '../../src/physics/propulsion/combustion';
import { AVGAS_100LL } from '../../src/physics/propulsion/defs';
import * as electrical from '../../src/physics/propulsion/electrical';
import * as engine from '../../src/physics/propulsion/engine';
import * as engineThermal from '../../src/physics/propulsion/engineThermal';
import * as fuelSystem from '../../src/physics/propulsion/fuelSystem';
import * as induction from '../../src/physics/propulsion/induction';
import * as propulsionSystem from '../../src/physics/propulsion/propulsionSystem';
import { LOADING } from '../fdm/helpers';
import { DT, makeInput, runningSystem } from '../propulsion/helpers';

/** The import statements of a module's source that bring in VALUES from another module, with the rest of their last line. */
function valueImports(source: string): { from: string; tail: string }[] {
  const found: { from: string; tail: string }[] = [];
  for (const m of source.matchAll(/^import (type )?[^;]*? from '([^']+)';(.*)$/gm)) {
    if (!m[1]) found.push({ from: m[2], tail: m[3] });
  }
  return found;
}

/**
 * `actual` has exactly the members of `expected`, and every number, string and shared table in it IS the
 * expected one (toBe); only the containers written in the definition itself are walked.
 */
function expectSame(actual: unknown, expected: unknown, path: string): void {
  if (Object.is(actual, expected) || typeof expected !== 'object' || expected === null || typeof actual !== 'object' || actual === null) {
    expect(actual, path).toBe(expected);
    return;
  }
  expect(Object.keys(actual).sort(), path).toEqual(Object.keys(expected).sort());
  for (const [key, value] of Object.entries(expected)) expectSame((actual as Record<string, unknown>)[key], value, `${path}.${key}`);
}

describe('C172_POWERPLANT: the engine', () => {
  const inst = C172_POWERPLANT.engines[0];
  const e = inst.engine;

  it('is one clockwise, direct-drive spark engine at the propeller hub of core/c172.ts', () => {
    expect(C172_POWERPLANT.engines).toHaveLength(1);
    expect(inst.hub).toBe(C172.prop.hub);
    expect(inst.rotation).toBe(1);
    expect(inst.tilt).toBeUndefined();
    expect(e.kind).toBe('sparkPiston');
    expect(e.cylinders).toBe(4);
    expect(e.gearRatio).toBe(1);
    expect(e.fadec).toBeUndefined();
    expect(e.ratedPower).toBe(C172.engine.ratedPower);
    expect(e.ratedRpm).toBe(C172.engine.ratedRpm);
    expect(e.idleRpm).toBe(C172.engine.idleRpm);
    expect(e.displacement).toBe(induction.DISPLACEMENT);
    expect(e.compressionRatio).toBe(induction.COMPRESSION_RATIO);
    expect(e.fuel).toBe(AVGAS_100LL);
  });

  it('splits the shaft inertia so that the sum is exactly ROTOR_INERTIA', () => {
    expect(inst.propeller.inertia).toBe(1.2);
    expect(e.rotatingInertia).toBe(0.5);
    expect(inst.propeller.inertia + e.gearRatio * e.gearRatio * e.rotatingInertia).toBe(propulsionSystem.ROTOR_INERTIA);
  });

  it('induction, metering and ignition are the constants of induction.ts, combustion.ts and engine.ts', () => {
    const i = e.induction;
    expect(i.throttleBoreArea).toBe(induction.THROTTLE_BORE_AREA);
    expect(i.throttleCd).toBe(induction.THROTTLE_CD);
    expect(i.closedAngle).toBe(induction.CLOSED_ANGLE);
    expect(i.idleArea).toBe(induction.IDLE_AREA);
    expect(i.inletArea).toBe(induction.INLET_AREA);
    expect(i.exhaustCoeff).toBe(induction.EXHAUST_COEFF);
    expect(i.inductionHeating).toBe(induction.INDUCTION_HEATING);
    expect(i.ramRecovery).toBe(propulsionSystem.RAM_RECOVERY);
    expect(i.veReferenceT).toBe(induction.VE_REFERENCE_T);
    expect(i.veRpm).toBe(induction.VE_RPM);
    expect(i.ve).toBe(induction.VE);
    expect(i.carburettor).toBeUndefined();
    expect(i.alternateAir).toBeUndefined();
    expectSame(e.metering, { kind: 'rsaInjection', fullRichPhi: combustion.FULL_RICH_PHI, leanestFraction: combustion.LEANEST_FRACTION }, 'metering');
    const ignition = {
      kind: 'magnetos',
      minFiringRpm: engine.MIN_FIRING_RPM,
      singleLoss: engine.SINGLE_MAG_LOSS,
      singleDilutionLoss: engine.SINGLE_MAG_DILUTION_LOSS,
      dilutionSensitivity: engine.DILUTION_SENSITIVITY,
    };
    expectSame(e.ignition, ignition, 'ignition');
  });

  it('friction, starting and the starter are the constants of engine.ts, propulsionSystem.ts and electrical.ts', () => {
    expect(e.fmep).toHaveLength(3);
    e.fmep.forEach((c, k) => expect(c).toBe(engine.FMEP_COEFFS[k]));
    expect(e.coldFrictionFactor).toBe(engine.COLD_FRICTION_FACTOR);
    expect(e.compressionLossTorque).toBe(engine.COMPRESSION_LOSS_TORQUE);
    expect(e.breakawayTorque).toBe(propulsionSystem.BREAKAWAY_TORQUE);
    expect(e.runningRpm).toBe(propulsionSystem.RUNNING_RPM);
    expect(e.starter.k).toBe(electrical.STARTER_K);
    expect(e.starter.r).toBe(electrical.STARTER_R);
  });

  it('the start speeds are the flight model\'s (written out: the definition may not import the flight model)', () => {
    expect(e.airStartRpm).toBe(flightModel.AIR_START_RPM);
    expect(e.groundStartRpm).toBe(flightModel.GROUND_START_RPM);
  });

  it('the thermal model is the constants of engineThermal.ts, air cooled, without cowl flaps', () => {
    const t = e.thermal;
    expect(t.cooling).toBe('air');
    expect(t.liquid).toBeUndefined();
    expect(t.cowlFlapClosedFactor).toBe(1);
    expect(t.headCapacity).toBe(engineThermal.HEAD_CAPACITY);
    expect(t.headConductance).toBe(engineThermal.HEAD_CONDUCTANCE);
    expect(t.headHeatFraction).toBe(engineThermal.HEAD_HEAT_FRACTION);
    expect(t.referenceMassFlux).toBe(engineThermal.REFERENCE_MASS_FLUX);
    expect(t.oilCapacity).toBe(engineThermal.OIL_CAPACITY);
    expect(t.oilCoolerConductance).toBe(engineThermal.OIL_COOLER_CONDUCTANCE);
    expect(t.crankcaseConductance).toBe(engineThermal.CRANKCASE_CONDUCTANCE);
    expect(t.oilPsiPerRpm).toBe(engineThermal.OIL_PSI_PER_RPM);
    expect(t.oilReliefPsi).toBe(engineThermal.OIL_RELIEF_PSI);
    const warm = {
      egt: engineThermal.WARM_EGT,
      cht: engineThermal.WARM_CHT,
      oilTemp: engineThermal.WARM_OIL_TEMP,
      oilPressure: engineThermal.WARM_OIL_PRESSURE,
    };
    expectSame(t.warm, warm, 'warm');
    // The named values are what a reset with the engine running gives.
    const th = new engineThermal.EngineThermal();
    th.reset(true, 288.15);
    expect({ egt: th.egt, cht: th.cht, oilTemp: th.oilTemp, oilPressure: th.oilPressure }).toEqual(t.warm);
  });
});

describe('C172_POWERPLANT: the propeller', () => {
  const p = C172_POWERPLANT.engines[0].propeller;

  it('is the fixed-pitch blade of bladeGeometry.ts', () => {
    expect(p.diameter).toBe(C172.prop.diameter);
    expect(p.diameter / 2).toBe(bladeGeometry.PROP_RADIUS);
    expect(p.blades).toBe(bladeGeometry.PROP_BLADES);
    expect(p.hubRadius).toBe(bladeGeometry.PROP_HUB_RADIUS);
    expect(p.stationX).toBe(bladeGeometry.STATION_X);
    expect(p.chordOverR).toBe(bladeGeometry.CHORD_OVER_R);
    expect(p.thicknessX).toBe(bladeGeometry.THICKNESS_X);
    expect(p.thickness).toBe(bladeGeometry.THICKNESS);
    expectSame(p.twist, { kind: 'helix', pitch: bladeGeometry.PROP_PITCH }, 'twist');
    expect(p.pitchControl).toEqual({ kind: 'fixed' });
    expect(p.referenceStation).toBeUndefined();
  });

  it('carries the blade section of airfoil.ts', () => {
    const section = {
      alpha0: airfoil.ALPHA0,
      liftSlope: airfoil.LIFT_SLOPE,
      clMaxLowSpeed: airfoil.CL_MAX_LOW_SPEED,
      clMaxMachLoss: airfoil.CL_MAX_MACH_LOSS,
      clMin: airfoil.CL_MIN,
      cdMax: airfoil.CD_MAX,
      clMinDrag: airfoil.CL_MIN_DRAG,
      dragDueToLift: airfoil.DRAG_DUE_TO_LIFT,
      clIdeal: airfoil.CL_IDEAL,
    };
    expectSame(p.section, section, 'section');
  });
});

describe('C172_POWERPLANT: the fuel system', () => {
  const fuel = C172_POWERPLANT.fuel;
  const feed = fuel.feeds[0];

  it('has the two wing tanks of the mass model, in the order of AircraftState.fuel.tanks', () => {
    expect(fuel.tanks.map((t) => t.id)).toEqual(makeMockState().fuel.tanks.map((t) => t.id));
    expect(fuel.tanks.map((t) => t.side)).toEqual(['left', 'right']);
    for (const t of fuel.tanks) expect(t.capacity).toBe(fuelSystem.TANK_CAPACITY);
    expect(fuel.tanks[0].capacity + fuel.tanks[1].capacity).toBe(C172.mass.usableFuel);
    const tank = C172.mass.tank;
    expect(fuel.tanks[0].position).toEqual({ x: tank.x, y: -tank.y, z: tank.z });
    expect(fuel.tanks[1].position).toEqual({ x: tank.x, y: tank.y, z: tank.z });
  });

  it('the feed is the constants of fuelSystem.ts', () => {
    expect(fuel.feeds).toHaveLength(1);
    expect(feed.gravityHeadPsi).toBe(0);
    expect(feed.feedCapacity).toBe(fuelSystem.FEED_CAPACITY);
    expect(feed.lineCapacity).toBe(fuelSystem.LINE_CAPACITY);
    expect(feed.lineUnusable).toBe(fuelSystem.LINE_UNUSABLE);
    expectSame(feed.enginePump, { psi: fuelSystem.ENGINE_PUMP_PSI }, 'enginePump');
    expectSame(feed.auxPump, { psi: fuelSystem.AUX_PUMP_PSI, minVolts: fuelSystem.AUX_PUMP_MIN_VOLTS }, 'auxPump');
    const delivery = {
      kind: 'injector',
      capacity: fuelSystem.INJECTOR_CAPACITY,
      openPsi: fuelSystem.INJECTION_OPEN_PSI,
      fullPsi: fuelSystem.INJECTION_FULL_PSI,
    };
    expectSame(feed.delivery, delivery, 'delivery');
    expectSame(feed.film, { fraction: fuelSystem.FILM_FRACTION, time: fuelSystem.FILM_TIME }, 'film');
  });

  it('the selector map names the tanks the running engine really draws from in every position', () => {
    const positions: FuelSelector[] = ['off', 'left', 'right', 'both', 'on', 'crossfeed'];
    for (const fuelSelector of positions) {
      const sys = runningSystem(2300);
      const input = makeInput({ ktas: 100, controls: { fuelSelector } });
      const before = [sys.fuelLeft, sys.fuelRight];
      for (let k = 0; k < Math.round(1 / DT); k++) sys.step(input);
      const drawn = [sys.fuelLeft, sys.fuelRight].flatMap((q, tank) => (q < before[tank] ? [tank] : []));
      expect(drawn, fuelSelector).toEqual(feed.positions[fuelSelector] ?? []);
    }
  });
});

describe('C172_POWERPLANT: the electrical system', () => {
  const el = C172_POWERPLANT.electrical;

  it('is the constants of electrical.ts', () => {
    expect(el.nominalVolts).toBe(electrical.NOMINAL_VOLTS);
    expect(el.regulatorVolts).toBe(electrical.REGULATOR_VOLTS);
    const battery = {
      capacityAh: electrical.BATTERY_CAPACITY_AH,
      ocvEmpty: electrical.OCV_EMPTY,
      ocvSpan: electrical.OCV_SPAN,
      rDischarge: electrical.R_DISCHARGE,
      rChargeBase: electrical.R_CHARGE_BASE,
      rChargeFull: electrical.R_CHARGE_FULL,
    };
    expectSame(el.battery, battery, 'battery');
    const alternator = {
      engine: 0,
      maxAmps: electrical.ALTERNATOR_MAX_AMPS,
      cutInRpm: electrical.ALTERNATOR_CUT_IN_RPM,
      fullRpm: electrical.ALTERNATOR_FULL_RPM,
      efficiency: electrical.ALTERNATOR_EFFICIENCY,
    };
    expectSame(el.alternators, [alternator], 'alternators');
    expect(el.loads).toBe(electrical.LOAD_AMPS);
    // Every consumer the load sum looks up by name is there.
    for (const name of ['master', 'avionics', 'nav', 'beacon', 'strobe', 'landing', 'taxi', 'panelFull', 'pitotHeat', 'fuelPump']) {
      expect(el.loads[name], name).toBeGreaterThan(0);
    }
  });

  it('keeps its thresholds in volts', () => {
    expect(el.nominalVolts).toBe(28);
    expect(el.lowVoltsLamp).toBe(24.5);
    expect(el.overVolts).toBe(32);
    expect(el.busDeadVolts).toBe(18);
    expect(el.busDeadVolts).toBe(BUS_DEAD_VOLTS);
    expect(C172_POWERPLANT.fuel.feeds[0].auxPump?.minVolts).toBe(18);
    expect(C172S_CONTROLS.flaps.drive).toMatchObject({ kind: 'electric', minVolts: 20 });
  });
});

describe('C172_POWERPLANT: the object', () => {
  it('is what src/aircraft/c172s/powerplant.ts exports', () => {
    expect(POWERPLANT_FROM_AIRCRAFT).toBe(C172_POWERPLANT);
  });

  it('is plain data', () => {
    expect(structuredClone(C172_POWERPLANT)).toEqual(C172_POWERPLANT);
    expect(JSON.parse(JSON.stringify(C172_POWERPLANT))).toEqual(C172_POWERPLANT);
  });

  it('marks every import of a propulsion component module BYREF(B2)', () => {
    for (const i of valueImports(powerplantSource)) {
      if (i.from === './defs' || i.from.includes('core/')) continue;
      expect(i.tail, i.from).toContain('// BYREF(B2)');
    }
  });
});

describe('C172S_MASS', () => {
  const m = C172S_MASS;

  it('is the masses and the inertia of core/c172.ts, about the reference point', () => {
    expect(m.empty).toBe(C172.mass.empty);
    expect(m.maxTakeoff).toBe(C172.mass.maxTakeoff);
    expect(m.maxLanding).toBe(C172.mass.maxTakeoff);
    expectSame(m.inertia, { about: 'referencePoint', Ixx: C172.mass.Ixx, Iyy: C172.mass.Iyy, Izz: C172.mass.Izz, Ixz: C172.mass.Ixz }, 'inertia');
    expect(m.emptyCg).toBeUndefined();
    expect(m.seatY).toBe(massModel.SEAT_Y);
    expect(m.inertiaLoading.payload).toBe(C172.mass.crew);
    expect(m.inertiaLoading.payloadPosition).toBe(C172.mass.crewPos);
    expect(m.inertiaLoading.fuelFraction).toBeUndefined();
  });

  it('the inertia loading is the one the mass model balances at the reference point with that inertia', () => {
    const tank = C172_POWERPLANT.fuel.tanks[0].capacity;
    const mp = massModel.massProperties({ ...m.inertiaLoading, fuelLeft: tank, fuelRight: tank });
    expect(Math.hypot(mp.cgOffset.x, mp.cgOffset.y, mp.cgOffset.z)).toBeLessThan(1e-12);
    expect(mp.inertia.Ixx).toBeCloseTo(m.inertia.Ixx, 9);
    expect(mp.inertia.Iyy).toBeCloseTo(m.inertia.Iyy, 9);
    expect(mp.inertia.Izz).toBeCloseTo(m.inertia.Izz, 9);
    expect(mp.inertia.Ixz).toBeCloseTo(m.inertia.Ixz, 9);
  });

  it('the typical loading is the flight model\'s default payload', () => {
    expect(m.loadings.typical.payload).toBe(flightModel.DEFAULT_PAYLOAD);
    expect(m.loadings.typical.payloadPosition).toBe(flightModel.DEFAULT_PAYLOAD_POSITION);
  });

  it('forward, aft and maxGross are the three loadings of the flight tests, number for number', () => {
    const pairs = [
      [m.loadings.forward, LOADING.forward],
      [m.loadings.aft, LOADING.aft],
      [m.loadings.maxGross, LOADING.typical],
    ] as const;
    for (const [def, rig] of pairs) {
      expect(def.payload).toBe(rig.payload);
      expect(def.payloadPosition.x).toBe(rig.payloadPosition.x);
      expect(def.payloadPosition.y).toBe(rig.payloadPosition.y);
      expect(def.payloadPosition.z).toBe(rig.payloadPosition.z);
      expect(def.fuelFraction).toBeUndefined();
    }
    expect(m.loadings.forward.payload).toBe(massModel.MAX_GROSS_PAYLOAD);
    // With full tanks each of them is the maximum take-off mass.
    const tank = C172_POWERPLANT.fuel.tanks[0].capacity;
    expect(massModel.massProperties({ ...m.loadings.maxGross, fuelLeft: tank, fuelRight: tank }).mass).toBeCloseTo(m.maxTakeoff, 9);
  });
});

describe('C172S_LIMITS', () => {
  const l = C172S_LIMITS;

  it('is the limits the flight model fails the structure at', () => {
    expect(l.loadFactorPositive).toBe(flightModel.LIMIT_LOAD_POSITIVE);
    expect(l.loadFactorNegative).toBe(flightModel.LIMIT_LOAD_NEGATIVE);
    expect(l.ultimateFactor).toBe(flightModel.ULTIMATE_FACTOR);
    expect(l.diveSpeedCas).toBe(flightModel.DIVE_SPEED);
    expect(l.structureTime).toBe(flightModel.STRUCTURE_TIME);
  });

  it('has the values of the POH: +3.8 / -1.52 g, ultimate 1.5, Vne / 0.9', () => {
    expect(l.loadFactorPositive).toBe(3.8);
    expect(l.loadFactorNegative).toBe(-1.52);
    expect(l.ultimateFactor).toBe(1.5);
    expect(l.loadFactorPositive * l.ultimateFactor).toBe(3.8 * 1.5);
    expect(l.loadFactorNegative * l.ultimateFactor).toBe(-1.52 * 1.5);
    expect(l.diveSpeedCas).toBe((163 / 0.9) * KT);
    expect(l.structureTime).toBe(0.03);
  });

  it('gives one flap limit speed per detent and monitors neither flap nor gear overspeed', () => {
    expect(l.vfeCas).toHaveLength(C172S_CONTROLS.flaps.detents.length);
    expect(l.vfeCas[0]).toBe(Infinity);
    expect(l.vfeCas.slice(1)).toEqual(C172S_REFERENCE.vfe.map((kias) => kias * KT));
    expect(l.flapOverspeed.consequence).toBe('none');
    expect(l.gearOverspeed.consequence).toBe('none');
    expect(l.vleCas).toBeUndefined();
  });
});

describe('C172S_CONTROLS', () => {
  const c = C172S_CONTROLS;

  it('is the constants of controlSystem.ts and the travels of core/c172.ts', () => {
    const elevator = {
      maxUp: C172.hTail.elevator.maxUp,
      maxDown: C172.hTail.elevator.maxDown,
      alphaFloat: controlSystem.ELEVATOR_ALPHA_FLOAT,
      floatAlphaLimit: controlSystem.FLOAT_ALPHA_LIMIT,
      floatQHalf: controlSystem.FLOAT_Q_HALF,
    };
    expectSame(c.elevator, elevator, 'elevator');
    const aileron = { maxUp: C172.wing.aileron.maxUp, maxDown: C172.wing.aileron.maxDown, rigging: controlSystem.AILERON_RIGGING };
    expectSame(c.aileron, aileron, 'aileron');
    const rudder = {
      maxDeflection: C172.vTail.rudder.maxDeflection,
      tabOffset: controlSystem.RUDDER_TAB_OFFSET,
      alphaFloat: controlSystem.RUDDER_ALPHA_FLOAT,
      floatLimit: controlSystem.RUDDER_FLOAT_LIMIT,
    };
    expectSame(c.rudder, rudder, 'rudder');
    const pitchTrim = {
      kind: 'tab',
      tabDown: controlSystem.TRIM_TAB_DOWN,
      tabUp: controlSystem.TRIM_TAB_UP,
      floatRatio: controlSystem.TRIM_FLOAT_RATIO,
    };
    expectSame(c.pitchTrim, pitchTrim, 'pitchTrim');
    expect(c.trimRate).toBe(controlSystem.TRIM_RATE);
    expect(c.flaps.maxDeflection).toBe(C172.wing.flap.maxDeflection);
    expectSame(c.flaps.drive, { kind: 'electric', rate: controlSystem.FLAP_RATE, minVolts: controlSystem.FLAP_MIN_VOLTS }, 'flaps.drive');
    expect(c.stretchQ).toBe(controlSystem.STRETCH_Q);
    expect(c.surfaceRate).toBe(controlSystem.SURFACE_RATE);
    expectSame(c.steering, { kind: 'bungee', ...controlSystem.FEET_OFF_GROUND }, 'steering');
  });

  it('has the detents 0, 10, 20 and 30 degrees, which the thirds of the flap lever select', () => {
    const d = c.flaps.detents;
    expect(d).toHaveLength(4);
    expect(d[0]).toBe(0);
    expect(d[3]).toBe(c.flaps.maxDeflection);
    d.forEach((rad, k) => expect(rad / DEG).toBeCloseTo(10 * k, 12));
    // To the last bit: the lever value of a detent is detents[i] / maxDeflection, and the flap target there is detents[i].
    const out = { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0, elevatorTrim: 0, rudderTrim: 0 };
    d.forEach((rad, k) => {
      expect(rad / c.flaps.maxDeflection).toBe(FLAP_DETENTS[k]);
      expect(controlSystem.surfaceTargets({ ...defaultControls(), flaps: FLAP_DETENTS[k] }, 0, out).flaps).toBe(rad);
    });
  });
});

describe('C172S_AIR_DATA', () => {
  const a = C172S_AIR_DATA;

  it('is the three calibration tables of airData.ts at the maximum take-off mass', () => {
    expect(a.calibration.map((row) => row.flapDeg)).toEqual([0, 10, 30]);
    expect(a.calibration[0].cas).toBe(airData.TABLES.up.cas);
    expect(a.calibration[0].ias).toBe(airData.TABLES.up.ias);
    expect(a.calibration[1].cas).toBe(airData.TABLES.f10.cas);
    expect(a.calibration[1].ias).toBe(airData.TABLES.f10.ias);
    expect(a.calibration[2].cas).toBe(airData.TABLES.f30.cas);
    expect(a.calibration[2].ias).toBe(airData.TABLES.f30.ias);
    expect(a.referenceMass).toBe(C172.mass.maxTakeoff);
    expect(a.asiAliveKt).toEqual([18, 35]);
  });

  it('every row is what the airspeed indicator shows in 1-g flight at the reference mass', () => {
    for (const row of a.calibration) {
      row.cas.forEach((casKt, k) => {
        const cas = casKt * KT;
        const cl = (a.referenceMass * G0) / (0.5 * ISA_SEA_LEVEL.density * cas * cas * C172.wing.area);
        expect(airData.indicatedAirspeed(cas, row.flapDeg * DEG, cl) / KT, `flaps ${row.flapDeg}, ${casKt} KCAS`).toBeCloseTo(row.ias[k], 9);
      });
    }
  });
});

describe('C172S_AUTOPILOT', () => {
  const g = C172S_AUTOPILOT;

  it('is the gains of autopilot.ts', () => {
    const gains = {
      qRef: autopilot.Q_REF,
      pitchKp: autopilot.PITCH_KP,
      pitchKi: autopilot.PITCH_KI,
      pitchKq: autopilot.PITCH_KQ,
      rollKp: autopilot.ROLL_KP,
      rollKd: autopilot.ROLL_KD,
      rollKi: autopilot.ROLL_KI,
      headingK: autopilot.HEADING_K,
      altitudeK: autopilot.ALTITUDE_K,
      vsKp: autopilot.VS_KP,
      vsKi: autopilot.VS_KI,
      speedKp: autopilot.SPEED_KP,
      speedKi: autopilot.SPEED_KI,
      throttleKp: autopilot.THROTTLE_KP,
      throttleKi: autopilot.THROTTLE_KI,
      ballKp: autopilot.BALL_KP,
      ballKi: autopilot.BALL_KI,
      yawKr: autopilot.YAW_KR,
      rudderLimit: autopilot.RUDDER_LIMIT,
      trimRate: autopilot.TRIM_RATE,
      pitchLimit: autopilot.PITCH_LIMIT,
      trimEquivalence: autopilot.TRIM_EQUIVALENCE,
      defaults: { airspeed: autopilot.DEFAULT_AIRSPEED, verticalSpeed: autopilot.DEFAULT_VERTICAL_SPEED, maxBank: autopilot.DEFAULT_MAX_BANK },
    };
    expectSame(g, gains, 'autopilot');
  });

  it('has the rudder clamp 0.6, the trim equivalence of the tab and the defaults of the settings', () => {
    expect(g.rudderLimit).toBe(0.6);
    expect(g.trimEquivalence).toBe((controlSystem.TRIM_FLOAT_RATIO * controlSystem.TRIM_TAB_DOWN) / C172S_CONTROLS.elevator.maxUp);
    const s = autopilot.defaultAutopilotSettings();
    expect(g.defaults).toEqual({ airspeed: s.airspeed, verticalSpeed: s.verticalSpeed, maxBank: s.maxBank });
    expect(g.defaults).toEqual({ airspeed: 45, verticalSpeed: 3.5, maxBank: 25 * DEG });
  });
});

describe('systems.ts: the file', () => {
  it('is plain data', () => {
    for (const def of [C172S_MASS, C172S_LIMITS, C172S_CONTROLS, C172S_AIR_DATA, C172S_AUTOPILOT]) {
      expect(structuredClone(def)).toEqual(def);
    }
  });

  it('marks every import of a physics component module BYREF(C1a)', () => {
    for (const i of valueImports(systemsSource)) {
      if (i.from.startsWith('./') || i.from.includes('core/')) continue;
      expect(i.tail, i.from).toContain('// BYREF(C1a)');
    }
  });
});
