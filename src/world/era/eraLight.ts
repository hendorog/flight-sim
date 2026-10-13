// Deep Time, increment 2 (WP0a): the era's "night" ramp, shared by the terrain's ERA_UNIFORMS.uNight
// (world/terrain/eraUniforms.ts), the lava state (world/terrain/volcano.ts volcanoLavaState, WP5) and any era
// effect. Pure, three-free (the volcano module runs in the terrain workers).
//
// 0 with the sun NIGHT_RAMP_FROM_DEG or more above the horizon, 1 at NIGHT_RAMP_TO_DEG below it, smoothstep
// between. The +15 deg start lets a faint crater glow exist at the safari's dusk start (SAFARI.tod 19.0: the sun
// 7.2 deg up gives 0.31; 10 deg up gives 0.14).

export const NIGHT_RAMP_FROM_DEG = 15;
export const NIGHT_RAMP_TO_DEG = -6;

/** The night ramp from the sine of the sun's elevation (sunDir.y in three.js world space, -sunNED.z). */
export function nightRamp(sinSunElevation: number): number {
  const el = (Math.asin(Math.max(-1, Math.min(1, sinSunElevation))) * 180) / Math.PI;
  const t = Math.min(1, Math.max(0, (NIGHT_RAMP_FROM_DEG - el) / (NIGHT_RAMP_FROM_DEG - NIGHT_RAMP_TO_DEG)));
  return t * t * (3 - 2 * t);
}
