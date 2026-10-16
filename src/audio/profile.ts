// The sound description of one aircraft type: engine and propeller voices, the warning and system sounds, and
// the cabin / exterior mix. Plain data: it is sent to the worklet as a 'config' message and must stay
// cloneable. A profile with ONE engine entry keeps the per-sample synthesis path; two entries select the
// per-block path (and the second engine's block of the parameter list, audio/params.ts).

export interface EngineSoundProfile {
  /** A gas turbine has none: the field is kept equal to the powerplant's (tests/aircraft/consistency.ts) and not read. */
  cylinders: 4 | 6;
  /**
   * 'diesel': a sharper exhaust pulse, a hard combustion knock, regular firing (no idle lope, whatever idleLopeRpm says, and no mixture / magneto roughness).
   * 'turbine': no combustion pulses at all; the voice of a gas turbine described by `turbine` (which it then needs), and the piston members are not read.
   */
  combustion: 'spark' | 'diesel' | 'turbine';
  /** Per-cylinder timing offsets (revolutions) and loudness. C172S: [0, .014, -.01, .008], [1, .8, .93, .74]. */
  firingOffsets: readonly number[]; cylGains: readonly number[];
  ratedPowerW: number;
  /** Manifold pressure at idle and full throttle, inHg (load for the sound); null = load from power only (diesel). */
  mapRange: readonly [number, number] | null;
  /** idleLopeRpm: the idle lope fades in below this crank rpm (C172S 1100); 0 = none (diesel). */
  crankRpm: number; idleLopeRpm: number;
  exhaust: readonly { hz: number; perRps: number; perLoad: number; q: number; gain: number }[];
  /** Turbocharger whine: its pitch with the rotor at full-load speed, Hz, and its strength there relative to the exhaust note (0.05 is faint). */
  turbo?: { hzAtFullLoad: number; level: number };
  /** combustion 'turbine' only: the gas generator, its burner and its gearbox. */
  turbine?: TurbineSoundProfile;
  /** Crank revolutions per propeller revolution. 1: the blade passage is locked to the crank; otherwise the propeller voice turns at the propeller's own speed. */
  gearRatio: number;
  /** Stem gain of this engine voice (two engines: about 0.71 each). */
  level: number;
}
/**
 * The sound of a gas turbine (combustion 'turbine'). Its synthesis parameters differ from a piston engine's
 * (mapping.ts fillSynthParams): `rpm` is the GAS-GENERATOR speed, rev/min; `firing` 1 while it is lit; `load` the
 * burner's output 0..~1.2 (fuel flow and shaft power); `starter` the starter-generator; `propRpm` the propeller.
 */
export interface TurbineSoundProfile {
  /** Gas-generator speed at 100 % Ng, rev/min (EngineState.ng is a percentage of it). */
  ngRpm: number;
  /** Fuel flow at 100 % Ng at sea level, kg/s: with the rated shaft power, the scale of `load`. */
  fuelFlowRef: number;
  /**
   * The gas generator's whine: tones at `order` x its shaft rate, of strength `gain` at 100 % Ng (falling with the
   * square of Ng below), each with a breathy band of noise around it `band` as strong (0: a pure tone).
   */
  tones: readonly { order: number; gain: number; band: number }[];
  /** Combustion and exhaust roar: noise bands centred at `hz` + `perLoad` x load, of Q `q` and strength `gain` at load 1. */
  roar: readonly { hz: number; perLoad: number; q: number; gain: number }[];
  /** Starter-generator while it motors the spool: its commutator tone at `perNgRev` x the gas-generator shaft rate. */
  starter: { perNgRev: number; level: number };
  /** Reduction gearbox: a mesh tone at `perPropRev` x the propeller shaft rate, faint. */
  gearMesh: { perPropRev: number; level: number };
  /** Strength of the soft thud of light-off on a start (0: none). */
  lightOff: number;
}
/**
 * growl: a turboprop's propeller loaded unevenly round its disc (the cowl, the intake and the exhaust stacks
 * behind it) beats each blade's passage at the shaft rate: the depth of that roughness at full thrust (0 or
 * absent: none; 0.3 is strong). Read behind a reduction gear only.
 */
export interface PropSoundProfile { /** Blades on the disc (PC-12 4; MD 500E main rotor 5). */ blades: 2 | 3 | 4 | 5; diameterM: number; cruiseThrustN: number; level: number; growl?: number }
export interface StemRoute {
  stem: number;
  /** Low-pass cutoff of this stem, Hz; 0 = no low-pass (the stem is routed unfiltered). */
  lowpassHz: number;
  /** Q of that low-pass, dB (the Web Audio convention for a low-pass). Absent: 0.6. */
  lowpassQ?: number;
  gain: number;
}
export interface BiquadSpec { type: 'peaking' | 'lowshelf' | 'highshelf'; hz: number; gainDb: number; q: number }
export interface AudioProfile {
  engines: readonly { engine: EngineSoundProfile; prop: PropSoundProfile }[];
  /** Bus voltage above which bus-powered sounds work (20 on 28 V, 10 on 14 V). */
  busPoweredV: number;
  /** 'reed': pitch baseHz .. baseHz + sweepHz and loudness rise toward the stall. 'electric': a steady tone at baseHz (sweepHz is not read). */
  stallWarner: { kind: 'reed' | 'electric'; baseHz: number; sweepHz: number; needsBus: boolean };
  flapMotor: boolean; flapMaxRad: number;
  /**
   * warningKind: what the gear warning sounds like (PA-34: a horn; DA42: a repeating chime). Absent: 'horn'.
   * warningHz: its pitch (absent: horn 480, chime 880). warningPerMinute: beeps or strokes per minute (absent:
   * horn 90, chime 60). pumpHz: pitch of the hydraulic pump's motor at speed (absent: 310).
   */
  gear: { pump: boolean; warningHorn: boolean; warningKind?: 'horn' | 'chime'; warningHz?: number; warningPerMinute?: number; pumpHz?: number } | null;
  /** 'electric': every gyro spins on the bus. 'none': no spinning gyros (solid-state attitude sensors), no whine. */
  gyros: 'vacuum+electric' | 'electric' | 'none';
  cabin: { routes: readonly StemRoute[]; bus: readonly BiquadSpec[]; level: number };
  exterior: { routes: readonly StemRoute[]; level: number };
}
