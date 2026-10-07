// Exterior lighting: position (nav) lights, red flashing beacon on the fin, white wingtip strobes with a
// double flash, and the landing and taxi lights (C172S: in the left wing leading edge). Where each lamp sits,
// its lens radius and the aim of the two beams are the airframe definition's (AirframeVisualDef.lamps: always
// these eight ids). Everything is powered from the bus: below ~18 V nothing lights, full output from ~24 V.
//
// Three parts per light, all on the project's photometric scale (core/context.ts, SCENE_UNITS_PER_LUX):
//   - the lens mesh (the physical dome, lit a little so it reads as a glowing lens up close);
//   - a glow sprite (one THREE.Points draw for all eight lights) that carries the lamp's luminous intensity
//     in the direction of the camera: its screen footprint is the lens size, but never below MIN_PX pixels,
//     and its radiance is always intensity / footprint area, so the flux reaching the eye is exactly
//     I(direction) / d^2 at any distance (a nav light from the tower camera is a faint dot, a strobe is a
//     clear flash, and nothing blooms by day that would not in reality);
//   - real three.js lights for what lights the world: spot lights for the landing / taxi pools, point
//     lights for strobe and beacon flashes on the airframe.
// The intensity of each lamp depends on the viewing direction (FAR 23.1387-1401 distributions): the red and
// green position lights cover 0-110 degrees to their side of dead ahead, the white tail light the rear 140
// degrees, the landing and taxi lights are narrow forward beams, and every light falls off vertically.
//
// Intensities (typical of the 172S installation): landing light 150 kcd peak, 4 deg half-width (PAR-36,
// ~11 deg total spread) plus 0.1 % reflector spill; taxi light 30 kcd, 12 deg; nav 40 cd ahead / 30 cd to
// 20 deg / 8 cd to 110 deg; tail 20 cd; strobe 1 kcd for 50 ms (the eye-integrated, effective intensity of
// a ~1 ms xenon flash); beacon 800 cd. Timing: strobes double-flash every
// 1.1 s (~55 per minute), beacon flashes every 1.25 s (48 per minute) - both inside the 40-100 flashes/min
// range of FAR 23.1401.

import * as THREE from 'three';
import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import { SCENE_UNITS_PER_LUX, type SkyState } from '../../core/context';
import type { AircraftState, ControlInputs } from '../../core/types';
import type { LampVisualDef } from './airframe/types';
import { frd } from './geometry';

/** Light intensity units per candela: the project's photometric scale (core/context.ts). */
export const LIGHT_UNITS_PER_CANDELA = SCENE_UNITS_PER_LUX;

const CD = { landing: 150000, taxi: 30000, strobe: 1000, beacon: 800, tail: 20 };
/** Point-light intensity for the strobe / beacon flashes on the airframe (what the lamp throws sideways). */
const FLASH_CD = { strobe: 600, beacon: 150 };
/** Luminance of a lit lens surface (the glow sprite carries the rest of the light), cd/m^2. */
const LENS_LUMINANCE = { nav: 3000, strobe: 20000, beacon: 8000, landing: 30000, taxi: 20000 };
/** Smallest glow sprite on screen, px (diameter), and the largest. */
const MIN_PX = 2.5;
const MAX_PX = 256;
/**
 * Highest core radiance, scene units (half-float range with headroom). The core never grows beyond the lens:
 * what a lamp sends toward the camera above this is shown by the glare halo (and the bloom of the saturated
 * core), not by a larger uniformly bright disc.
 */
const MAX_RADIANCE = 6e4;
/** Integral of the sprite profile over its disc (see GLOW_FRAG): flux = L0 * R^2 * PROFILE_INTEGRAL. */
const PROFILE_INTEGRAL = 0.3409;
/**
 * Veiling glare around a bright lamp (the eye's and the lens's scatter; Stiles-Holladay form, as the airfield
 * lights use): halo luminance L = GLARE * E / theta_deg^2 for illuminance E at the eye, from the lens's edge
 * out to where it falls below HALO_CUTOFF on the display (at most MAX_HALO_DEG).
 */
