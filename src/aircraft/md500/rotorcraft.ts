// MD 500E (369E): the RotorcraftDefinition. Owner: T2.
//
// Five-blade fully articulated main rotor (V-strap pack, elastomeric lead-lag dampers; reduced harmonic hub of
// physics/rotorcraft/articulated.ts), two-blade teetering tail rotor on the left of the boom, a 3 deg forward
// static mast, the T-stab on the upper fin; the 250-C20B through the overrunning clutch (systems.drive 'freewheel')
// with the twist grip, the hydromechanical N2 governor and the beep (systems.turboshaft; physics/rotorcraft/
// turboshaft.ts, docs/turboshaft-model.md). Every number has its tag: P primary (RFM CSP-E-1 Rev 16, FAA TCDS H3WE
// Rev 21, EASA IM.E.052), D derived, F family (OH-6A, Heffley NASA CR-3144; 500C, NASA CR-166256), 3V measured on
// the RFM drawings, ESTIMATE judged and calibrated (docs/md500-flight-model.md has the calibration of each).
import { DEG } from '../../core/math';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import { R22_ROTORCRAFT } from '../r22/rotorcraft';
import * as D from './dimensions';
import { MD500_ARTICULATED, MD500_BLADE_ROOT } from './articulated';
import { MD500_BLADE_CONING } from './coning';
import { MD500_ENGINE_OUT, MD500_ENGINE_RATIO, MD500_N2_BEEP, MD500_NR_100, MD500_NR_NOMINAL, MD500_PSI_PER_NM,
  MD500_TAIL_RATIO, MD500_TORQUE_PSI, MD500_TOT_C, MD500_N1_PCT, MD500_N2_PCT, MD500_TWIST_GRIP } from './facts';
import { MD500_SPEED_CORRECTIONS, MD500_VNE } from './limits';
import { MD500_CONTINUOUS_POWER, MD500_TAKEOFF_POWER, ALLISON_250_C20B } from './powerplant';

const IN = 0.0254;
const x = (sta: number): number => (100 - sta) * IN;
const z = (wl: number): number => D.SKID_Z - (wl + D.GROUND_WL_BELOW) * IN;
const fcu = ALLISON_250_C20B.turbine!.gasGenerator.fcu;

/** Main-rotor blade pitch at 0.75 R with the collective fully down, rad: the free parameter of the RFM 4-25
 * autorotation law (485 +/- 5 rpm at 2250 lb, SL, 60 KIAS, collective full down). Calibrated, ESTIMATE. */
export const MD500_MIN_PITCH = 1.15 * DEG;

/** Upper fin (3V outline, dimensions.ts): area and centroid of the trapezoid. */
const UPPER_FIN = { area: (96.91 - 60) * IN * ((290 - 268) + (296 - 286)) / 2 * IN, centre: { x: x(283), y: 0, z: z(76) } };
const LOWER_FIN = { area: (50 - 25.46) * IN * ((288 - 270) + (290 - 283)) / 2 * IN, centre: { x: x(282), y: 0, z: z(39) } };
const HS = D.HORIZONTAL_STABILIZER;
/** Zero-lift angle of the stabiliser's inverted cambered section, deg (lift-up positive). ESTIMATE. */
export const STAB_ZERO_LIFT_DEG = 6;

