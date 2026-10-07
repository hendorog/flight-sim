// Final display transform: bloom mix, exposure, mesopic/scotopic shift, AgX tone mapping, sRGB
// encoding and dithering.

import { SCENE_UNITS_PER_LUX } from '../sky/params';
import { EXPOSURE_GLSL } from './AutoExposure';
import { LOCAL_EXPOSURE_GLSL } from './LocalExposure';

export const TONEMAP_FRAG = /* glsl */ `
${EXPOSURE_GLSL}
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloomWeight;
uniform float uBloomScale;
uniform vec2 uTanHalf;
uniform vec3 uSunView;
uniform vec2 uSunUv;
uniform vec2 uSunTap;
uniform vec3 uSunGlare;
uniform float uSunExpected;
uniform vec3 uWhiteBalance;
varying vec2 vUv;
${LOCAL_EXPOSURE_GLSL}

// Veiling glare of the sun in the eye (Stiles-Holladay: L = 10 E / theta^2, L in cd/m^2, E in lux,
// theta in degrees), scaled by how much of the disc is visible in the frame (so terrain, the airframe
// and clouds hide it). Visibility is measured as the disc's excess over its surroundings: the mean of
// 3x3 taps inside the disc minus the brightest of 8 taps on a ring at 3 disc radii, relative to what an
// unobstructed disc adds. A bright cloud in front of the sun (forward scattering, silver lining) is
// as bright inside the disc as around it, so it counts as hiding the sun; thin cloud or haze that dims
// the disc gives a proportionally weaker glare.
float sunLum(vec2 p, inout float n) {
  if (any(lessThan(p, vec2(0.0))) || any(greaterThan(p, vec2(1.0)))) return 0.0;
  n += 1.0;
  return dot(texture2D(tScene, p).rgb, vec3(0.2126, 0.7152, 0.0722));
}
vec3 sunGlare() {
  float inner = 0.0, nInner = 0.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) inner += sunLum(uSunUv + vec2(i, j) * uSunTap, nInner);
  }
  float outer = 0.0, nOuter = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.785398;
    float n0 = nOuter;
    float l = sunLum(uSunUv + vec2(cos(a), sin(a)) * uSunTap * (3.0 / 0.7), nOuter);
    if (nOuter > n0) outer = max(outer, l);
  }
  if (nInner <= 0.0) return vec3(0.0);
  // Taps off-screen count as hidden (the disc is partly outside the frame).
  float excess = inner / 9.0 - outer * (nInner / 9.0);
  float visible = smoothstep(0.1, 0.9, excess / max(uSunExpected - outer, 1e-3 * uSunExpected));
  vec3 v = normalize(vec3((vUv * 2.0 - 1.0) * uTanHalf, -1.0));
  float theta = degrees(acos(clamp(dot(v, uSunView), -1.0, 1.0)));
  return uSunGlare * visible / max(theta * theta, 0.25);
}

// AgX (Troy Sobotka), polynomial sigmoid fit by Benjamin Wrensch; matrices as in three.js r186 for
// linear-sRGB input, with extra saturation (1.3) in AgX log space.
// The log2 -> [0,1] shaper is split at middle grey. Below it, the log range starts at -10.88 as in round 1
// (0.18 -> ~127/255, deep shadows unchanged). Above it the reference AgX range (+4.03) reaches display
// white 6.5 EV over middle grey, so diffuse white (0.9, 2.3 EV over grey) sat at ~209 and sunlit cumulus
// and white paint read light grey. A camera's JPEG curve puts diffuse white at ~235-245 and rolls off
// only in the last 1-2 EV. So above grey the shaper keeps the slope it has at grey (no crease in sky
// gradients) and curves up quadratically to reach 1 at +1.2 (3.7 EV over grey): 0.4 -> 177, 0.9 -> 226,
// 1.2 -> 238, 2 -> 251 (sRGB, neutral). Measured: sunlit cumulus and white paint 225-245 at noon.
const float AGX_MIN_EV = -10.88;
const float AGX_GREY_EV = -2.4739312;   // log2(0.18)
const float AGX_MAX_EV = 1.2;
float agxShaper(float x) {
  const float x0 = (AGX_GREY_EV - AGX_MIN_EV) / (3.0 - AGX_MIN_EV);   // grey's position, as before (0.606)
  const float slope = x0 / (AGX_GREY_EV - AGX_MIN_EV);
  const float span = AGX_MAX_EV - AGX_GREY_EV;
  const float curve = (1.0 - x0 - slope * span) / (span * span);
  float d = x - AGX_GREY_EV;
  return d < 0.0 ? x0 + slope * d : x0 + slope * d + curve * d * d;
}
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 c) {
  const mat3 SRGB_TO_REC2020 = mat3(0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956);
  const mat3 REC2020_TO_SRGB = mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187);
  const mat3 INSET = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859);
  const mat3 OUTSET = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
  c = INSET * (SRGB_TO_REC2020 * c);
  c = log2(max(c, 1e-10));
  c = clamp(vec3(agxShaper(c.r), agxShaper(c.g), agxShaper(c.b)), 0.0, 1.0);
  c = agxContrast(c);
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(vec3(0.0), luma + 1.3 * (c - luma));
  c = OUTSET * c;
  c = pow(max(vec3(0.0), c), vec3(2.2));
  return clamp(REC2020_TO_SRGB * c, 0.0, 1.0);
}

vec3 srgbEncode(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  c = any(isnan(c)) || any(isinf(c)) ? vec3(0.0) : clamp(c, vec3(0.0), vec3(60000.0));
  // Energy-conserving bloom: the blur replaces a fraction of the image instead of adding to it.
  c = c * (1.0 - uBloomWeight) + texture2D(tBloom, vUv).rgb * uBloomScale;
  if (uSunExpected > 0.0) c += sunGlare();

  // Partial chromatic adaptation to the ambient illuminant (von Kries gains, computed on the CPU).
  c *= uWhiteBalance;

  // Rod vision: below ~3 cd/m^2 colour fades and shifts toward blue (Purkinje), complete by ~0.01 cd/m^2.
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float scotopic = 1.0 - smoothstep(-2.0, 0.5, log(max(lum / ${SCENE_UNITS_PER_LUX.toExponential(6)}, 1e-9)) / log(10.0));
  c = mix(c, lum * vec3(0.78, 0.94, 1.32), 0.7 * scotopic);

  // Local adaptation around the global exposure (see LocalExposure.ts).
  float logAdapted = texture2D(tExposure, vec2(0.5)).r;
  float ev = localExposureEV(log2(max(lum, 1e-9)), logAdapted);
  c = agx(c * (sceneExposure() * exp2(ev)));
  c = srgbEncode(c);
  // Triangular dither of +-1 LSB breaks up banding in dark gradients (sky, fog).
  vec2 p = gl_FragCoord.xy;
  c += (ign(p) + ign(p + vec2(47.0, 17.0)) - 1.0) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
`;
