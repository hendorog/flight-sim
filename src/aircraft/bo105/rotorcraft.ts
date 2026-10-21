// MBB Bo 105 CB-4: the RotorcraftDefinition. Owner: BO (plan revision 2, sections 6.1-6.2).
//
// Four-blade hingeless main rotor (titanium star hub, GRP blades flexing at the root: an equivalent hinge with a spring
// in RC's harmonic solver, hub.ts and coning.ts), CCW from above; two-blade teetering tail rotor on the LEFT at the fin
// top (a pusher); 3 deg forward shaft tilt; the stabiliser with endplates on the boom; two Allison 250-C20B through two
// freewheels into the ZF FS 72B (systems.turboshaft per engine, systems.twinTurboshaft; TW's drivetrain); tandem
// hydraulic boost with electric cyclic trim and no SAS. The physics flies the geometry contract (dimensions.ts): hub,
// tail rotor, stabiliser, fin, skids. Tags: P primary (pages in docs/bo105-sources.md), P5 the CB-5 FM used for the
// CB-4, F family, S secondary, D derived (arithmetic shown), 3V measured on a three-view or photo, ESTIMATE judged.
// docs/bo105-flight-model.md has every calibration (the sole knob of each, before/after numbers).
import { DEG } from '../../core/math';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import { R44_ROTORCRAFT } from '../r44/rotorcraft';
import * as D from './dimensions';
import { BO105_BLADE_CONING } from './coning';
import { BO105_HUB_SET, BO105_MAIN_ROTOR, BO105_MAST_MOMENT } from './hub';
import { BO105_ENGINE } from './powerplant';
import { BO105_ENGINE_RATIO, BO105_NR_100, BO105_POWER_LEVER, BO105_TAIL_RATIO, BO105_TORQUE_100_W, BO105_TORQUE_PCT,
  BO105_WARNINGS } from './facts';
import { BO105_SPEED_CORRECTIONS, BO105_VNE } from './limits';
import { BO105_TRANSMISSION_TORQUE_LIMIT_NM, BO105_TURBOSHAFT_INDICATION, BO105_TWIN } from './twin';

const fcu = BO105_ENGINE.turbine!.gasGenerator.fcu;
const HS = D.HORIZONTAL_STABILIZER;

/** Fin area and centroid from the 3V outline (stations and heights, m; shoelace). D */
function outlineArea(p: readonly (readonly [number, number])[]): { area: number; x: number; z: number } {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length], cross = x0 * y1 - x1 * y0;
    a += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
  }
  a /= 2; cx /= 6 * a; cy /= 6 * a;
  return { area: Math.abs(a), x: D.x(cx), z: D.z(cy) };
}
const FIN = outlineArea(D.FIN_OUTLINE);

/**
 * Cyclic travel, deg of blade cyclic at the stops. Control rigging not found (MM ch 103 not obtained; research-bo105
 * section 8): the TOTAL travels are FITTED to AR-280's control derivatives per % of travel, taking "%" as % of full
 * travel (0.02 of the sim's -1..1 axis), an assumption flagged in docs: longitudinal 13.43 deg to M_lon 0.093 rad/s^2
 * per % (DLR; AFDD 0.098), lateral 8.25 deg to L_lat 0.185 (DLR; AFDD 0.179); calibrated at 80 KCAS, 3000 ft, 2200 kg
 * (docs/bo105-flight-model.md). Where the stops sit about the zero-cyclic swashplate is not published either (AGENT/
 * ESTIMATE rigging): the envelope needs 9.41 deg forward at 145 KIAS (2200 kg, aft CG) and 2.63 deg aft in 20 kt rearward
 * flight (2500 kg, forward CG), 12.04 of the 13.43 deg, so the stops leave the same 0.70 deg (5.2 % of travel) beyond
 * both: forward 10.10, aft 3.33 (the plan's 10 % rearward margin cannot be had with the fitted travel: KNOWN_ISSUES).
 * The hover stick sits about 0.25 of the travel aft of its centre. Lateral symmetric (needs: 2.42 deg left in 25 kt
 * sideward flight from the left at 2500 kg, 1.92 right at 145 KIAS). Calibrated, ESTIMATE.
 */
