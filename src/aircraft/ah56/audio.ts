// Lockheed AH-56A Cheyenne: the sound profile. One General Electric T64-GE-716 behind the rear (pilot's) cockpit (a
// large turboshaft's whine on Ng, burner and exhaust, starter, igniters, light-off) driving the main transmission (its
// mesh) and, on one shared shaft, a four-blade hingeless rotor at 246 rpm (4 x 246 / 60 = 16.4 Hz blade passage; 16.0
// Hz at the AMCS's 97.5 %), with a crack of high-speed impulsive noise as the advancing tip nears Mach 0.9 at the top
// of the speed range; a four-blade tail rotor at 1238 rpm (82.5 Hz) and a three-blade pusher propeller at 1717 rpm
// (85.9 Hz, static tip Mach 0.81) beating against it at about 3 Hz, the pusher's loudness with |thrust| and blade
// angle and its roar in reverse pitch; the 8P (32.8 Hz) vibration hum in the cockpit; the half-P hop's 2.05 Hz thump;
// the gear motor, the tyres and brakes and the tail-wheel lock; FLAWS tones and spoken warnings. Plain data. Plan
// revision 2, section 7.7.
//
// IMPORT RULE (section 7.7, critique C3.19): every number the consistency check compares (rated power, drive ratio,
// rotor and tail-rotor blades, diameters, ratios, the pusher's blades/diameter/ratio, bus voltage) is imported from the
// definition (AH56_ROTORCRAFT) or the powerplant, so AG's T64, hub and wheels and AC's pusher land WITHOUT an edit
// here: today the definition is the S0 stub (the MD 500E rotor with four blades at 492 rpm, its tail rotor and
// 250-C20B), and the voice follows it. Voice retunes after AG/AC are integrator items at the stage-2/4 gates.
//
// Sources (tags as facts.ts / dimensions.ts; research-ah56 section 15; docs/ah56-sources.md):
//   Nr 100 % = 246 rpm, AMCS 97.5 % (ASTA-72, AMCS-73) ............................. AH56_NR_100, AH56_AMCS_NR_FRACTION P
//   rotor power-on band 95-105 % (the ROTOR RPM warning's limits) .................... AH56_NR_PCT                  P
//   pusher: 3 blades, 10 ft (Hamilton Standard; ASTA-72 p 51), 1717 / 246 rpm ........ PUSHER_BLADES, PUSHER_RADIUS, AH56_PROP_RATIO P / D
//   pusher blade angle: hover detent -2.2, range -17.2 .. +40.8 deg (ASTA-72) ........ AH56_PROP_BETA_DEG           P
//   tail rotor 4 blades x 1238 rpm: 82.5 Hz (ASTA-72 p 50) ............................ the definition (AG)         P / D
//   8P cockpit vibration, 0.4 g at the pilot station in level flight (AMCS-73 para 47) . vibration.perRev            P
//   half-P hop at 0.5 per rev, 2.05 Hz (APE-I) ........................................ halfP.perRev (until AH's)    P
//   test mass 18,300 lb (AMCS-73 p 37): the rotor's hover thrust ...................... AH56_MASS_LB.test            P
//   max power 4275 shp (AMCS), SFC 0.49 (ESTIMATE ladder, facts.ts): fuel flow scale ... AH56_ENGINE_MAX_SHP          P / ESTIMATE
//   FLAWS with a voice warning existed and was rated excellent (ASTA-72 para 73f; APE-I para 134g)      P
// ESTIMATE (no source): the T64's gas-generator speed (18,000 rpm at 100 % Ng; research-ah56 section 16 gap 6) and the
// orders of its whine, its roar, starter and igniters; the transmission mesh (about 1.35 kHz at 246 rpm); the rotor's
// impulsive-noise onset (advancing tip Mach 0.82, full at 0.92); the pusher's cruise thrust (15 kN: about 2600 shp at
// 194 KTAS and 80 % efficiency) and its levels; the tail rotor's hover thrust (audio/rotorcraftProfile.ts); the gear
// motor's pitch; the hum's and the half-P rumble's strengths; the FLAWS tone's pitch; the words of the spoken warnings
// and their triggers (ROTOR RPM outside the power-on band; ENGINE FIRE has no state that reports a fire yet and never
// sounds; MASTER CAUTION on a new caution chime event); the cockpit.

import { G0, LB } from '../../core/math';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import type { PowerplantDef } from '../../physics/propulsion/defs';
import { STEM } from '../../audio/params';
import { bladePassageHz, tailHoverThrustN } from '../../audio/rotorcraftProfile';
import type { AudioProfile, EngineSoundProfile, PropSoundProfile } from '../types';
import { PUSHER_BLADES, PUSHER_RADIUS } from './dimensions';
import { AH56_ENGINE_MAX_SHP, AH56_MASS_LB, AH56_NR_100, AH56_NR_PCT, AH56_PROP_BETA_DEG, AH56_PROP_RATIO, AH56_TAIL_RATIO } from './facts';
import { AH56_POWERPLANT } from './powerplant';
import { AH56_ROTORCRAFT } from './rotorcraft';

