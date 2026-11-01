// The smoke marker (docs/career.md "Build plan", wave 4, 4a): the coloured smoke flare a ground crew lights at a
// helicopter landing site, so a pilot can find the site and read the wind from a few kilometres. The CareerSystem
// adds it to the scene once (CareerShell.addToScene), places it on a medevac's site and shows it only while the job's
// next point is that site (a landing waypoint); every other moment it is hidden.
//
// THE PLUME. A stream of soft puffs, SMOKE_RULES.ratePerS a second, each living about lifeS seconds. A puff leaves the
// canister with a little buoyancy (riseFastMs decaying over riseTauS, then riseMs), is carried off by the surface wind
// (driftFactor of it: the smoke sits in the slower air near the ground; it takes up the wind over driftTauS), wanders
// a little, grows as it mixes (radius r0M + growM x age^growPow) and thins out. A stronger wind bends the plume over
// (the rise is divided by 1 + windMs / bendMs) and stretches it downwind, so the plume shows the wind's direction and
// strength, as a real flare does. Every puff is an analytic function of its age and the wind now (its birth time is
// k / ratePerS), so the plume is exact at any frame rate, under time acceleration and after a fast-forward.
//
// RENDERING (src/core/context.ts conventions). One draw: an InstancedBufferGeometry of camera-facing quads (the corner
// offset added in view space), each puff's centre, radius, opacity and spin as instance attributes. The colour is
// lit like the terrain is lit (SkySystem: albedo x (sun / pi + sky)), the sun and sky from ctx.sky each frame, so the
// orange reads right in the HDR scene at any time of day. The post chain draws the sky, the clouds and the haze from
// the depth buffer (PostPipeline: wherever the depth is still clear it paints sky over whatever was drawn), so a
// blended, depth-less puff against the sky would vanish. The smoke is therefore drawn as an opaque surface with
// stochastic transparency: each fragment is kept with the puff's opacity as its probability (interleaved gradient
// noise, decorrelated per puff and moved on every frame, uFrame) and writes depth; the temporal stabilisation
// (TemporalAA.ts, medium quality and up) averages the frames into a translucent plume, hazed at its own distance.
// three's logdepthbuf chunks for either depth convention, no scene.fog.

import * as THREE from 'three';
import { nedToThree } from '../../core/frames';
import { KT } from '../../core/math';

/** The plume's rules (see the header). Times s, distances m, speeds m/s. */
export const SMOKE_RULES = {
  /** Instance slots: at least ratePerS x lifeS x (1 + lifeSpread / 2). */
  puffs: 192,
  ratePerS: 6,
  lifeS: 26,
  /** Each puff lives lifeS x (1 - lifeSpread / 2 + lifeSpread x u). */
  lifeSpread: 0.4,
  riseFastMs: 4, riseTauS: 3, riseMs: 1,
  /** The rise is divided by 1 + wind / bendMs. */
  bendMs: 5,
  driftFactor: 0.8, driftTauS: 2,
  /** Turbulent wander, m per s^wanderPow of age. */
  wanderM: 0.6, wanderPow: 0.8,
  /** Radius r0M + growM x age^growPow: a few metres at the canister, some 30 m where it thins out. */
  r0M: 0.8, growM: 2, growPow: 0.85,
  /** Each puff's radius varies by this share either way. */
  sizeSpread: 0.25,
  /**
   * Opacity at the canister, the fade-in time and the fade's power over the life; the smoke thins as it spreads:
   * x (diluteM / radius)^dilutePow (not above 1, not below diluteFloor).
   */
  alpha: 0.95, fadeInS: 0.3, fadePow: 1.4, diluteM: 5, dilutePow: 0.5, diluteFloor: 0.3,
  /** The smoke's colour (linear reflectance): a signal orange. */
  albedo: [0.8, 0.3, 0.06] as const,
  /** Share of the direct sun a puff takes (it is lit through and from the side). */
  sunShare: 0.65,
} as const;

