// The mix: how the four synthesis stems are filtered and summed for the interior (cockpit) and exterior
// listener, and the master section. Plain data shared by AudioSystem (which builds Web Audio nodes from it)
// and the offline level analysis in tests/audio (which runs the same biquads in node), so the levels the
// tests measure are the levels the browser plays.
//
// The routes, the cabin resonances and the two levels belong to the aircraft type (AudioProfile.cabin /
// .exterior); mixFor() turns a profile into the Web Audio settings below. The INTERIOR_* / EXTERIOR_* constants
// are the Cessna 172S ones.

import { C172S_AUDIO } from '../aircraft/c172s/audio';
import type { AudioProfile } from './profile';

/** A Web Audio BiquadFilterNode's settings (lowpass/highpass Q is in dB, peaking Q is linear; per spec). */
export interface BiquadSpec {
  type: 'lowpass' | 'highpass' | 'peaking' | 'lowshelf' | 'highshelf';
  frequency: number;
  Q: number;
  gainDb?: number;
}

export interface StemRoute {
  stem: number;
  /** Filters applied in order. */
  filters: BiquadSpec[];
  gain: number;
}

/** Q of a stem's low-pass when the profile gives none, dB. */
export const STEM_LOWPASS_Q = 0.6;

/** The mix of one aircraft type as Web Audio settings. */
export interface Mix {
  interiorRoutes: StemRoute[];
  /** Overall interior level. */
  interiorLevel: number;
  /** Applied to the interior sum. */
  interiorBus: BiquadSpec[];
  exteriorRoutes: StemRoute[];
  /** Overall exterior level. */
  exteriorLevel: number;
}

/** The routes of a profile: a stem gets a low-pass only when its `lowpassHz` is above 0 (0 = routed unfiltered). */
function routesFor(routes: AudioProfile['cabin']['routes']): StemRoute[] {
  return routes.map((r) => ({
    stem: r.stem,
    filters: r.lowpassHz > 0 ? [{ type: 'lowpass', frequency: r.lowpassHz, Q: r.lowpassQ ?? STEM_LOWPASS_Q }] : [],
    gain: r.gain,
  }));
}

export function mixFor(profile: AudioProfile): Mix {
  return {
    interiorRoutes: routesFor(profile.cabin.routes),
    interiorLevel: profile.cabin.level,
    interiorBus: profile.cabin.bus.map((f) => ({ type: f.type, frequency: f.hz, Q: f.q, gainDb: f.gainDb })),
    exteriorRoutes: routesFor(profile.exterior.routes),
    exteriorLevel: profile.exterior.level,
  };
}

const C172S_MIX = mixFor(C172S_AUDIO);

/** Cessna 172S interior: engine, propeller and airframe through the cabin's low-passes, the cabin stem as it is. */
export const INTERIOR_ROUTES: StemRoute[] = C172S_MIX.interiorRoutes;
/** Cessna 172S overall interior level. */
export const INTERIOR_LEVEL = C172S_MIX.interiorLevel;
/** Cessna 172S cabin resonances, applied to the interior sum. */
export const INTERIOR_BUS: BiquadSpec[] = C172S_MIX.interiorBus;

/** Cessna 172S exterior: the raw sources (the cabin stem is inaudible outside), then propagation. */
export const EXTERIOR_ROUTES: StemRoute[] = C172S_MIX.exteriorRoutes;
/** Cessna 172S overall exterior level. */
export const EXTERIOR_LEVEL = C172S_MIX.exteriorLevel;

/** Master section: a gentle glue compressor never needed in normal operation, then a brick-wall-ish limiter. */
export const LIMITER = { threshold: -6, knee: 4, ratio: 20, attack: 0.002, release: 0.2 };

/** Default master volume. */
export const DEFAULT_VOLUME = 1.0;
