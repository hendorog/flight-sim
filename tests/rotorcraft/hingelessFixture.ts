// The hingeless rotor core's TEST-LOCAL Bo 105 (plan revision 2, section 4, "Validation"). Owner: RC. It is NOT the
// bo105 aircraft (BO owns src/aircraft/bo105/**): it spreads the S0 bo105 definition and overrides what the rotor-core
// validation needs with research data, so R2-R23 can be measured before BO lands. BO adopts the hub set this file
// records (docs/rotor-hingeless-model.md), not the airframe estimates.
//
// Tags: P primary, D derived (arithmetic shown), F family, 3V measured on a three-view or photo, ESTIMATE judged. Every
// airframe coefficient below was SET FROM GEOMETRY BEFORE MEASURING and is not a knob (the R18-R20 fitting rule leaves
// only controlPhase and the polar inertia inside 850-950 kg m^2).
import { BO105_DEFINITION } from '../../src/aircraft/bo105';
import { MD500_DEFINITION } from '../../src/aircraft/md500';
import { ALLISON_250_C20B, MD500_POWERPLANT } from '../../src/aircraft/md500/powerplant';
import * as D from '../../src/aircraft/bo105/dimensions';
import type { AircraftDefinition, MassDef } from '../../src/aircraft/types';
import type { HingelessHub, RotorcraftDefinition } from '../../src/physics/rotorcraft/definition';
import type { BladeConingDefinition } from '../../src/physics/rotorcraft/coning';
import type { EngineDef } from '../../src/physics/propulsion/defs';
import { hingelessSpring } from '../../src/physics/rotorcraft/hingeless';
import { createFlightModelFor } from '../../src/physics';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import { atmosphereAt } from '../../src/physics/atmosphere';
import { cloneControls, type ControlInputs } from '../../src/core/types';
import type { BodyState } from '../../src/physics/interfaces';
import { DEG, FT, KT, quat, v3 } from '../../src/core/math';
import { flatEnvironment } from '../fdm/helpers';

export const DT = 1 / 240;
const R = D.MAIN_ROTOR_RADIUS;

/** A 250-C20B with every power, flow and inertia doubled: the two Bo 105 engines as one shaft, so the fixture does not
 *  depend on the twin drivetrain (TW). ESTIMATE (the spool dynamics are unchanged: every term of J w dw/dt scales). */
export const TWIN_EQUIVALENT_ENGINE: EngineDef = (() => {
  const e = ALLISON_250_C20B, t = e.turbine!, g = t.gasGenerator;
  return { ...e, name: '2 x 250-C20B equivalent (test)', ratedPower: 2 * e.ratedPower, rotatingInertia: 2 * e.rotatingInertia,
    turbine: { ...t,
      gasGenerator: { ...g, inertia: 2 * g.inertia, compressorPower: 2 * g.compressorPower,
        map: { ...g.map, fuelFlow: g.map.fuelFlow.map((x) => 2 * x), power: g.map.power.map((x) => 2 * x) },
        fcu: { ...g.fcu, accelFuel: { ...g.fcu.accelFuel, fuelFlow: g.fcu.accelFuel.fuelFlow.map((x) => 2 * x) } } },
      powerTurbine: { ...t.powerTurbine, friction: [2 * t.powerTurbine.friction[0], 2 * t.powerTurbine.friction[1]] } } };
})();

/** Options of a fixture variant (the R18-R20 knobs and the switches the tests flip). */
export interface FixtureOptions {
  /** Hub fields over the fixture's (e.g. harmonicInflow false, controlPhase). */
  hub?: Partial<HingelessHub>;
  /** Polar inertia, kg m^2 (the fitting rule's band 850-950). */
  inertia?: number;
  /** Main-rotor fields over the fixture's (periodicFlapDamping, stations, ...). */
  main?: Partial<RotorcraftDefinition['main']>;
}

/** Polar inertia of the fixture, kg m^2: ESTIMATE 900 (plan 2.3; gamma about the shaft 5.0-5.5 with a = 6.0). */
export const FIXTURE_INERTIA = 900;
/** Blade lift slope, 1/rad: ESTIMATE 6.0 for the NACA 23012 at blade Mach 0.3-0.6 (2 pi x 0.95; F Padfield a0 6.113,
 *  recollection, UNVERIFIED). Fixed once (advisor rule), not a knob. */
