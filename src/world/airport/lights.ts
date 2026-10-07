// Airfield lighting as instanced HDR point sprites (one draw call for every light in the airport and valley),
// on the project's photometric scale (core/context.ts: scene radiance = cd/m^2 x SCENE_UNITS_PER_LUX).
//
// Every light is specified by its luminous intensity in candela (a night and a day setting, like the brightness
// steps of real airfield lighting), a beam pattern and the diameter of its luminous aperture. Per vertex the
// shader evaluates the intensity toward the camera, the illuminance it produces at the eye, E = I / d^2 (lux),
// and draws it as a small Gaussian core carrying that energy:
//   - when the lens is resolved (close up) the core has the lens's real luminance I / A;
//   - when it is not (a sub-pixel point) the core is at most 1 pixel-ish wide, and its peak luminance is raised
//     toward what the eye would see through its own ~1 arc-minute (FWHM) point spread (a display pixel is several
//     times larger than that), up to 32x the pixel-averaged value by day (10x at night). This is what keeps a
//     daylight PAPI or a 5 NM final readable.
//   - by day a core that would tone map toward white is spread a little wider (at most about its own pixel
//     footprint), and whatever still exceeds the colour cap is clamped with its hue kept, so red and green signal
//     lights stay small saturated points (AgX desaturates bright reds to salmon and pink);
//   - the core sprite is pulled toward the camera far enough to clear the ground plane in front of the lamp, so a
//     low lamp seen at a grazing angle is not cut in half by the ground it stands on.
//   - a veiling-glare halo L = GLARE * E / theta^2 (theta in degrees; Stiles-Holladay form) around it, sized from
//     an estimate of the post chain's exposure so it is only as wide as it is visible.
// Auto exposure, bloom and aerial perspective in the post chain do the rest.
//
// Directional behaviour is evaluated per vertex against the camera position:
//   BIDIRECTIONAL  colour depends on which side along the runway the viewer is (edge lights turn yellow in the
//                  last 600 m, threshold lights are green from the approach and red from the runway)
//   PAPI           red below the unit's setting angle, white above (3 arc-minute transition), visible only in
//                  the approach sector
//   BEACON         two beams 180 degrees apart (white and green) rotating at 12 rpm = 24 flashes a minute
//   CUTOFF         downward-aimed floodlight / street light: bright from below, only a faint glow from above
// plus an optional beam (main-beam azimuth / elevation spread with an all-round floor) and flashing
// (sequenced flashers, REIL strobes) for any kind.

import * as THREE from 'three';
import { SCENE_UNITS_PER_LUX } from '../../core/context';
import { AIRPORT } from '../../core/world';
import { nedToThree } from '../../core/frames';
import { BEACON, BUILDINGS, FLOODLIGHTS, localToNed, PAPIS, PAVED_RECTS, pavedSD, RUNWAY_HALF_LENGTH, RUNWAY_HALF_WIDTH, TOWER } from './layout';
import type { SharedUniforms } from './shared';

export enum LightKind {
  Bidirectional = 0,
  PapiFacingLowU = 1,
  PapiFacingHighU = 2,
  Beacon = 3,
  /** Full cut-off luminaire aimed down (floodlights, street lights): glare mainly for viewers below it. */
  CutOff = 4,
}

/** Light colours (chromaticity, unit peak). The renderer normalises each to unit luminance, so a light's candela
 * value is its real luminous intensity whatever its colour (filters are accounted for in the candela values). */
export const LIGHT_COLORS = {
  runwayWhite: new THREE.Color(1.0, 0.82, 0.58), // quartz halogen, ~2850 K
  // Signal colours are kept close to the primaries: bright HDR values of a less saturated colour would
  // saturate every channel in tone mapping and read as white.
  yellow: new THREE.Color(1.0, 0.42, 0.0),
  green: new THREE.Color(0.0, 1.0, 0.45),
  red: new THREE.Color(1.0, 0.004, 0.0),
  blue: new THREE.Color(0.03, 0.12, 1.0),
  papiWhite: new THREE.Color(1.0, 0.88, 0.7),
  flood: new THREE.Color(1.0, 0.9, 0.78),
  strobe: new THREE.Color(0.9, 0.95, 1.0),
  sodium: new THREE.Color(1.0, 0.36, 0.04), // high-pressure sodium, ~2000 K
  led4000: new THREE.Color(1.0, 0.8, 0.6), // 4000 K LED street / area lighting
  metalHalide: new THREE.Color(1.0, 0.9, 0.8), // commercial forecourt / car-park lighting, ~4200 K
  window: new THREE.Color(1.0, 0.72, 0.42),
} as const;

