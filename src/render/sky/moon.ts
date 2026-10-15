// The Moon's presentation in the visible sky (package P1 of the night-sky plan owns this file, glsl/moon.ts and
// celestial.ts): the uniforms of MOON_GLSL and their per-frame update.
//
// Interface (frozen by the scaffold; see the plan): `uniforms` is spread into the sky dome's uniforms, so the
// objects are shared with every material that spreads the dome's uniforms (the star layer reads
// uMoonAngularRadius to hide stars behind the disc). update() runs once per frame from SkyDome.update, after the
// Celestial has moved.

import type { SimContext } from '../../core/context';
import { MOON_TINT } from './Atmosphere';
import type { Celestial } from './celestial';
import { MOON_ANGULAR_RADIUS, MOON_FULL_ILLUMINANCE_TOA } from './params';

const MOON_SOLID_ANGLE = Math.PI * MOON_ANGULAR_RADIUS * MOON_ANGULAR_RADIUS;

export class MoonModel {
  readonly uniforms = {
    // Full-moon disc radiance; the shader's Lommel-Seeliger shading produces the phase.
    uMoonRadiance: { value: MOON_TINT.clone().multiplyScalar(MOON_FULL_ILLUMINANCE_TOA / MOON_SOLID_ANGLE) },
    /** Apparent angular radius of the drawn disc, rad (presentation scale included). */
    uMoonAngularRadius: { value: MOON_ANGULAR_RADIUS },
  };

  update(_ctx: SimContext, _celestial: Celestial): void {}

  dispose(): void {}
}

