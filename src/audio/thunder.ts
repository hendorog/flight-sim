// Thunder for a lightning strike (the 'lightning' event of LightningOverlay): a one-shot noise rumble on the main
// thread, built like synthChime (AudioSystem.ts), with no part in the synthesis worklet.
//
// thunderPlan works out, from the strike and the listener: the start (the sound from the nearest point of the
// channel, d_near / c), the length (the spread of arrival times over the channel, (d_far - d_near) / c, at least
// THUNDER_MIN_S, plus THUNDER_TAIL_S of rumble), a low-pass for the air's absorption, a gain and a stereo pan.
// The channel is a vertical segment: a cloud-to-ground strike from the ground to the flash altitude, an intracloud
// flash IC_HALF_LENGTH_M above and below it. Nothing is played beyond THUNDER_MAX_DISTANCE_M.
// scheduleThunder builds the nodes at a given audio time: a seeded noise buffer (the strike id seeds it) through
// the absorption low-pass, a second low-pass in cockpit view (the cabin), an envelope with one swell per return
// stroke, and the pan, into `dest`. The start is scheduled directly on the audio clock: the exterior path's
// DelayNode holds at most 12 s (MAX_DELAY in AudioSystem.ts), and thunder from 10 km arrives after about 30 s.
//
// The absorption cutoff is a copy of airAbsorptionCutoff (mapping.ts), 20 kHz x (40 m / d)^0.8, with a lower floor
// (THUNDER_CUTOFF_MIN_HZ instead of 1200 Hz) so distant thunder is a low rumble; it is copied rather than imported
// so that mapping.ts can change for the aircraft sound without changing this.

/** Distance beyond which a strike makes no sound here, m. Unconfirmed: a tuning value. */
export const THUNDER_MAX_DISTANCE_M = 20_000;
/** Shortest rumble from the channel's spread, s, and the rumble added after the last arrival, s. */
export const THUNDER_MIN_S = 0.6;
export const THUNDER_TAIL_S = 1.5;
/** Half the vertical extent of an intracloud flash's channel, m. Unconfirmed: a tuning value. */
export const IC_HALF_LENGTH_M = 1500;
/** Gain: THUNDER_GAIN x min(1, THUNDER_NEAR_M / d) x the strike's energy. Unconfirmed: tuning values. */
export const THUNDER_GAIN = 0.8;
export const THUNDER_NEAR_M = 300;
/** Absorption low-pass range, Hz. */
export const THUNDER_CUTOFF_MIN_HZ = 100;
export const THUNDER_CUTOFF_MAX_HZ = 20_000;
/** Low-pass for the cabin in cockpit view, Hz. Unconfirmed: a tuning value. */
export const THUNDER_CABIN_HZ = 700;
/** Speed of sound when the environment gives none, m/s (ISA sea level; mapping.ts propagationDelay uses 340.3). */
export const SPEED_OF_SOUND_FALLBACK = 340.3;

/** Where the thunder comes from: the strike's channel, NED m and m MSL. */
export interface ThunderSource {
  id: number;
  kind: 'cg' | 'ic';
  north: number;
  east: number;
  /** Flash altitude, m MSL (the channel's cloud end for a ground strike). */
  altM: number;
  /** 0..1 */
  energy: number;
  strokes: number;
}

/** The listener: position NED m / m MSL, and its right-hand axis in NED (unit; for the pan). */
export interface ThunderListener {
  north: number;
  east: number;
  altM: number;
  rightNorth: number;
  rightEast: number;
  rightUp: number;
}

export interface ThunderPlan {
  /** From the strike to the first sound, s. */
  delayS: number;
  /** Length of the rumble, s. */
  durationS: number;
  /** Nearest and farthest point of the channel, m. */
  nearM: number;
  farM: number;
  cutoffHz: number;
  gain: number;
  /** -1..1 */
  pan: number;
  strokes: number;
  /** Seeds the noise. */
  seed: number;
}

/** Absorption low-pass for a source at d m (airAbsorptionCutoff with a floor of THUNDER_CUTOFF_MIN_HZ). */
export function thunderCutoff(d: number): number {
  const f = 20_000 * Math.pow(40 / Math.max(d, 1), 0.8);
  return Math.min(THUNDER_CUTOFF_MAX_HZ, Math.max(THUNDER_CUTOFF_MIN_HZ, f));
}

/**
 * What the listener hears of a strike, or null when the channel's nearest point is beyond THUNDER_MAX_DISTANCE_M.
 * `groundM` is the ground elevation under the strike, m MSL; `c` the speed of sound, m/s.
 */
