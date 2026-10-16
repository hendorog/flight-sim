// Pilatus PC-12/47: the landing gear and ground contact. Retractable tricycle, hydraulic (an electric power pack and
// a nitrogen accumulator; 47E-PROXY 7-4): trailing-link main legs with oleo-pneumatic struts, retracting INWARD with
// the wheels about 25 mm proud of the wells; the nose leg retracts AFT and is fully enclosed. No mechanical up-locks:
// pressure holds the gear up (the accumulator for about 200 min after a pump failure). Emergency extension by free
// fall and the hand pump. Nosewheel steered from the pedals, 12 deg each way, castoring to 60 deg with differential
// braking. 8.50-10 main and 17.5x6.25-6 nose tyres at 60 psi (TCDS C.III.19). A factory's value: the configuration
// holds spring objects and damping closures.
//
// Design point: 4740 kg with the CG at about station 5.97 (the maxGross loading, systems.ts), which puts about 7 % of
// the weight on the nose (the trailing links carry the main wheels aft as they compress): about 3.3 kN on the nose and
// 21.6 kN on each main. The springs below then compress the
// nose 0.011 m (oleo 0, tyre 0.011) and the mains 0.10 m vertically (geometry.ts PC12_GEAR_STATIC_SAG): the
// reference point stands 1.54 m above the ground, the aircraft about level.

import { DEG } from '../../core/math';
import type { GearConfig, RetractConfig, StructuralPoint, WheelConfig } from '../../physics/gear/gearConfig';
import { OleoPneumaticSpring } from '../../physics/gear/springs';
import type { SteeringParams, TyreParams } from '../../physics/gear/tyre';
import { PC12_GEAR, PC12_GEOMETRY, PC12_MAIN_LEG_TILT, PC12_REST_HEIGHT, PC12_TAIL, PC12_THRUST_Z } from './geometry';

const G = PC12_GEOMETRY;
const S = (station: number) => 6.0 - station;
const H = (height: number) => PC12_REST_HEIGHT - height;

/** 8.50-10 mains, 17.5x6.25-6 nose (TCDS). Cornering and slip as the other types' tyres (NASA TR R-64). */
const tyre = (radius: number, inertia: number): TyreParams => ({
  radius,
  inertia,
  slipStiffness: 15,
  corneringStiffness: 8,
  relaxationLong: 0.25,
  relaxationLat: 0.45,
  lowSpeedDamping: 1.5,
});

/**
 * Pedal steering through a spring link, 12 deg each way, the nosewheel castoring to 60 deg with differential braking
 * and a shimmy damper (47E-PROXY 7-4, sect. 8). The C208's link scaled for the nose load.
 */
const NOSE_STEERING: SteeringParams = {
  maxCommand: G.gear.maxNoseSteer,
  casterLimit: PC12_GEAR.castorLimit,
  trail: 0.07,
  linkStiffness: 9000,
  breakoutTorque: 90,
  bungeeStiffness: 140,
  damper: 120,
  centeringTime: 0.2,
};

/** Oleo damping: a valve-limited linear term and a metering orifice, firmer on rebound (the C208's nose strut pattern). */
function oleoDamping(linear: number, compression: number, rebound: number): WheelConfig['damping'] {
  const knee = 0.6;
  return (strutRate, totalRate) => linear * knee * Math.tanh(totalRate / knee) + (strutRate > 0 ? compression : rebound) * strutRate * Math.abs(strutRate);
}

/**
 * Hydraulic retraction (47E-PROXY 7-4): the power pack runs on the bus (20 V, ESTIMATE), about 7 s either way
 * (ESTIMATE: not published), a squat switch, no up-locks with the pressure held by the accumulator (deadBusSagTime
 * Infinity: 200 min), free fall in about 15 s with the emergency selector (ESTIMATE). The horn (47E 7-4): a leg not
 * down and locked with the PCL at idle below 130 KIAS, or with flaps 30 or more; or the selector UP on the ground.
 * The 47E's "below 200 ft radio altitude with torque below 10 psi" rule is not modelled (no radio altimeter).
 */
