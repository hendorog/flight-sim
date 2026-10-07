// Sky dome shader: atmosphere from the sky-view LUTs, ground below the horizon, and (for the visible
// sky only, not the environment map) the sun disc, moon, stars, Milky Way and airglow, each attenuated
// by the atmosphere's transmittance along the view ray.

import { MOON_ANGULAR_RADIUS, SCENE_UNITS_PER_LUX } from '../params';
import { ATMOSPHERE_GLSL, SKY_SAMPLING_GLSL } from './atmosphere';
import { CLOUD_SKY_GLSL } from '../cloudSky';

const f = (v: number): string => v.toExponential(6);

/** Stars per cube-map face side; ~240 000 cells, one star each, magnitudes -1.4 .. 9.4. */
const STAR_CELLS = 200;

export const SKY_DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // Rotation only: the dome is centred on whichever camera renders it.
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
}
`;

const CELESTIAL_GLSL = /* glsl */ `
uniform vec3 uSunDiscRadiance;
uniform vec3 uMoonRadiance;
uniform vec3 uCelestialPole;
uniform mat3 uWorldToEquatorial;
uniform float uPixelAngle;
uniform float uNight;
uniform float uTime;

const float MOON_ANGULAR_RADIUS = ${f(MOON_ANGULAR_RADIUS)};
/** Earthshine on the unlit part of the moon, relative to full-moon radiance (~1e-4, Danjon). */
const float EARTHSHINE = 1.5e-4;
/** Illuminance of a magnitude-0 star, 2.54e-6 lux, in scene units. */
const float STAR_E0 = ${f(2.54e-6 * SCENE_UNITS_PER_LUX)};
const float STAR_CELLS = ${STAR_CELLS}.0;
/** Brightest magnitude + 2 log10(cell count): N(<m) grows ~x3.2 per magnitude (Allen). */
const float STAR_MAG_LIMIT = ${(-1.4 + 2 * Math.log10(6 * STAR_CELLS * STAR_CELLS)).toFixed(3)};
/** Milky Way peak surface brightness ~5e-4 cd/m^2; airglow ~1.2e-4 cd/m^2 at the zenith. */
const float MILKY_WAY_LUMINANCE = ${f(5e-4 * SCENE_UNITS_PER_LUX)};
const float AIRGLOW_LUMINANCE = ${f(1.2e-4 * SCENE_UNITS_PER_LUX)};

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 random3(uvec3 v) { return vec3(pcg3d(v)) * (1.0 / 4294967295.0); }

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  uvec3 b = uvec3(ivec3(i) + 32768);
  float n000 = random3(b).x, n100 = random3(b + uvec3(1, 0, 0)).x;
  float n010 = random3(b + uvec3(0, 1, 0)).x, n110 = random3(b + uvec3(1, 1, 0)).x;
  float n001 = random3(b + uvec3(0, 0, 1)).x, n101 = random3(b + uvec3(1, 0, 1)).x;
  float n011 = random3(b + uvec3(0, 1, 1)).x, n111 = random3(b + uvec3(1, 1, 1)).x;
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * valueNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.96875;
}

// Sun: limb-darkened disc, I(mu) = mu^alpha per channel (Hestroffer & Magnan 1998), normalised so the
// disc integrates to the solar illuminance.
vec3 sunDisc(vec3 d) {
  float c = dot(d, uSunDir);
  if (c < 0.999) return vec3(0.0);
  float x = length(d - uSunDir * c) / SUN_ANGULAR_RADIUS;
  float aa = uPixelAngle / SUN_ANGULAR_RADIUS;
  float cover = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, x);
  float mu = sqrt(max(1e-4, 1.0 - x * x));
  vec3 alpha = vec3(0.397, 0.503, 0.652);
  return uSunDiscRadiance * pow(vec3(mu), alpha) * (alpha + 2.0) * 0.5 * cover;
}

// Moon: a sphere lit by the sun (so phase and terminator orientation are exact) with the
// Lommel-Seeliger law of lunar regolith, procedural maria, and earthshine on the dark side.
vec3 moonDisc(vec3 d, out float cover) {
  cover = 0.0;
  float c = dot(d, uMoonDir);
  if (c < 0.999) return vec3(0.0);
  vec3 ax = normalize(cross(uCelestialPole, uMoonDir));
  vec3 ay = cross(uMoonDir, ax);
  vec2 p = vec2(dot(d, ax), dot(d, ay)) / MOON_ANGULAR_RADIUS;
  float q = dot(p, p);
  float aa = uPixelAngle / MOON_ANGULAR_RADIUS;
  cover = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, sqrt(q));
  if (cover <= 0.0) return vec3(0.0);
  float mu = sqrt(max(0.0, 1.0 - q));
  vec3 n = ax * p.x + ay * p.y - uMoonDir * mu;
  float mu0 = dot(n, uSunDir);
  float lommelSeeliger = mu0 > 0.0 ? 2.0 * mu0 / (mu0 + mu) : 0.0;
  vec3 local = vec3(p, mu);
  float maria = smoothstep(0.42, 0.62, fbm(local * 2.2 + vec3(3.1, 7.7, 1.3)));
  float albedo = mix(1.12, 0.62, maria) * (0.85 + 0.3 * fbm(local * 14.0));
  return uMoonRadiance * albedo * (lommelSeeliger + EARTHSHINE) * cover;
}

