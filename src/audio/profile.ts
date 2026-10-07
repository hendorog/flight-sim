// The sound description of one aircraft type: engine and propeller voices, the warning and system sounds, and
// the cabin / exterior mix. Plain data: it is sent to the worklet as a 'config' message and must stay
// cloneable. A profile with ONE engine entry keeps the per-sample synthesis path; two entries select the
// per-block path (and the second engine's block of the parameter list, audio/params.ts).

export interface EngineSoundProfile {
  cylinders: 4 | 6;
  /** 'diesel': a sharper exhaust pulse, a hard combustion knock, regular firing (no idle lope, whatever idleLopeRpm says, and no mixture / magneto roughness). */
  combustion: 'spark' | 'diesel';
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
  /** Crank revolutions per propeller revolution. 1: the blade passage is locked to the crank; otherwise the propeller voice turns at the propeller's own speed. */
  gearRatio: number;
  /** Stem gain of this engine voice (two engines: about 0.71 each). */
  level: number;
}
export interface PropSoundProfile { blades: 2 | 3; diameterM: number; cruiseThrustN: number; level: number }
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
