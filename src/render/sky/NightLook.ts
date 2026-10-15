// The night sky's presentation (package P3 of the night-sky plan owns this file and glsl/nightSky.ts): the
// gains that make the stars and the Milky Way read as a dark-adapted eye sees them at a dark site.
//
// Interface (frozen by the scaffold; see the plan): `uniforms` is spread into the sky dome's uniforms (the star
// layer in StarField reads uStarGain too); update() runs once per frame from SkyDome.update.

import type { SimContext } from '../../core/context';
import type { Atmosphere } from './Atmosphere';

export class NightLook {
  readonly uniforms = {
    /** Presentation gain of point sources (stars, planets); 1 = photometric. */
    uStarGain: { value: 1 },
    /** Presentation gain of diffuse night light (Milky Way, airglow); 1 = photometric. */
    uDiffuseGain: { value: 1 },
  };

  update(_ctx: SimContext, _atmosphere: Atmosphere): void {}
}