export const FIXTURE_LIFT_SLOPE = 6.0;
/** Equivalent hinge offset: 0.12 R (P BK117-ERF7 "an effective flap hinge offset of 12 percent (zero spring)"). */
export const FIXTURE_OFFSET = 0.12 * R;
/** Rotating first flap frequency, per rev: 1.11, AGENT choice inside the plan's 1.10-1.12 (P TM-85990 Table 1: 1.10
 *  calculated at 425 rpm; P TM-103867: 1.12). TM-85990 gives no non-rotating frequency, so e stays 0.12 R and the
 *  spring makes up the rest (Kbeta about 13 % of (nu^2 - 1) I Omega^2). */
export const FIXTURE_NU = 1.11;
/** Control phase, rad (positive advances the swashplate cyclic in the rotation sense, swashplate.ts): 30 deg, the knob of
 *  R18 calibrated at 80 KCAS / 3000 ft so the settled off-axis moment ratios of lateral and longitudinal cyclic steps
 *  (M/L = -0.07, L/M = +0.18) best fit the DLR/AFDD means (-0.085, +0.145; AR-280 Tables 6.2.11, P), least squares on a
 *  1 deg grid (hingelessAr280.test.ts). D check: Ward (NASA) "control phasing retarded to about 60 deg" is a 30 deg lead
 *  on the articulated 90 deg. */
export const FIXTURE_CONTROL_PHASE = 30 * DEG;

/** Lock number about the shaft at SL ISA, for the docs and R4: rho a c R^4 / (I_polar / B). D */
export function lockNumber(inertia = FIXTURE_INERTIA, liftSlope = FIXTURE_LIFT_SLOPE): number {
  return 1.225 * liftSlope * D.MAIN_ROTOR_CHORD * R ** 4 / (inertia / D.MAIN_ROTOR_BLADES);
}

/** Fin area and centroid from dimensions.ts FIN_OUTLINE (stations and heights, m; shoelace). 3V */
function finFromOutline(): { area: number; x: number; z: number } {
  const p = D.FIN_OUTLINE;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length], cross = x0 * y1 - x1 * y0;
    a += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
  }
  a /= 2; cx /= 6 * a; cy /= 6 * a;
  return { area: Math.abs(a), x: D.x(cx), z: D.z(cy) };
}

