// Piper PA-34-200 Seneca I: the landing gear and ground contact. Retractable tricycle on air / oil oleos, worked by
// an electric reversible pump driving a hydraulic power pack in the nose: the mains fold inboard into the wing root
// and stay partly exposed, the nose leg retracts forward; no up-locks (pump pressure holds the gear up and stays
// trapped with the pump off), spring-loaded down-locks, a squat switch on the left main, free fall on the guarded
// emergency knob; the nosewheel linked to the pedals, 21 degrees each way (s.3 of the type's data sheet,
// aircraft-data/pa34.md in the design work folder). 6.00-6 tyres on all three wheels. A factory's value: the
// configuration holds spring objects and damping closures.
//
// Design point: 1905 kg with the centre of gravity at FS 89.7 (the maxGross loading, systems.ts), which puts 23 %
// of the weight on the nose wheel: about 4.2 kN on the nose and 7.2 kN on each main. The oleos then compress so that
// the reference point stands geometry.restHeight above the ground, the struts showing the handbook's 2.6 in (nose)
// and 3.6 in (mains) at rest (s.3); geometry.ts gives the fully extended contact points from that.

import { DEG, type Vec3 } from '../../core/math';
import type { GearConfig, RetractConfig, StructuralPoint, WheelConfig } from '../../physics/gear/gearConfig';
import { OleoPneumaticSpring } from '../../physics/gear/springs';
import type { SteeringParams, TyreParams } from '../../physics/gear/tyre';
import { PA34_GEOMETRY, pa34StationX } from './geometry';

const G = PA34_GEOMETRY;

/** 6.00-6: nose 6-ply at 31 psi, mains 8-ply at 50 psi (s.3). Cornering and slip as the 172's tyres (NASA TR R-64). */
const tyre = (inertia: number): TyreParams => ({
  radius: G.gear.mainWheelRadius,
  inertia,
  slipStiffness: 15,
  corneringStiffness: 8,
  relaxationLong: 0.15,
  relaxationLat: 0.3,
  lowSpeedDamping: 1.5,
});

/**
 * Nosewheel steering linked to the pedals, 21 degrees each way (s.3); a centring spring damps shimmy. The rods'
 * stiffness and the breakout are the PA-38's direct link scaled with the nose load (4.2 against 1.9 kN).
 */
const NOSE_STEERING: SteeringParams = {
  maxCommand: G.gear.maxNoseSteer,
  casterLimit: G.gear.maxNoseSteer,
  trail: 0.06,
  linkStiffness: 13000,
  breakoutTorque: 4400,
  bungeeStiffness: 13000,
  damper: 30,
  centeringTime: 0.15,
};

/**
 * The oleos' damping: the light-aircraft air / oil strut of c172Gear.ts (a valve-limited linear term and a metering
 * orifice, firmer on rebound), scaled with the load each leg carries.
 */
function oleoDamping(linear: number, compression: number, rebound: number): WheelConfig['damping'] {
  const knee = 0.6;
  return (strutRate, totalRate) => linear * knee * Math.tanh(totalRate / knee) + (strutRate > 0 ? compression : rebound) * strutRate * Math.abs(strutRate);
}

/**
 * Electro-hydraulic retraction (s.3): 6-7 s either way, the squat switch on the left main, NO up-locks and the
 * pressure trapped with the pump off (only a leak drops the gear: deadBusSagTime Infinity, contract 5.4), free fall
 * on the emergency knob (its time ESTIMATED), the pump working down to about 10 V (ESTIMATE, 14 V system). The horn
 * (s.3, s.9): a gear not down and locked with either throttle closed past the quadrant's microswitch, at the lever
 * position that gives 14 inHg at sea level and 2000 rpm; or the selector UP on the ground.
 */
export const PA34_RETRACT: RetractConfig = {
  extendTime: 6.5,
  retractTime: 6.5,
  minBusVolts: 10,
  squatInhibit: true,
  upLocks: false,
  deadBusSagTime: Infinity,
  emergency: { freeFallTime: 8 },
  // The lever position that gives 14 inHg at 2000 rpm near sea level (100 KIAS).
  warning: { throttleBelow: 0.18, leverUpOnGround: true },
};

/** Lower edge of a stowed main tyre: folded inboard to about y = 0.95 m, under the wing root's lower surface. */
const STOWED_MAIN_Y = 0.95;
const STOWED_MAIN_Z = 0.62;

function main(name: 'left' | 'right'): WheelConfig {
  const side = name === 'left' ? -1 : 1;
  const position = name === 'left' ? G.gear.leftMain : G.gear.rightMain;
  return {
    name,
    position,
    axis: { x: 0, y: 0, z: -1 },
    // About 0.11 m of the stroke at the static load (3.6 in showing against more than 8 in extended, s.3), the gas
    // column stiffening it beyond.
    strut: new OleoPneumaticSpring(2000, 0.155, 1.2, 0.2),
    // About 2 cm of tyre deflection at the static load.
    tyreSpring: { stiffness: 300e3, hardening: 0.07 },
    damping: oleoDamping(9000, 4000, 10000),
    tyre: tyre(0.35),
    steering: null,
    brake: name,
    // Cleveland 30-65 disc brakes (s.3): sized to hold both engines' static thrust on the brakes, about 8 kN on the
    // two wheels (the short-field take-off is begun "full power against the brakes", s.10).
    maxBrakeTorque: 1000,
    // About 3.5 g on one leg.
    limitLoad: 50e3,
    stowed: { x: position.x, y: side * STOWED_MAIN_Y, z: STOWED_MAIN_Z },
  };
}

