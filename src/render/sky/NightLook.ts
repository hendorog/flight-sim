// The night sky's presentation (package P3 of the night-sky plan owns this file and glsl/nightSky.ts): the
// gains that make the stars and the Milky Way read as a dark-adapted eye sees them at a dark site.
//
// Every radiance in the sky stays physical; this only scales how the night sky's own terms are presented. The
// look ("a dark-adapted eye at a dark site") and every number below are AGENT choices of the night-sky plan, not
// owner decisions.
//
// Why (measured on main, moonless cruise frame doy 186 tod 23.5 looking at the galactic centre, 1600x900):
// the eye's adaptation is already at its darkest (adapted 5.0e-5 cd/m^2, reference 5.7e-5, the key at its
// -4.5 EV floor); the Milky Way's core renders at its physical 4.5-5.3e-4 cd/m^2 (sRGB ~63-80), but the
// background, which is almost all airglow (1.2e-4 cd/m^2 at the zenith, ~1.9e-4 at 30 deg with the van Rhijn
// slant), sits at 1.9e-4 cd/m^2 = sRGB 30-48, grey-green after the Purkinje shift. A 3:1 contrast reads as a
// grey haze. Raising the exposure or every gain alike cannot fix it (auto-exposure meters the sky back), so the
// presentation changes the CONTRAST: the airglow is presented darker (the eye, adapted to a dark sky, sees its
// background as near-black), the Milky Way and the stars brighter.
//
// Darkness D (0..1) comes from the outdoor light the eye adapts to: the luminance of an 18 % grey card under the
// moon, the sky and starlight (the PostPipeline's exposure reference without the cockpit lamps or floodlights:
// the sky looks the same whichever view it is seen from; the lamps lower its display brightness through the
// exposure anyway). D = 1 below DARK_LEVEL (a moonless night, ~5.7e-5 cd/m^2), 0 above BRIGHT_LEVEL (a full
// Moon ~15 deg up, ~2.6e-3; a high winter full Moon ~1e-2; twilight and day far above), smoothstep in log
// between. With D = 0 every gain is exactly 1: frames lit by the sun, twilight, or a bright Moon are unchanged.
//
// Interface (frozen by the scaffold; see the plan): `uniforms` is spread into the sky dome's uniforms (the star
// layer in StarField reads uStarGain too, the one gain for ALL stars); update() runs once per frame from
// SkyDome.update, after SkySystem has published ctx.sky.

import type { SimContext } from '../../core/context';
import type { Atmosphere } from './Atmosphere';
import { SCENE_UNITS_PER_LUX } from './params';

/** Starlight + airglow illuminance on a moonless night, ~1e-3 lux (as the PostPipeline's exposure reference). */
const NIGHT_SKY_ILLUMINANCE = 1e-3 * SCENE_UNITS_PER_LUX;

/** Grey-card luminance (cd/m^2) at and below which the night is fully dark (D = 1). Agent choice. */
export const DARK_LEVEL = 1.5e-4;
/** Grey-card luminance (cd/m^2) at and above which the sky is presented photometrically (D = 0). Agent choice. */
export const BRIGHT_LEVEL = 2.5e-3;

/**
 * Gains at full darkness (agent choices; retune here once the catalogue stars and the Milky Way map land):
 *  - STAR_GAIN: stars and planets (all point sources; P2's catalogue layer reads the same uniform).
 *  - MILKY_WAY_GAIN: the Milky Way's diffuse light (uDiffuseGain).
 *  - AIRGLOW_GAIN: the airglow background (< 1: the dark-adapted eye's black sky; see the header).
 */
export const STAR_GAIN = 1.5;
export const MILKY_WAY_GAIN = 2.2;
export const AIRGLOW_GAIN = 0.3;

/** Darkness of the night, 0 (bright) .. 1 (moonless), from the outdoor grey-card luminance in cd/m^2. */
export function nightDarkness(greyCardCdm2: number): number {
  if (!(greyCardCdm2 > 0)) return 1;
  const t = (Math.log10(greyCardCdm2) - Math.log10(DARK_LEVEL)) / (Math.log10(BRIGHT_LEVEL) - Math.log10(DARK_LEVEL));
  const x = Math.min(1, Math.max(0, t));
  return 1 - x * x * (3 - 2 * x);
}

export interface NightGains {
  star: number;
  diffuse: number;
  airglow: number;
}

/** The presentation gains at darkness `d` (exactly 1 at d = 0). */
export function nightGains(d: number, out: NightGains = { star: 1, diffuse: 1, airglow: 1 }): NightGains {
  out.star = 1 + (STAR_GAIN - 1) * d;
  out.diffuse = 1 + (MILKY_WAY_GAIN - 1) * d;
  out.airglow = 1 + (AIRGLOW_GAIN - 1) * d;
  return out;
}

const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Luminance (cd/m^2) of an 18 % grey card under the outdoor light: direct sun and moon through the cloud layer,
 * the sky, and the night sky's own light (the PostPipeline's reference without lamps).
 */
export function outdoorGreyCard(ctx: SimContext, atmosphere: Atmosphere): number {
  const { sunColor, skyColor, sunDir, moonDir } = ctx.sky;
  const m = atmosphere.moonIlluminance;
  const direct = (lum(sunColor.r, sunColor.g, sunColor.b) * Math.max(sunDir.y, 0) + m.y * Math.max(moonDir.y, 0)) * atmosphere.cloudSky.directCamera;
  return (0.18 * ((direct + NIGHT_SKY_ILLUMINANCE) / Math.PI + lum(skyColor.r, skyColor.g, skyColor.b))) / SCENE_UNITS_PER_LUX;
}

export class NightLook {
  readonly uniforms = {
    /** Presentation gain of point sources (stars, planets); 1 = photometric. */
    uStarGain: { value: 1 },
    /** Presentation gain of diffuse night light (the Milky Way); 1 = photometric. */
    uDiffuseGain: { value: 1 },
    /** Presentation gain of the airglow background (glsl/nightSky.ts only); 1 = photometric. */
    uAirglowGain: { value: 1 },
  };
  /** This frame's darkness (0..1), for tools. */
  darkness = 0;
  private readonly gains: NightGains = { star: 1, diffuse: 1, airglow: 1 };

  update(ctx: SimContext, atmosphere: Atmosphere): void {
    this.darkness = nightDarkness(outdoorGreyCard(ctx, atmosphere));
    const g = nightGains(this.darkness, this.gains);
    this.uniforms.uStarGain.value = g.star;
    this.uniforms.uDiffuseGain.value = g.diffuse;
    this.uniforms.uAirglowGain.value = g.airglow;
  }
}