export function thunderPlan(s: ThunderSource, l: ThunderListener, groundM: number, c: number): ThunderPlan | null {
  const speed = c > 1 ? c : SPEED_OF_SOUND_FALLBACK;
  const lo = s.kind === 'cg' ? Math.min(groundM, s.altM) : s.altM - IC_HALF_LENGTH_M;
  const hi = s.kind === 'cg' ? Math.max(groundM, s.altM) : s.altM + IC_HALF_LENGTH_M;
  const dn = s.north - l.north;
  const de = s.east - l.east;
  const h2 = dn * dn + de * de;
  const nearUp = Math.min(hi, Math.max(lo, l.altM)) - l.altM;
  const nearM = Math.sqrt(h2 + nearUp * nearUp);
  if (nearM > THUNDER_MAX_DISTANCE_M) return null;
  const farUp = Math.max(Math.abs(lo - l.altM), Math.abs(hi - l.altM));
  const farM = Math.sqrt(h2 + farUp * farUp);
  // Toward the channel's middle, projected on the listener's right axis.
  const du = 0.5 * (lo + hi) - l.altM;
  const dm = Math.sqrt(h2 + du * du);
  const pan = dm > 0.5 ? (0.8 * (dn * l.rightNorth + de * l.rightEast + du * l.rightUp)) / dm : 0;
  return {
    delayS: nearM / speed,
    durationS: Math.max(THUNDER_MIN_S, (farM - nearM) / speed) + THUNDER_TAIL_S,
    nearM,
    farM,
    cutoffHz: thunderCutoff(nearM),
    gain: THUNDER_GAIN * Math.min(1, THUNDER_NEAR_M / Math.max(nearM, 1)) * Math.min(1, Math.max(0, s.energy)),
    pan: Math.max(-1, Math.min(1, pan)),
    strokes: Math.max(1, Math.round(s.strokes)),
    seed: s.id >>> 0,
  };
}

/** The nodes of one scheduled thunder, so that a reset can stop it. */
export interface ScheduledThunder {
  source: AudioBufferSourceNode;
  /** Audio time the sound starts and ends, s. */
  startAt: number;
  endAt: number;
}

/**
 * Build the thunder of `plan` into `dest`: it starts at audio time `strikeAt + plan.delayS`. `cockpit` adds the
 * cabin low-pass. One-shot nodes only: the source is stopped at the end, so the graph frees itself.
 */
export function scheduleThunder(ac: BaseAudioContext, dest: AudioNode, plan: ThunderPlan, strikeAt: number, cockpit: boolean): ScheduledThunder {
  const startAt = strikeAt + plan.delayS;
  const endAt = startAt + plan.durationS;
  const n = Math.max(1, Math.round(ac.sampleRate * plan.durationS));
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const data = buf.getChannelData(0);
  // Deterministic noise (a small LCG seeded by the strike), smoothed once so the rumble has less hiss to filter.
  let x = (plan.seed ^ 0x2545f491) >>> 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    prev = 0.6 * prev + 0.4 * (x / 0x80000000 - 1);
    data[i] = prev * 2;
  }
  const source = new AudioBufferSourceNode(ac, { buffer: buf });
  let node: AudioNode = source.connect(new BiquadFilterNode(ac, { type: 'lowpass', frequency: plan.cutoffHz, Q: 0.7 }));
  if (cockpit) node = node.connect(new BiquadFilterNode(ac, { type: 'lowpass', frequency: THUNDER_CABIN_HZ, Q: 0.7 }));
  const env = new GainNode(ac, { gain: 0 });
  // One swell per return stroke over the first part of the rumble (each arrives from the near part of the channel
  // first), then the decay over the rest.
  const g = env.gain;
  g.setValueAtTime(0, startAt);
  const swell = Math.min(plan.durationS * 0.5, 0.25 * plan.strokes);
  for (let j = 0; j < plan.strokes; j++) {
    const at = startAt + (swell * j) / plan.strokes;
    g.linearRampToValueAtTime(plan.gain * (1 - 0.15 * j), at + 0.03);
    g.linearRampToValueAtTime(plan.gain * 0.55, at + 0.03 + swell / plan.strokes);
  }
  g.exponentialRampToValueAtTime(0.0001, endAt);
  node.connect(env).connect(new StereoPannerNode(ac, { pan: plan.pan })).connect(dest);
  source.start(startAt);
  source.stop(endAt + 0.01);
  return { source, startAt, endAt };
}