// Stars: one per cell of a cube map over the celestial sphere, drawn as a Gaussian a little under a
// pixel wide carrying the star's full flux, so they neither alias nor change brightness with zoom.
vec3 starColour(float t) {
  vec3 c = t < 0.1 ? vec3(0.65, 0.75, 1.0)
         : t < 0.3 ? vec3(0.85, 0.9, 1.0)
         : t < 0.6 ? vec3(1.0, 0.97, 0.92)
         : t < 0.85 ? vec3(1.0, 0.86, 0.68)
         : vec3(1.0, 0.72, 0.5);
  return c / dot(c, vec3(0.2126, 0.7152, 0.0722));
}
vec3 stars(vec3 e, float airmass) {
  vec3 a = abs(e);
  uint face;
  vec2 uv;
  if (a.x >= a.y && a.x >= a.z) { face = e.x > 0.0 ? 0u : 1u; uv = e.yz / a.x; }
  else if (a.y >= a.z) { face = e.y > 0.0 ? 2u : 3u; uv = e.xz / a.y; }
  else { face = e.z > 0.0 ? 4u : 5u; uv = e.xy / a.z; }
  vec2 cell = floor((uv * 0.5 + 0.5) * STAR_CELLS);
  vec3 r0 = random3(uvec3(uvec2(cell), face));
  float mag = STAR_MAG_LIMIT + 2.0 * log(max(r0.z, 1e-9)) / log(10.0);
  // Fainter stars than ~7th magnitude sit below the night-sky background even for dark-adapted eyes.
  if (mag > 7.0) return vec3(0.0);
  vec2 suv = (cell + 0.2 + 0.6 * r0.xy) / STAR_CELLS * 2.0 - 1.0;
  float s = face % 2u == 0u ? 1.0 : -1.0;
  vec3 star = face < 2u ? vec3(s, suv) : face < 4u ? vec3(suv.x, s, suv.y) : vec3(suv, s);
  vec3 dv = e - normalize(star);
  float sigma = 0.6 * uPixelAngle;
  float profile = exp(-0.5 * dot(dv, dv) / (sigma * sigma)) / (6.2831853 * sigma * sigma);
  vec3 r1 = random3(uvec3(uvec2(cell), face + 6u));
  float twinkle = 1.0 + 0.3 * min(airmass - 1.0, 3.0) * sin(uTime * (7.0 + 9.0 * r1.x) + 6.2831853 * r1.y);
  return STAR_E0 * pow(10.0, -0.4 * mag) * profile * twinkle * starColour(r1.z);
}

// Milky Way: galactic latitude band brighter toward the bulge, with dust lanes. The rotation is the
// J2000 equatorial -> galactic matrix (Hipparcos, ESA 1997), written column by column.
vec3 milkyWay(vec3 e) {
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

// Airglow: faint emission from ~90 km, brightening toward the horizon with the van Rhijn slant factor.
vec3 airglow(vec3 d) {
  float sinZ2 = 1.0 - d.y * d.y;
  float vanRhijn = 1.0 / sqrt(1.0 - 0.972 * sinZ2);
  return AIRGLOW_LUMINANCE * min(vanRhijn, 4.0) * vec3(0.75, 1.0, 0.8);
}
`;

export const SKY_DOME_FRAG = /* glsl */ `
${ATMOSPHERE_GLSL}
${SKY_SAMPLING_GLSL}
uniform vec3 uGroundRadiance;
#ifdef ENV_MAP
${CLOUD_SKY_GLSL}
// The ground right under the aircraft (rgb radiance; w = patch radius / height above it): toward the nadir
// the lower hemisphere is that surface, a few metres away (no haze), not the regional average far away.
uniform vec4 uLocalGround;
#else
${CELESTIAL_GLSL}
#endif
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  vec4 sky = skyViewRadiance(d);
#ifdef ENV_MAP
  // The environment (ambient light and reflections) includes the cloud layer.
  vec3 inscatter = sky.rgb;
  vec3 ground = rayHitsGround(uCamR, d.y) ? sky.a * uGroundRadiance : vec3(0.0);
  if (d.y < 0.0 && uLocalGround.w > 0.0) {
    // Nadir angle theta: the local patch fills tan(theta) < radius / height.
    float tanTheta = length(d.xz) / -d.y;
    float local = 1.0 - smoothstep(0.7 * uLocalGround.w, 1.3 * uLocalGround.w, tanTheta);
    inscatter *= 1.0 - local;
    ground = mix(ground, uLocalGround.rgb, local);
  }
  vec3 radiance = cloudySky(d, inscatter, ground);
#else
  vec3 radiance = sky.rgb;
  if (rayHitsGround(uCamR, d.y)) {
    radiance += sky.a * uGroundRadiance;
  }
  else {
    float moonCover;
    vec3 space = moonDisc(d, moonCover) + sunDisc(d);
    if (uNight > 0.0) {
      vec3 e = uWorldToEquatorial * d;
      float airmass = 1.0 / max(d.y, 0.05);
      space += (1.0 - moonCover) * uNight * (stars(e, airmass) + milkyWay(e) + airglow(d));
    }
    radiance += transmittanceToTop(uCamR, d.y) * space;
  }
#endif
  // Half-float headroom: the sun disc (~6e6) is clamped; bloom still sees a very bright source.
  gl_FragColor = vec4(min(radiance, vec3(60000.0)), 1.0);
}
`;
