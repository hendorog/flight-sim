// Piper PA-38-112 Tomahawk II: the landing gear and ground contact. Fixed tricycle: single-leaf steel-spring main
// legs from the underside of the wing, splayed down and out to the wheels; an air / oil oleo nose strut on the
// engine mount, its wheel linked directly to the rudder pedals, 30 degrees each way, with no free castering (s.3 of
// the type's data sheet, aircraft-data/pa38.md in the design work folder). 6.00-6 tyres on all three wheels (the
// Tomahawk II's standard). A factory's value: the configuration holds spring objects and damping closures.
//
// Design point: 757.5 kg with the centre of gravity at STA 75.8 (the maxGross loading, systems.ts), which puts 25 %
// of the weight on the nose wheel (s.3): about 1.86 kN on the nose and 2.79 kN on each main. The springs then
// compress so that the reference point stands geometry.restHeight above the ground with the fuselage level, as the
// POH's dimensioned heights have it (s.2.9); geometry.ts gives the fully extended contact points from that.

import { DEG } from '../../core/math';
import type { GearConfig, StructuralPoint, WheelConfig } from '../../physics/gear/gearConfig';
import { LinearStrutSpring, OleoPneumaticSpring } from '../../physics/gear/springs';
import type { SteeringParams, TyreParams } from '../../physics/gear/tyre';
import { PA38_GEOMETRY } from './geometry';

const G = PA38_GEOMETRY;
/**
 * The leaf legs run down and out at about 45 degrees (s.12) and bend in their own plane: the wheel moves up and
 * outward. ESTIMATE of the axis a wheel moves along, between the Cessnas' tubular legs (10 degrees) and the leaf.
 */
const MAIN_TILT = 20 * DEG;

/** 6.00-6 Type III, 4-ply, at 30 psi (POH 7.7, s.3). Cornering and slip as the 172's tyres (NASA TR R-64). */
const TYRE: TyreParams = {
  radius: G.gear.mainWheelRadius,
  inertia: 0.28,
  slipStiffness: 15,
  corneringStiffness: 8,
  relaxationLong: 0.15,
  relaxationLat: 0.3,
  lowSpeedDamping: 1.5,
};

/**
 * Direct nosewheel steering (POH 7.7, MM chart 1): push-pull rods from the pedals, 30 +/-2 degrees each way at full
 * pedal, no bungee to give and no free castering beyond the stops. The rods' stiffness stands in for the bungee's
 * (a breakout no tyre can reach).
 */
const NOSE_STEERING: SteeringParams = {
  maxCommand: G.gear.maxNoseSteer,
  casterLimit: G.gear.maxNoseSteer,
  trail: 0.05,
  linkStiffness: 6000,
  breakoutTorque: 2000,
  bungeeStiffness: 6000,
  damper: 25,
  centeringTime: 0.15,
};

/** Main-leg damping: the steel leaf's hysteresis and the tyre carcass, about 0.15-0.2 of critical in heave. */
const MAIN_DAMPING = 1300;
/**
 * Nose oleo: the Cessnas' damping valve and metering orifice (c172Gear.ts), the same family of light-aircraft
 * air / oil strut.
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
    // About 48 kN/m per leg along that axis: 0.06 m of static deflection at gross (ESTIMATE).
    strut: new LinearStrutSpring(48e3),
    // About 2 cm of tyre deflection at the static load.
    tyreSpring: { stiffness: 125e3, hardening: 0.07 },
    damping: (_strutRate, totalRate) => MAIN_DAMPING * totalRate,
    tyre: TYRE,
    steering: null,
    brake: name,
    // Cleveland single-disc hydraulic brake (POH 7.7, s.3), sized to hold the static full-power run (about 2.2 kN of
    // thrust on the brakes: POH 4.5's short-field take-off and the static rpm check, s.5); on the landing roll that
    // stops at about 0.3 g, the C172S's figure, where the POH's 215 m implies 0.23 g. The model has one brake torque
    // for a sliding and a holding disc: request D-D-pa38-phys-01.
    maxBrakeTorque: 260,
    // About 3.5 g on one leg.
    limitLoad: 20e3,
  };
}

/** Wing chord plane at the tip and at mid-span (dihedral from the fuselage side); the lower surface is about 0.08 m below it (17 %). */
const wingLowerZ = (y: number) => G.wing.quarterChord.z - (y - G.wing.rootY) * Math.tan(G.wing.dihedral) + 0.08;
const HALF_SPAN = G.wing.span / 2;
const H_TAIL_HALF = G.hTail.span / 2;
const IN = 0.0254;
const sta = (station: number) => (77.25 - station) * IN;
const wl = (waterLine: number) => (36.5 - waterLine) * IN;

