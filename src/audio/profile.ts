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
  /**
   * Reduction-gearbox mesh, how its strength grows with the output shaft: the tone is at full strength from this
   * output speed up, rev/s (absent: 30, a turboprop's propeller at 1800 rpm). A helicopter's main transmission turns
   * the rotor at 8 rev/s and is loud: about 8.
   */
  gearMeshFullRps?: number;
  /**
   * The igniters on a start: the exciter's spark snaps `perSecond` times a second, each a sharp crack of strength
   * `level` (absent or 0: not heard). Keyed on the `ignitor` parameter (the starter engaged and the gas generator not yet running).
   */
  ignitor?: { perSecond: number; level: number };
}
/**
 * growl: a turboprop's propeller loaded unevenly round its disc (the cowl, the intake and the exhaust stacks
 * behind it) beats each blade's passage at the shaft rate: the depth of that roughness at full thrust (0 or
 * absent: none; 0.3 is strong). Read behind a reduction gear only.
 */
export interface PropSoundProfile {
  /** Blades on the disc (PC-12 4; MD 500E main rotor 5). */
  blades: 2 | 3 | 4 | 5;
  diameterM: number;
  cruiseThrustN: number;
  level: number;
  growl?: number;
  /**
   * A reversing turboprop (beta and reverse): the roar of the disc driven against its own wake, heard as the
   * blades go through flat to a negative angle and the gas generator spools up for reverse thrust. `growl`: its
   * strength at full reverse thrust (the `reverse` parameter 1); `fullPitchDeg`: the blade angle of full reverse at
   * the propeller's reference station, deg (negative; PC-12 -17.5). Read behind a reduction gear only, on engine 0.
   */
  reverse?: { growl: number; fullPitchDeg: number };
  /**
   * A helicopter main rotor's high-speed impulsive noise (HSI): as the ADVANCING tip nears Mach 1 its thickness noise
   * steepens into a sharp, mostly negative pressure crack once per blade passage, heard ahead of the aircraft and as a
   * hard edge on the beat inside. It sets in at the advancing-tip Mach `onsetMach` and is at its full strength `level`
   * (relative to the blade-passage tone) from `fullMach` (the `advTipMach` parameter). Read behind a reduction gear
   * only, on engine 0 (the rotor voice). Absent: none.
   */
  impulsive?: { onsetMach: number; fullMach: number; level: number };
}
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
  /**
   * 'reed': pitch baseHz .. baseHz + sweepHz and loudness rise toward the stall. 'electric': a steady tone at baseHz
   * (sweepHz is not read). 'none': no stall horn at all (the PC-12/47: its stall warning is the stick shaker's
   * rattle, `stickShaker`).
   */
  stallWarner: { kind: 'reed' | 'electric' | 'none'; baseHz: number; sweepHz: number; needsBus: boolean };
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
  /**
   * A helicopter's tail rotor, in the propeller stem: blade passage at `blades` x its shaft rate (`ratio` x the
   * main-rotor rpm), with the broadband noise of its tips, and a slap (the impulsive passage of each blade, its
   * harmonics flattening) that grows with its loading |thrust| / `hoverThrustN`. Absent: none (every type before the MD 500E).
   */
  tailRotor?: { blades: 2 | 3 | 4; diameterM: number; ratio: number; hoverThrustN: number; slap: number; level: number };
  /**
   * Pusher propeller on the rotor shaft (AH-56A), in the propeller stem beside the rotors: blade passage = blades x
   * rotor rpm x ratio, its harmonics and tip noise growing with |thrust| and the blade angle, and a roar in reverse
   * pitch. Declared at S0; consistency: `blades`, `diameterM`, `ratio` equal RotorcraftDefinition.pusher (propeller.blades,
   * propeller.diameter, ratio) once that exists. The voice members after them are optional (defaults in the worklet):
   *   cruiseThrustN  |thrust| giving the `pusherLoad` parameter 1 (absent: 10 kN);
   *   zeroThrustDeg  blade angle of zero thrust at the reference station, deg (absent: 0): the `pusherPitch` and
   *                  `pusherReverse` parameters count from it;
   *   topPitchDeg    blade angle at the top of the forward range, deg (pusherPitch 1; absent: 40);
   *   reverseDeg     blade angle of full reverse, deg (pusherReverse 1 at full reverse thrust; absent: -17);
   *   growl          strength of the reverse roar at pusherReverse 1 (absent: 0.6); level: stem gain (absent: 1).
   * Silent (its parameters 0) while the state has no pusher (RotorcraftState.pusher). Absent: none.
   */
  pusher?: { blades: number; diameterM: number; ratio: number; cruiseThrustN?: number; zeroThrustDeg?: number;
    topPitchDeg?: number; reverseDeg?: number; growl?: number; level?: number };
  /**
   * A twin turboshaft's warning unit (RotorcraftState.twinTurboshaft; the Bo 105's K-DW02/01): an intermittent tone at
   * `lowHz`, `lowPerSecond` beeps a second while NR is low (nrLowTone) and while the N1s split (n1SplitLight), a
   * steady tone at `highHz` while NR is high (nrHighTone), each `level` strong in the cabin, on the bus. Absent: none.
   */
  rotorWarnings?: { lowHz: number; lowPerSecond: number; highHz: number; level: number };
  /**
   * The rotor's n-per-rev vibration felt and heard in the cabin as a hum: a tone at `perRev` x the rotor's rev/s,
   * `level` strong at `fullKias` and above (growing with the square of the airspeed from `hoverShare` of it in the
   * hover; the transition hump is not modelled), and with the square of the rotor speed relative to `rpm100`
   * (a rotor running down shakes less). Interior only (the cabin stem). Absent: none.
   */
  vibration?: { perRev: number; level: number; fullKias: number; hoverShare: number; rpm100: number };
  /**
   * The half-P hop (RotorcraftState.events.halfPHop): a low rumble (a noise band at `rumbleHz`) thumping at `perRev` x
   * the rotor's rev/s, its depth and loudness with the event's amplitude (1 = the onset cue), `level` strong at 1.
   * Interior only (the cabin stem). Absent: none.
   */
  halfP?: { perRev: number; rumbleHz: number; level: number };
  /**
   * Spoken warnings (the AH-56A's FLAWS, fault locator aural warning system): each message is spoken while its
   * condition holds (audio/voiceWarnings.ts flawsConditions), again every `repeatSeconds`, the highest priority (the
   * first in the list) first; `caution` is spoken once per new caution/warning chime event (AudioSystem.caws). Through
   * the browser's speech synthesis where it exists (silent otherwise). Absent: none.
   */
  voiceWarnings?: { messages: readonly VoiceMessage[]; repeatSeconds: number; volume: number };
  /** A stick shaker (AircraftState.stickShaker): the rattle of its eccentric motor at `hz` on the control column, `level` strong. Absent: none. */
  stickShaker?: { hz: number; level: number };
  /** Aural overspeed warning: a clacker at `perSecond` strokes a second above `kias` or `mach` (LimitsDef.overspeedWarning), on the bus. Absent: none. */
  overspeedWarning?: { kias: number; mach: number; perSecond: number; level: number };
  /**
   * The caution and warning system's chimes, struck by a { type: 'caws', level } message (AudioSystem.caws()):
   * a warning is a triple chime, a caution a single one, at `hz`. Absent: the message is ignored.
   */
  caws?: { hz: number; level: number };
}
/** One spoken warning: its words and what sounds it (audio/voiceWarnings.ts). */
export interface VoiceMessage {
  text: string;
  /**
   * 'rotorRpm': the rotor outside [low, high] % of its 100 % rpm (`rpm100`) once it has reached `low` (powered, rotor
   * turning); 'engineFire': an engine fire (no state reports one yet: never sounds); 'caution': a new master caution
   * (the 'caws' event).
   */
  when: { kind: 'rotorRpm'; low: number; high: number; rpm100: number } | { kind: 'engineFire' } | { kind: 'caution' };
}
