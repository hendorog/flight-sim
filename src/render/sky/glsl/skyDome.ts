// Sky dome shader: atmosphere from the sky-view LUTs, ground below the horizon, and (for the visible
// sky only, not the environment map) the sun disc, moon, stars, Milky Way and airglow, each attenuated
// by the atmosphere's transmittance along the view ray.

import { ATMOSPHERE_GLSL, SKY_SAMPLING_GLSL } from './atmosphere';
import { CLOUD_SKY_GLSL } from '../cloudSky';
import { MILKY_WAY_GLSL } from './milkyWay';
import { MOON_GLSL } from './moon';
import { NIGHT_SKY_GLSL } from './nightSky';
import { PLANETS_GLSL } from './planets';
import { SKY_COMMON_GLSL } from './skyCommon';
import { STARS_GLSL } from './stars';

export const SKY_DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // Rotation only: the dome is centred on whichever camera renders it.
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
}
`;

// The celestial modules, in dependency order. Each package of the night-sky plan owns its own module; this file
// (the composition and main()) is frozen: see the plan's interface section before changing it.
const CELESTIAL_GLSL = /* glsl */ `
uniform vec3 uSunDiscRadiance;
${SKY_COMMON_GLSL}

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
${MOON_GLSL}
${STARS_GLSL}
${MILKY_WAY_GLSL}
${PLANETS_GLSL}
${NIGHT_SKY_GLSL}
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
  // Alpha: 1, or minus the planets' share of the pixel's light (the tone map's point-source flag, post/ToneMap.ts).
  float outAlpha = 1.0;
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
    vec3 point;
    vec3 space = moonDisc(d, moonCover) + sunDisc(d);
    space += nightSky(d, moonCover, point);
    vec3 t = transmittanceToTop(uCamR, d.y);
    radiance += t * space;
    float pl = dot(t * point, vec3(0.2126, 0.7152, 0.0722));
    if (pl > 0.0) outAlpha = -min(pl / max(dot(radiance, vec3(0.2126, 0.7152, 0.0722)), 1e-30), 1.0);
  }
#endif
  // Half-float headroom: the sun disc (~6e6) is clamped; bloom still sees a very bright source.
  gl_FragColor = vec4(min(radiance, vec3(60000.0)), outAlpha);
}
`;