/** Main-beam pattern. Intensity = cd * (floor + (1 - floor) * azimuth term * elevation term). */
export interface Beam {
  /** Beam axis in the airport frame: +1 toward +u, -1 toward -u, 2 both ways along u, 0 all round. */
  axis: -1 | 0 | 1 | 2;
  /** Gaussian azimuth spread (sigma), rad. Ignored for axis 0. */
  azSigma: number;
  /** Full intensity from the horizon up to this elevation angle, rad ... */
  elTop: number;
  /** ... then a Gaussian fall-off of this sigma above it, rad. */
  elSigma: number;
  /** Fraction of the peak intensity emitted outside the main beam (all round). */
  floor: number;
}

export interface LightSpec {
  /** World position (three.js coordinates). */
  position: THREE.Vector3;
  /** Colour seen from lower u (or the only colour; PAPI: red; beacon: first beam). */
  colorA: THREE.Color;
  /** Colour seen from higher u (PAPI: white; beacon: second beam). Defaults to colorA. */
  colorB?: THREE.Color;
  /** Intensity of colour B relative to colour A (e.g. a PAPI's red filter passes ~20 % of its white). Default 1. */
  gainB?: number;
  /** Diameter of the luminous aperture (lens), m. */
  lens: number;
  /** Peak luminous intensity at night, candela (colour A). */
  cd: number;
  /** Peak luminous intensity by day, candela (0 = off by day). */
  cdDay: number;
  kind?: LightKind;
  /** PAPI: setting angle (rad). CutOff: fraction of the intensity still seen from above or level (0..1). */
  param?: number;
  beam?: Beam;
  /** Flashing light: on for `duration` seconds every `period` seconds, starting at `phase` seconds. */
  flash?: { period: number; phase: number; duration: number };
  /** Runway-class light whose day intensity follows the visibility brightness step (uDayStep; see dayBrightnessStep). */
  daySteps?: boolean;
  /** Height of the lamp above the ground below it, m. Defaults to its height above the field elevation. */
  height?: number;
}

/** Airport-local (u, v, height above field) to a world position. */
export function localToWorld(u: number, v: number, h: number, out = new THREE.Vector3()): THREE.Vector3 {
  const n = localToNed(u, v);
  return nedToThree({ x: n.north, y: n.east, z: -(AIRPORT.elevation + h) }, out);
}

const DEG = Math.PI / 180;
/**
 * Effective solid angle of the eye's foveal point-spread core, sr: a Gaussian of 1 arc-minute FWHM (a 3 mm pupil is
 * diffraction limited to ~0.65', ocular aberrations bring it to ~1'), i.e. 2 pi sigma^2 with sigma = 1' / 2.355.
 */
const OMEGA_EYE = 2 * Math.PI * (DEG / 60 / 2.355) ** 2;
/**
 * Largest factor by which the drawn core's energy may exceed the pixel-averaged value (see header), by day and at
 * night. By day a lamp must reach the eye's peak contrast against a bright background to be seen at all; at night
 * every lamp is far above threshold anyway and the extra energy would only feed bloom, so the boost stays small.
 */
const MAX_BOOST_DAY = 32;
const MAX_BOOST_NIGHT = 10;
/**
 * Exposed (display-referred) luminance above which a strongly coloured core is spread wider instead of brighter by
 * day. AgX drives any colour toward white as it approaches display white; a red signal light exposed above ~0.15
 * already reads pink. Spreading the same energy over a wider core keeps it saturated (and it is what the eye's
 * own scatter does with a bright point).
 */
const COLOR_CAP = 0.12;
/** Same for near-white lights (only spreads what would be clipped anyway). */
const WHITE_CAP = 4;
/**
 * Largest core widening by day (sigma factor); none at night, where the glare halo does the spreading. Kept to about
 * the lamp's own pixel footprint: a daylight signal light a few hundred metres away is a small point, not a disc.
 * Whatever energy still exceeds the colour cap is dropped (a hue-preserving clamp, see CLAMP_OVER_CAP).
 */
const MAX_WIDEN = 1.5;
/**
 * A coloured core is clamped at this multiple of its colour cap (exposed value), keeping its hue: the display
 * cannot show the lamp's real luminance anyway, and letting it through only turns a red signal pink or salmon.
 * Measured through the real post chain (AgX): a PAPI red core peaks at about (225, 80, 45) at this setting, against
 * (255, 135, 95) at 1.6x the cap.
 */