export const PC12_RETRACT: RetractConfig = {
  extendTime: 7,
  retractTime: 7,
  legDelay: [0, 0.4, 0.4],
  minBusVolts: 20,
  squatInhibit: true,
  upLocks: false,
  deadBusSagTime: Infinity,
  emergency: { freeFallTime: 15 },
  // PCL at idle: the lever's first 5 % (the idle detent region); flaps 30 = lever 0.75 (30 of 40 deg).
  warning: { throttleBelow: 0.05, kiasBelow: 130, flapsAtOrBeyond: 0.749, leverUpOnGround: true },
};

/** Main leg axis (geometry.ts PC12_MAIN_LEG_TILT: vertical; the trailing link's aft travel is not modelled). */
const MAIN_AXIS = { x: -Math.sin(PC12_MAIN_LEG_TILT), y: 0, z: -Math.cos(PC12_MAIN_LEG_TILT) };

function main(name: 'left' | 'right'): WheelConfig {
  const side = name === 'left' ? -1 : 1;
  const stowed = name === 'left' ? PC12_GEAR.stowed.leftMain : PC12_GEAR.stowed.rightMain;
  return {
    name,
    position: name === 'left' ? G.gear.leftMain : G.gear.rightMain,
    axis: MAIN_AXIS,
    // About 0.08 m of oleo at the static load (21.6 kN), the gas column stiffening it toward the 0.17 m stroke
    // (ESTIMATE).
    strut: new OleoPneumaticSpring(10500, 0.18, 1.2, 0.17),
    // About 20 mm of tyre at the static load.
    tyreSpring: { stiffness: 1.08e6, hardening: 0.08 },
    damping: oleoDamping(20000, 4000, 40000),
    tyre: tyre(G.gear.mainWheelRadius, 1.2),
    steering: null,
    brake: name,
    // Multi-piston steel brakes (47E 7-4), no anti-skid (ESTIMATE): about 0.34 g at full pedal at the landing weight.
    // Gate: 3200 N m (0.45 g) locked both mains at full pedal from 60 KIAS (the wing still lifting), and with the
    // cornering force gone the default 6 kt crosswind swung the aircraft 20-35 deg against full rudder; at 2400 the
    // same stop holds the heading within 2 deg (work/pcmd gate-0 brake probe).
    maxBrakeTorque: 2400,
    // About 3.5 g on one leg's axial share.
    limitLoad: 75e3,
    stowed: { ...stowed, y: side * Math.abs(stowed.y) },
  };
}

/** Lower surface of the wing at span y (the chord plane less about 6 % of the local chord below it). */
const wingLowerZ = (y: number) => G.wing.quarterChord.z - Math.max(y - G.wing.rootY, 0) * Math.tan(G.wing.dihedral) + 0.07;
const HALF_SPAN = G.wing.span / 2;
const H_TAIL_HALF = G.hTail.span / 2;

