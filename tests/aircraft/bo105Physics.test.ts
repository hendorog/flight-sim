// MBB Bo 105 CB-4: the definition's data against its sources (BO, plan revision 2 section 6.1). Flight behaviour is
// tested in tests/rotorcraft/bo105{Derivatives,Performance,Systems,Handling}.test.ts.
import { describe, expect, it } from 'vitest';
import { DEG, FT } from '../../src/core/math';
import { BO105_DEFINITION as def } from '../../src/aircraft/bo105';
import * as D from '../../src/aircraft/bo105/dimensions';
import { BO105_ENGINE_RATIO, BO105_FUEL, BO105_INERTIA, BO105_MASS_KG, BO105_NR_100, BO105_N2_100_RPM, BO105_PCT_PER_NM,
  BO105_POWER_LEVER, BO105_TAIL_RATIO, BO105_TORQUE_100_W } from '../../src/aircraft/bo105/facts';
import { BO105_REFERENCE as V } from '../../src/aircraft/bo105/reference';
import { BO105_HUB_SET, BO105_MAIN_ROTOR, BO105_MAST_MOMENT } from '../../src/aircraft/bo105/hub';
import { BO105_BLADE_CONING } from '../../src/aircraft/bo105/coning';
import { BO105_ENGINE, BO105_POWERPLANT } from '../../src/aircraft/bo105/powerplant';
import { BO105_SPEED_CORRECTIONS, BO105_VNE, BO105_VNE_OAT_C, BO105_VNE_PA_FT, BO105_VNE_TABLE } from '../../src/aircraft/bo105/limits';
import { BO105_INSTALLED_C20B, BO105_TURBOSHAFT_INDICATION, BO105_TWIN } from '../../src/aircraft/bo105/twin';
import { AIRCRAFT_CATALOGUE } from '../../src/aircraft/registry';
import { configuredVne, placardVne } from '../../src/physics/rotorcraft/limits';
import { bladeConing } from '../../src/physics/rotorcraft/coning';
import { hingelessBlade, hingelessSpring } from '../../src/physics/rotorcraft/hingeless';
import { createMassModel } from '../../src/physics/massModel';
import { cgLimits } from '../rotorcraft/bo105Rig';

const r = def.rotorcraft!, hub = r.hubModel!, ts = r.systems.turboshaft!;

