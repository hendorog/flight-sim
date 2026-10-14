// Deep Time, increment 2 (WP0a): the boot-time rules of an era start, pure so node tests can pin them.
//
//   startTimeOfDay   the Cretaceous safari boots at SAFARI.tod (cretaceousAnchors.ts: the dusk light its first
//                    minute was computed for) when the boot starts the safari, the URL has no tod= and nothing is
//                    resumed. A scenario-level override: the runway start keeps the weather's own time, tod= in the
//                    URL always wins, and a resumed flight keeps its snapshot's time.
//   cameraModeAllowed  the tower camera stands in the airport's tower: refused in an era without one
//                    (EraWorld.towerCamera false, e.g. the Cretaceous Flats).
//   safariHeadPitch  SAFARI.headPitchDeg for a safari start (null: the aircraft's default view, the case today).

import type { CameraMode, ScenarioId } from '../core/context';
import { SAFARI } from '../world/era/cretaceousAnchors';
import { era, isPresent } from '../world/era/eraState';

export interface StartTimeInput {
  /** The scenario the boot starts (after the resume decision and the era's default start). */
  scenario: ScenarioId;
  /** The URL gave tod= (params.weather.timeOfDay is set). */
  urlTod: boolean;
  /** The boot resumes a snapshot (whose weather, time included, wins). */
  resumed: boolean;
}

/** The time of day the boot should set, or null to leave the weather's own. */
export function startTimeOfDay(o: StartTimeInput): number | null {
  if (isPresent()) return null;
  if (o.scenario !== 'safari' || o.urlTod || o.resumed) return null;
  return SAFARI.tod;
}

/** May the camera switch to `mode` in this era? */
export function cameraModeAllowed(mode: CameraMode): boolean {
  return mode !== 'tower' || era().world.towerCamera;
}

/** The camera mode to boot in: `mode`, or the cockpit when this era refuses it. */
export function bootCameraMode(mode: CameraMode): CameraMode {
  return cameraModeAllowed(mode) ? mode : 'cockpit';
}

/** The initial cockpit head pitch (deg) for a start, or null for the aircraft's default view. */
export function safariHeadPitch(scenario: ScenarioId): number | null {
  return scenario === 'safari' ? SAFARI.headPitchDeg : null;
}