const CLAMP_OVER_CAP = 0.6;
/** At night the clamp is this much higher (the dark surround lets a signal light run brighter before it bleaches). */
const NIGHT_CLAMP_GAIN = 3;
/** Veiling-glare coefficient: halo luminance = GLARE * E / theta_deg^2 (the eye's is ~10; kept low for a display). */
const GLARE = 1.5;
/** Largest glare halo radius, degrees. */
const MAX_HALO_DEG = 1.5;
/** Displayed value at which the halo is cut off. */
const HALO_CUTOFF = 0.008;

const f = (x: number): string => x.toExponential(6);

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 colorA;
attribute vec3 colorB;
attribute vec4 light;   // lens diameter (m), cd night, cd day, param
attribute vec4 beam;    // axis, azSigma, elTop, elSigma
attribute vec4 extra;   // kind, beam floor, gainB, 1 = runway-class light dimmed by day with uDayStep
attribute vec4 flash;   // period (0 = steady), phase, duration; lamp height above the ground below it (m)
uniform float uNight;
uniform float uTime;
uniform float uViewportH;
uniform float uMinPx;
uniform float uMaxPx;
uniform float uIntensity;
uniform float uExposure;
uniform float uDayStep;
uniform vec2 uHaze;       // sea-level haze extinction (1/m), its scale height (m)
uniform vec3 uRunwayDir;  // world direction of +u
varying vec3 vCore;
varying vec3 vHalo;
varying vec4 vShape;      // sprite radius px, 1 / core sigma^2 (px^-2), degrees per px, core radius^2 (deg^2)