export const MD500_ROTORCRAFT: RotorcraftDefinition = {
  // RFM 1-10: fully articulated (V-strap pack: flap and feather; elastomeric lead-lag dampers, 500D on (S)).
  hubModel: { kind: 'articulated', flapHingeOffset: D.FLAP_HINGE_OFFSET, lagHingeOffset: D.LAG_HINGE_OFFSET,
    lagDamper: 'elastomeric', coning: MD500_BLADE_CONING },
  // RFM 2-4: 100 % = 477.7 rpm (D: 492 / 1.03); normal 487-492 (102-103 %), take-off at 103 % = 492.
  referenceRpm: MD500_NR_100, nominalRpm: MD500_NR_NOMINAL,
  // D: 6016 / 477.67 = 12.594 (TCDS p12: N2 6196 rpm at 492 Nr). Tail: ESTIMATE 2933 rpm at 492 (5.96; the OH-6A's
  // 6.447 would give 3172).
  engineRatio: MD500_ENGINE_RATIO, tailRatio: MD500_TAIL_RATIO,
  // CCW from above (RFM 3-3 left yaw on power loss); tail rotor sense for the renderer (dimensions.ts).
  rotation: D.MAIN_ROTOR_ROTATION, tailRotation: D.TAIL_ROTOR_ROTATION,
  // ESTIMATE: spiral-bevel main and tail gearboxes and the shafts.
  transmissionEfficiency: 0.95,
  // TCDS p14 rigging (relative to the rigging position): fwd 17-18.5, aft 7-9.3, left 7-9.3, right 5.5-8.5 deg; the
  // stick's travel is linear, so its centre is 4.8 deg forward of the rigging neutral, which sits 0.31 of the travel
  // from full aft (RFM 4-12). cyclicLimit (the legacy symmetric reader: other renderers' ground blade pose) is
  // the mean half-travel.
  cyclicLimits: { forward: D.CYCLIC_LIMITS_DEG.forward * DEG, aft: D.CYCLIC_LIMITS_DEG.aft * DEG,
    left: D.CYCLIC_LIMITS_DEG.left * DEG, right: D.CYCLIC_LIMITS_DEG.right * DEG },
  cyclicLimit: (D.CYCLIC_LIMITS_DEG.forward + D.CYCLIC_LIMITS_DEG.aft + D.CYCLIC_LIMITS_DEG.left + D.CYCLIC_LIMITS_DEG.right) / 4 * DEG,
  // F / 3V: 3 deg forward static mast (OH-6A, Heffley p34; RFM Fig 6-3 cant lines).
  shaftTilt: D.SHAFT_TILT_DEG * DEG,
  // F: OH-6A control-system flexibility from full-scale wind-tunnel tests (Heffley CR-3144 Fig II-2, p22): the blade
  // reaches 0.75 of the commanded cyclic and 0.67 of the commanded tail-rotor pitch (the same figure's linkage gains,
  // 0.24 / 0.135 / 0.39 deg per % of travel, are the 369A's TCDS ranges, so the factors sit on top of the rigging).
  // Pivots (ESTIMATE): the zero-cyclic swashplate and the centre of the tail-rotor range. The collective's 0.88 is
  // not applied (it would re-calibrate minPitch and the autorotation law): KNOWN_ISSUES.md.
  controlFlex: { longitudinal: 0.75, lateral: 0.75, pedal: 0.67 },
  // The governed rotor's air speed carries the fuselage yaw rate (main-rotor yaw damping; Heffley's OH-6A Z_r).
  yawInRotorSpeed: true,
  // Articulated: no teeter stop (the harmonic hub never reads it); the legacy field.
  teeterLimit: 12 * DEG,
  airspeedLimits: MD500_VNE, airspeedCorrections: MD500_SPEED_CORRECTIONS, manifoldLimits: undefined,
  // RFM 1-10, 3-19..3-21: mechanical controls, no hydraulic boost; electric cyclic trim on a 4-way coolie, about
  // 30 lb (133 N) of stick force from a runaway. Motor speed ESTIMATE.
  controlSystem: { cyclic: 'mechanical', collective: 'mechanical', pedals: 'mechanical', trim: 'electric-spring',
    springTrim: { rate: 0.05, force: 133 } },
  systems: {
    // Belt-clutch and piston-governor fields: ignored on 'freewheel' (definition.ts), written inert.
    clutchSeconds: 1, beltTorque: 0, correlator: 0, governorRate: 0, governorEngage: 0, powerCheckMinRpm: 0,
    // RFM 3-3: ENGINE OUT / low rotor at Nr 468 (98 % N2); no collective inhibit (consistency: -1).
    lowRpmWarning: MD500_ENGINE_OUT.nrBelowRpm / MD500_NR_100, hornCollectiveMin: -1,
    // TCDS p12 / RFM 1-9: 350 shp MCP, 375 shp take-off for 5 min (documentation; the pilot limits are psi).
    continuousPower: MD500_CONTINUOUS_POWER, takeoffPower: MD500_TAKEOFF_POWER, takeoffSeconds: MD500_TORQUE_PSI.takeoffSeconds,
    drive: 'freewheel',
    // Twice the 97.6 psi transient torque (482 N m at the output shaft): never binds (a pilot limit, not a slip).
    transmissionTorqueLimit: 2 * MD500_TORQUE_PSI.transient3s / MD500_PSI_PER_NM,
    turboshaft: {
      grip: MD500_TWIST_GRIP,
      plaNg: { groundIdle: fcu.lowIdleNg, fullOpen: fcu.maxNg },
      governor: {
        setRange: MD500_N2_BEEP.range, setDefault: MD500_N2_BEEP.setDefault,
        // ESTIMATE: about 7 s from the low to the high stop (RFM 4-18 run-up check).
        beepRate: 0.01,
        // Steady droop (5 % N2 per unit N1) and its collective compensator, zeroed at the flat-pitch N1 on the
        // ground at 103 % N2 (78.4 %): the beep set point reads at flat pitch (the RFM 4-18 run-up check), the
        // compensator over-compensates by 0.5-1 % at take-off power (RFM 4-22 "N2 should increase 1/2 to 1 percent
        // on take-off"), and unloaded in autorotation N2 stays within 1 % of the set (plan 6.6; droop 0.1 gave 1.6 %).
        // Gains and rate lead: calibrated to the plan 6.6 transient rows. ESTIMATE.
        droop: 0.05, anticipation: 0.65, datumNg: 0.784, gain: 4, integralGain: 1.5, lead: 0.15,
      },
      engineOut: { n1Below: MD500_ENGINE_OUT.n1Below, nrBelow: MD500_ENGINE_OUT.nrBelowRpm / MD500_NR_100 },
      psiPerNm: MD500_PSI_PER_NM,
      limits: {
        mcpPsi: MD500_TORQUE_PSI.mcp, mcpPsiAboveTot: { psi: MD500_TORQUE_PSI.mcpHot, totC: MD500_TORQUE_PSI.mcpHotAboveTotC },
        takeoffPsi: MD500_TORQUE_PSI.takeoff, takeoffSeconds: MD500_TORQUE_PSI.takeoffSeconds,
        transientPsi: [MD500_TORQUE_PSI.transient15s, MD500_TORQUE_PSI.transient3s],
        totC: { mcp: MD500_TOT_C.mcp, takeoff: MD500_TOT_C.takeoff, transient6s: MD500_TOT_C.transient6s, start1s: MD500_TOT_C.start1s },
        n1Pct: { continuous: MD500_N1_PCT.continuous, transient15s: MD500_N1_PCT.transient15s },
        n2AvoidPct: MD500_N2_PCT.avoid,
      },
    },
  },
  // XMSN OIL PRESS (RFM 4-16: out within 30 s of light-off on the 369D25100 transmission): rotor-driven pump,
  // full pressure from about 400 rpm. The 500 has a pressure switch, not a gauge. ESTIMATES.
  transmission: { pressurePsi: 30, pumpRpm: 400, pressureSeconds: 6, heatCapacity: 60000, cooling: 220 },
  main: {
    radius: D.MAIN_ROTOR_RADIUS, rootCutout: MD500_BLADE_ROOT, chord: D.MAIN_ROTOR_CHORD, blades: D.MAIN_ROTOR_BLADES,
    // TCDS p14: collective travel 14.25-18.0 deg (mid 16.1) above the low-pitch stop.
    minPitch: MD500_MIN_PITCH, maxPitch: MD500_MIN_PITCH + D.COLLECTIVE_RANGE_DEG * DEG,
    twist: D.MAIN_ROTOR_TWIST_DEG * DEG,
    // NACA 0015 (F): analytic section, not a measured polar. Tip Mach 0.61 at 492 rpm.
    liftSlope: 5.7, maxCl: 1.2, profileCd: 0.0095, inducedDrag: 0.01, inducedFactor: 1.15,
    // Five uniform 11.5 kg blades (articulated.ts, from the OH-6A flap inertia, F): 352 kg m^2. ESTIMATE.
    inertia: D.MAIN_ROTOR_BLADES * MD500_ARTICULATED.blade.polar, hub: D.MAIN_HUB,
  },
  tail: {
    radius: D.TAIL_ROTOR_RADIUS, rootCutout: 0.12, chord: D.TAIL_ROTOR_CHORD, blades: D.TAIL_ROTOR_BLADES,
    // TCDS p14 (369D21600): +27 deg (thrust to the right: anti-torque, left pedal) to -13..-15 deg.
    minPitch: D.TAIL_PITCH_DEG.min * DEG, maxPitch: D.TAIL_PITCH_DEG.max * DEG, twist: D.TAIL_ROTOR_TWIST_DEG * DEG,
    liftSlope: 5.7, maxCl: 1.2, profileCd: 0.012, inducedDrag: 0.012,
    // ESTIMATE: two ~1 kg blades and the teetering hub.
    inertia: 0.35, hub: D.TAIL_HUB,
    // The small, fast tail rotor's inflow settles in about 5 ms in the hover (Pitt-Peters), not the legacy 0.08 s.
    pittPetersInflow: true,
  },
  // T-stab on the upper fin (dimensions.ts): span 5.43 ft (with endplates), chord ESTIMATE 0.30 m. TCDS p14:
  // incidence 8.92-9.42 deg to the mast normal, which lies 3 deg nose-down of the body axis: leading edge UP, +6.17 deg
  // to the body axis (STAB_INCIDENCE_TO_WL_DEG; the TCDS signs a nose-down setting where it means one, p21), drawn so
  // by the exterior. An inverted cambered section (zero-lift angle ESTIMATE +6 deg) makes it carry a DOWNLOAD at every
  // forward speed (heli-archive: "set at +5 deg and produces negative lift", S); a symmetric section at +6.17 deg lifts
  // below 120 KIAS. docs/md500-flight-model.md ("Stabiliser sign") has the sweep. The model's surface is symmetric:
  // incidence = geometric - zero-lift angle.
  stabilizer: { centre: { x: HS.leadingX - HS.chord / 4, y: 0, z: HS.z }, area: HS.span * HS.chord,
    liftSlope: 3.8, incidence: (D.STAB_INCIDENCE_TO_WL_DEG - STAB_ZERO_LIFT_DEG) * DEG, maxCl: 1.1, wash: 0.45 },
  // Upper (swept, under the T-stab) and lower fins, 3V outlines; symmetric sections, no offset. ESTIMATES.
  // The tail rotor turns 0.30 m to the left of them and draws its inflow across them (the fins are on its intake
  // side): the 0.70 m disc covers all of the lower fin's outline and 60 % of the upper's (dimensions.ts outlines
  // against TAIL_HUB), where the actuator-disc inflow 0.30 m upstream of the disc is about 0.6 of the disc's induced
  // velocity (1 - 0.3 / sqrt(0.3^2 + 0.7^2)). Pilot review 2026-10-17 (yaw damping): docs/md500-flight-model.md sect. 7.
  fins: [
    { centre: UPPER_FIN.centre, area: UPPER_FIN.area, liftSlope: 3.0, incidence: 0, maxCl: 1.1, tailRotorFlow: { areaFraction: 0.6, velocityRatio: 0.6 } },
    { centre: LOWER_FIN.centre, area: LOWER_FIN.area, liftSlope: 2.6, incidence: 0, maxCl: 1.1, tailRotorFlow: { areaFraction: 1, velocityRatio: 0.6 } },
  ],
  // ESTIMATE: the egg cabin is about twice the R22's in volume.
  fuselageMoment: { pitch: 0.25, yaw: 0.15 },
  // Equivalent flat plate along x calibrated to the cruise rows (spec p7: 135 kt at MCP, SL, M). y, z: 3V side and
  // plan areas with bluff-body coefficients. ESTIMATES.
  dragArea: { x: 0.6, y: 3.6, z: 3.2 }, dragCentre: { x: -0.15, y: 0, z: 0.2 },
  fuselageWash: 1 + -D.MAIN_HUB.z / Math.hypot(D.MAIN_ROTOR_RADIUS, D.MAIN_HUB.z),
  // Tail-skid bumper under the lower fin (RFM Fig 6-3: WL 25.46 at the bottom).
  tailProtection: { stinger: [{ x: x(281), y: 0, z: z(26.5) }, { x: x(284), y: 0, z: z(25.46) }, { x: x(289), y: 0, z: z(26.5) }],
    radius: 0.02, fin: D.LOWER_FIN_OUTLINE, stiffness: 15000, damping: 600, maxSink: 1, maxCompression: 0.08 },
  groundRotor: { blade: MD500_BLADE_CONING, stopFriction: 0,
    tailcone: { front: { x: D.BOOM_ROOT.x, y: 0, z: D.BOOM_ROOT.z }, rear: { ...D.TAIL_HUB, y: 0 }, frontRadius: 0.18, rearRadius: 0.08 },
    // The egg cabin: nose STA 15 to the firewall STA 174, belly 1.27 ft to roof 6.77 ft above the ground.
    cabin: { centre: { x: x(94.5), y: 0, z: D.SKID_Z - (1.27 + 6.77) / 2 * 0.3048 },
      radii: { x: 79.5 * IN, y: D.CABIN_WIDTH / 2, z: (6.77 - 1.27) / 2 * 0.3048 } } },
  skids: { ...R22_ROTORCRAFT.skids, flexure: undefined,
    // RFM 1-9: skid gear on nitrogen-charged dampers (springs and shock absorbers; ground-resonance stability).
    // No stroke or charge data (research-md500 gap 11): ESTIMATES. Sized so the 3000 lb aircraft survives the
    // FAR 27.725 limit drop (13 in, about 2.55 m/s with rotor lift; the 369 was certificated to CAR 6, assumed
    // comparable) and a 2-2.5 m/s touchdown (type experience, ESTIMATE): 0.14 m usable stroke, static strokes
    // 0.04-0.05 m at 3000 lb (about a third), a short gas column (0.155 m) so the stance stays stiff in pitch under
    // the tall CG (a longer column halves the static pitch stiffness and the nose rises onto the tail), the relief
    // valve at 11 kN a damper. Pilot review 2026-10-17: the S269's 0.06 m stroke scaled up bottomed under the static
    // weight at 3000 lb. docs/md500-flight-model.md "Skid gear".
    oleo: { pressure: [1300 * 6894.757 + 101325, 1400 * 6894.757 + 101325],
      area: 0.00025, gasLength: 0.155, exponent: 1.3, contactStiffness: 600000,
      maxStroke: 0.14, orifice: 3500, rebound: 4500, reliefForce: 11000, reliefDamping: 900 },
    terrain: { ...R22_ROTORCRAFT.skids.terrain!, tubeRadius: D.SKID_TUBE_RADIUS, toe: D.SKID_FRONT_X, heel: D.SKID_REAR_X },
    suspension: 'oleo', halfTrack: D.SKID_HALF_TRACK, front: D.SKID_CONTACT_FRONT_X, rear: D.SKID_CONTACT_REAR_X, z: D.SKID_Z,
    frontZ: D.SKID_FRONT_Z },
};
