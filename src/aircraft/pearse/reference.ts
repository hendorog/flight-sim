// Richard Pearse 1903 Monoplane: pilot reference speeds, KIAS. Plain data.
// Derived from the 15.0 m^2 cambered canvas wing at 276 kg MTOW (~3.8 lb/ft^2 wing loading) and 24 hp direct-drive
// tractor propulsion (ESTIMATE from Ogilvie / Rodliffe reconstructions).

import type { ReferenceSpeeds } from '../types';

export const PEARSE_REFERENCE: ReferenceSpeeds = {
  /** Power-off stall with full trailing-edge camber flap (18 deg). */
  vs0: 26,
  /** Clean stall speed (~33 mph). */
  vs1: 29,
  /** Nosewheel lift-off / rotation speed. */
  vr: 31,
  /** Best angle of climb. */
  vx: 35,
  /** Best rate of climb. */
  vy: 39,
  /** Best power-off glide speed (~5.8 : 1). */
  vglide: 38,
  /** Design manoeuvring speed (+3.0 g limit on wire-braced bamboo spars). */
  va: 50,
  /** Flap limits for 9 deg and 18 deg camber settings. */
  vfe: [50, 48],
  /** Maximum structural cruising speed in rough air. */
  vno: 54,
  /** Never-exceed speed of the wire-braced bamboo & canvas airframe (~75 mph). */
  vne: 65,
  /** Approach speed with intermediate flap. */
  vapp: 39,
  /** Final threshold speed with full flap. */
  vref: 36,
  /** Typical cruise (~53 mph). */
  vcruise: 46,
  /** Circuit downwind speed. */
  vdownwind: 43,
  /** Wire-braced open truss and exposed spoked tricycle gear. */
  glideRatio: 5.8,
};
