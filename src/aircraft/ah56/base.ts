// Lockheed AH-56A Cheyenne: the base helicopter (no wing, no pusher: stage 2). Owner: AG. Plan revision 2, sections 7.1-7.2;
// docs/ah56-flight-model.md has the calibration of every ESTIMATE.
//
// Four-blade hingeless main rotor (flap and lag by structural bending, feathering on the "door hinge"; the reduced
// harmonic hub of physics/rotorcraft/articulated.ts with RC's hingeless core: an equivalent hinge plus a spring derived
// from the flap frequency, the harmonic Pitt-Peters inflow, the radial-flow terms and the TPP-relative blade-element
// cyclic), the control gyro (gyro.ts; the stick commands moments, not cyclic), a four-blade teetering tail rotor on the
// LEFT stabiliser tip pushing right, the ventral fin, one T64-GE-716 through a freewheel with the condition grip and the
// Nf governor ("RPM SET" beep), and the retractable tail-wheel gear (gear.ts; landingGear 'wheels'). The wing and the
// pusher (stages 3-4) are AC's compound.ts; the high-advance-ratio aerodynamics (stage 5) are AH's highSpeed.ts.
//
// Tags: P primary (ASTA-72 = USAASTA 72-08, AMCS-73 = USAASTA 72-44, APE-I, Hoh-74; pages in docs/ah56-sources.md), D
// derived (arithmetic shown), S secondary, 3V photos, INF inference from primary text, ESTIMATE judged and calibrated.
import { DEG } from '../../core/math';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import * as D from './dimensions';
import { AH56_BLADE, AH56_BLADE_CONING, AH56_HUB, AH56_LIFT_SLOPE } from './coning';
import { AH56_CONDITION_GRIP, AH56_ENGINE_RATIO, AH56_N2_BEEP, AH56_NG_PCT, AH56_NR_100, AH56_ROTOR_INERTIA, AH56_TAIL_PITCH_DEG,
  AH56_TAIL_RATIO, AH56_TAIL_ROTOR_INERTIA, AH56_TIT_C, AH56_TORQUE_LIMIT_PCT, AH56_TORQUE_PCT_PER_NM,
  AH56_TRANSMISSION_LOSS_SHP, AH56_TRANSMISSION_LIMIT_SHP } from './facts';
import { AH56_SPEED_CORRECTIONS, AH56_VNE } from './limits';
import { AH56_TRANSMISSION_POWER, T64_GE_716 } from './powerplant';

const R = D.MAIN_ROTOR_RADIUS;
const fcu = T64_GE_716.turbine!.gasGenerator.fcu;
/** Output-shaft torque at 114 % (3925 shp at 100 % Nf), N m (D). */
const TORQUE_114 = AH56_TORQUE_LIMIT_PCT / AH56_TORQUE_PCT_PER_NM;

