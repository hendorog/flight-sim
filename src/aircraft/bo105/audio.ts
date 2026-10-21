// MBB Bo 105 CB-4: the sound profile. Two Allison 250-C20B turboshafts side by side on the cabin roof, aft of the main
// transmission (each its own gas producer whine on its own N1, its burner and exhaust, starter-generator, igniters and
// light-off), driving through freewheels a ZF FS 72B main transmission (its mesh) and ONE four-blade hingeless rotor at
// 424.5 rpm: 4 x 424.5 / 60 = 28.3 Hz blade passage, the Bo 105's deep, quick beat (engine 1's `prop` voice; engine 2's
// is the same rotor and is silent: a twin rotorcraft must not double the rotor, mapping.ts fillSynthParams); a two-blade
// tail rotor at 5.25 x 424.5 = 2229 rpm, 74.3 Hz (the tail-rotor channel). The warning unit K-DW02/01 in the cabin: an
// intermittent 650 Hz tone at 5 a second for NR LOW and N1 SPLIT, a steady 2600 Hz tone for NR HIGH (second stage).
// No ENGINE OUT horn (the MD 500E's), no flaps, no retractable gear, a 28 V bus. Plain data. Plan revision 2, section 6.5.
//
// IMPORT RULE (plan section 7.7): every number the consistency check compares (rated power, drive ratio, blade counts,
// diameters, tail ratio, bus voltage, engine count) is imported from the definition or the powerplant, so BO's flight
// model lands without an edit here; the published facts (facts.ts) give the rest.
//
// Sources (tags as facts.ts; docs/bo105-sources.md):
//   N1 100 % = 50 970 rpm, 849.5 Hz shaft rate (250-C20B, EASA IM.E.052 p15) ....... BO105_N1_100_RPM            P
//   rated power, drive ratio, rotor and tail-rotor blades/diameters/ratio .......... BO105_POWERPLANT, BO105_ROTORCRAFT (P/D/F there)
//   Nr 100 % = 424.5 rpm (TCDS p10 bands) ........................................ BO105_NR_100                 D
//   hover thrust at the AR-280 flight-test mass 2200 kg .......................... BO105_MASS_KG.typical        P
//   warning unit: NR <= 95 % 650 Hz 5 per second; NR >= 108 % steady 2600 Hz; N1 split
//     >= 12 % intermittent (TM 00-44; FM 3-16) ...................................... BO105_WARNINGS               P
//   starter-generator on N1, pad ratio 0.2361 (the 250-C20B's, EASA IM.E.052 p10) ... the MD 500E voice's starter  P
// ESTIMATE (no source): the whine's orders and strengths (the MD 500E's: same engine), the roar, the commutator, the
// ZF FS 72B mesh order (about 1.34 kHz at 424.5 rpm), the igniters' rate, the tail rotor's slap and hover thrust
// (audio/rotorcraftProfile.ts: figure of merit 0.7), the warning tones' timbre and loudness, the cabin. N1 SPLIT uses
// the NR LOW tone (the TM gives "intermittent tone" without a pitch or rate).
// AGENT choices: no ENGINE OUT horn (the Bo 105 has the warning unit instead); the two engines are not panned apart
// (the worklet's engine stem is mono; they sit side by side close to the centreline, behind the pilot's head).

import { G0 } from '../../core/math';
import { STEM } from '../../audio/params';
import { bladePassageHz, tailHoverThrustN } from '../../audio/rotorcraftProfile';
import type { AudioProfile, EngineSoundProfile, PropSoundProfile } from '../types';
import { MD500_AUDIO } from '../md500/audio';
import { BO105_MASS_KG, BO105_N1_100_RPM, BO105_NR_100, BO105_WARNINGS } from './facts';
import { BO105_POWERPLANT as pp } from './powerplant';
import { BO105_ROTORCRAFT as rotor } from './rotorcraft';

/** The 250-C20B's voice: the MD 500E's (the same engine). */
const C20B = MD500_AUDIO.engines[0].engine.turbine!;
/** Main-rotor thrust giving propLoad 1: the hover at 2200 kg, 21.6 kN (P mass, D thrust). */
const HOVER_THRUST_N = BO105_MASS_KG.typical * G0;
/** Two equal voices: each 1 / sqrt(2) of one (audio/profile.ts EngineSoundProfile.level). */
const TWIN_LEVEL = Math.SQRT1_2;
/** The ZF FS 72B's mesh: 190 x the rotor's rate, 1.34 kHz at 424.5 rpm (ESTIMATE). */
const MESH_ORDER = 190;

