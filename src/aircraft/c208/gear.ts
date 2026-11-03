// Cessna 208 Caravan 675: the landing gear and ground contact. Fixed tricycle: tubular spring-steel main legs and an
// air / oil oleo nose strut steered from the pedals through a spring link (POH sect. 7). A factory's value: the
// configuration holds spring objects and damping closures.
//
// Design point: 8000 lb with the CG near 30 % MAC (x about -0.08), which puts about 11 % of the weight on the
// nose wheel: about 3.9 kN on the nose and 15.9 kN on each main. The springs below then compress about 0.065 m at
// the nose (oleo 0.045 + tyre 0.02) and 0.095 m at the mains (leg 0.05 + tyre 0.045): geometry.ts gives the fully
// extended points from that, and the aircraft stands about level, the thrust line 1.68 m above the ground.
//
// Tyre springs from the inflation pressure and size: Raymer ("Aircraft Design", 6th ed., 11.3) has the contact area
// A = 2.3 sqrt(w D) (D/2 - R_rolling) carrying load = p A, so the radial stiffness is about 2.3 p sqrt(w D) (the
// C172S's 6.00-6 at 38 psi gives 157 kN/m against its 150). Pressures: ESTIMATES, no POH section 8 in hand: the
// 6.50-10 8-ply mains near their rated pressure for the 3400 lb each carries at 8000 lb (60 psi), the 22x8.00-8 nose
// at 40 psi.

import { DEG } from '../../core/math';
import type { GearConfig, StructuralPoint, WheelConfig } from '../../physics/gear/gearConfig';
import { LinearStrutSpring, OleoPneumaticSpring } from '../../physics/gear/springs';
import { TURBOPROP_BREAKAWAY, TURBOPROP_HYSTERESIS, type SteeringParams, type TyreParams } from '../../physics/gear/tyre';
import { C208_GEOMETRY, C208_THRUST_Z } from './geometry';

const G = C208_GEOMETRY;
const T = C208_THRUST_Z;
/** The spring legs deflect up and outboard: their axis is tilted this far from the vertical. */
const MAIN_TILT = 12 * DEG;

/** 6.50-10, 8-ply (POH). Cornering and slip as the light Cessnas' tyres (NASA TR R-64). */
const MAIN_TYRE: TyreParams = {
  radius: G.gear.mainWheelRadius,
  inertia: 1.0,
  slipStiffness: 15,
  corneringStiffness: 8,
  relaxationLong: 0.25,
  relaxationLat: 0.45,
  lowSpeedDamping: 1.5, hysteresis: TURBOPROP_HYSTERESIS, breakaway: TURBOPROP_BREAKAWAY,
};

/** 22 x 8.00-8 (POH). */
const NOSE_TYRE: TyreParams = {
  radius: G.gear.noseWheelRadius,
  inertia: 0.6,
  slipStiffness: 15,
  corneringStiffness: 8,
  relaxationLong: 0.2,
  relaxationLat: 0.4,
  lowSpeedDamping: 1.5, hysteresis: TURBOPROP_HYSTERESIS, breakaway: TURBOPROP_BREAKAWAY,
};

/**
 * Pedal steering through a spring link (POH: about 15 degrees each way; castering to 56 with differential
 * braking). The 152's bungee scaled for the heavier nose's scrub torque.
 */
const NOSE_STEERING: SteeringParams = {
  maxCommand: G.gear.maxNoseSteer,
  casterLimit: 56 * DEG,
  trail: 0.07,
  linkStiffness: 8000,
  breakoutTorque: 80,
  bungeeStiffness: 120,
  damper: 100,
  centeringTime: 0.2,
};

/** Main-leg damping: steel-leg hysteresis and the tyre carcass, about 0.2 of critical in heave on a 1600 kg share. */
const MAIN_DAMPING = 9000;
/** Nose oleo: the 152's valve and orifice scaled to the heavier strut. */
const NOSE_DAMPING_LINEAR = 30000;
const NOSE_VALVE_KNEE = 0.6;
const NOSE_ORIFICE_COMPRESSION = 6000;
const NOSE_ORIFICE_REBOUND = 15000;

function main(name: 'left' | 'right'): WheelConfig {
  const side = name === 'left' ? -1 : 1;
  return {
    name,
    position: name === 'left' ? G.gear.leftMain : G.gear.rightMain,
    axis: { x: 0, y: side * Math.sin(MAIN_TILT), z: -Math.cos(MAIN_TILT) },
    // About 320 kN/m per leg at the wheel (ESTIMATE: 0.05 m at the static load).
    strut: new LinearStrutSpring(320e3),
    // 6.50-10 (w 0.165 m, D 0.62 m) at 60 psi: 2.3 p sqrt(w D) = 304 kN/m (was 900); about 0.045 m at the static load,
    // a quarter of the 0.18 m section height; stiffening toward the rim.
    tyreSpring: { stiffness: 304e3, hardening: 0.09 },
    damping: (_strutRate, totalRate) => MAIN_DAMPING * totalRate,
    tyre: MAIN_TYRE,
    steering: null,
    brake: name,
    // Hydraulic disc brakes; a full-pedal stop on dry pavement averages about 0.35 g.
    maxBrakeTorque: 2000,
    // About 3.5 g on one leg's share.
    limitLoad: 70e3,
  };
}

/** Wing-tip lower surface (3 degrees of dihedral from the root rib). */
const TIP_Z = G.wing.quarterChord.z - (G.wing.span / 2 - G.wing.rootY) * Math.tan(G.wing.dihedral);
const HALF_SPAN = G.wing.span / 2;
const H_TAIL_TIP_X = G.hTail.tipQuarterChordX ?? G.hTail.quarterChord.x;
const H_TAIL_HALF = G.hTail.span / 2;