/** The fixture's RotorcraftDefinition. */
export function fixtureRotorcraft(o: FixtureOptions = {}): RotorcraftDefinition {
  const base = BO105_DEFINITION.rotorcraft!, md = MD500_DEFINITION.rotorcraft!;
  const inertia = o.inertia ?? FIXTURE_INERTIA;
  const main: RotorcraftDefinition['main'] = { ...base.main, inertia, liftSlope: FIXTURE_LIFT_SLOPE, hub: { ...D.MAIN_HUB },
    // ESTIMATE: Bo 105 NACA 23012 profile drag and induced-drag factor of the analytic polar (the S0 stub's MD 500E
    // values); the collective range keeps the stub's 1.15 deg low stop and its travel.
    ...o.main };
  const fin = finFromOutline(), hs = D.HORIZONTAL_STABILIZER;
  const hubFields: HingelessHub = {
    kind: 'hingeless', equivalentHingeOffset: FIXTURE_OFFSET, flapFrequency: FIXTURE_NU,
    precone: D.MAIN_ROTOR_PRECONE_DEG * DEG, controlPhase: FIXTURE_CONTROL_PHASE,
    harmonicInflow: true, radialFlow: true, bemFromFlap: true, ...o.hub,
  };
  const draft: RotorcraftDefinition = {
    ...base,
    hubModel: hubFields,
    main,
    // Tail rotor on the left at the fin top (D TAIL_HUB), the stub's Bo 105 tail-rotor geometry and ratio.
    tail: { ...base.tail, hub: { ...D.TAIL_HUB } },
    // Hydraulic boost, no SAS (P5 FM 7-24): no control-system flexibility. Control travels not found (gap): symmetric
    // +/-10 deg ESTIMATE (BO fits the travels to AR-280's per-% control derivatives).
    controlFlex: undefined, cyclicLimits: undefined, cyclicLimit: 10 * DEG,
    shaftTilt: D.SHAFT_TILT,
    systems: { ...base.systems, twinTurboshaft: undefined,
      // The coupling cap at the (doubled) engine's output shaft: never binds (2 x the doubled transient torque).
      transmissionTorqueLimit: 4 * md.systems.transmissionTorqueLimit! },
    // Stabiliser (P AR-280 Table 6.2.1): 0.8 m^2, 2.0 x 0.4 m, 0 deg incidence, at its 3V station; lift slope ESTIMATE 3.5
    // (aspect ratio 5 with endplates); downwash fraction at the surface ESTIMATE 0.45 (the MD 500E's).
    stabilizer: { centre: { x: hs.quarterChord.x, y: 0, z: hs.quarterChord.z }, area: hs.area, liftSlope: 3.5,
      incidence: hs.incidenceDeg * DEG, maxCl: 1.0, wash: 0.45 },
    // Vertical fin from the 3V outline (shoelace), lift slope ESTIMATE 2.5 (aspect ratio about 1.2); half of it in the tail
    // rotor's intake flow (ESTIMATE; the rotor sits at the fin top). The two endplates (2 x 0.45 x 0.42 m, 3V) as a second
    // surface at the stabiliser, lift slope ESTIMATE 2.0.
    fins: [
      { centre: { x: fin.x, y: 0, z: fin.z }, area: fin.area, liftSlope: 2.5, incidence: 0, maxCl: 1.0,
        tailRotorFlow: { areaFraction: 0.5, velocityRatio: 0.6 } },
      { centre: { x: hs.quarterChord.x, y: 0, z: hs.quarterChord.z }, area: 2 * hs.endplates.height * hs.endplates.chord,
        liftSlope: 2.0, incidence: 0, maxCl: 1.0 },
    ],
    // Cabin volume about 2.3 x the MD 500E's egg (4.3 x 1.58 x 1.4 m hull, 3V/P): the MD 500E's destabilising
    // fuselage moment derivatives scaled by that, ESTIMATE.
    fuselageMoment: { pitch: 0.55, yaw: 0.35 },
    // Equivalent flat plates, ESTIMATE: x 1.6 m^2 (D: about 300 kW of parasite power at 130 KTAS, MCP 2 x 257 kW less
    // induced, profile and tail rotor); y 5.5 and z 6.5 m^2 (3V side and plan areas x bluff-body coefficients).
    dragArea: { x: 1.6, y: 5.5, z: 6.5 }, dragCentre: { x: -0.2, y: 0, z: 0.1 },
    fuselageWash: 1 + -D.MAIN_HUB.z / Math.hypot(R, D.MAIN_HUB.z),
    // Airborne fixture: no stinger, no ground-rotor pose (the stub's are the MD 500E's), skids at the Bo 105 stance.
    tailProtection: undefined, groundRotor: undefined,
    skids: { ...base.skids, halfTrack: D.SKID_HALF_TRACK, front: D.SKID_FRONT_X, rear: D.SKID_REAR_X, z: D.SKID_Z, frontZ: undefined },
  };
  const coning: BladeConingDefinition = {
    // Uniform blade (the solver's own estimate): polar inertia / blades over the 1.10-4.92 m span.
    mass: inertia / D.MAIN_ROTOR_BLADES / ((main.rootCutout ** 2 + main.rootCutout * R + R * R) / 3),
    cgRadius: (main.rootCutout + R) / 2, inertia: inertia / D.MAIN_ROTOR_BLADES, hingeRadius: hubFields.equivalentHingeOffset,
    thrustRadius: 0.75 * R, precone: hubFields.precone, hingeStiffness: 0,
    // ESTIMATE droop stop (plan 4 "(e, Kbeta) split"), no bending in the fixture (BO sets it 3V).
    droopStop: -1.5 * DEG,
  };
  draft.hubModel = { ...hubFields, coning };
  coning.hingeStiffness = hingelessSpring(draft);
  return draft;
}

