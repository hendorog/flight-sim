// Cessna 152 (1978 model): the landing gear and ground contact. Fixed tricycle: "Land-O-Matic" tapered tubular
// spring-steel main legs, an air / oil oleo nose strut on the engine mount steered from the pedals through a
// spring bungee (s.3 of the type's data sheet, aircraft-data/c152.md in the design work folder). A factory's
// value: the configuration holds spring objects and damping closures.
//
// Design point: 757.5 kg with the centre of gravity at FS 33.8 (the POH sample loading, s.6), which puts 23 % of
// the weight on the nose wheel (s.3): about 1.71 kN on the nose and 2.87 kN on each main. The springs then
// compress 0.063 m at the nose and 0.078 m at the mains (geometry.ts gives the fully extended points from that):
// the reference point 1.19 m above the ground and the fuselage 3.5 degrees nose-up, as on the static contact
// points of the data sheet.

import { DEG } from '../../core/math';
import type { GearConfig, StructuralPoint, WheelConfig } from '../../physics/gear/gearConfig';
import { LinearStrutSpring, OleoPneumaticSpring } from '../../physics/gear/springs';
import type { SteeringParams, TyreParams } from '../../physics/gear/tyre';
import { C152_GEOMETRY } from './geometry';

const G = C152_GEOMETRY;
/** The spring legs deflect up and outboard: their axis is tilted this far from the vertical (as the 172's). */
const MAIN_TILT = 10 * DEG;

/** 6.00-6, 4-ply, at 21 psi (s.3): softer than the 172's. Cornering and slip as the 172's tyres (NASA TR R-64). */
const MAIN_TYRE: TyreParams = {
  radius: G.gear.mainWheelRadius,
  inertia: 0.28,
  slipStiffness: 15,
  corneringStiffness: 8,
  relaxationLong: 0.15,
  relaxationLat: 0.3,
  lowSpeedDamping: 1.5,
};

/** 5.00-5, 4-ply, at 30 psi (s.3). */
const NOSE_TYRE: TyreParams = {
  radius: G.gear.noseWheelRadius,
  inertia: 0.12,
  slipStiffness: 15,
  corneringStiffness: 8,
  relaxationLong: 0.12,
  relaxationLat: 0.25,
  lowSpeedDamping: 1.5,
};

/**
 * The steering bungee (s.3): +/-8.5 degrees from the pedals alone; a braked main wheel makes the nose tyre scrub
 * and the wheel casters toward its 30 degree stops (the POH's tight turns with differential braking). The 172's
 * linkage; the bungee's preload and rate are lower in proportion to the lighter nose's scrub torque (about 1.2 kN
 * of side force on the 5 cm trail): with full pedal and full inside brake the wheel then reaches about 28 degrees
 * and the outer wingtip turns on 7.8 m (POH fig 1-1: 7.52 m); with the 172's it stopped at 20 (9.2 m).
 */
const NOSE_STEERING: SteeringParams = {
  maxCommand: G.gear.maxNoseSteer,
  casterLimit: 30 * DEG,
  trail: 0.05,
  linkStiffness: 2000,
  breakoutTorque: 20,
  bungeeStiffness: 30,
  // Hydraulic shimmy damper (s.3).
  damper: 25,
  centeringTime: 0.15,
};

/**
 * Main-leg damping: the steel leg's hysteresis and the tyre carcass, about 0.2 of critical in heave. The sheet
 * gives 0.1-0.15 ("the 152 bounces if dropped on", s.3); a little more, for the scrub the model leaves out.
 */
const MAIN_DAMPING = 1300;
/**
 * Nose oleo: the 172's damping valve and metering orifice (c172Gear.ts): the same Cessna strut family. On the
 * lighter nose and the softer gas column it damps the pitch-rocking mode at about the same fraction of critical.
 */
const NOSE_DAMPING_LINEAR = 10000;
const NOSE_VALVE_KNEE = 0.6;
const NOSE_ORIFICE_COMPRESSION = 2000;
const NOSE_ORIFICE_REBOUND = 5000;

function main(name: 'left' | 'right'): WheelConfig {
  const side = name === 'left' ? -1 : 1;
  return {
    name,
    position: name === 'left' ? G.gear.leftMain : G.gear.rightMain,
    axis: { x: 0, y: side * Math.sin(MAIN_TILT), z: -Math.cos(MAIN_TILT) },
    // About 50 kN/m per leg at the wheel, static deflection about 0.06 m at gross (s.3, ESTIMATE).
    strut: new LinearStrutSpring(50e3),
    // About 2 cm of tyre deflection at the static load.
    tyreSpring: { stiffness: 125e3, hardening: 0.07 },
    damping: (_strutRate, totalRate) => MAIN_DAMPING * totalRate,
    tyre: MAIN_TYRE,
    steering: null,
    brake: name,
    // Single-disc Cleveland 30-75A brake (s.3); sized so a full-pedal stop on dry pavement averages about 0.33 g.
    maxBrakeTorque: 250,
    // About 3.5 g on one leg.
    limitLoad: 20e3,
  };
}