/** Airframe points that must not touch the ground (stations of s.2.7, the fuselage table of s.12). */
const STRUCTURE: readonly StructuralPoint[] = [
  // The down-turned tip caps, and the lower surface at mid-span: a low wing meets the ground well inboard of the tip.
  { position: { x: -0.1, y: -HALF_SPAN, z: wingLowerZ(HALF_SPAN) + 0.03 }, message: 'Left wingtip struck the ground', tolerance: 0 },
  { position: { x: -0.1, y: HALF_SPAN, z: wingLowerZ(HALF_SPAN) + 0.03 }, message: 'Right wingtip struck the ground', tolerance: 0 },
  { position: { x: 0.1, y: -2.6, z: wingLowerZ(2.6) }, message: 'Left wing struck the ground', tolerance: 0 },
  { position: { x: 0.1, y: 2.6, z: wingLowerZ(2.6) }, message: 'Right wing struck the ground', tolerance: 0 },
  // The tail skid / tie-down under the sternpost (POH 4.33, 7.35; rudder bottom WL 44.90): it touches at about 16
  // degrees of pitch. A scrape at taxi or take-off-roll speed is survivable (as on the Cessnas).
  { position: { x: sta(258), y: 0, z: wl(44.9) }, message: 'Tail strike', tolerance: 2.5 },
  // Tailplane tips on the fin top: roll-over points.
  { position: { x: G.hTail.quarterChord.x, y: -H_TAIL_HALF, z: G.hTail.quarterChord.z }, message: 'Left horizontal stabilizer struck the ground', tolerance: 0 },
  { position: { x: G.hTail.quarterChord.x, y: H_TAIL_HALF, z: G.hTail.quarterChord.z }, message: 'Right horizontal stabilizer struck the ground', tolerance: 0 },
  // Fuselage belly under the cabin and the cowl's chin.
  { position: { x: -0.5, y: 0, z: 0.5 }, message: 'Belly struck the ground', tolerance: 0 },
  { position: { x: 0.5, y: 0, z: 0.5 }, message: 'Belly struck the ground', tolerance: 0 },
  { position: { x: 1.4, y: 0, z: 0.42 }, message: 'Nose struck the ground', tolerance: 0 },
  // Upper surfaces, for a nose-over or roll-over: the top of the tail (WL 105.75) and the canopy crown.
  { position: { x: G.vTail.tip.x, y: 0, z: wl(105.75) }, message: 'Aircraft flipped over', tolerance: 0 },
  { position: { x: -0.14, y: 0, z: G.propellers[0].hub.z - 0.7 }, message: 'Aircraft flipped over', tolerance: 0 },
];

export function createPA38Gear(): GearConfig {
  const prop = G.propellers[0];
  return {
    wheels: [
      {
        name: 'nose',
        position: G.gear.nose,
        axis: { x: 0, y: 0, z: -1 },
        // About 0.11 m of stroke; the gas column puts the static nose load about 5 cm into it (the POH's "3 in of
        // strut exposed", s.3).
        strut: new OleoPneumaticSpring(450, 0.07, 1.2, 0.11),
        tyreSpring: { stiffness: 125e3, hardening: 0.05 },
        damping: (strutRate, totalRate) =>
          NOSE_DAMPING_LINEAR * NOSE_VALVE_KNEE * Math.tanh(totalRate / NOSE_VALVE_KNEE) +
          (strutRate > 0 ? NOSE_ORIFICE_COMPRESSION : NOSE_ORIFICE_REBOUND) * strutRate * Math.abs(strutRate),
        tyre: TYRE,
        steering: NOSE_STEERING,
        brake: null,
        maxBrakeTorque: 0,
        // As the Cessnas' (the C152's review: a firm flat arrival must not fold it).
        limitLoad: 20e3,
      },
      main('left'),
      main('right'),
    ],
    structure: STRUCTURE,
    propellers: [{ hub: prop.hub, radius: prop.diameter / 2, message: 'Propeller strike' }],
    // Contact speeds of a 52 KCAS (27 m/s) landing stall: 1.6 and 1.4 times it (gearConfig.ts rule of thumb).
    impact: { sinkRate: 7, speed: 43, steepSpeed: 37, steepPath: 12 * DEG },
  };
}