/** Lower surface of the wing at span y (the chord plane less about 7 % of the chord below it). */
const wingLowerZ = (y: number) => G.wing.quarterChord.z - Math.max(y - G.wing.rootY, 0) * Math.tan(G.wing.dihedral) + 0.11;
const HALF_SPAN = G.wing.span / 2;
const H_TAIL_HALF = G.hTail.span / 2;
const NACELLE_X = G.propellers[1].hub.x - 1.2;

/** Airframe points that must not touch the ground. */
const STRUCTURE: readonly StructuralPoint[] = [
  // The squared tips with their caps, and the lower surface at mid-span: a low wing meets the ground inboard of
  // the tip.
  { position: { x: -0.4, y: -HALF_SPAN, z: wingLowerZ(HALF_SPAN) }, message: 'Left wingtip struck the ground', tolerance: 0 },
  { position: { x: -0.4, y: HALF_SPAN, z: wingLowerZ(HALF_SPAN) }, message: 'Right wingtip struck the ground', tolerance: 0 },
  { position: { x: -0.2, y: -3.3, z: wingLowerZ(3.3) }, message: 'Left wing struck the ground', tolerance: 0 },
  { position: { x: -0.2, y: 3.3, z: wingLowerZ(3.3) }, message: 'Right wing struck the ground', tolerance: 0 },
  // Nacelle undersides (behind the cowl flaps) and the stowed main tyres, which stay partly exposed in the wing
  // root (s.12): a gear-up landing slides on them (contract 3.3).
  { position: { x: NACELLE_X, y: G.propellers[0].hub.y, z: 0.36 }, message: 'Left nacelle struck the ground', tolerance: 0, part: 'left nacelle', belly: true },
  { position: { x: NACELLE_X, y: G.propellers[1].hub.y, z: 0.36 }, message: 'Right nacelle struck the ground', tolerance: 0, part: 'right nacelle', belly: true },
  { position: { x: G.gear.leftMain.x, y: -STOWED_MAIN_Y, z: STOWED_MAIN_Z }, message: 'Left main wheel struck the ground', tolerance: 0, part: 'left main wheel', belly: true },
  { position: { x: G.gear.rightMain.x, y: STOWED_MAIN_Y, z: STOWED_MAIN_Z }, message: 'Right main wheel struck the ground', tolerance: 0, part: 'right main wheel', belly: true },
  // The flat belly under the cabin and the nose's underside.
  { position: { x: -0.6, y: 0, z: 0.415 }, message: 'Belly struck the ground', tolerance: 0, part: 'belly', belly: true },
  { position: { x: 0.6, y: 0, z: 0.415 }, message: 'Belly struck the ground', tolerance: 0, part: 'belly', belly: true },
  { position: { x: 2.3, y: 0, z: 0.38 }, message: 'Nose struck the ground', tolerance: 0 },
  // The tail cone's underside at the tie-down, FS 285 (s.12): it touches at about 12 degrees of pitch. A scrape at
  // taxi or take-off-roll speed is survivable (as on the Cessnas).
  { position: { x: pa34StationX(285), y: 0, z: 0.14 }, message: 'Tail strike', tolerance: 2.5 },
  // Stabilator tips: roll-over points.
  { position: { x: G.hTail.quarterChord.x, y: -H_TAIL_HALF, z: G.hTail.quarterChord.z }, message: 'Left horizontal stabilizer struck the ground', tolerance: 0 },
  { position: { x: G.hTail.quarterChord.x, y: H_TAIL_HALF, z: G.hTail.quarterChord.z }, message: 'Right horizontal stabilizer struck the ground', tolerance: 0 },
  // Upper surfaces, for a nose-over or roll-over: the fin tip and the cabin roof (1.93 m above the ground).
  { position: { x: G.vTail.tip.x, y: 0, z: G.vTail.tip.z }, message: 'Aircraft flipped over', tolerance: 0 },
  { position: { x: 0.5, y: 0, z: G.restHeight - 1.93 }, message: 'Aircraft flipped over', tolerance: 0 },
];

export function createPA34Gear(): GearConfig {
  const nosePosition: Vec3 = G.gear.nose;
  return {
    wheels: [
      {
        name: 'nose',
        position: nosePosition,
        axis: { x: 0, y: 0, z: -1 },
        // About 0.08 m of the stroke at the static load (2.6 in showing, s.3).
        strut: new OleoPneumaticSpring(900, 0.102, 1.2, 0.14),
        tyreSpring: { stiffness: 180e3, hardening: 0.06 },
        damping: oleoDamping(8000, 3000, 7000),
        tyre: tyre(0.3),
        steering: NOSE_STEERING,
        brake: null,
        maxBrakeTorque: 0,
        limitLoad: 30e3,
        // Forward into the nose, under the baggage bay.
        stowed: { x: nosePosition.x + 0.55, y: 0, z: 0.38 },
      },
      main('left'),
      main('right'),
    ],
    structure: STRUCTURE,
    propellers: G.propellers.map((p, i) => ({
      hub: p.hub,
      radius: p.diameter / 2,
      message: i === 0 ? 'Left propeller strike' : 'Right propeller strike',
      part: i === 0 ? 'left propeller' : 'right propeller',
    })),
    // Contact speeds of a 60 KCAS (31 m/s) landing stall: 1.6 and 1.4 times it (gearConfig.ts rule of thumb).
    impact: { sinkRate: 7, speed: 49, steepSpeed: 43, steepPath: 12 * DEG },
    retract: PA34_RETRACT,
  };
}