/** Mass 2200 kg with the AR-280 inertia at the full-fuel loading the tests fly (P AR-280 Table 6.2.1). */
function fixtureMass(): MassDef {
  const fuel = MD500_POWERPLANT.fuel.tanks[0].capacity, payload = 160;
  const loading = { payload, payloadPosition: { x: 0, y: 0, z: 0 } };
  return { empty: 2200 - fuel - payload, maxTakeoff: 2500, maxLanding: 2500, seatY: 0,
    inertia: { about: 'cg', Ixx: 1433, Iyy: 4973, Izz: 4099, Ixz: 660 }, inertiaLoading: loading, emptyCg: { x: 0, y: 0, z: 0 },
    loadings: { typical: loading, forward: loading, aft: loading, maxGross: loading } };
}

/** The fixture aircraft: one doubled engine, the MD 500E's single-station compatibility aero and input. */
export function fixtureDefinition(o: FixtureOptions = {}): AircraftDefinition {
  const md = MD500_POWERPLANT, rotor = fixtureRotorcraft(o);
  return {
    ...BO105_DEFINITION,
    engineCount: 1,
    aero: MD500_DEFINITION.aero,
    input: MD500_DEFINITION.input,
    rotorcraft: rotor,
    mass: fixtureMass(),
    powerplant: { ...md, engines: [{ ...md.engines[0], engine: TWIN_EQUIVALENT_ENGINE }],
      // The single tank at the reference point, so the CG is there at every fuel state.
      fuel: { ...md.fuel, tanks: [{ ...md.fuel.tanks[0], position: { x: 0, y: 0, z: 0 } }] } },
    geometry: { ...BO105_DEFINITION.geometry,
      propellers: [{ hub: rotor.main.hub, diameter: 2 * R, blades: rotor.main.blades, rotation: rotor.rotation }] },
  };
}

/** A flat world whose atmosphere is held at `ft` pressure altitude, ISA (AR-280: density altitude about 3000 ft). */
export function environment(ft = 0) {
  const a = atmosphereAt(ft * FT);
  return { ...flatEnvironment(undefined, 0), atmosphere: () => a };
}
export type FixtureEnv = ReturnType<typeof environment>;

export interface FixtureRigOptions extends FixtureOptions { kt?: number; ft?: number; height?: number; pathDeg?: number;
  /** Physics sub-step rate, Hz (default 240). */
  physicsRate?: number }
/** The fixture trimmed in level flight at `kt` TRUE airspeed (default hover), `ft` (default 0), 1500 m up. */
export function fixtureRig(o: FixtureRigOptions = {}) {
  const def = fixtureDefinition(o), env = environment(o.ft ?? 0);
  const fm = createFlightModelFor(def, o.physicsRate ? { physicsRate: o.physicsRate } : undefined) as BladeElementFlightModel;
  fm.setLoading(def.mass.loadings.typical);
  fm.reset({ position: { x: 0, y: 0, z: -(o.height ?? 1500) }, heading: 0, airspeed: (o.kt ?? 0) * KT,
    flightPathAngle: (o.pathDeg ?? 0) * DEG, onGround: false, engineRunning: true, fuelFraction: 1 }, env);
  return { fm, c: cloneControls(fm.trimControls), env, def };
}
export type FixtureRig = ReturnType<typeof fixtureRig>;

export function run(r: FixtureRig, seconds: number, each?: (t: number) => void, dt = DT): void {
  for (let i = 0, n = Math.round(seconds / dt); i < n; i++) { each?.(i * dt); r.fm.step(dt, r.c, r.env); }
}

// ------------------------------------------------------------------------------------------------ quasi-static derivatives

/** The six body accelerations the flight model integrates for a body state, with the rotor's slow states re-settled:
 *  specific force (body axes, aerodynamic only: gravity and the kinematic terms are the linear model's) and the
 *  angular accelerations of flightModel.ts's Euler equations, I dw/dt = M - w x (I w + h), Ixz coupled. */
