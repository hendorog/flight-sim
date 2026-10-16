// Cessna 208 Caravan 675: the sound profile. One Pratt & Whitney Canada PT6A-114A free turbine (no combustion
// pulses: the gas generator's whine, the burner and exhaust roar, the starter-generator, a faint reduction gearbox)
// driving a McCauley three-blade 106 in propeller governed at 1900 rpm: about 95 Hz blade passage, the buzzing,
// growling drone that dominates a Caravan at power. An electric stall warning horn, electric flaps, fixed gear,
// vacuum and electric gyros, a 28 V bus, a big cabin behind a long nose. Plain data.
//
// The turbine voice and what each number means: audio/profile.ts TurbineSoundProfile and the TurbineVoice of
// audio/worklet/aircraftSynth.js. The blade and tooth counts of the PT6A are not published: the orders of the
// whine are chosen to put its tones where a PT6's whine is heard (about 3, 7.5 and 11 kHz at 100 % Ng, a faint
// rotor tone at the shaft rate), not taken from P&WC data.

import { STEM } from '../../audio/params';
import { DEG, HP, LB } from '../../core/math';
import type { AudioProfile, EngineSoundProfile, PropSoundProfile } from '../types';
import { C208_GEOMETRY } from './geometry';
import { C208_BETA, PT6A_114A, PT6A_NG_RPM } from './powerplant';

const GEOMETRY_PROP = C208_GEOMETRY.propellers[0];
/** Fuel flow at 100 % Ng, sea level ISA (the gas generator's running line, powerplant.ts): 390 lb/h. */
const FUEL_FLOW_100 = (390 * LB) / 3600;

const ENGINE: EngineSoundProfile = {
  // A turbine has no cylinders: the field is the powerplant's (inherited from the piston definition), not read.
  cylinders: 4,
  combustion: 'turbine',
  firingOffsets: [0, 0, 0, 0],
  cylGains: [1, 1, 1, 1],
  // 675 shp flat rated.
  ratedPowerW: 675 * HP,
  mapRange: null,
  crankRpm: 0,
  idleLopeRpm: 0,
  exhaust: [],
  turbine: {
    ngRpm: PT6A_NG_RPM,
    fuelFlowRef: FUEL_FLOW_100,
    tones: [
      // The rotor's once-per-revolution tone: 625 Hz at 100 % Ng, a low note under the whine.
      { order: 1, gain: 0.08, band: 0 },
      // The compressor's whine: 3.1 kHz at 100 % Ng (1.6 kHz at low idle, a few hundred hertz as the starter turns it).
      { order: 5, gain: 0.18, band: 0.35 },
      { order: 12, gain: 0.11, band: 0.5 },
      { order: 18, gain: 0.055, band: 0.7 },
    ],
    // The burner and the two exhaust stacks: a low roar and a hiss above it, both growing and brightening with power.
    roar: [
      { hz: 120, perLoad: 60, q: 0.7, gain: 1.4 },
      { hz: 420, perLoad: 380, q: 0.8, gain: 0.9 },
      { hz: 1700, perLoad: 1300, q: 0.9, gain: 0.35 },
    ],
    // The starter-generator on the accessory gearbox: a commutator whine of about 840 Hz at 15 % Ng.
    starter: { perNgRev: 9, level: 0.05 },
    // The second planetary stage of the reduction gearbox: about 2.3 kHz at 1900 propeller rpm, faint.
    gearMesh: { perPropRev: 72, level: 0.008 },
    lightOff: 0.45,
  },
  // Power-turbine revolutions per propeller revolution (33 000 : 1900).
  gearRatio: PT6A_114A.gearRatio,
  level: 1,
};

const PROP: PropSoundProfile = {
  // McCauley 3GFR34C703/106GA-0 (TCDS IM.A.226 sect. 6.2), three blades, 106 in.
  blades: 3,
  diameterM: GEOMETRY_PROP.diameter,
  // Thrust giving propLoad = 1: a cruise at about 500 shp and 165 KTAS, efficiency 0.82: ~3500 N.
  cruiseThrustN: 3500,
  // The Caravan's growl: the blades pass the cowl's chin intake and the two exhaust stacks once a revolution.
  growl: 0.3,
  // Beta and reverse: the roar of the disc driven against its own wake below flat pitch (the PC-12's voice, a little
  // weaker for the smaller reverse power; strength ESTIMATE). Full reverse at the powerplant's reference station.
  reverse: { growl: 1.0, fullPitchDeg: C208_BETA.reverse / DEG },
  level: 1,
};

export const C208_AUDIO: AudioProfile = {
  engines: [{ engine: ENGINE, prop: PROP }],
  // 28 V system: the starter-generator, the boost pump, the flap motor and the horn work above this.
  busPoweredV: 20,
  // Electric: a lift-detector vane on the left wing switches a horn in the cabin; dead with the master off.
  stallWarner: { kind: 'electric', baseHz: 2800, sweepHz: 0, needsBus: true },
  flapMotor: true,
  flapMaxRad: C208_GEOMETRY.wing.flap.maxDeflection,
  gear: null,
  // Engine-bleed vacuum (an ejector) for the attitude and heading gyros, an electric turn coordinator.
  gyros: 'vacuum+electric',
  // Interior: a long nose and a firewall between the engine and the cockpit: the turbine's whine reaches the cabin
  // only below a couple of kilohertz (its upper tones faint), the propeller's blade passage dominates, the large
  // cabin resonates low.
  cabin: {
    routes: [
      { stem: STEM.engine, lowpassHz: 2200, gain: 0.8 },
      { stem: STEM.prop, lowpassHz: 1300, gain: 0.8 },
      { stem: STEM.airframe, lowpassHz: 2100, gain: 0.4 },
      { stem: STEM.cabin, lowpassHz: 0, gain: 1.0 },
    ],
    bus: [
      { type: 'peaking', hz: 95, gainDb: 5, q: 1.2 },
      { type: 'peaking', hz: 190, gainDb: 3, q: 1.5 },
    ],
    // Full power on the ground inside the C172S's window (-17 .. -9 dBFS RMS at volume 1, tests/audio/turbine.test.ts).
    level: 0.5,
  },
  // Exterior: the raw sources (the cabin stem is inaudible outside), then propagation.
  exterior: {
    routes: [
      { stem: STEM.engine, lowpassHz: 0, gain: 1.0 },
      { stem: STEM.prop, lowpassHz: 0, gain: 1.1 },
      { stem: STEM.airframe, lowpassHz: 0, gain: 0.25 },
    ],
    level: 1.1,
  },
};