/** One 250-C20B on the Bo 105's N1. `meshLevel`: the main transmission's mesh, voiced by engine 1 only (one transmission). */
const engine = (meshLevel: number): EngineSoundProfile => ({
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
    ...C20B,
    ngRpm: BO105_N1_100_RPM,
    // Right under the rotor, ahead of the engines; at full strength from 7 rev/s of the rotor (420 rpm) up.
    gearMesh: { perPropRev: MESH_ORDER, level: meshLevel },
    gearMeshFullRps: 7,
  },
  gearRatio: rotor.engineRatio,
  level: TWIN_LEVEL,
});

const ROTOR: PropSoundProfile = {
  // Four blades, 9.84 m: tip Mach 0.64 in the hover at 424.5 rpm.
  blades: rotor.main.blades as 4,
  diameterM: rotor.main.radius * 2,
  cruiseThrustN: HOVER_THRUST_N,
  level: 1,
};

export const BO105_AUDIO: AudioProfile = {
  // Engine 2's rotor voice is the same rotor at level 0 (and the mapping gives it no tip Mach): one rotor is heard.
  engines: [{ engine: engine(0.04), prop: ROTOR }, { engine: engine(0), prop: { ...ROTOR, level: 0 } }],
  busPoweredV: pp.electrical.busDeadVolts,
  // No ENGINE OUT horn: the warning unit's tones (rotorWarnings) are the Bo 105's aural warnings.
  stallWarner: { kind: 'none', baseHz: 0, sweepHz: 0, needsBus: true },
  flapMotor: false,
  // No flaps: any non-zero value (the wind-noise mapping divides by it; the flaps never move).
  flapMaxRad: MD500_AUDIO.flapMaxRad,
  gear: null,
  gyros: 'electric',
  // Interior: a wide cabin under the transmission deck, the engines on the roof behind it. The transmission's mesh and
  // the rotor's 28 Hz beat dominate; the engines' whine comes through the roof, less than in the MD 500E (whose engine
  // is right behind the seats); the tail rotor's 74 Hz drones along the boom; the clamshell doors let wind in.
  cabin: {
    routes: [
      { stem: STEM.engine, lowpassHz: 3500, gain: 0.5 },
      { stem: STEM.prop, lowpassHz: 900, gain: 0.95 },
      { stem: STEM.airframe, lowpassHz: 2200, gain: 0.25 },
      { stem: STEM.cabin, lowpassHz: 0, gain: 1.0 },
    ],
    bus: [
      { type: 'peaking', hz: Math.round(10 * bladePassageHz(rotor.main.blades, BO105_NR_100)) / 10, gainDb: 4, q: 1.0 },
      { type: 'peaking', hz: Math.round(10 * bladePassageHz(rotor.tail.blades, BO105_NR_100 * rotor.tailRatio)) / 10, gainDb: 2.5, q: 1.4 },
    ],
    // Hover inside the C172S's full-power window (-17 .. -9 dBFS RMS at volume 1, tests/audio/bo105.test.ts).
    level: 0.75,
  },
  // Exterior: the rotors loudest (a Bo 105 is known by its beat), then the two engines' whine.
  exterior: {
    routes: [
      { stem: STEM.engine, lowpassHz: 0, gain: 0.8 },
      { stem: STEM.prop, lowpassHz: 0, gain: 1.3 },
      { stem: STEM.airframe, lowpassHz: 0, gain: 0.25 },
    ],
    level: 0.95,
  },
  // Two blades, 1.90 m, at rotor.tailRatio x Nr (5.25 x 424.5 = 2229 rpm, 74.3 Hz, tip Mach 0.65).
  tailRotor: {
    blades: rotor.tail.blades as 2,
    diameterM: rotor.tail.radius * 2,
    ratio: rotor.tailRatio,
    hoverThrustN: tailHoverThrustN(rotor, HOVER_THRUST_N),
    slap: 0.5,
    level: 0.55,
  },
  // The warning unit K-DW02/01 (P TM 00-44): 650 Hz at 5 a second, 2600 Hz steady. Loudness ESTIMATE.
  rotorWarnings: { lowHz: BO105_WARNINGS.nrLowToneHz, lowPerSecond: BO105_WARNINGS.nrLowBeepsPerSecond, highHz: BO105_WARNINGS.nrHighToneHz, level: 0.12 },
};