/** Airframe points that must not touch the ground. */
const STRUCTURE: readonly StructuralPoint[] = [
  // Wing tips (the winglets' roots) and the lower surface at mid-span.
  { position: { x: -0.2, y: -HALF_SPAN, z: wingLowerZ(HALF_SPAN) }, message: 'Left wingtip struck the ground', tolerance: 0 },
  { position: { x: -0.2, y: HALF_SPAN, z: wingLowerZ(HALF_SPAN) }, message: 'Right wingtip struck the ground', tolerance: 0 },
  { position: { x: 0, y: -4.5, z: wingLowerZ(4.5) }, message: 'Left wing struck the ground', tolerance: 0 },
  { position: { x: 0, y: 4.5, z: wingLowerZ(4.5) }, message: 'Right wing struck the ground', tolerance: 0 },
  // The stowed wheels (the mains stay about 25 mm proud, 47E 7-4) and the belly: a gear-up landing slides on them.
  { position: PC12_GEAR.stowed.leftMain, message: 'Left main wheel struck the ground', tolerance: 0, part: 'left main wheel', belly: true },
  { position: PC12_GEAR.stowed.rightMain, message: 'Right main wheel struck the ground', tolerance: 0, part: 'right main wheel', belly: true },
  // The belly under the cabin and over the wing-root fairing (3V: 0.93 / 0.87 m up).
  { position: { x: S(4.5), y: 0, z: H(0.93) }, message: 'Belly struck the ground', tolerance: 0, part: 'belly', belly: true },
  { position: { x: S(6.4), y: 0, z: H(0.87) }, message: 'Belly struck the ground', tolerance: 0, part: 'belly', belly: true },
  { position: { x: S(8.6), y: 0, z: H(0.98) }, message: 'Belly struck the ground', tolerance: 0, part: 'belly', belly: true },
  // The chin inlet's lower lip under the spinner (3V: 0.54 m below the thrust line at station 1.4).
  { position: { x: S(1.4), y: 0, z: PC12_THRUST_Z + 0.54 }, message: 'Nose struck the ground', tolerance: 0 },
  // The ventral strakes' aft ends and the ventral fin under the tailcone (3V, P2): they touch at about 13 deg of pitch.
  // A scrape at taxi or take-off-roll speed is survivable (as on the other types).
  { position: { x: S(12.3), y: 0, z: H(1.4) }, message: 'Tail strike', tolerance: 2.5 },
  { position: { x: S(13.4), y: 0, z: H(1.72) }, message: 'Tail strike', tolerance: 2.5 },
  // Tailplane tips: roll-over points.
  { position: { x: G.hTail.quarterChord.x, y: -H_TAIL_HALF, z: G.hTail.quarterChord.z }, message: 'Left horizontal stabilizer struck the ground', tolerance: 0 },
  { position: { x: G.hTail.quarterChord.x, y: H_TAIL_HALF, z: G.hTail.quarterChord.z }, message: 'Right horizontal stabilizer struck the ground', tolerance: 0 },
  // Upper surfaces, for a nose-over or roll-over: the fin tip and the cabin roof.
  { position: { x: PC12_TAIL.finTip.x, y: 0, z: PC12_TAIL.finTip.z }, message: 'Aircraft flipped over', tolerance: 0 },
  { position: { x: S(5.5), y: 0, z: H(2.73) }, message: 'Aircraft flipped over', tolerance: 0 },
];

export function createPC12Gear(): GearConfig {
  const prop = G.propellers[0];
  return {
    wheels: [
      {
        name: 'nose',
        position: G.gear.nose,
        axis: { x: 0, y: 0, z: -1 },
        // A stiff, progressive nose strut (ESTIMATE): preloaded to about the static load (3.3 kN), 0.07 m at the 12.6 kN
        // of a full-brake stop, 0.11 m at 60 kN, its gas column closing short of the 0.119 m stroke so that it never
        // meets a hard stop; with the tyre the propeller (0.30 m of clearance, 1.5 x the nose's travel at the disc)
        // keeps about 0.12 m on a braked nose.
        strut: new OleoPneumaticSpring(3500, 0.12, 1.2, 0.119),
        tyreSpring: { stiffness: 300e3, hardening: 0.05 },
        damping: oleoDamping(35000, 5000, 15000),
        tyre: tyre(G.gear.noseWheelRadius, 0.5),
        steering: NOSE_STEERING,
        brake: null,
        maxBrakeTorque: 0,
        // About 6 x the nose load of a full-brake stop (ESTIMATE).
        limitLoad: 80e3,
        stowed: PC12_GEAR.stowed.nose,
      },
      main('left'),
      main('right'),
    ],
    structure: STRUCTURE,
    propellers: [{ hub: prop.hub, radius: prop.diameter / 2, message: 'Propeller strike' }],
    // Contact speeds of a 67 KIAS (34 m/s) landing stall: 1.6 and 1.4 times it (gearConfig.ts rule of thumb).
    impact: { sinkRate: 7, speed: 55, steepSpeed: 48, steepPath: 12 * DEG },
    retract: PC12_RETRACT,
  };
}