/** The lighting a frame gives the smoke (ctx.sky's sunColor and skyColor, linear HDR). */
export interface SmokeLight {
  sunColor: { r: number; g: number; b: number };
  skyColor: { r: number; g: number; b: number };
}

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aCentre;
attribute float aSize;
attribute float aAlpha;
attribute float aSpin;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(aCentre, 1.0);
  float c = cos(aSpin);
  float s = sin(aSpin);
  mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * aSize;
  vUv = position.xy;
  vAlpha = aAlpha;
  vSeed = aSpin;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uLight;
uniform float uFrame;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vUv);
  if (r > 1.0) discard;
  vec2 q = vUv + vec2(vSeed * 3.7, vSeed * 1.9);
  float n = 0.6 * noise2(q * 2.5) + 0.4 * noise2(q * 5.0 + 7.0);
  // A billowed outline: the noise moves the edge in and out.
  float a = vAlpha * (1.0 - smoothstep(0.35, 1.0, r + (n - 0.5) * 0.9));
  // Firm up the opacity (dense smoke reads as solid billows), leaving a narrow dithered band at the edges.
  a = smoothstep(0.08, 0.5, a);
  // Stochastic transparency: kept with probability a (interleaved gradient noise, per puff and per frame).
  vec2 px = gl_FragCoord.xy + 5.588238 * mod(uFrame, 64.0);
  float keep = fract(fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))) + vSeed * 0.6180339);
  if (a <= keep) discard;
  // A little body: lighter in the middle and on top, the noise's texture.
  float body = (0.55 + 0.3 * (1.0 - r * r) + 0.2 * vUv.y) * (0.9 + 0.2 * fract(vSeed * 7.31));
  gl_FragColor = vec4(uLight * body * (0.75 + 0.5 * n), 1.0);
}
`;

/** A tiny integer hash to [0, 1) (each puff's own variation, the same every frame). */
function rand(k: number, salt: number): number {
  let h = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** The coloured smoke plume at a site (see the header). */
export class SmokeMarker {
  /** The scene object (add it once; `visible` is the marker's own switch). */
  readonly object: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly centre: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly spin: Float32Array;
  /** The smoke's own clock, s (frames' sim time while shown). */
  private t = 0;

  constructor() {
    const n = SMOKE_RULES.puffs;
    const quad = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    this.centre = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.spin = new Float32Array(n);
    g.setAttribute('aCentre', new THREE.InstancedBufferAttribute(this.centre, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.InstancedBufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSpin', new THREE.InstancedBufferAttribute(this.spin, 1).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = n;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      name: 'careerSmokeMarker',
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uLight: { value: new THREE.Vector3(1, 0.4, 0.05) }, uFrame: { value: 0 } },
    });
    this.object = new THREE.Mesh(g, this.material);
    this.object.name = 'careerSmokeMarker';
    this.object.frustumCulled = false;
    this.object.visible = false;
  }

  /** Shown or hidden (hidden, it costs nothing: the renderer skips it and update() returns at once). */
  get visible(): boolean {
    return this.object.visible;
  }

  set visible(on: boolean) {
    this.object.visible = on;
  }

  /** Put the canister at a NED point on the ground (`elevationM` MSL); the plume starts afresh. */
  place(north: number, east: number, elevationM: number): void {
    nedToThree({ x: north, y: east, z: -elevationM }, this.object.position);
    this.object.updateMatrix();
    this.object.updateMatrixWorld(true);
    this.t = 0;
  }

  /**
   * Advance the plume by `dt` sim seconds in the surface wind (from `windFromDeg` true, `windKt`) and light it with
   * `light` (ctx.sky; null keeps the last). Does nothing while hidden.
   */
  update(dt: number, windFromDeg: number, windKt: number, light: SmokeLight | null): void {
    if (!this.object.visible) return;
    if (dt > 0 && Number.isFinite(dt)) this.t += dt;
    this.material.uniforms.uFrame.value = (this.material.uniforms.uFrame.value + 1) % 64;
    const R = SMOKE_RULES;
    if (light) {
      const k = R.sunShare / Math.PI;
      const u = this.material.uniforms.uLight.value as THREE.Vector3;
      u.set(
        R.albedo[0] * (light.sunColor.r * k + light.skyColor.r),
        R.albedo[1] * (light.sunColor.g * k + light.skyColor.g),
        R.albedo[2] * (light.sunColor.b * k + light.skyColor.b),
      );
    }
    // The wind blows towards windFromDeg + 180: NED velocity, then the three axes (x east, y up, z -north).
    const ws = Math.max(0, windKt) * KT;
    const to = ((windFromDeg + 180) * Math.PI) / 180;
    const vn = Math.cos(to) * ws * R.driftFactor;
    const ve = Math.sin(to) * ws * R.driftFactor;
    const bend = 1 / (1 + ws / R.bendMs);
    this.alpha.fill(0);
    const maxLife = R.lifeS * (1 + R.lifeSpread / 2);
    const kHi = Math.floor(this.t * R.ratePerS);
    const kLo = Math.max(0, Math.ceil((this.t - maxLife) * R.ratePerS));
    for (let k = kLo; k <= kHi; k++) {
      const age = this.t - k / R.ratePerS;
      const life = R.lifeS * (1 - R.lifeSpread / 2 + R.lifeSpread * rand(k, 1));
      if (age < 0 || age >= life) continue;
      const slot = k % R.puffs;
      const carried = age - R.driftTauS * (1 - Math.exp(-age / R.driftTauS));
      const wander = R.wanderM * Math.pow(age, R.wanderPow);
      const ph = rand(k, 2) * Math.PI * 2;
      const dn = vn * carried + wander * Math.cos(ph + 0.3 * age);
      const de = ve * carried + wander * Math.sin(ph + 0.3 * age);
      const up = (R.riseMs * age + R.riseFastMs * R.riseTauS * (1 - Math.exp(-age / R.riseTauS))) * bend;
      const radius = (R.r0M + R.growM * Math.pow(age, R.growPow)) * (1 - R.sizeSpread + 2 * R.sizeSpread * rand(k, 4));
      const dilute = Math.max(R.diluteFloor, Math.min(1, Math.pow(R.diluteM / radius, R.dilutePow)));
      this.centre[slot * 3] = de;
      this.centre[slot * 3 + 1] = up + 0.5 * radius * Math.min(1, age);
      this.centre[slot * 3 + 2] = -dn;
      this.size[slot] = radius;
      this.alpha[slot] = R.alpha * dilute * Math.min(1, age / R.fadeInS) * Math.pow(1 - age / life, R.fadePow);
      this.spin[slot] = rand(k, 3) * Math.PI * 2 + 0.05 * age;
    }
    for (const name of ['aCentre', 'aSize', 'aAlpha', 'aSpin']) (this.geometry.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  /** Puffs drawn now (opacity above zero): what the tests look at. */
  livePuffs(): number {
    let n = 0;
    for (const a of this.alpha) if (a > 0) n++;
    return n;
  }

  /** The plume's centre of mass now, NED m from the canister (downwind of it in any wind). */
  drift(): { north: number; east: number; up: number } {
    let w = 0;
    let n = 0;
    let e = 0;
    let u = 0;
    for (let i = 0; i < this.alpha.length; i++) {
      const a = this.alpha[i];
      if (a <= 0) continue;
      w += a;
      e += a * this.centre[i * 3];
      u += a * this.centre[i * 3 + 1];
      n += a * -this.centre[i * 3 + 2];
    }
    return w > 0 ? { north: n / w, east: e / w, up: u / w } : { north: 0, east: 0, up: 0 };
  }

  /** Out of the scene, its buffers and program freed (the CareerSystem's dispose). */
  dispose(): void {
    this.object.visible = false;
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
