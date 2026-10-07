// Test-bed gear configurations: each switches on one mechanism the Cessna 172S does not have, on numbers that
// are known. Stage C builds its whole-aircraft test-beds (CASTER_TESTBED, RETRACT_TESTBED and the twins) on
// these. None of them is a real type's definition: where a figure is an estimate the comment says so.
//
//   CASTER_GEAR          the C172S gear with a free-castering nosewheel (DA20 swivel)
//   DA20_LIKE            mass, inertias and a gear of DA20-C1 proportions with that nosewheel
//   RETRACT_GEAR         the C172S gear made retractable (PA-34 system): stowed positions, belly points
//   TWIN_RETRACT_GEAR    the same with two propeller discs at y = +/-1.9 m, nacelle undersides and the impact
//                        thresholds of a 60 kt stall speed
//   PA34_RETRACT, DA42_RETRACT    the two retraction systems as data

import { DEG, type Vec3 } from '../../src/core/math';
import { C172_GEAR, type GearConfig, type RetractConfig, type WheelConfig } from '../../src/physics/gear';
import { LinearStrutSpring } from '../../src/physics/gear/springs';
import type { SteeringParams, TyreParams } from '../../src/physics/gear/tyre';

// --------------------------------------------------------------------------------------------- castering

/**
 * DA20-C1 nosewheel: free castering through +/-60 degrees, not linked to the pedals (AFM 7.5). The trail, the
 * friction of the swivel and its viscous drag are not published: ESTIMATES (fork offset about 7 cm; a friction
 * damper set to a few N m; `damper` is the rate constant of the inertia-free swivel, not a hydraulic unit).
 * No centring cam: in flight the wheel trails in the airflow, here within `centeringTime`.
 */
export const DA20_CASTER: SteeringParams = {
  mode: 'castering',
  maxCommand: 0,
  casterLimit: 60 * DEG,
  trail: 0.07,
  linkStiffness: 0,
  breakoutTorque: 0,
  bungeeStiffness: 0,
  damper: 10,
  friction: 4,
  centeringTime: 0.3,
};

/** `base` with its nosewheel free to caster. */
export function casterGear(base: GearConfig = C172_GEAR, steering: SteeringParams = DA20_CASTER): GearConfig {
  const [nose, left, right] = base.wheels;
  return { ...base, wheels: [{ ...nose, steering }, left, right] };
}

export const CASTER_GEAR: GearConfig = casterGear();

const DA20_MAIN_TYRE: TyreParams = { ...C172_GEAR.wheels[1].tyre, radius: 0.18, inertia: 0.2 };
const DA20_NOSE_TYRE: TyreParams = { ...C172_GEAR.wheels[0].tyre, radius: 0.165, inertia: 0.1 };

function da20Main(name: 'left' | 'right'): WheelConfig {
  const side = name === 'left' ? -1 : 1;
  return {
    name,
    // Track 1.86 m; the mains 0.319 m behind the centre of gravity (19 % of the weight on the nosewheel).
    position: { x: -0.319, y: side * 0.93, z: 1.14 },
    axis: { x: 0, y: side * Math.sin(10 * DEG), z: -Math.cos(10 * DEG) },
    // Aluminium leaf: 60-70 kN/m per leg, lightly damped (data sheet estimate).
    strut: new LinearStrutSpring(65e3),
    tyreSpring: { stiffness: 120e3, hardening: 0.06 },
    damping: (_strutRate, totalRate) => 1500 * totalRate,
    tyre: DA20_MAIN_TYRE,
    steering: null,
    brake: name,
    // ESTIMATE: a full-pedal stop at about 0.35 g (2 x 250 N m / 0.18 m on 800 kg).
    maxBrakeTorque: 250,
    limitLoad: 21e3,
  };
}

/**
 * An aircraft of DA20-C1 proportions for the gear rig: 800 kg with the centre of gravity at the reference
 * point 1.07 m above the ground, wheelbase 1.678 m, track 1.86 m, 19 % of the weight on the nosewheel (AFM
 * three-view and the data sheet's section 3), estimated inertias 1100 / 1400 / 2400 kg m^2 (its section 6).
 * Springs, damping, brakes and limit loads are the sheet's estimates or scaled from the C172S.
 */
export const DA20_LIKE: { mass: number; inertia: Readonly<Vec3>; wheelbase: number; track: number; gear: GearConfig } = {
  mass: 800,
  inertia: { x: 1100, y: 1400, z: 2400 },
  wheelbase: 1.678,
  track: 1.86,
  gear: {
    wheels: [
      {
        name: 'nose',
        position: { x: 1.359, y: 0, z: 1.13 },
        axis: { x: 0, y: 0, z: -1 },
        // Elastomer pack: 25-35 kN/m with moderate hysteresis (data sheet estimate).
        strut: new LinearStrutSpring(30e3),
        tyreSpring: { stiffness: 100e3, hardening: 0.05 },
        damping: (_strutRate, totalRate) => 2500 * totalRate,
        tyre: DA20_NOSE_TYRE,
        steering: DA20_CASTER,
        brake: null,
        maxBrakeTorque: 0,
        limitLoad: 12e3,
      },
      da20Main('left'),
      da20Main('right'),
    ],
    structure: [
      // Low wing, 10.87 m span, 4 degrees of dihedral: the tips are 0.9 m above the ground at rest.
      { position: { x: -0.1, y: -5.43, z: -0.18 }, message: 'Left wingtip struck the ground', tolerance: 0 },
      { position: { x: -0.1, y: 5.43, z: -0.18 }, message: 'Right wingtip struck the ground', tolerance: 0 },
      { position: { x: -0.6, y: 0, z: 0.55 }, message: 'Belly struck the ground', tolerance: 0 },
      { position: { x: 1.55, y: 0, z: 0.5 }, message: 'Nose struck the ground', tolerance: 0 },
    ],
    // 1.75 m propeller, hub 1.84 m ahead of the reference point: the tip is 0.31 m clear at rest (three-view).
    propellers: [{ hub: { x: 1.84, y: 0, z: -0.12 }, radius: 0.875, message: 'Propeller strike' }],
  },
};