export const BO105_CYCLIC_DEG = { forward: 10.10, aft: 3.33, left: 4.125, right: 4.125 } as const;
/** Tail-rotor blade pitch, deg, full right (min) to full left pedal (max): the RANGE fitted to N_ped 0.049 rad/s^2 per
 *  % (DLR; AFDD 0.057), 16.74 deg; the stops placed for the demanding trims (AGENT/ESTIMATE rigging, no source): 25 kt
 *  sideward flight with the wind from the right at 2500 kg needs 13.18 deg, left 10 % of the pedal beyond it (14.85);
 *  a 75 KIAS autorotation needs about 0.2 deg, 12 % above the right stop. Calibrated, ESTIMATE. */
export const BO105_TAIL_PITCH_DEG = { min: -1.89, max: 14.85 } as const;

export const BO105_ROTORCRAFT: RotorcraftDefinition = {
  hubModel: { kind: 'hingeless', ...BO105_HUB_SET, coning: BO105_BLADE_CONING,
    mastMomentLimit: BO105_MAST_MOMENT.limit, mastMomentYellow: BO105_MAST_MOMENT.yellow },
  // 100 % NR = 424.5 rpm (D from P TCDS p10 bands); governed at 100 % (P5 FM 4-17: "100 % recommended for steady flight").
  referenceRpm: BO105_NR_100, nominalRpm: BO105_NR_100,
  // D: 6016 / 424.5 = 14.17; tail 5.25 (F METU / Theodore: 233 / 44.4 rad/s).
  engineRatio: BO105_ENGINE_RATIO, tailRatio: BO105_TAIL_RATIO,
  // CCW from above (D, FM 3-34: double engine failure yaws LEFT); tail-rotor sense for the renderer (not found).
  rotation: D.MAIN_ROTOR_ROTATION, tailRotation: D.TAIL_ROTOR_ROTATION,
  // ESTIMATE: the three-stage FS 72B, the intermediate and tail gearboxes and the shafts (the MD 500E's figure).
  transmissionEfficiency: 0.95,
  cyclicLimits: { forward: BO105_CYCLIC_DEG.forward * DEG, aft: BO105_CYCLIC_DEG.aft * DEG,
    left: BO105_CYCLIC_DEG.left * DEG, right: BO105_CYCLIC_DEG.right * DEG },
  // The legacy symmetric reader (the ground blade pose of other renderers): the mean half-travel.
  cyclicLimit: (BO105_CYCLIC_DEG.forward + BO105_CYCLIC_DEG.aft + BO105_CYCLIC_DEG.left + BO105_CYCLIC_DEG.right) / 4 * DEG,
  // P5 FM Fig 1-1 (3V), P AR-280: 3 deg forward.
  shaftTilt: D.SHAFT_TILT,
  // The governed rotor's air speed carries the fuselage yaw rate (the main rotor's yaw damping), as on the MD 500E.
  yawInRotorSpeed: true,
  // Hydraulic boost (P5 FM 7-24): no control-system flexibility between the actuators and the blades.
  controlFlex: undefined,
  // Hingeless: no teeter stop (the legacy field; never read on this hub).
  teeterLimit: 12 * DEG,
  airspeedLimits: BO105_VNE, airspeedCorrections: BO105_SPEED_CORRECTIONS, manifoldLimits: undefined,
  // Tandem hydraulic boost, no SAS (P5 FM 3-9..3-11, 7-24; P TM 00-6); electric cyclic trim with feel springs and a
  // 4-way switch (P5 FM 7-24, 3-45). Trim rate and spring force ESTIMATE (a boosted control's light feel springs).
  controlSystem: { cyclic: 'hydraulic', collective: 'hydraulic', pedals: 'mechanical', trim: 'electric-spring',
    springTrim: { rate: 0.05, force: 60 } },
  systems: {
    // Belt-clutch and piston-governor fields: ignored on 'freewheel' (definition.ts), written inert.
    clutchSeconds: 1, beltTorque: 0, correlator: 0, governorRate: 0, governorEngage: 0, powerCheckMinRpm: 0,
    // The warning unit's NR LOW at 95 % (P TM 00-44, P5 FM 3-16); no collective inhibit (consistency: -1).
    lowRpmWarning: BO105_WARNINGS.nrLowPct / 100, hornCollectiveMin: -1,
    // AEO 2 x 257 kW (86 %) take-off (5 min) and MCP (P TCDS p9): documentation fields; the pilot limits are % torque.
    continuousPower: 2 * BO105_TORQUE_PCT.aeo / 100 * BO105_TORQUE_100_W,
    takeoffPower: 2 * BO105_TORQUE_PCT.aeo / 100 * BO105_TORQUE_100_W, takeoffSeconds: BO105_TORQUE_PCT.aeoTakeoffSeconds,
    drive: 'freewheel',
    // The coupling cap at each engine's output shaft: 2 x the 95 % OEI rating (twin.ts, D): never binds.
    transmissionTorqueLimit: BO105_TRANSMISSION_TORQUE_LIMIT_NM,
    turboshaft: {
      // The power levers OFF - IDLE - FLIGHT (facts.ts BO105_POWER_LEVER; consistency: the input profile's twistGrip).
      grip: { ...BO105_POWER_LEVER },
      plaNg: { groundIdle: fcu.lowIdleNg, fullOpen: fcu.maxNg },
      // The Bo 105 indication (torque in % of 298 kW, TCDS/FM limits) and the twin governor law (twin.ts, TW), with
      // the droop compensator re-fitted on this rotor by TW's two readings (docs/twin-turboshaft.md section 8): the datum
      // at the per-engine N1 at flat pitch on the ground at 100 % NR, split synchronised (77.40 %), and the anticipation
      // through the 2200 kg OGE hover, SL ISA (N1 95.34 % per engine at collective 0.3827): (0.9534 - 0.7740) / 0.3827 =
      // 0.469 per unit collective. ESTIMATE (the Bo 105's compensator rigging is not published).
      ...BO105_TURBOSHAFT_INDICATION,
      governor: { ...BO105_TURBOSHAFT_INDICATION.governor, datumNg: 0.774, anticipation: 0.469 },
    },
    twinTurboshaft: BO105_TWIN,
  },
  // Main transmission oil (P5 FM 2-20: pressure 0.5 kp/cm^2 minimum, 0.8-2.0 normal; temperature 30-105 C): the
  // accessory gearbox's rotor-driven pump (P5 FM 7-16), about 1.5 kp/cm^2 = 21 psi at 100 % NR; full pressure from about
  // 300 rpm NR. Heat: about 25 kW lost in the drive at cruise power, the oil-cooler fan holding about 75 C (ESTIMATES).
  transmission: { pressurePsi: 21, pumpRpm: 300, pressureSeconds: 6, heatCapacity: 120_000, cooling: 400 },
  main: BO105_MAIN_ROTOR,
  tail: {
    radius: D.TAIL_ROTOR_RADIUS, chord: D.TAIL_ROTOR_CHORD, blades: D.TAIL_ROTOR_BLADES,
    // Root cut-out ESTIMATE (the teetering hub and the tension straps: about 20 % R).
    rootCutout: 0.19,
    minPitch: BO105_TAIL_PITCH_DEG.min * DEG, maxPitch: BO105_TAIL_PITCH_DEG.max * DEG, twist: D.TAIL_ROTOR_TWIST_DEG * DEG,
    // NACA 0012 (P AR-280 p145; P5 FM 7-21): analytic polar. ESTIMATES.
    liftSlope: 5.7, maxCl: 1.2, profileCd: 0.011, inducedDrag: 0.012,
    // Two GRP blades (0.95 m) and the teetering hub with the yoke's dynamic weights (P5 FM 7-21): ESTIMATE.
    inertia: 0.6, hub: D.TAIL_HUB,
    // The small, fast tail rotor's inflow settles in milliseconds (Pitt-Peters uniform mode).
    pittPetersInflow: true,
  },
  // Stabiliser on the boom (P AR-280 Table 6.2.1: span 2.0 m, chord 0.4 m, 0.8 m^2, 0 deg incidence; section "NACA
  // 0010/C020", read as symmetric). Its lift slope is the effective one at the tail (aspect ratio 5 with endplates, the
  // rotor wake's downwash gradient and the boom's wake): the sole knob of Mw (plan 6.2), ESTIMATE. Downwash fraction at
  // the surface ESTIMATE 0.45 (the MD 500E's).
  stabilizer: { centre: { x: HS.quarterChord.x, y: 0, z: HS.quarterChord.z }, area: HS.area, liftSlope: 3.0,
    incidence: HS.incidenceDeg * DEG, maxCl: 1.0, wash: 0.45 },
  fins: [
    // The swept fin (3V outline, dimensions.ts; shoelace area and centroid), symmetric section; the upper half inside
    // the tail rotor's intake stream tube (the rotor turns on its left at the fin top). ESTIMATES.
    { centre: { x: FIN.x, y: 0, z: FIN.z }, area: FIN.area, liftSlope: 2.5, incidence: 0, maxCl: 1.0,
      tailRotorFlow: { areaFraction: 0.5, velocityRatio: 0.6 } },
    // The two stabiliser endplates (2 x 0.45 x 0.42 m, 3V) as one surface at the stabiliser. ESTIMATE slope.
    { centre: { x: HS.quarterChord.x, y: 0, z: HS.quarterChord.z }, area: 2 * HS.endplates.height * HS.endplates.chord,
      liftSlope: 2.0, incidence: 0, maxCl: 1.0 },
  ],
  // Fuselage destabilising moments, N m per (Pa rad): slender-body (Munk) estimate for the cabin pod and boom, D:
  // 2 x volume x (k2 - k1) with the pod 4.3 x 1.58 x 1.4 m filled about 0.6 (5.7 m^3) and the boom 0.5 m^3, k2 - k1 about
  // 0.6 (fineness about 3-5), times 0.6 for the real body's viscous loss: pitch 4.5; yaw the same body seen from the side
  // less the fin's root fairing, 3.0. ESTIMATES set from geometry before measuring (RC's note: the repo's MD 500E 0.25 is
  // about 15 x below a Munk estimate of a cabin this size).
  fuselageMoment: { pitch: 4.5, yaw: 3.0 },
  // Equivalent flat plates, m^2: x the cruise-speed knob (plan 6.2: max cruise 125-135 KTAS at MCP); y, z 3V side and
  // plan areas with bluff-body coefficients. ESTIMATES.
  dragArea: { x: 1.5, y: 5.5, z: 6.5 }, dragCentre: { x: -0.2, y: 0, z: 0.1 },
  fuselageWash: 1 + -D.MAIN_HUB.z / Math.hypot(D.MAIN_ROTOR_RADIUS, D.MAIN_HUB.z),
  // Tail skid under the fin (3V, dimensions.ts TAIL_SKID); the fin's lower edge as the strike points.
  tailProtection: {
    stinger: [{ x: D.x(D.TAIL_SKID.sta - 0.25), y: 0, z: D.z(D.TAIL_SKID.height + 0.05) },
      { x: D.x(D.TAIL_SKID.sta), y: 0, z: D.z(D.TAIL_SKID.height) },
      { x: D.x(D.TAIL_SKID.sta + 0.2), y: 0, z: D.z(D.TAIL_SKID.height + 0.04) }],
    radius: 0.015, fin: D.FIN_OUTLINE.map(([sta, h]) => ({ x: D.x(sta), y: 0, z: D.z(h) })),
    stiffness: 30_000, damping: 1200, maxSink: 1, maxCompression: 0.08 },
  groundRotor: { blade: BO105_BLADE_CONING, stopFriction: 0,
    // The tail boom from the pod's end (STA 5.0) to the fin (3V ESTIMATE).
    tailcone: { front: { x: D.x(5.0), y: 0, z: D.z(1.55) }, rear: { x: D.x(8.6), y: 0, z: D.z(1.75) }, frontRadius: 0.30, rearRadius: 0.13 },
    // The cabin pod: nose STA 0.70 to 5.0, belly 0.40 to roof 2.05 m (P hull 4.30 x 1.58 m; 3V heights).
    cabin: { centre: { x: D.x(2.85), y: 0, z: D.z(1.225) }, radii: { x: 2.15, y: D.HULL_WIDTH / 2, z: 0.825 } } },
  skids: {
    halfTrack: D.SKID_HALF_TRACK, front: D.SKID_CONTACT_FRONT_X, rear: D.SKID_CONTACT_REAR_X, z: D.SKID_Z, frontZ: D.SKID_FRONT_Z,
    // Two bending cross tubes (P TM 00-7): the R44's cross-tube gear scaled to 2500 kg (x 2.2): elastic per contact,
    // a bilinear yield at about 3 g at maximum mass (2500 x 9.81 x 3 / 4 = 18 kN). ESTIMATES (no gear data).
    stiffness: 240_000, damping: 7900, friction: 0.5, maxSink: 3.5,
    suspension: 'cross-tube',
    flexure: { yieldForce: 18_000, hardening: 24_000, maxStroke: 0.25, spread: 0.5 },
    terrain: { ...R44_ROTORCRAFT.skids.terrain!, tubeRadius: D.SKID_TUBE_RADIUS, toe: D.SKID_FRONT_X, heel: D.SKID_REAR_X },
    surfaces: R44_ROTORCRAFT.skids.surfaces,
  },
};