export const AH56_BASE: RotorcraftDefinition = {
  // Hingeless (P ASTA-72 App B): equivalent hinge 10 % R, nu_beta 1.12 (ESTIMATE, coning.ts), precone 2 deg (P), zero
  // delta-3 (P: the "zero delta-3" pitch arm; pitch-flap coupling about 0 after the hop fix, Hoh-74 sect. 4.6). No
  // controlPhase: the gyro's input and feedback rotations are the phasing (consistency). Harmonic inflow, radial flow
  // and the TPP-relative blade-element cyclic on: RC's validated set (AGENT choice, docs/ah56-flight-model.md).
  hubModel: { kind: 'hingeless', ...AH56_HUB, blade: AH56_BLADE, coning: AH56_BLADE_CONING,
    harmonicInflow: true, radialFlow: true, bemFromFlap: true },
  // P: 100 % = 246 rpm (ICS normal); AMCS 97.5 % = 239.85 rpm through the gyro configuration (governedRpm).
  referenceRpm: AH56_NR_100, nominalRpm: AH56_NR_100,
  // D: Nf 13,600 rpm (S) / 246 = 55.28; tail rotor 1238 / 246 = 5.033 (P rpms).
  engineRatio: AH56_ENGINE_RATIO, tailRatio: AH56_TAIL_RATIO,
  // INF: counter-clockwise from above (left yaw on an engine failure, ASTA-72 para 68; the tail rotor on the left pushing
  // right, P). dimensions.ts.
  rotation: 1,
  // D: the Army's constant 90 shp transmission loss (ASTA-72 App G para 3) at the 3925 shp limit.
  transmissionEfficiency: 1 - AH56_TRANSMISSION_LOSS_SHP / AH56_TRANSMISSION_LIMIT_SHP,
  // The legacy symmetric reader (ground blade pose of other renderers): the ICS gyro's +/-15 deg (P). The stick commands
  // moments on the gyro; the blade cyclic is the gyro tilt (gyro.ts, swashplateCyclic).
  cyclicLimit: 15 * DEG,
  // P ASTA-72 p 48: shaft incidence 0.
  shaftTilt: 0,
  // The governed rotor's air speed carries the fuselage yaw rate (main-rotor yaw damping), as the MD 500E's.
  yawInRotorSpeed: true,
  teeterLimit: 12 * DEG,
  airspeedLimits: AH56_VNE, airspeedCorrections: AH56_SPEED_CORRECTIONS, manifoldLimits: undefined,
  // P: boosted (hydraulic) cyclic and collective, irreversible on the AMCS; pedals boosted (written 'mechanical', the only
  // pedal kind). The 4-way coolie-hat cyclic trim (P ASTA-72 para 40) drives the force-feel trim anchor the keyboard's
  // re-centring cyclic returns to. Trim rate ESTIMATE; force at full anchor deflection: 3.2-3.5 lb/in x 5 in (P).
  controlSystem: { cyclic: 'hydraulic', collective: 'hydraulic', pedals: 'mechanical', trim: 'electric-spring',
    springTrim: { rate: 0.1, force: 77 } },
  systems: {
    // Belt-clutch and piston-governor fields: ignored on 'freewheel' (definition.ts), written inert.
    clutchSeconds: 1, beltTorque: 0, correlator: 0, governorRate: 0, governorEngage: 0, powerCheckMinRpm: 0,
    // P: Nr 95 % minimum power on (the FLAWS "ROTOR RPM" voice); no collective inhibit (-1).
    lowRpmWarning: 0.95, hornCollectiveMin: -1,
    // P: transmission limit 3925 shp, 114 % "maximum continuous" (APE 1.2); the engine's 10-min maximum is above it.
    continuousPower: AH56_TRANSMISSION_POWER, takeoffPower: AH56_TRANSMISSION_POWER, takeoffSeconds: 600,
    drive: 'freewheel',
    // Twice the 114 % output-shaft torque: never binds (the transmission rating is a pilot limit, not a slip).
    transmissionTorqueLimit: 2 * TORQUE_114,
    turboshaft: {
      grip: AH56_CONDITION_GRIP,
      plaNg: { groundIdle: fcu.lowIdleNg, fullOpen: fcu.maxNg },
      governor: {
        // P: Nf 95-105 % power on; the RPM SET beep (range and rate ESTIMATE).
        setRange: AH56_N2_BEEP.range, setDefault: AH56_N2_BEEP.setDefault, beepRate: 0.01,
        // The MD 500E's hydromechanical law with the T64's collective compensator: droop 5 % Nf per unit Ng demand, the
        // datum at the flat-pitch Ng on the ground, the anticipation calibrated so the hover Nf reads the set point
        // within 1 % (docs/ah56-flight-model.md "Governor"). ESTIMATE.
        droop: 0.05, anticipation: 0.3, datumNg: 0.72, gain: 4, integralGain: 1.5, lead: 0.15,
      },
      // P: Ng below 58 % (the idle red line) or Nr below 95 %: the FLAWS warning.
      engineOut: { n1Below: AH56_NG_PCT.idle[0] / 100, nrBelow: 0.95 },
      psiPerNm: AH56_TORQUE_PCT_PER_NM, torqueGauge: 'percent',
      limits: {
        // P: torque 0-114 % green, 114 % maximum continuous (APE 1.2) - the transmission; no time-limited torque above it.
        mcpPsi: AH56_TORQUE_LIMIT_PCT, mcpPsiAboveTot: { psi: AH56_TORQUE_LIMIT_PCT, totC: AH56_TIT_C.continuous },
        takeoffPsi: AH56_TORQUE_LIMIT_PCT, takeoffSeconds: 600,
        transientPsi: [AH56_TORQUE_LIMIT_PCT, AH56_TORQUE_LIMIT_PCT],
        // P: TIT 740 C maximum continuous; 770 for 30 min / 780 for 10 min; 785 inspection; start 649 C to idle (APE 1.1).
        totC: { mcp: AH56_TIT_C.continuous, takeoff: AH56_TIT_C.yellow10min, transient6s: AH56_TIT_C.inspection, start1s: 649 },
        // P: Ng 100 % continuous, 101.5 % red (10 s yellow band 100-101.5).
        n1Pct: { continuous: AH56_NG_PCT.continuous, transient15s: AH56_NG_PCT.red },
        // No steady-Nf avoid band published: an empty band.
        n2AvoidPct: [0, 0],
      },
    },
  },
  // P (1972): transmission oil 70-110 psi; rotor-driven pump (pressure from about 200 rotor rpm), thermal mass and cooling
  // sized for the 90 shp loss at about 60 C above ambient (the MD 500E's rise). ESTIMATES.
  transmission: { pressurePsi: 95, pumpRpm: 200, pressureSeconds: 6, heatCapacity: 2.4e5, cooling: 1100 },
  main: {
    radius: R, rootCutout: D.MAIN_ROTOR_ROOT_CUTOUT, chord: D.MAIN_ROTOR_CHORD, blades: D.MAIN_ROTOR_BLADES,
    // Collective at 0.75 R (AGENT): the physical range covering both reports, -2.5 to 18.5 deg (ICS 0.5-18.5 P; AMCS
    // indicated 4.5-21.5 less its +7 deg offset); the gauge reads physical + the configuration's offset (gyro.ts).
    minPitch: -2.5 * DEG, maxPitch: 18.5 * DEG,
    // P: -5 deg linear twist (centre to RS 302.4).
    twist: D.MAIN_ROTOR_TWIST_DEG * DEG,
    // NACA (4.6)3012 mod root / (0.6)3006 mod tip (P): analytic section, lift slope 5.73 (0.1/deg; with the blade set of
    // coning.ts the Lock number about the shaft is the P 6.4), cm0 -0.012 (the 23012 family, nose down; the gyro's
    // feathering-moment feedback reads it). ESTIMATES.
    liftSlope: AH56_LIFT_SLOPE, maxCl: 1.3, profileCd: 0.0085, inducedDrag: 0.01, inducedFactor: 1.15, cm0: -0.012,
    // P: rotor polar inertia 9748 slug-ft^2 (blades and hubs; the drivetrain, the start and the governor see it).
    inertia: AH56_ROTOR_INERTIA, hub: D.MAIN_HUB,
  },
  tail: {
    radius: D.TAIL_ROTOR_RADIUS, rootCutout: 0.30, chord: D.TAIL_ROTOR_CHORD, blades: D.TAIL_ROTOR_BLADES,
    // P: -7.4 to +24.2 deg (+ thrust to the right, the anti-torque side: left pedal); twist 0 (P).
    minPitch: AH56_TAIL_PITCH_DEG.min * DEG, maxPitch: AH56_TAIL_PITCH_DEG.max * DEG, twist: 0,
    // Slab-sided droop-nose NACA (0.675)300(5.89) mod (P): analytic section. ESTIMATES.
    liftSlope: 5.5, maxCl: 1.2, profileCd: 0.012, inducedDrag: 0.012,
    // P: 12.6 slug-ft^2. Teetering hub at FS 658.5, WL 114.5, BL 72 LEFT (P); delta-3 37.5 deg (P) not modelled (the tail
    // rotor is a blade-element disc without flapping).
    inertia: AH56_TAIL_ROTOR_INERTIA, hub: D.TAIL_HUB,
    pittPetersInflow: true,
  },
  // Horizontal stabiliser (P ASTA-72 pp 54-55): 31.83 ft^2, 1/4-MAC FS 637.18, incidence +2 deg; the tail cone's WL
  // (the tail rotor hub's, WL 114.5) as its height. Lift slope 3.5 (AR 3.68, ESTIMATE); rotor downwash fraction at the
  // surface 0.5 (ESTIMATE). The bobtailed left panel and the right panel act as one surface.
  stabilizer: { centre: { x: D.HORIZONTAL_STABILIZER.quarterMacX, y: 0, z: D.TAIL_HUB.z }, area: D.HORIZONTAL_STABILIZER.areaM2,
    liftSlope: 3.5, incidence: D.HORIZONTAL_STABILIZER.incidenceDeg * DEG, maxCl: 1.0, wash: 0.5 },
  // Ventral fin (P ASTA-72 p 56): 24.6 ft^2, 1/4-MAC FS 620.3 WL 79.4, NACA 0018 mod, incidence 0; lift slope 2.4 (AR 1.67,
  // ESTIMATE). No upper fin exists (P): the tail rotor's thrust change with sideslip and this fin are the weathercock.
  fins: [{ centre: { x: D.VENTRAL_FIN.quarterMac.x, y: 0, z: D.VENTRAL_FIN.quarterMac.z }, area: D.VENTRAL_FIN.areaM2,
    liftSlope: 2.4, incidence: 0, maxCl: 1.0 }],
  // ESTIMATE: the MD 500E's destabilising fuselage derivatives scaled by the hull volume (about 18 m^3, 9x the egg's).
  fuselageMoment: { pitch: 2.3, yaw: 1.4 },
  // Equivalent flat plates, ESTIMATE: x 2.0 m^2 (plan 7.2: the fuselage, turrets and pylons without the wing; AC
  // recalibrates it with the compound); y 12 and z 14 m^2 from the 3V side and plan areas with bluff-body coefficients.
  dragArea: { x: 2.0, y: 12, z: 14 }, dragCentre: { x: -0.5, y: 0, z: 0.1 },
  fuselageWash: 1 + -D.MAIN_HUB.z / Math.hypot(R, D.MAIN_HUB.z),
  // Wheels: no stinger, no ground-rotor pose model (the hingeless pose is publishBlades'); the airframe strike points
  // are in gear.ts (structure) and RotorClearance (wheels.ts: rotor tips, tail rotor).
  tailProtection: undefined, groundRotor: undefined,
  // `skids` carries wheel-rest data on a wheeled type (plan 3.5): z = the tyres' contact z at rest, front = the main
  // wheels, rear = the tail wheel. Physics ignores it ('wheels'); the hover start, the scripted pilot and heliHold read z.
  skids: { halfTrack: D.MAIN_GEAR_HALF_TRACK, front: D.MAIN_GEAR.x, rear: D.TAIL_WHEEL.x, z: D.GROUND_Z,
    stiffness: 4e5, damping: 3e4, friction: 0.6, maxSink: 2.9 },
  landingGear: 'wheels',
};