/** Wing-tip lower surface (1 degree of dihedral from the root). */
const TIP_Z = G.wing.quarterChord.z - (G.wing.span / 2 - G.wing.rootY) * Math.tan(G.wing.dihedral);
const HALF_SPAN = G.wing.span / 2;
const H_TAIL_TIP_X = G.hTail.tipQuarterChordX ?? G.hTail.quarterChord.x;
const H_TAIL_HALF = G.hTail.span / 2;

/** Airframe points that must not touch the ground (positions from s.2.5 and the fuselage table of s.12). */
const STRUCTURE: readonly StructuralPoint[] = [
  { position: { x: -0.1, y: -HALF_SPAN, z: TIP_Z }, message: 'Left wingtip struck the ground', tolerance: 0 },
  { position: { x: -0.1, y: HALF_SPAN, z: TIP_Z }, message: 'Right wingtip struck the ground', tolerance: 0 },
  // Tail tie-down ring under the tailcone: it touches at about 15 degrees of pitch, 11.5 degrees of rotation from
  // the static attitude (s.2.4). A scrape at taxi or take-off-roll speed is survivable (as on the 172).
  { position: { x: -4.0, y: 0, z: 0.2 }, message: 'Tail strike', tolerance: 2.5 },
  { position: { x: H_TAIL_TIP_X, y: -H_TAIL_HALF, z: G.hTail.quarterChord.z }, message: 'Left horizontal stabilizer struck the ground', tolerance: 0 },
  { position: { x: H_TAIL_TIP_X, y: H_TAIL_HALF, z: G.hTail.quarterChord.z }, message: 'Right horizontal stabilizer struck the ground', tolerance: 0 },
  // Fuselage belly under the cabin and the lower cowling.
  { position: { x: -0.7, y: 0, z: 0.6 }, message: 'Belly struck the ground', tolerance: 0 },
  { position: { x: 0.4, y: 0, z: 0.66 }, message: 'Belly struck the ground', tolerance: 0 },
  { position: { x: 1.55, y: 0, z: 0.45 }, message: 'Nose struck the ground', tolerance: 0 },
  // Upper surfaces, for a nose-over or roll-over.
  { position: { x: G.vTail.tip.x, y: 0, z: G.vTail.tip.z }, message: 'Aircraft flipped over', tolerance: 0 },
  { position: { x: 0.2, y: 0, z: -0.8 }, message: 'Aircraft flipped over', tolerance: 0 },
];

export function createC152Gear(): GearConfig {
  const prop = G.propellers[0];
  return {
    wheels: [
      {
        name: 'nose',
        position: G.gear.nose,
        axis: { x: 0, y: 0, z: -1 },
        // About 0.10 m of stroke, 20 psi of air fully extended (s.3; about 0.4 kN on the piston); the gas column puts
        // the static nose load 5 cm into the stroke ("two to three fingers" of chrome showing).
        strut: new OleoPneumaticSpring(400, 0.07, 1.2, 0.1),
        tyreSpring: { stiffness: 125e3, hardening: 0.05 },
        damping: (strutRate, totalRate) =>
          NOSE_DAMPING_LINEAR * NOSE_VALVE_KNEE * Math.tanh(totalRate / NOSE_VALVE_KNEE) +
          (strutRate > 0 ? NOSE_ORIFICE_COMPRESSION : NOSE_ORIFICE_REBOUND) * strutRate * Math.abs(strutRate),
        tyre: NOSE_TYRE,
        steering: NOSE_STEERING,
        brake: null,
        maxBrakeTorque: 0,
        // The 172's: the same Cessna oleo, fork and firewall mounting, and the damping above makes the same force
        // for the same closing speed. An unflared arrival is nose-first (the 152's descending attitude at 55-60 KIAS
        // is below its 3.5 degree ground attitude): at 1.3 m/s (250 ft/min) the nose peaks at about 9 kN, at 2.3 m/s
        // (CAR 3's limit sink of the 1670 lb aeroplane is about 2.4) at 16 kN, both survived; steeper and nose-down
        // it folds.
        limitLoad: 20e3,
      },
      main('left'),
      main('right'),
    ],
    structure: STRUCTURE,
    propellers: [{ hub: prop.hub, radius: prop.diameter / 2, message: 'Propeller strike' }],
    // Contact speeds of a 43 KCAS (22 m/s) landing stall: 1.6 and 1.4 times it (gearConfig.ts rule of thumb).
    impact: { sinkRate: 7, speed: 35, steepSpeed: 31, steepPath: 12 * DEG },
  };
}