/** T64-GE-716 gas generator at 100 % Ng, rev/min. ESTIMATE (not found; a 14-stage axial gas generator of this class). */
const T64_NG_100_RPM = 18_000;
/** Fuel flow at 100 % Ng, sea level, kg/s: 4275 shp x 0.49 lb/shp/h = 2095 lb/h. ESTIMATE (the SFC is facts.ts's ladder). */
const FUEL_FLOW_100 = (AH56_ENGINE_MAX_SHP.amcs * 0.49 * LB) / 3600;
/** Main-rotor thrust giving propLoad 1: the hover at the AMCS test mass, 18,300 lb = 81.4 kN (P mass, D thrust). */
const HOVER_THRUST_N = AH56_MASS_LB.test * LB * G0;
/** Pusher thrust giving pusherLoad 1, N: about 2600 shp at 194 KTAS (99.8 m/s) and 80 % efficiency. ESTIMATE */
const PUSHER_CRUISE_THRUST_N = 15_000;
/** The main transmission's mesh: 330 x the rotor's rate, 1.35 kHz at 246 rpm. ESTIMATE */
const MESH_ORDER = 330;
/** The rotor's 100 % for the post-AG targets in the comments: 16.4 Hz blade passage, 32.8 Hz 8P. */
export const AH56_TARGET_HZ = {
  rotor: bladePassageHz(4, AH56_NR_100),
  tailRotor: bladePassageHz(4, AH56_NR_100 * AH56_TAIL_RATIO),
  pusher: bladePassageHz(PUSHER_BLADES, AH56_NR_100 * AH56_PROP_RATIO),
  vibration8P: (8 * AH56_NR_100) / 60,
  halfP: (0.5 * AH56_NR_100) / 60,
} as const;

/**
 * The AH-56A's sound profile from its definition and powerplant: every checked number read from them, so the voice
 * follows AG (T64, rotor, wheels) and AC (pusher) without an edit. Exported so tests can feed it a landed definition.
 */