void main() {
  vec3 toCam = cameraPosition - position;
  float dist = max(length(toCam), 0.05);
  float along = dot(toCam, uRunwayDir);
  float horiz = max(length(toCam.xz), 1e-3);
  float elev = atan(toCam.y, horiz);
  int k = int(extra.x + 0.5);
  float side = smoothstep(-1.0, 1.0, along);
  vec3 col = mix(colorA, colorB * extra.z, side);
  float gain = 1.0;

  // Main beam with an all-round floor.
  float axis = beam.x;
  float gAz = 1.0;
  if (axis > 1.5) {
    float az = acos(clamp(abs(along) / horiz, 0.0, 1.0));
    gAz = exp(-0.5 * az * az / (beam.y * beam.y));
  } else if (abs(axis) > 0.5) {
    float az = acos(clamp(axis * along / horiz, -1.0, 1.0));
    gAz = exp(-0.5 * az * az / (beam.y * beam.y));
  }
  float de = max(elev - beam.z, 0.0);
  float gEl = exp(-0.5 * de * de / (beam.w * beam.w));
  gain = extra.y + (1.0 - extra.y) * gAz * gEl;

  if (k == 1 || k == 2) {
    // PAPI: sharp red/white transition at the setting angle; beam about +-10 deg wide around the approach axis.
    float facing = k == 1 ? -1.0 : 1.0;
    col = mix(colorA, colorB * extra.z, smoothstep(light.w - 0.0008, light.w + 0.0008, elev));
    float cosAz = facing * along / horiz;
    float eh = max(elev - 0.14, 0.0) / 0.08;
    gain = smoothstep(0.94, 0.985, cosAz) * smoothstep(-0.02, 0.01, elev) * exp(-0.5 * eh * eh);
  } else if (k == 3) {
    // Rotating beacon: white and green beams, each ~7 deg wide, sweeping at 12 rpm; aimed a few degrees up.
    float az = atan(toCam.x, -toCam.z);
    float rot = uTime * 1.2566371;  // 12 rpm
    float dw = abs(mod(az - rot + PI, 2.0 * PI) - PI);
    float dg = abs(mod(az - rot, 2.0 * PI) - PI);
    float bw = exp(-dw * dw / 0.006), bg = exp(-dg * dg / 0.006);
    col = colorA * bw + colorB * extra.z * bg;
    float eb = (elev - 0.05) / 0.12;
    gain = (0.01 + max(bw, bg)) * exp(-0.5 * eb * eb);
    col /= max(max(bw, bg), 1e-3) + 0.01;
  } else if (k == 4) {
    float down = -toCam.y / dist;  // 1 when the viewer is straight below the lamp
    gain = mix(light.w, 1.0, smoothstep(0.05, 0.7, down));
  }
  if (flash.x > 0.0) gain *= step(mod(uTime - flash.y, flash.x), flash.z);

  float cdDay = light.z * (extra.w > 0.5 ? uDayStep : 1.0);
  float cd = uIntensity * mix(cdDay, light.y, uNight) * gain;
  if (!(cd > 0.0)) cd = 0.0;  // also catches NaN, which bloom would spread over the frame
  // Illuminance at the eye, scene units.
  float E = cd / (dist * dist) * ${f(SCENE_UNITS_PER_LUX)};

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float radPerPx = 2.0 / (projectionMatrix[1][1] * uViewportH);
  float degPerPx = radPerPx * ${f(180 / Math.PI)};
  float omegaPx = radPerPx * radPerPx;
  float lensPx = light.x / dist / radPerPx;
  float sigma = max(0.42 * lensPx, 0.7);
  float omegaLens = PI * 0.25 * light.x * light.x / (dist * dist);
  float omegaCore = 2.0 * PI * sigma * sigma * omegaPx;
  float boost = clamp(omegaCore / max(omegaLens, ${f(OMEGA_EYE)}), 1.0, mix(${f(MAX_BOOST_DAY)}, ${f(MAX_BOOST_NIGHT)}, uNight));
  float energy = E * boost;
  // By day, spread a core that would tone map toward white over a wider disc of the same energy, so signal colours
  // stay saturated (col has unit luminance; its whiteness is its smallest channel over its largest).
  float whiteness = min(min(col.r, col.g), col.b) / max(max(max(col.r, col.g), col.b), 1e-6);
  float cap = mix(${f(COLOR_CAP)}, ${f(WHITE_CAP)}, smoothstep(0.3, 0.6, whiteness));
  float widen = clamp(sqrt(energy / omegaCore * uExposure / cap), 1.0, mix(${f(MAX_WIDEN)}, 1.0, uNight));
  sigma *= widen;
  omegaCore *= widen * widen;
  // Clamp what the widening could not absorb (coloured lights only, day and night; white may clip to white): the
  // energy lost from the core is not missed at night, where the glare halo (computed from E) carries the glow.
  // Clamp to half-float range (the HDR target is RGBA16F).
  float peak = energy / omegaCore;
  float colored = 1.0 - smoothstep(0.3, 0.6, whiteness);
  // The limit applies to what reaches the display: aerial perspective in the post chain still attenuates the core,
  // so divide out the haze transmittance along the path (exponential atmosphere between lamp and camera), or a
  // signal light in mist would be clamped first and then fogged away.
  float y0 = min(position.y, cameraPosition.y), dy = abs(cameraPosition.y - position.y);
  float Hs = max(uHaze.y, 1.0);
  float hazeTau = uHaze.x * exp(-y0 / Hs) * dist * (dy > 1.0 ? Hs / dy * (1.0 - exp(-dy / Hs)) : 1.0);
  float hueLimit = ${f(CLAMP_OVER_CAP)} * mix(1.0, ${f(NIGHT_CLAMP_GAIN)}, uNight) * cap / max(uExposure, 1e-12) * exp(min(hazeTau, 6.0));
  peak = mix(peak, min(peak, hueLimit), colored);
  vCore = min(col * peak, vec3(3.0e4));
  // Glare halo, only as wide as it is visible at the current exposure.
  float haloK = ${f(GLARE)} * E;
  float haloDeg = min(sqrt(haloK * uExposure / ${f(HALO_CUTOFF)}), ${f(MAX_HALO_DEG)});
  vHalo = col * haloK;
  float coreDeg = max(sigma * degPerPx, 0.06);
#ifdef HALO_PASS
  // Glare is formed in the eye, so it overlays whatever lies near the lamp: the halo sprite is pulled halfway to
  // the camera (the ground and objects just in front of the lamp do not cut it; the cockpit still does).
  float R = min(haloDeg / degPerPx, 0.5 * uMaxPx);
  float pull = 0.5 * dist;
  bool skip = R < 2.0;
#else
  float R = clamp(max(3.0 * sigma, 0.5 * uMinPx), 1.0, 0.5 * uMaxPx);
  // The core is one flat sprite at the lamp's depth, so the ground just in front of a low lamp would cut off its
  // lower half at grazing angles. Pull it toward the camera far enough to clear the ground plane under the lamp
  // over the sprite's lower half (flat-ground estimate, at most half the distance, so objects between the camera
  // and the lamp's surroundings still hide it).
  float pull = min(0.5 * dist, light.x);
  float camAbove = cameraPosition.y - (position.y - flash.w);
  if (camAbove > 0.0) {
    float depr = atan(camAbove - flash.w, horiz);  // depression of the lamp below the camera's horizon
    float groundDist = camAbove / max(sin(depr + R * radPerPx), 1e-4);
    pull = clamp(1.05 * (dist - groundDist), pull, 0.5 * dist);
  }
  bool skip = false;
#endif
  vShape = vec4(R, 1.0 / (sigma * sigma), degPerPx, coreDeg * coreDeg);
  mv.xyz *= (dist - pull) / dist;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 2.0 * R;
  if (cd <= 0.0 || skip) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vCore;
varying vec3 vHalo;
varying vec4 vShape;
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float px2 = r2 * vShape.x * vShape.x;
#ifdef HALO_PASS
  float window = (1.0 - r2) * (1.0 - r2);
  vec3 col = vHalo * window / max(px2 * vShape.z * vShape.z, vShape.w);
#else
  vec3 col = vCore * exp(-0.5 * px2 * vShape.y);
#endif
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface LightsUniforms {
  uViewportH: THREE.IUniform<number>;
  uMinPx: THREE.IUniform<number>;
  /** Largest sprite diameter, px. */
  uMaxPx: THREE.IUniform<number>;
  /** Global multiplier on every light's intensity (1 = physical). */
  uIntensity: THREE.IUniform<number>;
  /** Estimate of the post chain's exposure (display value per scene unit), used to size glare halos and day cores. */
  uExposure: THREE.IUniform<number>;
  /** Day brightness step of runway-class lights (HIRL, threshold/end, approach lights) as a fraction of the top step. */
  uDayStep: THREE.IUniform<number>;
  /** Haze: sea-level extinction (1/m) and scale height (m), from ctx.sky. */
  uHaze: THREE.IUniform<THREE.Vector2>;
}

const luminance = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** Build one Points object from the light specs. */
export function createLightPoints(specs: LightSpec[], shared: SharedUniforms): { points: THREE.Points; uniforms: LightsUniforms } {
  const n = specs.length;
  const pos = new Float32Array(n * 3), ca = new Float32Array(n * 3), cb = new Float32Array(n * 3);
  const lp = new Float32Array(n * 4), bm = new Float32Array(n * 4), ex = new Float32Array(n * 4), fl = new Float32Array(n * 4);
  const unit = (c: THREE.Color) => c.clone().multiplyScalar(1 / Math.max(luminance(c), 1e-4));
  specs.forEach((s, i) => {
    s.position.toArray(pos, i * 3);
    unit(s.colorA).toArray(ca, i * 3);
    unit(s.colorB ?? s.colorA).toArray(cb, i * 3);
    lp.set([s.lens, s.cd, s.cdDay, s.param ?? 0], i * 4);
    const b = s.beam ?? { axis: 0, azSigma: 1, elTop: Math.PI, elSigma: 1, floor: 1 };
    bm.set([b.axis, b.azSigma, b.elTop, b.elSigma], i * 4);
    ex.set([s.kind ?? LightKind.Bidirectional, b.floor, s.gainB ?? 1, s.daySteps ? 1 : 0], i * 4);
    if (s.flash) fl.set([s.flash.period, s.flash.phase, s.flash.duration], i * 4);
    fl[i * 4 + 3] = Math.max(s.height ?? s.position.y - AIRPORT.elevation, 0.05);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('colorA', new THREE.BufferAttribute(ca, 3));
  g.setAttribute('colorB', new THREE.BufferAttribute(cb, 3));
  g.setAttribute('light', new THREE.BufferAttribute(lp, 4));
  g.setAttribute('beam', new THREE.BufferAttribute(bm, 4));
  g.setAttribute('extra', new THREE.BufferAttribute(ex, 4));
  g.setAttribute('flash', new THREE.BufferAttribute(fl, 4));
  g.computeBoundingSphere();

  const dir = localToWorld(1, 0, 0).sub(localToWorld(0, 0, 0)).normalize();
  const uniforms: LightsUniforms = { uViewportH: { value: 900 }, uMinPx: { value: 2.5 }, uMaxPx: { value: 160 }, uIntensity: { value: 1 }, uExposure: { value: 1 }, uDayStep: { value: 1 }, uHaze: { value: new THREE.Vector2(0, 1200) } };
  const allUniforms = { uNight: shared.uNight, uTime: shared.uTime, uRunwayDir: { value: dir }, ...uniforms };
  const material = (halo: boolean) =>
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: halo ? { HALO_PASS: '' } : {},
      uniforms: allUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  // Two draws of the same points: the lamp cores (depth-tested at the lamp) and their glare halos.
  const points = new THREE.Points(g, material(false));
  points.name = 'airfield-lights';
  points.frustumCulled = false; // lights span the whole valley; culling one bounding sphere gains nothing
  points.renderOrder = 10;
  const halos = new THREE.Points(g, material(true));
  halos.name = 'airfield-light-halos';
  halos.frustumCulled = false;
  halos.renderOrder = 11;
  points.add(halos);
  return { points, uniforms };
}

// ---------------------------------------------------------------------------------------------------------------
// Photometry of the airport's lights (FAA AC 150/5345-46, -28, -44, -51; typical luminaire data). Night values
// are the brightness step a pilot or controller would select in clear weather at night; day values the top step.

const SM = 1609.344;
/**
 * Day brightness step of runway-class lighting (HIRL, threshold/end lights, approach lights, REIL) as a fraction of
 * the top step, from the visibility, following the FAA order JO 7110.65 intensity tables for a 5-step system
 * (steps 5..1 = 100 %, 25 %, 5 %, 1.2 %, 0.3 %): step 5 below 1 SM, step 4 from 1 to 2 SM, step 3 from 2 SM up
 * (lights left on at step 3 in good visibility rather than switched off). The night setting is fixed (see HIRL).
 */
export function dayBrightnessStep(visibilityM: number): number {
  if (!(visibilityM >= SM)) return 1;
  if (visibilityM < 2 * SM) return 0.25;
  return 0.05;
}

/** Height of runway/taxiway light lenses above the field, m (elevated fixtures, AC 150/5345-46). */
const LENS_HEIGHT = 0.36;
/** HIRL (L-862) main beam: 10 000 cd white at step 5, toed-in along the runway, 0-7 deg up. Step 2-3 at night. */
const HIRL = { day: 10000, night: 300 };
const HIRL_BEAM: Beam = { axis: 2, azSigma: 7 * DEG, elTop: 6 * DEG, elSigma: 6 * DEG, floor: 0.05 };
/** L-861T taxiway edge: ~10 cd blue, all round, up to 30 deg. */
const TAXI_EDGE = { day: 10, night: 6 };
/** PAPI (L-880) white per lamp (two per unit): ~12 000 cd by day, dimmed ~10x at night; red filter passes ~20 %. */
const PAPI_CD = { day: 12000, night: 1200 };
/** MALSF steady burning PAR-56 lamps: ~10 000 cd, dimmed at night. */
const APPROACH = { day: 10000, night: 400 };
const APPROACH_BEAM: Beam = { axis: -1, azSigma: 9 * DEG, elTop: 8 * DEG, elSigma: 6 * DEG, floor: 0.01 };
/** Sequenced flashers / REIL condenser-discharge strobes: effective intensity. */
const FLASHER = { day: 20000, night: 2000 };
/** Rotating beacon (L-801A): ~100 000 cd white beam peak, green filter ~25 %. */
const BEACON_CD = 100000;
/** L-810 steady red obstruction light, 32.5 cd. */
const OBSTRUCTION = 32.5;
/** Apron floodlight: one LED head, 7 500 cd peak (three per mast, fanned into one wide flood aimed 30 deg down; see shared.ts FLOOD_BEAM). */
export const FLOOD_HEAD_CD = 7500;
/** Heads per floodlight mast. */
export const FLOOD_HEADS = 3;

/**
 * L-880 PAPI light unit (two-lamp projector box on legs), metres. The lamp centres sit on the front face, where the
 * lenses are, `lensProud` in front of the housing box.
 */
export const PAPI_HOUSING = { width: 0.72, height: 0.42, depth: 0.8, lampSpacing: 0.34, lensRadius: 0.1, lensProud: 0.07 } as const;

export interface FixturePlacement {
  /** Local position of the fixture base. */
  u: number;
  v: number;
  /** Lens colour. */
  color: THREE.Color;
}

/** Approach light bar (MALSF): lamps on a crossbar on a stanchion, local u of the bar, lamp offsets across (v). */
export interface ApproachBar {
  u: number;
  lamps: number[];
  height: number;
}

export interface AirportLights {
  specs: LightSpec[];
  /** Elevated runway/taxiway light fixtures to model (local positions). */
  fixtures: FixturePlacement[];
  /** Approach light bars to model (stanchion, crossbar, lamp housings). */
  approachBars: ApproachBar[];
  /** REIL strobe units (local position of the unit, facing the approach toward `facing` u). */
  reil: { u: number; v: number; facing: 1 | -1 }[];
}

/** MALSF: 1400 ft of 5-lamp bars every 200 ft ahead of runway 07, 1000 ft roll bars, flashers on the outer 3 bars. */
export const MALSF_BARS: readonly ApproachBar[] = (() => {
  const FT = 0.3048;
  const bars: ApproachBar[] = [];
  for (let k = 1; k <= 7; k++) {
    const u = -RUNWAY_HALF_LENGTH - k * 200 * FT;
    const lamps = [-2, -1, 0, 1, 2].map((i) => i * 1.03);
    // 1000 ft roll bars: 3 lamps each side, 3 m either side of the centre bar.
    if (k === 5) lamps.push(-6.1, -5.1, -4.1, 4.1, 5.1, 6.1);
    bars.push({ u, lamps, height: 0.9 });
  }
  return bars;
})();

export function airportLights(): AirportLights {
  const specs: LightSpec[] = [];
  const fixtures: FixturePlacement[] = [];
  const C = LIGHT_COLORS;
  const at = (u: number, v: number, h: number) => localToWorld(u, v, h);

  // Runway edge lights (HIRL): 31 per side, 60 m spacing, 1 m outside the pavement edge.
  // Caution zone: the last 600 m seen from the landing direction show yellow (the yellow filter passes ~40 %).
  const HL = RUNWAY_HALF_LENGTH;
  const count = 31;
  for (let i = 0; i < count; i++) {
    const u = -HL + (i * 2 * HL) / (count - 1);
    for (const side of [-1, 1]) {
      const v = side * (RUNWAY_HALF_WIDTH + 1);
      const yA = u > HL - 600, yB = u < -HL + 600;
      const kA = yA ? 0.4 : 1, kB = yB ? 0.4 : 1;
      specs.push({
        position: at(u, v, LENS_HEIGHT),
        colorA: yA ? C.yellow : C.runwayWhite,
        colorB: yB ? C.yellow : C.runwayWhite,
        gainB: kB / kA,
        lens: 0.12,
        cd: HIRL.night * kA,
        cdDay: HIRL.day * kA,
        beam: HIRL_BEAM,
        daySteps: true,
      });
      fixtures.push({ u, v, color: C.runwayWhite });
    }
  }
  // Threshold / runway end lights: 8 per end, 1 m outside the end; green toward the approach (~20 % filter),
  // red toward the runway (~15 %).
  for (const end of [-1, 1]) {
    const u = end * (HL + 1);
    for (const v of [-13.5, -10.5, -7.5, -4.5, 4.5, 7.5, 10.5, 13.5]) {
      const green = 0.25, red = 0.15;
      const kA = end < 0 ? green : red, kB = end < 0 ? red : green;
      specs.push({
        position: at(u, v, LENS_HEIGHT),
        colorA: end < 0 ? C.green : C.red,
        colorB: end < 0 ? C.red : C.green,
        gainB: kB / kA,
        lens: 0.12,
        cd: HIRL.night * kA,
        cdDay: HIRL.day * kA,
        beam: HIRL_BEAM,
        daySteps: true,
      });
      fixtures.push({ u, v, color: C.green });
    }
  }
  // PAPI: two lamps per unit side by side, each emitting from its lens on the housing's front face (the sprite
  // must sit in front of the housing or the housing's own front face depth-occludes it).
  for (const papi of PAPIS) {
    for (const unit of papi.units) {
      for (const dv of [-PAPI_HOUSING.lampSpacing / 2, PAPI_HOUSING.lampSpacing / 2]) {
        specs.push({
          position: at(unit.u + papi.facingU * (PAPI_HOUSING.depth / 2 + PAPI_HOUSING.lensProud), unit.v + dv, unit.height),
          colorA: C.red,
          colorB: C.papiWhite,
          gainB: 1 / 0.2,
          lens: 0.2,
          cd: PAPI_CD.night * 0.2,
          cdDay: PAPI_CD.day * 0.2,
          kind: papi.facingU < 0 ? LightKind.PapiFacingLowU : LightKind.PapiFacingHighU,
          param: unit.angle,
        });
      }
    }
  }
  // Approach lights (MALSF) ahead of runway 07: steady white bars, and sequenced flashers on the outer three bars
  // running toward the threshold twice a second.
  const approachBars = MALSF_BARS.slice();
  approachBars.forEach((bar, k) => {
    for (const v of bar.lamps) {
      specs.push({ position: at(bar.u, v, bar.height + 0.12), colorA: C.runwayWhite, lens: 0.16, cd: APPROACH.night, cdDay: APPROACH.day, beam: APPROACH_BEAM, daySteps: true });
    }
    if (k >= 4) {
      specs.push({
        position: at(bar.u + 1.2, 0, bar.height + 0.35),
        colorA: C.strobe,
        lens: 0.12,
        cd: FLASHER.night,
        cdDay: FLASHER.day,
        beam: APPROACH_BEAM,
        flash: { period: 0.5, phase: (6 - k) * 0.06, duration: 0.05 },
        daySteps: true,
      });
    }
  });
  // Runway end identifier lights on runway 25: two synchronised strobes beside the threshold, aimed 15 deg out.
  const reil: AirportLights['reil'] = [];
  for (const side of [-1, 1]) {
    const u = HL + 3, v = side * (RUNWAY_HALF_WIDTH + 12);
    reil.push({ u, v, facing: 1 });
    specs.push({
      position: at(u, v, 0.7),
      colorA: C.strobe,
      lens: 0.12,
      cd: FLASHER.night,
      cdDay: FLASHER.day,
      beam: { axis: 1, azSigma: 14 * DEG, elTop: 12 * DEG, elSigma: 8 * DEG, floor: 0.005 },
      flash: { period: 1.0, phase: 0.3, duration: 0.05 },
      daySteps: true,
    });
  }
  // Blue taxiway / apron edge lights: along every paved rectangle edge, kept only where the edge is the real
  // boundary of the union (not inside another rectangle or fillet), away from the runway and not where the
  // apron meets the buildings.
  const off = 1.5;
  const accept: { u: number; v: number }[] = [];
  for (const r of PAVED_RECTS) {
    const edges: [number, number, number, number][] = [
      [r.u0 - off, r.v0 - off, r.u1 + off, r.v0 - off],
      [r.u0 - off, r.v1 + off, r.u1 + off, r.v1 + off],
      [r.u0 - off, r.v0 - off, r.u0 - off, r.v1 + off],
      [r.u1 + off, r.v0 - off, r.u1 + off, r.v1 + off],
    ];
    for (const [u0, v0, u1, v1] of edges) {
      const len = Math.hypot(u1 - u0, v1 - v0);
      const spacing = len > 200 ? 45 : 15;
      const nSeg = Math.max(1, Math.round(len / spacing));
      for (let i = 0; i <= nSeg; i++) {
        const u = u0 + ((u1 - u0) * i) / nSeg, v = v0 + ((v1 - v0) * i) / nSeg;
        if (Math.abs(pavedSD(u, v) - off) > 0.25) continue;
        if (v > -RUNWAY_HALF_WIDTH - 20) continue;
        if (BUILDINGS.some((b) => u > b.u0 - 3 && u < b.u1 + 3 && v > b.v0 - 3 && v < b.v1 + 3)) continue;
        if (accept.some((p) => Math.hypot(p.u - u, p.v - v) < 8)) continue;
        accept.push({ u, v });
      }
    }
  }
  for (const p of accept) {
    specs.push({
      position: at(p.u, p.v, LENS_HEIGHT),
      colorA: C.blue,
      lens: 0.1,
      cd: TAXI_EDGE.night,
      cdDay: TAXI_EDGE.day,
      beam: { axis: 0, azSigma: 1, elTop: 20 * DEG, elSigma: 15 * DEG, floor: 0.1 },
    });
    fixtures.push({ u: p.u, v: p.v, color: C.blue });
  }
  // Apron floodlight heads (night only), aimed at the apron: several lamps per mast head.
  for (const f of FLOODLIGHTS) {
    for (let h = 0; h < FLOOD_HEADS; h++) {
      const du = (h - (FLOOD_HEADS - 1) / 2) * 0.6;
      specs.push({ position: at(f.u + du, f.v + 0.4, f.height), colorA: C.flood, lens: 0.45, cd: FLOOD_HEAD_CD, cdDay: 0, kind: LightKind.CutOff, param: 0.08 });
    }
  }
  // Aerodrome beacon.
  specs.push({
    position: at(BEACON.u, BEACON.v, BEACON.height + 0.6),
    colorA: new THREE.Color(1, 0.95, 0.85),
    colorB: C.green,
    gainB: 0.25,
    lens: 0.5,
    cd: BEACON_CD,
    cdDay: 0,
    kind: LightKind.Beacon,
  });
  // Red obstruction lights on the tower roof and the beacon mast.
  const obstruction = { colorA: C.red, lens: 0.15, cd: OBSTRUCTION, cdDay: OBSTRUCTION };
  specs.push({ position: at(TOWER.u, TOWER.v, TOWER.roofHeight + 1.2), ...obstruction });
  specs.push({ position: at(BEACON.u + 1.3, BEACON.v, BEACON.height - 1), ...obstruction });
  return { specs, fixtures, approachBars, reil };
}