// --------------------------------------------------------------------------------------------- retractable

/**
 * PA-34-200 gear system (data sheet section 3): electro-hydraulic, 6 to 7 s either way, squat switch, NO
 * up-locks (pressure holds the gear up and stays trapped with the pump dead: only a leak drops it), free fall
 * on the emergency knob, horn with a throttle closed or the selector UP on the ground. ESTIMATES: the free-fall
 * time, the pump's minimum voltage (14 V system) and the lever position of the horn microswitch (the type sets
 * it to the position that gives 14 inHg at sea level and 2000 rpm).
 */
export const PA34_RETRACT: RetractConfig = {
  extendTime: 6.5,
  retractTime: 6.5,
  minBusVolts: 10,
  squatInhibit: true,
  upLocks: false,
  deadBusSagTime: Infinity,
  emergency: { freeFallTime: 8 },
  warning: { throttleBelow: 0.3, leverUpOnGround: true },
};

/**
 * DA42 NG gear system (AFM 7.5, 3.8): 6 to 10 s, squat switch, no up-locks, "if the electrical master is
 * switched off in flight the gear extends slowly", emergency extension up to 20 s, chime with either power
 * lever below about 20 % or the flaps at LDG. ESTIMATES: 25 s for "slowly", the pump's minimum voltage (28 V
 * system).
 */
export const DA42_RETRACT: RetractConfig = {
  extendTime: 8,
  retractTime: 8,
  minBusVolts: 20,
  squatInhibit: true,
  upLocks: false,
  deadBusSagTime: 25,
  emergency: { freeFallTime: 15 },
  warning: { throttleBelow: 0.2, flapsAtOrBeyond: 1, leverUpOnGround: true },
};

/** Where the C172S tyre contact points go when this test-bed stows them: the nose leg forward into the cowling, the mains inboard into the belly. */
const C172_STOWED: readonly [Vec3, Vec3, Vec3] = [
  { x: 1.75, y: 0, z: 0.4 },
  { x: -0.44, y: -0.35, z: 0.55 },
  { x: -0.44, y: 0.35, z: 0.55 },
];

/** `base` with a retraction system: every leg gets a stowed position, the belly points take a gear-up arrival. */
export function retractGear(base: GearConfig = C172_GEAR, retract: RetractConfig = PA34_RETRACT, stowed: readonly [Vec3, Vec3, Vec3] = C172_STOWED): GearConfig {
  const [nose, left, right] = base.wheels;
  return {
    ...base,
    wheels: [{ ...nose, stowed: stowed[0] }, { ...left, stowed: stowed[1] }, { ...right, stowed: stowed[2] }],
    structure: base.structure.map((p) => (p.message === 'Belly struck the ground' ? { ...p, part: 'belly', belly: true } : p)),
    retract,
  };
}

export const RETRACT_GEAR: GearConfig = retractGear();

const NACELLE_Y = 1.9;

/**
 * The retractable test-bed as a twin: two propeller discs on nacelles at y = +/-1.9 m in place of the nose
 * propeller, the nacelle undersides as belly points, and the impact thresholds of a type that stalls at 60 kt
 * (PA-34: 1.6 and 1.4 times Vs0 = 49 and 43 m/s), so that its ordinary 75-80 kt touchdown is not an "impact".
 */
export const TWIN_RETRACT_GEAR: GearConfig = {
  ...RETRACT_GEAR,
  structure: [
    ...RETRACT_GEAR.structure,
    { position: { x: 0.3, y: -NACELLE_Y, z: 0.5 }, message: 'Left nacelle struck the ground', tolerance: 0, part: 'left nacelle', belly: true },
    { position: { x: 0.3, y: NACELLE_Y, z: 0.5 }, message: 'Right nacelle struck the ground', tolerance: 0, part: 'right nacelle', belly: true },
  ],
  propellers: [
    { hub: { x: 1.1, y: -NACELLE_Y, z: 0 }, radius: 0.965, message: 'Left propeller strike', part: 'left propeller' },
    { hub: { x: 1.1, y: NACELLE_Y, z: 0 }, radius: 0.965, message: 'Right propeller strike', part: 'right propeller' },
  ],
  impact: { sinkRate: 7, speed: 49, steepSpeed: 43, steepPath: 12 * DEG },
};