const GLARE = 1.5;
const MAX_HALO_DEG = 4;
/**
 * Angular radius of the halo's smooth centre (theta0 in GLARE * E / (theta^2 + theta0^2)), degrees, or the
 * lens's own radius if larger: the centre stays a soft bell rather than a 1/theta^2 spike.
 */
const HALO_CORE_DEG = 0.3;
/** Smallest field of view (degrees over the viewport height) the glare halos are sized for (see GLOW_VERT). */
const NOMINAL_FOV_DEG = 60;
const HALO_CUTOFF = 0.008;
/**
 * Highest exposed (pre-tone-map) value of the halo, at its centre: 0.18 is middle grey and the AgX curve
 * reaches ~240/255 at 2.5 without clipping. Close to a lamp shining at the camera the glare law would push
 * the whole halo far past white, which reads as an opaque ball; the halo is scaled down instead, so only the
 * lens core saturates and the halo always falls off smoothly around it.
 */
const HALO_PEAK = 2.5;

const RED = new THREE.Color(1, 0.035, 0.015);
const GREEN = new THREE.Color(0.05, 1, 0.42);
const WHITE = new THREE.Color(1, 0.97, 0.92);
const XENON = new THREE.Color(0.92, 0.95, 1);
const HALOGEN = new THREE.Color(1, 0.84, 0.62);

const DEG = Math.PI / 180;

