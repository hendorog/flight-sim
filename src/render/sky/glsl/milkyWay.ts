// The Milky Way's diffuse light in the sky dome (package P2 of the night-sky plan owns this file).
//
// With the map loaded (uMilkyWayReady = 1): NASA SVS "Deep Star Maps 2020" Milky Way background (the star map
// without its Hipparcos/Tycho stars, i.e. the unresolved light of the fainter stars, Gaia DR2), plate carree in
// J2000 RA/Dec, shipped as public/sky/stars/milkyway_4k.webp (provenance and checksums in SOURCE.md next to it;
// made by scripts/sky/milkyway-build.sh). Whatever else the map holds (M31 as a faint smudge in Andromeda; the
// Magellanic Clouds never rise at 46.5 N) comes with it.
// Until it loads (node tests, the first frames, a failed fetch): an analytic galactic-latitude band brighter toward
// the bulge, with dust lanes. The rotation is the J2000 equatorial -> galactic matrix (Hipparcos, ESA 1997),
// written column by column.
//
// The map is normalised so its 2 deg-smoothed peak (the Large Sagittarius Star Cloud, ~4.8 deg from Sgr A*, whose
// own light is hidden by dust) has MILKY_WAY_LUMINANCE: the physical target is unchanged; presentation is
// NightLook's uDiffuseGain, applied by nightSky().

import { SCENE_UNITS_PER_LUX } from '../params';

const f = (v: number): string => v.toExponential(6);

/** Milky Way peak surface brightness, cd/m^2 (~5e-4). */
export const MILKY_WAY_LUMINANCE_CDM2 = 5e-4;

/**
 * Constants printed by scripts/sky/milkyway-build.sh for public/sky/stars/milkyway_4k.webp (4096x2048, WebP q75;
 * encoding v = sRGB_OETF(rgb / L_REF), decoded by the GPU as SRGBColorSpace so mipmaps filter in linear light).
 * Map units are the EXR's linear values (0..1). All measured on the decoded 8-bit file.
 */
export const MILKY_WAY_MAP = {
  width: 4096,
  height: 2048,
  /** Linear map value of a texel at 1.0: the map's 99.99th luminance percentile (agent choice: keeps the bulge's structure, clips single pixels). */
  lRef: 0.713126,
  /** Peak of the map's luminance smoothed with a 2 deg (sigma) Gaussian, map units ... */
  peak2deg: 0.475504,
  /** ... and where it is: image row from the top / height, column / width (texel centres). */
  peakRowFromTop: 0.661133,
  peakColumn: 0.744629,
  /** Mean luminance over the sphere (solid-angle weighted), map units. */
  mean: 0.0274334,
  /** Pole of the great circle best fitting the bright band (luminance-weighted, SVS's RA/Dec convention), deg. */
  bandPoleRaDeg: 194.644,
  bandPoleDecDeg: 25.726,
  /** Mean luminance at |b| < 3 deg over mean at |b| > 30 deg, b from EQ_TO_GAL. */
  bandContrast: 11.85,
} as const;

/**
 * Equatorial (J2000) -> galactic rotation, row-major: rows are the galactic x (toward the centre), y (toward
 * l = 90 deg) and z (north galactic pole) axes in equatorial coordinates (Hipparcos, ESA 1997). The GLSL mat3 below
 * holds the same numbers column by column.
 */
export const EQ_TO_GAL: readonly (readonly [number, number, number])[] = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762],
];

/**
 * TS mirror of the shader's map lookup: texture (u, v) of a J2000 direction (RA/Dec, rad). The map is "centered at
 * 0h right ascension, and r.a. increases to the left" (SVS); the texture is loaded with flipY, so v = 1 is the
 * image's top row (Dec +90).
 */
export function milkyWayUv(ra: number, dec: number): [number, number] {
  const u = 0.5 - ra / (2 * Math.PI);
  return [u - Math.floor(u), 0.5 + dec / Math.PI];
}

/** Mip level of the map that steers the filler stars' density: 64x32 texels, ~6 deg (agent choice). */
const FILLER_DENSITY_LOD = 6;

export const MILKY_WAY_GLSL = /* glsl */ `
uniform sampler2D tMilkyWay;
uniform float uMilkyWayReady;
/** Milky Way peak surface brightness ~5e-4 cd/m^2. */
const float MILKY_WAY_LUMINANCE = ${f(MILKY_WAY_LUMINANCE_CDM2 * SCENE_UNITS_PER_LUX)};
/** Decoded texel (linear, 0..1) -> scene radiance: L_REF map units, the 2 deg peak at MILKY_WAY_LUMINANCE. */
const float MILKY_WAY_MAP_SCALE = ${f((MILKY_WAY_MAP.lRef * MILKY_WAY_LUMINANCE_CDM2 * SCENE_UNITS_PER_LUX) / MILKY_WAY_MAP.peak2deg)};
/** Decoded texel luminance -> multiple of the map's mean. */
const float MILKY_WAY_MAP_REL = ${f(MILKY_WAY_MAP.lRef / MILKY_WAY_MAP.mean)};

vec2 milkyWayUv(vec3 e) {
  return vec2(fract(0.5 - atan(e.y, e.x) / 6.2831853), 0.5 + asin(clamp(e.z, -1.0, 1.0)) / 3.14159265);
}

// Local brightness of the map relative to its mean over the sky, smoothed over ~6 deg (1 without the map): the
// faint filler stars of stars.ts crowd toward the band with it.
float milkyWayDensity(vec3 e) {
  if (uMilkyWayReady < 0.5) return 1.0;
  vec3 c = textureLod(tMilkyWay, milkyWayUv(e), ${FILLER_DENSITY_LOD}.0).rgb;
  return dot(c, vec3(0.2126, 0.7152, 0.0722)) * MILKY_WAY_MAP_REL;
}

vec3 milkyWay(vec3 e) {
  if (uMilkyWayReady > 0.5) {
    // Analytic gradients (one pixel's angle along u and v), not screen derivatives: this runs in non-uniform
    // control flow (sky pixels only), and the u seam at RA 12h then needs no special case (wrapS = Repeat).
    vec2 uv = milkyWayUv(e);
    float cosDec = sqrt(max(1.0 - e.z * e.z, 1e-6));
    vec2 du = vec2(min(uPixelAngle / (6.2831853 * cosDec), 1.0), 0.0);
    vec2 dv = vec2(0.0, uPixelAngle / 3.14159265);
    return textureGrad(tMilkyWay, uv, du, dv).rgb * MILKY_WAY_MAP_SCALE;
  }
  const mat3 EQ_TO_GAL = mat3(
    -0.0548755604, 0.4941094279, -0.8676661490,
    -0.8734370902, -0.4448296300, -0.1980763734,
    -0.4838350155, 0.7469822445, 0.4559837762);
  vec3 g = EQ_TO_GAL * e;
  float b = asin(clamp(g.z, -1.0, 1.0));
  float l = atan(g.y, g.x);
  float disc = exp(-0.5 * b * b / (0.12 * 0.12));
  float bulge = exp(-0.5 * l * l / (0.45 * 0.45)) * exp(-0.5 * b * b / (0.2 * 0.2));
  float clumps = 0.55 + 0.9 * fbm(g * 9.0);
  float dust = 1.0 - 0.75 * smoothstep(0.45, 0.7, fbm(g * 5.0 + 11.0)) * exp(-0.5 * b * b / (0.05 * 0.05));
  return MILKY_WAY_LUMINANCE * (0.35 * disc + 0.65 * bulge) * clumps * dust * vec3(1.0, 0.94, 0.84);
}
`;