describe('Bo 105 CB-4 definition', () => {
  it('identity: id bo105, two engines, available (owner approved 2026-10-22) (AGENT choice: the CB-4)', () => {
    expect(def.id).toBe('bo105'); expect(def.engineCount).toBe(2); expect(def.icaoType).toBe('B105');
    expect(def.name).toBe('MBB Bo 105 CB-4');
    expect(AIRCRAFT_CATALOGUE.find((row) => row.id === 'bo105')?.available).toBe(true);
    expect(def.placeholder).toBeUndefined();
  });

  it('rotor (P TCDS p8, AR-280 p145, METU): four blades, R 4.92 m, chord 0.27 m, root 1.10 m, twist -6.2 deg, 3 deg forward shaft, CCW; tail rotor two blades, R 0.95 m, chord 0.18 m on the left at the fin top', () => {
    expect([r.main.blades, r.main.radius, r.main.chord, r.main.rootCutout]).toEqual([4, 4.92, 0.27, 1.10]);
    expect(r.main.twist / DEG).toBeCloseTo(-6.2, 9);
    expect(r.shaftTilt! / DEG).toBeCloseTo(3, 9); expect(r.rotation).toBe(1);
    expect([r.tail.blades, r.tail.radius, r.tail.chord]).toEqual([2, 0.95, 0.18]);
    expect(r.main.hub).toEqual(D.MAIN_HUB); expect(r.tail.hub).toEqual(D.TAIL_HUB);
    expect(D.TAIL_HUB.y).toBeLessThan(0);
    // The tail-rotor hub near the main hub's height (plan 6.2; BX's request 2): 2.80 against 2.90 m above the soles.
    expect(D.SKID_Z - D.TAIL_HUB.z).toBeCloseTo(2.80, 9);
  });

  it('drive (P TCDS p9-10, D): 100 % NR = 424.5 rpm, N2 6016 rpm, ratio 14.17, tail 5.25 (233 rad/s)', () => {
    expect(r.referenceRpm).toBe(BO105_NR_100); expect(r.nominalRpm).toBe(BO105_NR_100);
    expect(r.engineRatio).toBe(BO105_ENGINE_RATIO); expect(BO105_ENGINE_RATIO).toBeCloseTo(6016 / 424.5, 9);
    expect(r.tailRatio).toBe(BO105_TAIL_RATIO);
    expect(r.nominalRpm * r.tailRatio * Math.PI / 30).toBeCloseTo(233.4, 0);
    for (const e of def.powerplant.engines) expect(e.engine.ratedRpm).toBe(BO105_N2_100_RPM);
  });

  it('hingeless hub (plan 4 fitting rule): e 0.12 R, nu 1.11 in 1.10-1.12, precone 2.5 deg, polar inertia 850-950 kg m^2 with the Lock number about the shaft 5.0-5.5, inflow, radial flow and hub-aware blade elements on; the spring derived (hingelessSpring), never typed in', () => {
    if (hub.kind !== 'hingeless') throw new Error('not hingeless');
    expect(hub.equivalentHingeOffset / r.main.radius).toBeCloseTo(0.12, 9);
    expect(hub.flapFrequency).toBeGreaterThanOrEqual(1.10); expect(hub.flapFrequency).toBeLessThanOrEqual(1.12);
    expect(hub.precone / DEG).toBeCloseTo(2.5, 9);
    expect(r.main.inertia).toBeGreaterThanOrEqual(850); expect(r.main.inertia).toBeLessThanOrEqual(950);
    const gamma = 1.225 * r.main.liftSlope * r.main.chord * r.main.radius ** 4 / (r.main.inertia / r.main.blades);
    expect(gamma).toBeGreaterThanOrEqual(5.0); expect(gamma).toBeLessThanOrEqual(5.5);
    expect([hub.harmonicInflow, hub.radialFlow, hub.bemFromFlap]).toEqual([true, true, true]);
    expect(hub.delta3 ?? 0).toBe(0);
    expect(hub.coning!.hingeStiffness).toBeCloseTo(hingelessSpring(r), 6);
    expect(hingelessBlade(r).flapInertia).toBeGreaterThan(0);
    expect(r.main).toBe(BO105_MAIN_ROTOR);
    expect(hub.controlPhase).toBe(BO105_HUB_SET.controlPhase);
  });

  it('parked blade (plan 4, ESTIMATE 3V): droop stop -1.5 deg; the tip 0.2-0.3 m below the hub plane at rest', () => {
    const b = BO105_BLADE_CONING, pose = bladeConing(b, 0, 0);
    const tip = (b.bending!.radius - b.hingeRadius) * Math.sin(pose.angle) + pose.tipBend;
    expect(b.droopStop / DEG).toBeCloseTo(-1.5, 9);
    expect(-tip).toBeGreaterThanOrEqual(0.2); expect(-tip).toBeLessThanOrEqual(0.3);
  });

  it('mast-moment marks (AGENT/ESTIMATE, set from the slope-landing rows): LIMIT and the yellow onset on the hub', () => {
    if (hub.kind !== 'hingeless') throw new Error('not hingeless');
    expect(hub.mastMomentLimit).toBe(BO105_MAST_MOMENT.limit); expect(hub.mastMomentYellow).toBe(BO105_MAST_MOMENT.yellow);
    expect(BO105_MAST_MOMENT.yellow).toBeGreaterThan(0); expect(BO105_MAST_MOMENT.yellow).toBeLessThan(1);
  });

  it('engines (P TCDS p9, P5 FM 2-9, 4-17): two identical installed 250-C20B, the torque gauge in % of 298 kW at 100 % N2; TW\'s installed map (the Bo 105 anchors)', () => {
    const [a, b] = def.powerplant.engines;
    expect(a.engine).toBe(BO105_ENGINE); expect(b.engine).toBe(BO105_ENGINE);
    expect(BO105_ENGINE).toBe(BO105_INSTALLED_C20B);
    expect(BO105_ENGINE.ratedPower).toBe(313e3);
    expect(ts.torqueGauge).toBe('percent'); expect(ts.psiPerNm).toBe(BO105_PCT_PER_NM);
    expect(BO105_PCT_PER_NM * BO105_TORQUE_100_W / (6016 * Math.PI / 30)).toBeCloseTo(100, 9);
    expect(ts.limits).toEqual(BO105_TURBOSHAFT_INDICATION.limits);
    expect(ts.limits.takeoffPsi).toBe(86); expect(ts.limits.totC.takeoff).toBe(810); expect(ts.limits.totC.mcp).toBe(779);
    expect(BO105_TWIN.oei.emergencyPct).toBe(95);
    expect(r.systems.twinTurboshaft).toBe(BO105_TWIN);
    expect(r.systems.drive).toBe('freewheel');
  });

  it('power levers (P5 FM 7-12, AGENT stops): OFF - IDLE - FLIGHT on the per-engine lever, the input profile\'s stops equal to the turboshaft\'s; ENGINE TRIM fore/aft and left/right', () => {
    expect(ts.grip).toEqual(BO105_POWER_LEVER); expect(def.input.twistGrip).toEqual(BO105_POWER_LEVER);
    expect(def.input.engineLever).toBe('overheadPowerLevers'); expect(def.input.n2Beep).toBe(true); expect(def.input.n2BeepSplit).toBe(true);
    expect(def.input.engines).toBe(2);
    expect(def.input.labels?.throttleDown).toBeUndefined(); expect(def.input.labels?.throttleIdle).toBeUndefined();
    const aileron = def.input.assists.axes!.aileron;
    expect([aileron.baseRate, aileron.maxRate, aileron.accelTime]).toEqual([0.07, 0.35, 1.5]);
    expect(def.input.assists.axes!.elevator.baseRate).toBe(0.04);
    expect(def.input.mouseYoke).toEqual({ expo: 0.9, deadzone: 0.02 });
  });

  it('presets: every running preset with both levers at FLIGHT, the fuel pumps on, the ignition off; cold and dark with the levers OFF', () => {
    const p = def.sim.presets;
    for (const k of ['groundRunning', 'linedUp', 'airborne', 'approach'] as const) {
      expect(p[k].throttle, k).toBe(1); expect(p[k].fuelPump, k).toBe(true); expect(p[k].magnetos, k).toBe(0);
      expect(p[k].masterBattery, k).toBe(true);
    }
    expect(p.cold.throttle).toBe(0); expect(p.cold.masterBattery).toBe(false);
    expect(def.controlDefaults.throttle).toBe(0); expect(def.controlDefaults.magnetos).toBe(0);
  });

  it('fuel (P TCDS p9, P MM ch 06 p6): supply 74 kg on the left (index 0), main 382 kg on the right, 456 kg usable', () => {
    const [supply, main] = BO105_POWERPLANT.fuel.tanks;
    expect([supply.id, supply.side, supply.capacity]).toEqual(['supply', 'left', BO105_FUEL.supplyKg]);
    expect([main.id, main.side, main.capacity]).toEqual(['main', 'right', BO105_FUEL.mainKg]);
    expect(supply.capacity + main.capacity).toBe(456);
    expect(BO105_POWERPLANT.fuel.feeds).toHaveLength(2);
  });

  it('mass (P TCDS p10-11, P AR-280): maximum 2500 kg; the typical loading 2200 kg with the AR-280 inertia; every named loading inside the CG envelope', () => {
    const m = def.mass, model = createMassModel(m, BO105_POWERPLANT.fuel.tanks);
    expect(m.maxTakeoff).toBe(BO105_MASS_KG.max); expect(m.empty).toBe(V.emptyKg);
    for (const [name, l] of Object.entries(m.loadings)) {
      const p = model.properties({ payload: l.payload, payloadPosition: l.payloadPosition, payloadDistribution: l.payloadDistribution,
        tanks: BO105_POWERPLANT.fuel.tanks.map((t) => t.capacity) });
      const sta = D.x(p.cgOffset.x), lim = cgLimits(p.mass);
      expect(p.mass, name).toBeLessThanOrEqual(BO105_MASS_KG.max + 1e-9);
      expect(sta, `${name} CG STA ${sta}`).toBeGreaterThanOrEqual(lim.forward - 1e-9); expect(sta, name).toBeLessThanOrEqual(lim.aft + 1e-9);
      expect(Math.abs(p.cgOffset.y), name).toBeLessThanOrEqual(0.08);
      if (name === 'typical') {
        expect(p.mass).toBeCloseTo(BO105_MASS_KG.typical, 6);
        expect(p.inertia.Ixx).toBeCloseTo(BO105_INERTIA.Ixx, 6); expect(p.inertia.Iyy).toBeCloseTo(BO105_INERTIA.Iyy, 6);
        expect(p.inertia.Izz).toBeCloseTo(BO105_INERTIA.Izz, 6); expect(p.inertia.Ixz).toBeCloseTo(BO105_INERTIA.Ixz, 6);
      }
    }
  });

  it('mass model stays physical as fuel burns and at light loadings: Ixx at least 600 kg m^2 with the pilot alone, at least 0.6 of the AR-280 value with the typical cabin, at any fuel', () => {
    const m = def.mass, tanks = BO105_POWERPLANT.fuel.tanks, model = createMassModel(m, tanks);
    const pilotOnly = { payload: 80, payloadPosition: { x: D.x(1.85), y: D.PILOT_SEAT_Y, z: D.z(1.17) } };
    for (const fuel of [0, 0.1, 0.5, 1]) {
      const p = model.properties({ ...pilotOnly, tanks: tanks.map((t) => t.capacity * fuel) });
      expect(p.inertia.Ixx, `fuel ${fuel}`).toBeGreaterThan(600);
      const typical = model.properties({ ...m.loadings.typical, tanks: tanks.map((t) => t.capacity * fuel) });
      expect(typical.inertia.Ixx, `typical, fuel ${fuel}`).toBeGreaterThan(0.6 * BO105_INERTIA.Ixx);
    }
  });

  it('Vne (P5 FM Fig 2-2 cell for cell; P TCDS p10: 145 KIAS to 2400 kg, 130 above; P5 FM 2-4: power off 100 KIAS or the chart)', () => {
    BO105_VNE_PA_FT.forEach((ft, i) => BO105_VNE_OAT_C.forEach((c, j) => {
      const cell = BO105_VNE_TABLE[i][j];
      expect(placardVne(BO105_VNE, ft * FT, c + 273.15, 2200), `${ft} ft, ${c} C`).toBeCloseTo(cell, 9);
      expect(placardVne(BO105_VNE, ft * FT, c + 273.15, 2450), `${ft} ft, ${c} C heavy`).toBeCloseTo(cell > 0 ? cell - 15 : 0, 9);
    }));
    expect(placardVne(BO105_VNE, 0, 288.15, 2400)).toBe(145); expect(placardVne(BO105_VNE, 0, 288.15, 2401)).toBe(130);
    expect(configuredVne(BO105_VNE, BO105_SPEED_CORRECTIONS, 0, 288.15, { takeoffMass: 2200, powerOff: true })).toBe(100);
    expect(configuredVne(BO105_VNE, BO105_SPEED_CORRECTIONS, 14_000 * FT, 303.15, { takeoffMass: 2200, powerOff: true })).toBe(85);
    expect(placardVne(BO105_VNE, 18_000 * FT, 288.15, 2200)).toBe(0);
    expect(def.reference.vne).toBe(145); expect(V.vne).toBe(145);
  });

  it('geometry: the pilot\'s eye and the fuselage from dimensions.ts; the skids 1.25 deg nose-up to the fuselage (ground stance)', () => {
    expect(def.geometry.fuselage.pilotEye).toEqual(D.PILOT_EYE);
    expect(def.geometry.fuselage.length).toBe(D.FUSELAGE_LENGTH);
    expect(r.skids.frontZ).toBe(D.SKID_FRONT_Z);
    expect(Math.atan((r.skids.frontZ! - r.skids.z) / (r.skids.front - r.skids.rear)) / DEG).toBeCloseTo(D.SKID_GROUND_ATTITUDE_DEG, 9);
    expect(r.skids.halfTrack * 2).toBeCloseTo(2.53, 9);
    expect(def.geometry.propellers).toHaveLength(2);
  });
});