function pulse(t: number, start: number, width: number): number {
  const u = t - start;
  if (u < 0 || u > width) return 0;
  // Fast rise, slightly slower fall.
  return Math.min(1, u / (width * 0.15)) * Math.min(1, (width - u) / (width * 0.4));
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Vertical distribution of position lights (FAR 23.1393): fraction of the horizontal intensity. */
const V_ANGLES = [0, 5, 10, 15, 20, 30, 40, 90];
const V_FRACTION = [1, 0.9, 0.8, 0.7, 0.5, 0.3, 0.1, 0.05];
function verticalFactor(elevDeg: number): number {
  const e = Math.min(90, Math.abs(elevDeg));
  for (let i = 1; i < V_ANGLES.length; i++)
    if (e <= V_ANGLES[i]) {
      const f = (e - V_ANGLES[i - 1]) / (V_ANGLES[i] - V_ANGLES[i - 1]);
      return V_FRACTION[i - 1] + (V_FRACTION[i] - V_FRACTION[i - 1]) * f;
    }
  return 0.05;
}

/**
 * Horizontal intensity of a wingtip position light (cd) at azimuth `az` (deg, 0 = dead ahead, + toward
 * that light's own side): 40 cd within 10 deg, 30 cd to 20 deg, 8 cd to 110 deg, with a couple of
 * degrees of overlap across the centreline and a short cut-off beyond 110 deg.
 */
function navHorizontal(az: number): number {
  const across = smooth(-3, 1, az);
  const behind = 1 - smooth(108, 114, az);
  const i = 8 + 22 * (1 - smooth(18, 22, az)) + 10 * (1 - smooth(8, 12, az));
  return i * across * behind;
}

type LightId = 'navL' | 'navR' | 'navTail' | 'strobeL' | 'strobeR' | 'beacon' | 'landing' | 'taxi';
const LIGHT_IDS: LightId[] = ['navL', 'navR', 'navTail', 'strobeL', 'strobeR', 'beacon', 'landing', 'taxi'];

interface Lamp {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  colour: THREE.Color;
  /** Physical lens radius, m (the smallest glow sprite radius). */
  radius: number;
  lensLuminance: number;
  /** Glow sprite position relative to the lens centre (model space): on the lens's outer surface. */
  offset: THREE.Vector3;
}

const DEG_PER_RAD = 180 / Math.PI;
const f = (x: number): string => x.toExponential(6);

/**
 * Two draws of the same eight points: the lamp cores (the lens, depth-tested and depth-writing at the lamp) and,
 * with HALO_PASS, their glare halos.
 */
const GLOW_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 glow;      // linear colour * luminous intensity toward the camera, scene units (cd * scale)
attribute float radius;   // physical lens radius, m
uniform float uViewportH;
uniform float uMinPx;
uniform float uMaxPx;
uniform float uMaxRadiance;
uniform float uProfile;
uniform float uExposure;
varying vec3 vColor;
varying vec2 vShape;      // halo: sprite radius (deg), theta0^2 (deg^2)
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(length(mv.xyz), 0.05);
  float flux = max(glow.r, max(glow.g, glow.b));
  float pxPerM = projectionMatrix[1][1] * 0.5 * uViewportH / dist;
  // The core: the lens itself, at least MIN_PX across.
  float px = clamp(2.0 * radius * pxPerM, uMinPx, uMaxPx);
  float r = px / (2.0 * pxPerM);
  float degPerPx = ${f(DEG_PER_RAD)} / pxPerM / dist;
#ifdef HALO_PASS
  // Illuminance at the eye (scene units) and the halo it causes: GLARE * E / (theta^2 + theta0^2), with the
  // amplitude scaled down where its centre would exceed HALO_PEAK on the display, and only as wide as it is
  // visible (above HALO_CUTOFF).
  float E = flux / (dist * dist);
  // Glare is formed in the viewer's eye, so it is sized on the display: a zoomed-in (telephoto) view shows
  // the lamp larger but not its glare. Angles below are display degrees, at least NOMINAL_FOV_DEG over the
  // viewport height.
  float degH = max(degPerPx, ${f(NOMINAL_FOV_DEG)} / uViewportH);
  float theta0 = max(0.5 * px * degH, ${f(HALO_CORE_DEG)});
  float amp = min(${f(GLARE)}, ${f(HALO_PEAK)} * theta0 * theta0 / max(E * uExposure, 1e-30));
  float haloDeg = min(sqrt(amp * E * uExposure / ${f(HALO_CUTOFF)}), ${f(MAX_HALO_DEG)});
  vColor = glow / (dist * dist) * amp;
  px = min(2.0 * haloDeg / degH, uMaxPx);
  vShape = vec2(0.5 * px * degH, theta0 * theta0);
  if (haloDeg < 2.0 * theta0) flux = 0.0;
  // Glare forms in the eye, so it overlays whatever lies just in front of the lamp: pull it halfway in.
  mv.xyz *= 0.5;
#else
  // Centre radiance so that the core's integrated intensity is the lamp's, up to the radiance cap.
  vColor = glow / (uProfile * r * r);
  float peak = max(vColor.r, max(vColor.g, vColor.b));
  vColor *= min(1.0, uMaxRadiance / max(peak, 1e-30));
  vShape = vec2(0.0);
  // Pull the sprite toward the camera by a little so the lens housing does not clip it.
  mv.xyz *= max(dist - min(r, 0.05), 0.02) / dist;
#endif
  gl_Position = projectionMatrix * mv;
  gl_PointSize = px;
  if (flux <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const GLOW_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
varying vec2 vShape;
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
#ifdef HALO_PASS
  if (r2 > 1.0) discard;
  // L = GLARE * E / (theta^2 + theta0^2): 1/theta^2 glare tails on a smooth centre, faded out at the edge.
  float theta2 = r2 * vShape.x * vShape.x;
  float window = (1.0 - r2) * (1.0 - r2);
  gl_FragColor = vec4(vColor * window / (theta2 + vShape.y), 1.0);
#else
  // The core writes depth (so clouds and haze composited later from the depth buffer treat the light as
  // being where the aircraft is, not behind it): keep only the part that carries the light.
  if (r2 > 0.5) discard;
  // Integral over the disc: pi * integral_0^0.5 exp(-8u)(1-u) du = 0.3409.
  float profile = exp(-8.0 * r2) * (1.0 - r2);
  gl_FragColor = vec4(vColor * profile, 1.0);
#endif
}
`;

const lum = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * Approximate display exposure of the post chain (display value per scene unit: grey-card metering with the
 * key lowered in the dark), from the sky state. Only used to size and cap the glare halos. Same estimate as the
 * airfield lights (world/airport AirportSystem.estimateExposure), so both glare alike.
 */
export function estimateExposure(sky: SkyState): number {
  const { sunColor, moonColor, skyColor, sunDir, moonDir } = sky;
  const direct = lum(sunColor) * Math.max(sunDir.y, 0) + lum(moonColor) * Math.max(moonDir.y, 0);
  const grey = Math.max(0.18 * ((direct + 1e-3 * SCENE_UNITS_PER_LUX) / Math.PI + lum(skyColor)), 1e-9);
  const ev = Math.log2(grey / SCENE_UNITS_PER_LUX);
  const keyBias = Math.max(-0.2 * Math.max(0, 11 - ev), -4.5);
  return (0.18 * Math.pow(2, keyBias)) / grey;
}

export class AircraftLights {
  readonly group = new THREE.Group();
  private readonly lamps: Record<LightId, Lamp>;
  private readonly strobeLights: THREE.PointLight[] = [];
  private beaconLight: THREE.PointLight | null = null;
  private readonly landing: THREE.SpotLight;
  private readonly taxi: THREE.SpotLight;
  private readonly landingAxis = new THREE.Vector3();
  private readonly taxiAxis = new THREE.Vector3();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly glow: THREE.Points;
  private readonly glowPos: THREE.BufferAttribute;
  private readonly glowCol: THREE.BufferAttribute;
  private readonly glowMat: THREE.ShaderMaterial;
  private readonly haloMat: THREE.ShaderMaterial;
  private readonly glowUniforms: { uViewportH: THREE.IUniform<number>; uExposure: THREE.IUniform<number> };
  private readonly tmp = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly lampPos = new THREE.Vector3();
  private readonly size = new THREE.Vector2();
  private pointLightsOn: boolean;
  /** Lamps that ride on the nose gear leg: dark while it is not down. */
  private readonly onNoseGear = new Set<LightId>();

  /**
   * @param pointLights add flashing point lights for strobes and beacon (they light the airframe at night;
   *                    three forward+ lights cost shading time on every lit pixel, so off on low quality)
   * @param lightScale  multiplier on light-source intensities (see the units note above)
   * @param rudder      the rudder's moving object: a lamp with parent 'rudder' (the white tail light on its
   *                    trailing edge) swings with it
   * @param defs        the eight lamps of the airframe definition (default: the Cessna 172S)
   * @param noseGear    the node the nose gear leg hangs on (LandingGear.noseMount): a lamp with parent
   *                    'noseGear' swings up with the leg and is extinguished below extension 0.9
   */
  constructor(
    pointLights: boolean,
    private readonly lightScale: number,
    rudder: THREE.Object3D,
    defs: readonly LampVisualDef[] = C172S_VISUAL.lamps,
    noseGear?: THREE.Object3D,
  ) {
    this.group.name = 'aircraftLights';
    const def = (id: LightId): LampVisualDef => {
      const d = defs.find((l) => l.id === id);
      if (!d) throw new Error(`aircraft lights: the definition has no lamp '${id}'`);
      return d;
    };
    const at = (id: LightId): THREE.Vector3 => {
      const p = def(id).pos;
      return frd(p[0], p[1], p[2]);
    };
    const lamp = (id: LightId, colour: THREE.Color, lensLuminance: number, sx: number, sy: number, sz: number): Lamp => {
      const d = def(id);
      const radius = d.radius;
      const geo = dome(radius, sx, sy, sz);
      const pos = at(id);
      if (d.parent === 'noseGear') {
        if (!noseGear) throw new Error(`aircraft lights: lamp '${id}' is on the nose gear, which was not given`);
        this.onNoseGear.add(id);
      }
      const parent = d.parent === 'rudder' ? rudder : d.parent === 'noseGear' ? noseGear! : this.group;
      const mat = new THREE.MeshStandardMaterial({
        color: colour.clone().multiplyScalar(0.25).addScalar(0.05),
        roughness: 0.08,
        metalness: 0,
        emissive: colour,
        emissiveIntensity: 0,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos);
      if (parent !== this.group) {
        // Re-express the (model-space) position in the moving part's frame.
        if (d.parent === 'noseGear') {
          // (The leg's node may hang under a retract hinge: through every transform up to the model root.)
          let top: THREE.Object3D = parent;
          while (top.parent) top = top.parent;
          top.updateMatrixWorld(true);
          m.position.applyMatrix4(parent.matrixWorld.clone().invert().multiply(top.matrixWorld));
        } else {
          parent.updateMatrix();
          m.position.applyMatrix4(parent.matrix.clone().invert());
        }
      }
      parent.add(m);
      this.geometries.push(geo);
      // The glow sprite sits on the outer face of the lens, clear of the wingtip / fin / rudder skin around it.
      return { mesh: m, mat, colour, radius, lensLuminance, offset: frd(d.glowOffset[0], d.glowOffset[1], d.glowOffset[2]) };
    };
    const dome = (r: number, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry => new THREE.SphereGeometry(r, 12, 8).scale(sx, sy, sz);

    // Lens shapes: nav and strobe housings faired along the airflow, flat landing / taxi lenses.
    const L = LENS_LUMINANCE;
    this.lamps = {
      navL: lamp('navL', RED, L.nav, 1, 0.7, 1.4),
      navR: lamp('navR', GREEN, L.nav, 1, 0.7, 1.4),
      navTail: lamp('navTail', WHITE, L.nav, 1, 1, 1.2),
      strobeL: lamp('strobeL', XENON, L.strobe, 1.2, 0.8, 1.6),
      strobeR: lamp('strobeR', XENON, L.strobe, 1.2, 0.8, 1.6),
      beacon: lamp('beacon', RED, L.beacon, 1, 1.2, 1.4),
      landing: lamp('landing', HALOGEN, L.landing, 1, 0.75, 0.25),
      taxi: lamp('taxi', HALOGEN, L.taxi, 1, 0.75, 0.25),
    };
    const strobePos = (side: 1 | -1): THREE.Vector3 => at(side < 0 ? 'strobeL' : 'strobeR');
    const beaconPos = at('beacon');
    const landingPos = at('landing');
    const taxiPos = at('taxi');

    const spot = (pos: THREE.Vector3, halfAngleDeg: number, downDeg: number, outDeg: number, axis: THREE.Vector3): THREE.SpotLight => {
      const s = new THREE.SpotLight(HALOGEN, 0, 900, halfAngleDeg * DEG, 1, 2);
      s.position.copy(pos);
      axis.set(-Math.sin(outDeg * DEG), -Math.sin(downDeg * DEG), -1).normalize();
      s.target.position.copy(pos).addScaledVector(axis, 50);
      s.castShadow = false;
      this.group.add(s, s.target);
      return s;
    };
    const landingAim = def('landing').aim ?? { halfAngleDeg: 9, downDeg: 2.5, outDeg: 1 };
    const taxiAim = def('taxi').aim ?? { halfAngleDeg: 24, downDeg: 6, outDeg: 10 };
    this.landing = spot(landingPos, landingAim.halfAngleDeg, landingAim.downDeg, landingAim.outDeg, this.landingAxis);
    this.taxi = spot(taxiPos, taxiAim.halfAngleDeg, taxiAim.downDeg, taxiAim.outDeg, this.taxiAxis);

    // Point lights always exist (so a quality change does not alter the light count and recompile every
    // material); on low quality they simply stay dark.
    this.pointLightsOn = pointLights;
    for (const side of [-1, 1] as const) {
      const p = new THREE.PointLight(XENON, 0, 14, 2);
      p.position.copy(strobePos(side)).add(new THREE.Vector3(side * 0.08, 0, 0));
      this.strobeLights.push(p);
      this.group.add(p);
    }
    this.beaconLight = new THREE.PointLight(RED, 0, 10, 2);
    this.beaconLight.position.copy(beaconPos).add(new THREE.Vector3(0, 0.08, 0));
    this.group.add(this.beaconLight);

    // Glow sprites, one point per lamp in model space (the tail light follows the rudder each frame).
    const n = LIGHT_IDS.length;
    const g = new THREE.BufferGeometry();
    this.glowPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.glowCol = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.glowPos.setUsage(THREE.DynamicDrawUsage);
    this.glowCol.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.glowPos);
    g.setAttribute('glow', this.glowCol);
    g.setAttribute('radius', new THREE.BufferAttribute(new Float32Array(LIGHT_IDS.map((id) => this.lamps[id].radius)), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);
    this.geometries.push(g);
    const uniforms = {
      uViewportH: { value: 900 },
      uMinPx: { value: MIN_PX },
      uMaxPx: { value: MAX_PX },
      uMaxRadiance: { value: MAX_RADIANCE },
      uProfile: { value: PROFILE_INTEGRAL },
      uExposure: { value: 1 },
    };
    this.glowUniforms = uniforms;
    const material = (halo: boolean): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        name: halo ? 'aircraftLightHalo' : 'aircraftLightGlow',
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        defines: halo ? { HALO_PASS: '' } : {},
        uniforms,
        transparent: true,
        depthWrite: !halo,
        blending: THREE.AdditiveBlending,
      });
    this.glowMat = material(false);
    this.haloMat = material(true);
    this.glow = new THREE.Points(g, this.glowMat);
    this.glow.name = 'aircraftLightGlow';
    this.glow.frustumCulled = false;
    // After the glazing (2) and the prop disc (1).
    this.glow.renderOrder = 3;
    const halo = new THREE.Points(g, this.haloMat);
    halo.name = 'aircraftLightHalo';
    halo.frustumCulled = false;
    halo.renderOrder = 4;
    this.group.add(this.glow, halo);
  }

  /** Enable or disable the strobe / beacon point lights (quality setting). */
  setPointLights(on: boolean): void {
    this.pointLightsOn = on;
  }

  /**
   * @param root   the aircraft model root (model space = this group's parent space)
   * @param camera the rendering camera (for the directional intensity and the sprite size)
   * @param sky    the sky state, for the exposure estimate that sizes the glare halos (none without it)
   */
  update(
    time: number,
    state: AircraftState,
    controls: ControlInputs,
    root: THREE.Object3D,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    sky?: SkyState,
  ): void {
    const v = state.electrical.busVoltage;
    const power = Math.min(1, Math.max(0, (v - 18) / 6));
    const l = controls.lights;
    const k = LIGHT_UNITS_PER_CANDELA * this.lightScale;
    const nav = l.nav ? power : 0;
    const ts = time % 1.1;
    const strobe = l.strobe ? power * Math.max(pulse(ts, 0, 0.05), pulse(ts, 0.14, 0.05)) : 0;
    // Beacon offset in phase so it does not fire with the strobes.
    const beacon = l.beacon ? power * pulse((time + 0.5) % 1.25, 0, 0.16) : 0;
    // Halogen output rises steeply with voltage (~V^3.4); normalise to 28 V.
    const halogen = power * Math.min(1.1, Math.pow(Math.max(0, v) / 28, 3.4));
    // A lamp on the nose gear leg is switched off by the leg until it is (nearly) down.
    const legDown = state.gear.extension[0] >= 0.9 ? 1 : 0;
    const landing = (l.landing ? halogen : 0) * (this.onNoseGear.has('landing') ? legDown : 1);
    const taxi = (l.taxi ? halogen : 0) * (this.onNoseGear.has('taxi') ? legDown : 1);

    const flash = this.pointLightsOn ? 1 : 0;
    for (const p of this.strobeLights) p.intensity = FLASH_CD.strobe * k * strobe * flash;
    if (this.beaconLight) this.beaconLight.intensity = FLASH_CD.beacon * k * beacon * flash;
    this.landing.intensity = CD.landing * k * landing;
    this.taxi.intensity = CD.taxi * k * taxi;

    // Camera in model space.
    root.updateWorldMatrix(true, false);
    const cam = camera.getWorldPosition(this.tmp);
    root.worldToLocal(cam);
    renderer.getDrawingBufferSize(this.size);
    this.glowUniforms.uViewportH.value = this.size.y;
    this.glowUniforms.uExposure.value = sky ? estimateExposure(sky) : 0;

    const levels: Record<LightId, number> = { navL: nav, navR: nav, navTail: nav, strobeL: strobe, strobeR: strobe, beacon, landing, taxi };
    const pos = this.glowPos.array as Float32Array;
    const col = this.glowCol.array as Float32Array;
    for (let i = 0; i < LIGHT_IDS.length; i++) {
      const id = LIGHT_IDS[i];
      const lamp = this.lamps[id];
      const level = this.onNoseGear.has(id) ? levels[id] * legDown : levels[id];
      // Lamp position in model space.
      const p = lamp.mesh.getWorldPosition(this.lampPos);
      root.worldToLocal(p).add(lamp.offset);
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      let cd = 0;
      let facing = 0;
      if (level > 0) {
        const d = this.dir.copy(cam).sub(p).normalize();
        cd = this.intensityToward(id, d);
        // Lens surface: how much of the lit reflector the camera sees (in the beam or not).
        facing = Math.min(1, cd / this.peak(id));
      }
      const glow = cd * level * k;
      col[i * 3] = lamp.colour.r * glow;
      col[i * 3 + 1] = lamp.colour.g * glow;
      col[i * 3 + 2] = lamp.colour.b * glow;
      lamp.mat.emissiveIntensity = lamp.lensLuminance * SCENE_UNITS_PER_LUX * level * (0.15 + 0.85 * facing);
    }
    this.glowPos.needsUpdate = true;
    this.glowCol.needsUpdate = true;
  }

  private peak(id: LightId): number {
    switch (id) {
      case 'navL':
      case 'navR':
        return 40;
      case 'navTail':
        return CD.tail;
      case 'strobeL':
      case 'strobeR':
        return CD.strobe;
      case 'beacon':
        return CD.beacon;
      case 'landing':
        return CD.landing;
      case 'taxi':
        return CD.taxi;
    }
  }

  /** Luminous intensity (cd) of a lamp toward unit direction d (model space: forward -Z, right +X, up +Y). */
  private intensityToward(id: LightId, d: THREE.Vector3): number {
    const horiz = Math.hypot(d.x, d.z);
    const elev = Math.atan2(d.y, horiz) / DEG;
    // Azimuth from dead ahead, + to the right.
    const az = Math.atan2(d.x, -d.z) / DEG;
    switch (id) {
      case 'navL':
        return navHorizontal(-az) * verticalFactor(elev);
      case 'navR':
        return navHorizontal(az) * verticalFactor(elev);
      case 'navTail':
        return CD.tail * smooth(108, 112, Math.abs(az)) * verticalFactor(elev);
      case 'strobeL':
      case 'strobeR': {
        // Wide-angle flash tube: nearly omnidirectional, the wing hides it from the opposite side below.
        const side = id === 'strobeL' ? -1 : 1;
        const shadow = 1 - 0.8 * smooth(0.05, 0.4, -side * d.x) * smooth(0.05, 0.4, -d.y);
        return CD.strobe * (0.25 + 0.75 * Math.cos(Math.min(80, Math.abs(elev)) * DEG)) * shadow;
      }
      case 'beacon':
        return CD.beacon * Math.max(0.1, Math.cos(Math.min(85, Math.abs(elev)) * DEG));
      case 'landing':
      case 'taxi': {
        const axis = id === 'landing' ? this.landingAxis : this.taxiAxis;
        const c = Math.min(1, Math.max(-1, d.dot(axis)));
        const theta = Math.acos(c) / DEG;
        const hw = id === 'landing' ? 4 : 12;
        const peak = id === 'landing' ? CD.landing : CD.taxi;
        // Gaussian beam (half-width at half maximum hw) plus a little spill from the reflector rim; the
        // lamp is recessed in the leading edge, so nothing is seen from behind the wing.
        const beam = Math.exp(-Math.LN2 * (theta / hw) ** 2) + 0.001 * (1 - smooth(25, 80, theta));
        return peak * beam * smooth(-0.05, 0.25, c);
      }
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const lamp of Object.values(this.lamps)) lamp.mat.dispose();
    this.glowMat.dispose();
    this.haloMat.dispose();
  }
}