/** Airframe points that must not touch the ground (3V). */
const STRUCTURE: readonly StructuralPoint[] = [
  { position: { x: -0.1, y: -HALF_SPAN, z: TIP_Z }, message: 'Left wingtip struck the ground', tolerance: 0, item: 'wingtipLeft' },
  { position: { x: -0.1, y: HALF_SPAN, z: TIP_Z }, message: 'Right wingtip struck the ground', tolerance: 0, item: 'wingtipRight' },
  // The tail tie-down under the tailcone: it touches at about 15 degrees of pitch.
  { position: { x: -5.3, y: 0, z: T }, message: 'Tail strike', tolerance: 2.5, item: 'tail' },
  { position: { x: H_TAIL_TIP_X, y: -H_TAIL_HALF, z: G.hTail.quarterChord.z }, message: 'Left horizontal stabilizer struck the ground', tolerance: 0, item: 'tail' },
  { position: { x: H_TAIL_TIP_X, y: H_TAIL_HALF, z: G.hTail.quarterChord.z }, message: 'Right horizontal stabilizer struck the ground', tolerance: 0, item: 'tail' },
  // The flat cabin floor and the cowling's chin inlet.
  { position: { x: -1.5, y: 0, z: T + 0.8 }, message: 'Belly struck the ground', tolerance: 0, item: 'belly' },
  { position: { x: 1.2, y: 0, z: T + 0.8 }, message: 'Belly struck the ground', tolerance: 0, item: 'belly' },
  { position: { x: 3.3, y: 0, z: T + 0.58 }, message: 'Nose struck the ground', tolerance: 0, item: 'nose' },
  // Upper surfaces, for a nose-over or roll-over.
  { position: { x: G.vTail.tip.x, y: 0, z: G.vTail.tip.z }, message: 'Aircraft flipped over', tolerance: 0 },
  { position: { x: 0.5, y: 0, z: T - 1.2 }, message: 'Aircraft flipped over', tolerance: 0 },
];

export function createC208Gear(): GearConfig {
  const prop = G.propellers[0];
  return {
    wheels: [
      {
        name: 'nose',
        position: G.gear.nose,
        axis: { x: 0, y: 0, z: -1 },
        // About 0.15 m of stroke, 1.5 kN on the piston fully extended; the static nose load sits 4.5 cm in.
        strut: new OleoPneumaticSpring(1500, 0.078, 1.2, 0.15),
        // 22x8.00-8 (w 0.203 m, D 0.56 m) at 40 psi: 2.3 p sqrt(w D) = 214 kN/m (was 300).
        tyreSpring: { stiffness: 214e3, hardening: 0.06 },
        damping: (strutRate, totalRate) =>
          NOSE_DAMPING_LINEAR * NOSE_VALVE_KNEE * Math.tanh(totalRate / NOSE_VALVE_KNEE) +
          (strutRate > 0 ? NOSE_ORIFICE_COMPRESSION : NOSE_ORIFICE_REBOUND) * strutRate * Math.abs(strutRate),
        tyre: NOSE_TYRE,
        steering: NOSE_STEERING,
        brake: null,
        maxBrakeTorque: 0,
        limitLoad: 50e3,
      },
      main('left'),
      main('right'),
    ],
    structure: STRUCTURE,
    propellers: [{ hub: prop.hub, radius: prop.diameter / 2, message: 'Propeller strike' }],
    // Contact speeds of a 60 KCAS (31 m/s) landing stall: 1.6 and 1.4 times it (gearConfig.ts rule of thumb).
    // Landing damage (physics/damage.ts). Axial leg loads from drops at MTOW, wings level, lift = weight
    // (tests/gear/damage.test.ts), placed on the landing-damage research's section 7 sink-rate bands: the
    // hard-landing note at V_lim 3.05 m/s (600 fpm); hard / yield / collapse mains-first at 3.05 / 6.0 / 8.0 m/s (collapse: an 8 m/s drop's load, 8.4-8.7 once the set is in),
    // nose-wheel contact at 2.13 / 2.74 / 3.96 m/s. An oleo, once bottomed, folds on a later contact at 40 % of
    // the way from its yield to its ultimate load (an estimate). The spring mains are the owner's (a light-aircraft pilot's) call,
    // stronger than the research's: they take a permanent set at about 6 m/s and would break only beyond an 8 m/s
    // drop's load, past the 7 m/s terrain impact, so in a landing they bend but do not collapse.
    // All loads re-set 2026-11-03 for the pressure-based tyre springs (softer tyres take more of the energy: the old
    // loads were reached 0.15-0.3 m/s later).
    damage: {
      legs: [
        { kind: 'oleo', hardLoad: 51.5e3, yieldLoad: 81.3e3, ultimateLoad: 169.8e3, bottomedUltimate: 116.7e3, collapsedCompression: 0.15, yield: { text: 'Nose gear spring support damaged', item: 'nose' } },
        { kind: 'spring', hardLoad: 52.1e3, yieldLoad: 100.7e3, ultimateLoad: 138.4e3, collapsedCompression: 0.3 },
        { kind: 'spring', hardLoad: 52.1e3, yieldLoad: 100.7e3, ultimateLoad: 138.4e3, collapsedCompression: 0.3 },
      ],
      // Free turbine: a strike that digs in stops the propeller and power turbine; the gas generator runs on.
      propStopText: 'Propeller strike: propeller stopped (gas generator running)',
    },
    impact: { sinkRate: 7, speed: 50, steepSpeed: 43, steepPath: 12 * DEG },
  };
}
