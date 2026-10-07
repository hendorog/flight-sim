// Sound profiles of the test-bed aircraft: synthetic types built from the Cessna 172S profile that switch on
// the mechanisms no Cessna 172S exercises. The numbers are those of the pattern each follows, good enough to
// prove the mechanism; the profiles of the real types are written with those types.

import { C172S_AUDIO } from '../../src/aircraft/c172s/audio';
import type { AudioProfile, EngineSoundProfile, PropSoundProfile } from '../../src/audio/profile';

const C172S_ENGINE = C172S_AUDIO.engines[0].engine;
const C172S_PROP = C172S_AUDIO.engines[0].prop;

/** Stem gain of each of two equal voices: together they carry the power of one (0.71 squared, twice). */
export const TWIN_VOICE_LEVEL = 0.71;

/**
 * The PA-34 pattern: two direct-drive 200 hp flat fours with two-blade propellers, a 14 V system, manual flaps,
 * an electric stall warner, a hydraulic gear pump and a beeping gear horn.
 */
export const TWIN_AUDIO_TESTBED: AudioProfile = (() => {
  const engine: EngineSoundProfile = { ...C172S_ENGINE, ratedPowerW: 200 * 745.7, mapRange: [10, 29], level: TWIN_VOICE_LEVEL };
  const prop: PropSoundProfile = { ...C172S_PROP, diameterM: 1.93, cruiseThrustN: 1300, level: TWIN_VOICE_LEVEL };
  return {
    ...C172S_AUDIO,
    engines: [{ engine, prop }, { engine, prop }],
    busPoweredV: 10,
    stallWarner: { kind: 'electric', baseHz: 2600, sweepHz: 0, needsBus: true },
    flapMotor: false,
    gear: { pump: true, warningHorn: true },
  };
})();

/** Crank revolutions per propeller revolution of the diesel test-bed (the DA42 NG's gearbox). */
export const DIESEL_GEAR_RATIO = 1.69;

/** One geared, turbocharged FADEC diesel with a three-blade propeller (the engine of the DA42 pattern). */
export const DIESEL_ENGINE_TESTBED: EngineSoundProfile = {
  cylinders: 4,
  combustion: 'diesel',
  // Common-rail injection: even firing, nearly equal cylinders.
  firingOffsets: [0, 0.004, -0.003, 0.002],
  cylGains: [1, 0.95, 0.97, 0.93],
  ratedPowerW: 123_500,
  mapRange: null,
  crankRpm: 250,
  idleLopeRpm: 0,
  // The turbine takes the edge off the exhaust pulses: weaker upper resonances than the Cessna's open stacks.
  exhaust: [
    { hz: 110, perRps: 0.8, perLoad: 0, q: 3, gain: 1.4 },
    { hz: 300, perRps: 0, perLoad: 40, q: 3.5, gain: 0.7 },
    { hz: 800, perRps: 0, perLoad: 120, q: 4, gain: 0.3 },
  ],
  turbo: { hzAtFullLoad: 2600, level: 0.05 },
  gearRatio: DIESEL_GEAR_RATIO,
  level: TWIN_VOICE_LEVEL,
};
export const DIESEL_PROP_TESTBED: PropSoundProfile = { blades: 3, diameterM: 1.87, cruiseThrustN: 1200, level: TWIN_VOICE_LEVEL };

/**
 * The DA42 pattern: two of those engines, a 28 V system, electric flaps, an electric stall warner (a steady
 * tone), a gear pump and a repeating gear chime, and no spinning gyros.
 */
export const DIESEL_AUDIO_TESTBED: AudioProfile = {
  ...C172S_AUDIO,
  engines: [
    { engine: DIESEL_ENGINE_TESTBED, prop: DIESEL_PROP_TESTBED },
    { engine: DIESEL_ENGINE_TESTBED, prop: DIESEL_PROP_TESTBED },
  ],
  stallWarner: { kind: 'electric', baseHz: 2900, sweepHz: 0, needsBus: true },
  gear: { pump: true, warningHorn: true, warningKind: 'chime' },
  gyros: 'none',
};

/** The diesel engine alone on the Cessna 172S airframe (the per-sample synthesis path with a diesel, geared voice). */
export const DIESEL_SINGLE_TESTBED: AudioProfile = {
  ...C172S_AUDIO,
  engines: [{ engine: { ...DIESEL_ENGINE_TESTBED, level: 1 }, prop: { ...DIESEL_PROP_TESTBED, level: 1 } }],
};