export function settledAccelerations(r: FixtureRig, b: BodyState, c: ControlInputs = r.c) {
  const rc = r.fm.rotorcraft!, mp = r.fm.massProperties, a = r.env.atmosphere();
  const f = rc.settle(b, v3.zero(), a.density, 1500, c);
  const { Ixx, Iyy, Izz, Ixz } = mp.inertia, w = b.angularVelocity, h = rc.angularMomentum;
  const Hx = Ixx * w.x - Ixz * w.z + h.x, Hy = Iyy * w.y + h.y, Hz = Izz * w.z - Ixz * w.x + h.z;
  const ex = f.moment.x - (w.y * Hz - w.z * Hy), ey = f.moment.y - (w.z * Hx - w.x * Hz), ez = f.moment.z - (w.x * Hy - w.y * Hx);
  const det = Ixx * Izz - Ixz * Ixz;
  return { X: f.force.x / mp.mass, Y: f.force.y / mp.mass, Z: f.force.z / mp.mass,
    L: (Izz * ex + Ixz * ez) / det, M: ey / Iyy, N: (Ixz * ex + Ixx * ez) / det };
}

/** The trimmed body state of a rig (copy). */
export function trimBody(r: FixtureRig): BodyState {
  const s = r.fm.state, mp = r.fm.massProperties;
  return { time: 0, position: { ...s.position }, orientation: { ...s.orientation },
    velocityBody: quat.rotateInv(s.orientation, s.velocity), angularVelocity: v3.zero(), cgOffset: { ...mp.cgOffset }, mass: mp.mass };
}

export type Rows = Record<'X' | 'Y' | 'Z' | 'L' | 'M' | 'N', number[]>;
/**
 * Quasi-static stability derivatives by central differences about the trim (the rotor states re-settled at each
 * perturbed state): columns u, w, q, v, p, r (per m/s, per rad/s), rows X..N as the AR-280 tables (ar280.ts).
 */
export function quasiStaticDerivatives(r: FixtureRig, du = 0.5, dw = 0.02): { rows: Rows; u0: number; w0: number; theta0: number } {
  const b0 = trimBody(r);
  const cols: ((b: BodyState, sign: number) => void)[] = [
    (b, s) => { b.velocityBody.x += s * du; }, (b, s) => { b.velocityBody.z += s * du; }, (b, s) => { b.angularVelocity.y += s * dw; },
    (b, s) => { b.velocityBody.y += s * du; }, (b, s) => { b.angularVelocity.x += s * dw; }, (b, s) => { b.angularVelocity.z += s * dw; },
  ];
  const steps = [du, du, dw, du, dw, dw];
  const rows: Rows = { X: [], Y: [], Z: [], L: [], M: [], N: [] };
  cols.forEach((perturb, j) => {
    const plus = { ...b0, velocityBody: { ...b0.velocityBody }, angularVelocity: { ...b0.angularVelocity } };
    const minus = { ...b0, velocityBody: { ...b0.velocityBody }, angularVelocity: { ...b0.angularVelocity } };
    perturb(plus, 1); perturb(minus, -1);
    const ap = settledAccelerations(r, plus), am = settledAccelerations(r, minus);
    for (const k of ['X', 'Y', 'Z', 'L', 'M', 'N'] as const) rows[k][j] = (ap[k] - am[k]) / (2 * steps[j]);
  });
  // Leave the rotor settled at the trim again.
  settledAccelerations(r, b0);
  return { rows, u0: b0.velocityBody.x, w0: b0.velocityBody.z, theta0: r.fm.state.pitch };
}

// ------------------------------------------------------------------------------------------------ trace
interface TraceFs { mkdirSync(path: string, options: { recursive: boolean }): void; writeFileSync(path: string, data: string): void }
const traceDir = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.RC_TRACE;
const traceFs = traceDir ? await import(/* @vite-ignore */ 'node:fs' as string) as TraceFs : undefined;
/** A test file's measured numbers: printed as one JSON line, and written to RC_TRACE=<dir>/<file>.json when set. */
export function traceReport(file: string, data: unknown): void {
  console.info(`[${file}] ${JSON.stringify(data)}`);
  if (traceFs && traceDir) {
    traceFs.mkdirSync(traceDir, { recursive: true });
    traceFs.writeFileSync(`${traceDir}/${file}.json`, JSON.stringify(data, null, 1));
  }
}
