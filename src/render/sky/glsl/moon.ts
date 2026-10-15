// The Moon disc of the visible sky dome (package P1 of the night-sky plan owns this file).
//
// A sphere lit by the sun (so phase and terminator orientation are exact) with the Lommel-Seeliger law of
// lunar regolith, the NASA SVS CGI Moon Kit colour map (LRO LROC WAC mosaic, public/sky/moon/SOURCE.md) or,
// until it has loaded, procedural maria, and earthshine on the dark side. Its uniforms are made and updated by
// ../moon.ts (MoonModel), which also explains the size, the night display cap and the cinematic earthshine and
// aureole; uMoonAngularRadius is the APPARENT radius (size setting and horizon growth included), which the star
// layer also reads to hide stars behind the disc.
//
// Map orientation (no libration; lunar axis along celestial north): on the disc, x = dot(d, ax) toward celestial
// east and y = dot(d, ay) toward celestial north, in units of the radius; the sub-Earth point (0, 0) is at the
// centre, lunar north is +y and lunar east (+longitude) is -x (celestial west). moon.ts moonSurfaceLatLon /
// moonTexCoord mirror this and are unit-tested (Imbrium upper left and Tycho lower centre for a Moon due south).

import { MOON_AUREOLE_RADII } from '../params';

/** The map's disc-weighted mean near-side linear luminance (scripts/sky/moon-albedo.py on lroc_color_2k.jpg). */
const MOON_MAP_NEAR_SIDE_MEAN = 0.39681;

export const MOON_GLSL = /* glsl */ `
uniform vec3 uMoonRadiance;
uniform float uMoonAngularRadius;
uniform sampler2D uMoonMap;
uniform float uMoonMapReady;
uniform vec4 uMoonLook;

const float MOON_MAP_INV_MEAN = ${(1 / MOON_MAP_NEAR_SIDE_MEAN).toFixed(6)};
/** The map's own colour kept at half strength (MOON_TINT already carries the Moon's colour; agent choice). */
const float MOON_MAP_SATURATION = 0.5;
const float MOON_AUREOLE_RADII = ${MOON_AUREOLE_RADII.toFixed(1)};
/** Earthshine is sunlight reflected by the Earth's oceans and clouds: slightly blue (agent choice). */
const vec3 EARTHSHINE_TINT = vec3(0.86, 0.98, 1.22);
const float MOON_INV_TWO_PI = 0.15915494;
const float MOON_INV_PI = 0.31830989;

// Relative albedo (mean 1 over the near side as seen at full Moon) at disc point p (|p| <= 1), mu = sqrt(1 - |p|^2).
vec3 moonAlbedo(vec2 p, float mu) {
  if (uMoonMapReady > 0.5) {
    float cl = sqrt(max(0.0, 1.0 - p.y * p.y));
    vec2 uv = vec2(0.5 + atan(-p.x, max(mu, 1e-5)) * MOON_INV_TWO_PI, 0.5 + asin(clamp(p.y, -1.0, 1.0)) * MOON_INV_PI);
    // Analytic gradients (the disc's early-outs leave screen-space derivatives undefined at its rim): one pixel
    // spans e disc radii; d(lon)/dx = -1/mu, d(lon)/dy = -x y / (mu cl^2), d(lat)/dy = 1/cl.
    float e = uPixelAngle / uMoonAngularRadius;
    float m = max(mu, 0.03);
    float c = max(cl, 0.03);
    vec2 gx = e * vec2(-MOON_INV_TWO_PI / m, 0.0);
    vec2 gy = e * vec2(-p.x * p.y / (m * c * c) * MOON_INV_TWO_PI, MOON_INV_PI / c);
    vec3 a = textureGrad(uMoonMap, uv, gx, gy).rgb;
    float l = dot(a, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(l), a, MOON_MAP_SATURATION) * MOON_MAP_INV_MEAN;
  }
  vec3 local = vec3(p, mu);
  float maria = smoothstep(0.42, 0.62, fbm(local * 2.2 + vec3(3.1, 7.7, 1.3)));
  return vec3(mix(1.12, 0.62, maria) * (0.85 + 0.3 * fbm(local * 14.0)));
}

vec3 moonDisc(vec3 d, out float cover) {
  cover = 0.0;
  float r = uMoonAngularRadius;
  float c = dot(d, uMoonDir);
  if (c < cos(r * MOON_AUREOLE_RADII + uPixelAngle)) return vec3(0.0);
  vec3 ax = normalize(cross(uCelestialPole, uMoonDir));
  vec3 ay = cross(uMoonDir, ax);
  vec2 p = vec2(dot(d, ax), dot(d, ay)) / r;
  float x = length(p);
  // Limb anti-aliasing: +-1 px, widened to +-1.5 px at night (agent choice, night-sky review round 2: the large
  // horizon Moon's limb read hard), unchanged by day.
  float aa = uPixelAngle / r * mix(1.0, 1.5, uNight);
  cover = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, x);
  // Night display cap (moon.ts moonDisplayScale): one scale for the whole disc; gated by uNight (0 with the sun
  // above +5.7 deg), so it is 1 by day (a dim overcast day's exposure would otherwise cap it and add the night
  // styling) and without a known exposure.
  float k = uExposureValid > 0.5 ? mix(1.0, min(1.0, uMoonLook.x / sceneExposure()), uNight) : 1.0;
  float night = 1.0 - k;
  vec3 moon = vec3(0.0);
  if (cover > 0.0) {
    vec2 ps = x > 1.0 ? p / x : p;
    float mu = sqrt(max(0.0, 1.0 - dot(ps, ps)));
    vec3 n = ax * ps.x + ay * ps.y - uMoonDir * mu;
    float mu0 = dot(n, uSunDir);
    float lommelSeeliger = mu0 > 0.0 ? 2.0 * mu0 / (mu0 + mu) : 0.0;
    vec3 earthshine = mix(uMoonLook.y, uMoonLook.z, night) * mix(vec3(1.0), EARTHSHINE_TINT, night);
    moon = uMoonRadiance * k * moonAlbedo(ps, mu) * (lommelSeeliger + earthshine) * cover;
  }
  // Aureole (cinematic, night only): 1/theta^3 from the limb, reaching 0 at MOON_AUREOLE_RADII. It is light
  // scattered in the atmosphere, in front of the Moon, so it lies over the disc too (at its limb value): a crescent's
  // dark side and the sliver of a just-past-full Moon then join the aureole without a dark ring at the limb.
  if (night > 0.0) {
    float t = max(x, 1.0);
    const float tail = 1.0 / (MOON_AUREOLE_RADII * MOON_AUREOLE_RADII * MOON_AUREOLE_RADII);
    float halo = max(0.0, 1.0 / (t * t * t) - tail) / (1.0 - tail);
    moon += uMoonRadiance * (k * uMoonLook.w * night * halo);
  }
  return moon;
}
`;