export function ah56Audio(rotor: RotorcraftDefinition, pp: PowerplantDef): AudioProfile {
  const engine: EngineSoundProfile = {
    // A turbine has no cylinders: the field is the powerplant's, not read.
    cylinders: 4,
    combustion: 'turbine',
    firingOffsets: [0, 0, 0, 0],
    cylGains: [1, 1, 1, 1],
    ratedPowerW: pp.engines[0].engine.ratedPower,
    mapRange: null,
    crankRpm: 0,
    idleLopeRpm: 0,
    exhaust: [],
    turbine: {
      ngRpm: T64_NG_100_RPM,
      fuelFlowRef: FUEL_FLOW_100,
      // A large axial gas generator: a weak once-per-revolution tone (300 Hz at 100 % Ng), a mid tone and the strong
      // compressor whine near 3.9 kHz, a thin one above.
      tones: [
        { order: 1, gain: 0.05, band: 0 },
        { order: 5, gain: 0.08, band: 0.5 },
        { order: 13, gain: 0.18, band: 0.3 },
        { order: 21, gain: 0.07, band: 0.6 },
      ],
      // A heavier, lower roar than the 250's (4275 against 420 shp), the exhaust out of the sides of the fuselage.
      roar: [
        { hz: 90, perLoad: 50, q: 0.7, gain: 1.2 },
        { hz: 350, perLoad: 300, q: 0.8, gain: 0.8 },
        { hz: 1400, perLoad: 1000, q: 0.9, gain: 0.3 },
      ],
      starter: { perNgRev: 4, level: 0.04 },
      gearMesh: { perPropRev: MESH_ORDER, level: 0.035 },
      // The rotor turns at 4.1 rev/s: the mesh at full strength from 4 rev/s up.
      gearMeshFullRps: 4,
      lightOff: 0.45,
      ignitor: { perSecond: 3, level: 0.12 },
    },
    gearRatio: rotor.engineRatio,
    level: 1,
  };
  const main: PropSoundProfile = {
    blades: rotor.main.blades as 4,
    diameterM: rotor.main.radius * 2,
    cruiseThrustN: HOVER_THRUST_N,
    level: 1,
    // High-speed impulsive noise: 246 rpm x 7.808 m is 201 m/s at the tip, so the advancing tip reaches Mach 0.82 at
    // 150 KTAS and 0.885 at 194 KTAS (research-ah56 section 15).
    impulsive: { onsetMach: 0.82, fullMach: 0.92, level: 0.5 },
  };
  const pusherDef = rotor.pusher;
  return {
    engines: [{ engine, prop: main }],
    busPoweredV: pp.electrical.busDeadVolts,
    // The FLAWS tone on the low-rotor / engine-out condition (RotorcraftState.turboshaft.engineOutHorn): a steady
    // electric tone, pitch ESTIMATE, with the spoken ROTOR RPM (voiceWarnings).
    stallWarner: { kind: 'electric', baseHz: 1000, sweepHz: 0, needsBus: true },
    flapMotor: false,
    // No flaps: any non-zero value (the wind-noise mapping divides by it; the flaps never move).
    flapMaxRad: 0.5,
    // Retractable wheels (AG: landingGear 'wheels'): the gear motor while a leg is in transit, the legs in the flow,
    // the locks' thumps (and the tail-wheel lock's clunk, AudioSystem). No gear warning horn (none found). Skids: none.
    gear: rotor.landingGear === 'wheels' ? { pump: true, warningHorn: false, pumpHz: 240 } : null,
    gyros: 'electric',
    // Interior: the pilot in the rear seat, the engine and the transmission right behind and above him, the pusher
    // and the tail rotor 10 m aft. The engine's whine and the mesh reach the seat; the rotor's slow 16 Hz beat, the
    // prop/tail-rotor buzz and its beat through the structure; a large canopy at up to 200 kt.
    cabin: {
      routes: [
        { stem: STEM.engine, lowpassHz: 3500, gain: 1.0 },
        { stem: STEM.prop, lowpassHz: 900, gain: 0.85 },
        { stem: STEM.airframe, lowpassHz: 2200, gain: 0.14 },
        { stem: STEM.cabin, lowpassHz: 0, gain: 1.0 },
      ],
      bus: [
        { type: 'peaking', hz: Math.round(10 * AH56_TARGET_HZ.rotor) / 10, gainDb: 2, q: 1.0 },
        { type: 'peaking', hz: Math.round(10 * (AH56_TARGET_HZ.pusher + AH56_TARGET_HZ.tailRotor) / 2) / 10, gainDb: 2.5, q: 1.2 },
      ],
      // Hover inside the C172S's full-power window (-17 .. -9 dBFS RMS at volume 1, tests/audio/ah56.test.ts).
      level: 0.9,
    },
    // Exterior: the rotors and the pusher loudest, then the T64.
    exterior: {
      routes: [
        { stem: STEM.engine, lowpassHz: 0, gain: 0.7 },
        { stem: STEM.prop, lowpassHz: 0, gain: 1.2 },
        { stem: STEM.airframe, lowpassHz: 0, gain: 0.25 },
      ],
      level: 1.0,
    },
    // The definition's tail rotor (AG: 4 blades, 3.05 m, 1238 / 246 = 5.033: 82.5 Hz, tip Mach 0.58).
    tailRotor: {
      blades: rotor.tail.blades as 4,
      diameterM: rotor.tail.radius * 2,
      ratio: rotor.tailRatio,
      hoverThrustN: tailHoverThrustN(rotor, HOVER_THRUST_N),
      slap: 0.5,
      level: 0.55,
    },
    // The pusher (AC): the definition's once it exists (consistency: equal to def.pusher), until then the published
    // propeller (3 blades, 3.048 m, 6.980), present and silent (no RotorcraftState.pusher, so its parameters are 0).
    pusher: {
      blades: pusherDef ? pusherDef.propeller.blades : PUSHER_BLADES,
      diameterM: pusherDef ? pusherDef.propeller.diameter : PUSHER_RADIUS * 2,
      ratio: pusherDef ? pusherDef.ratio : AH56_PROP_RATIO,
      cruiseThrustN: PUSHER_CRUISE_THRUST_N,
      // Zero thrust about the hover detent (the detent is set where the prop does not push the hovering aircraft).
      zeroThrustDeg: AH56_PROP_BETA_DEG.hoverDetent,
      topPitchDeg: AH56_PROP_BETA_DEG.max,
      reverseDeg: AH56_PROP_BETA_DEG.min,
      growl: 1.6,
      level: 0.38,
    },
    // The 8P hum at the pilot station (P: 0.4 g in level flight, AMCS): strongest at speed.
    vibration: { perRev: 8, level: 0.05, fullKias: 180, hoverShare: 0.35, rpm100: rotor.referenceRpm },
    // The half-P hop (ICS; AH's event): 0.5 per rev unless AH's definition says otherwise.
    halfP: { perRev: rotor.halfPHop?.perRev ?? 0.5, rumbleHz: 45, level: 0.35 },
    voiceWarnings: {
      messages: [
        { text: 'Engine fire', when: { kind: 'engineFire' } },
        { text: 'Rotor RPM', when: { kind: 'rotorRpm', low: AH56_NR_PCT.powerOn[0], high: AH56_NR_PCT.powerOn[1], rpm100: rotor.referenceRpm } },
        { text: 'Master caution', when: { kind: 'caution' } },
      ],
      repeatSeconds: 3,
      volume: 0.9,
    },
  };
}

export const AH56_AUDIO: AudioProfile = ah56Audio(AH56_ROTORCRAFT, AH56_POWERPLANT);
