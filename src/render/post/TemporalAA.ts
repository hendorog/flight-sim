// Temporal stabilisation (TAA without jitter). Thin, sub-pixel features drawn by shaders - distant field
// edges, roads, power lines, the terrain's procedural detail - are sampled at one point per pixel, so as
// the camera moves they break into dashes whose gaps crawl from frame to frame. MSAA does not help (it
// only supersamples geometric edges). This pass blends each pixel with its reprojected history, which in
// motion integrates the many sub-pixel sample positions the moving camera visits - the same principle as
// TAA, with the camera's own motion as the jitter. With no projection jitter a still image is untouched
// (history = current) and nothing wobbles: the cockpit, the panel lettering and the aircraft stay exactly
// where they are drawn.
//
// Reprojection: each pixel's position is rebuilt from the log depth buffer (camera-relative, so float32
// keeps mm precision at any distance from the origin) and moved with the camera to the previous frame;
// pixels on the player aircraft (within its bounding sphere) move with the aircraft instead, so the
// airframe in chase, cockpit and tower views reprojects correctly. The history is sampled with a 5-tap
// Catmull-Rom filter (no progressive blur) and clipped to the current 3x3 neighbourhood's colour
// distribution in YCoCg (variance clipping, Salvi 2016), which rejects disocclusions, moving lights,
// the propeller and instrument needles. Blending is done on 1/(1+luma)-weighted colour so a bright pixel
// cannot smear (Karis 2014).

import * as THREE from 'three';
import { C172S_GEOMETRY } from '../../aircraft/c172s/geometry';
import { DEPTH_GLSL } from '../../core/shaderLib';
import { passMaterial } from './FullscreenPass';

/** Weight of the current frame in the blend (history lasts ~1/ALPHA frames). */
const ALPHA = 0.12;
/** Sharpening of the resampled history (see the shader). */
const HISTORY_SHARPEN = 0.8;
/** Variance-clip box half-size in standard deviations. */
const CLIP_GAMMA = 1.0;
/** Margin around the aircraft's bounding radius inside which pixels still move with the aircraft, m. */
const AIRCRAFT_MARGIN = 1;
/** Camera jumps larger than these (a cut, reset or teleport) restart the history. */
const CUT_DISTANCE = 300;
const CUT_ANGLE = 0.35;

const TAA_FRAG = /* glsl */ `
${DEPTH_GLSL}
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform vec2 uTanHalf;
uniform vec2 uPrevTanHalf;
uniform mat3 uCamToWorld;
uniform mat3 uPrevWorldToCam;
uniform vec3 uCamDelta;        // camera position - previous camera position
uniform vec4 uAircraft;        // xyz aircraft origin relative to the camera, w: radius (0 = none)
uniform mat3 uAircraftRot;     // aircraft rotation (local -> world)
uniform vec3 uAircraftPrev;    // previous aircraft origin relative to the previous camera
uniform mat3 uAircraftPrevRot;
uniform float uAlpha;          // 1 = no history
uniform float uHistSharpen;
varying vec2 vUv;

vec3 load(vec2 uv) {
  vec3 c = texture2D(tCurrent, uv).rgb;
  return any(isnan(c)) || any(isinf(c)) ? vec3(0.0) : clamp(c, 0.0, 60000.0);
}
// Tone-weighted YCoCg: bright pixels are compressed so they neither dominate the clip box nor smear.
vec3 toYCoCg(vec3 c) {
  c /= 1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722));
  return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
vec3 fromYCoCg(vec3 y) {
  vec3 c = vec3(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z);
  return c / max(1.0 - dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
}

// 5-tap Catmull-Rom history sample (Jimenez 2016).
vec3 history(vec2 uv) {
  vec2 size = 1.0 / uTexel;
  vec2 p = uv * size;
  vec2 t1 = floor(p - 0.5) + 0.5;
  vec2 f = p - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 tc0 = (t1 - 1.0) * uTexel;
  vec2 tc3 = (t1 + 2.0) * uTexel;
  vec2 tc12 = (t1 + w2 / w12) * uTexel;
  vec3 c = texture2D(tHistory, vec2(tc12.x, tc0.y)).rgb * w12.x * w0.y
         + texture2D(tHistory, vec2(tc0.x, tc12.y)).rgb * w0.x * w12.y
         + texture2D(tHistory, tc12).rgb * w12.x * w12.y
         + texture2D(tHistory, vec2(tc3.x, tc12.y)).rgb * w3.x * w12.y
         + texture2D(tHistory, vec2(tc12.x, tc3.y)).rgb * w12.x * w3.y;
  float w = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(c / w, 0.0);
}

void main() {
  vec3 cur = load(vUv);
  if (uAlpha >= 1.0) { gl_FragColor = vec4(cur, 1.0); return; }

  // Neighbourhood statistics (3x3) in tone-weighted YCoCg.
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec3 y = toYCoCg(i == 0 && j == 0 ? cur : load(vUv + vec2(i, j) * uTexel));
      m1 += y;
      m2 += y * y;
    }
  }
  m1 /= 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));
  vec3 lo = m1 - ${CLIP_GAMMA.toFixed(2)} * sigma;
  vec3 hi = m1 + ${CLIP_GAMMA.toFixed(2)} * sigma;

  // Reproject: camera-relative position of this pixel, then into the previous frame's camera.
  float d = texture2D(tDepth, vUv).r;
  vec3 view = vec3((vUv * 2.0 - 1.0) * uTanHalf, -1.0);
  vec3 prevView;
  if (isSky(d)) {
    prevView = uPrevWorldToCam * (uCamToWorld * view);
  } else {
    vec3 rel = uCamToWorld * (view * viewZFromDepth(d));
    vec3 ac = rel - uAircraft.xyz;
    vec3 prevRel = dot(ac, ac) < uAircraft.w * uAircraft.w
      ? uAircraftPrev + uAircraftPrevRot * (transpose(uAircraftRot) * ac)
      : rel + uCamDelta;
    prevView = uPrevWorldToCam * prevRel;
  }
  vec2 prevUv = prevView.z < 0.0 ? (prevView.xy / -prevView.z) / uPrevTanHalf * 0.5 + 0.5 : vec2(-1.0);
  if (any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0)))) {
    gl_FragColor = vec4(cur, 1.0);
    return;
  }

  // Variance clipping: pull the history toward the box centre until it lies inside.
  // Resampling the history at a fractional offset every frame softens it a little each time; restore the
  // lost high frequencies against a bilinear tap (the difference is what the filters remove).
  vec3 hc = history(prevUv);
  vec3 h = toYCoCg(max(hc + uHistSharpen * (hc - texture2D(tHistory, prevUv).rgb), 0.0));
  vec3 e = 0.5 * (hi - lo) + 1e-6;
  vec3 v = (h - 0.5 * (hi + lo)) / e;
  float m = max(abs(v.x), max(abs(v.y), abs(v.z)));
  if (m > 1.0) h = 0.5 * (hi + lo) + (h - 0.5 * (hi + lo)) / m;

  vec3 y = mix(h, toYCoCg(cur), uAlpha);
  gl_FragColor = vec4(fromYCoCg(y), 1.0);
}
`;

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _rot = new THREE.Matrix4();

export class TemporalAA {
  /** Off: the pass is skipped and the history dropped. */
  enabled = true;
  /** Weight of the current frame. */
  alpha = ALPHA;
  get sharpen(): number {
    return this.material.uniforms.uHistSharpen.value as number;
  }
  set sharpen(v: number) {
    this.material.uniforms.uHistSharpen.value = v;
  }
  /** Radius around the aircraft origin whose pixels move with the aircraft, m (C172S: 7.5; span 11 m). */
  private aircraftRadius = C172S_GEOMETRY.bounds.radius + AIRCRAFT_MARGIN;
  private targets: THREE.WebGLRenderTarget[] = [];
  private current = 0;
  private valid = false;
  private readonly material = passMaterial({
    fragmentShader: TAA_FRAG,
    uniforms: {
      tCurrent: { value: null },
      tHistory: { value: null },
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uTanHalf: { value: new THREE.Vector2() },
      uPrevTanHalf: { value: new THREE.Vector2() },
      uCamToWorld: { value: new THREE.Matrix3() },
      uPrevWorldToCam: { value: new THREE.Matrix3() },
      uCamDelta: { value: new THREE.Vector3() },
      uAircraft: { value: new THREE.Vector4() },
      uAircraftRot: { value: new THREE.Matrix3() },
      uAircraftPrev: { value: new THREE.Vector3() },
      uAircraftPrevRot: { value: new THREE.Matrix3() },
      uAlpha: { value: 1 },
      uHistSharpen: { value: HISTORY_SHARPEN },
    },
  });
  // Previous frame's camera and aircraft.
  private readonly prevCamPos = new THREE.Vector3();
  private readonly prevCamQuat = new THREE.Quaternion();
  private readonly prevAcPos = new THREE.Vector3();
  private readonly prevAcRot = new THREE.Matrix3();
  private hasAircraft = false;
  private readonly camPos = new THREE.Vector3();
  private readonly camQuat = new THREE.Quaternion();

  setSize(width: number, height: number): void {
    for (const t of this.targets) t.dispose();
    this.targets = [0, 1].map(
      () =>
        new THREE.WebGLRenderTarget(width, height, {
          type: THREE.HalfFloatType,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
        }),
    );
    this.material.uniforms.uTexel.value.set(1 / width, 1 / height);
    this.valid = false;
  }

  /** The aircraft drawn: its bounding radius about the reference point, m (the value the cameras take too). */
  setAircraftRadius(radius: number): void {
    this.aircraftRadius = radius + AIRCRAFT_MARGIN;
  }

  /** Drop the history (a camera cut, scenario reset or teleport). */
  reset(): void {
    this.valid = false;
  }

  /**
   * Blend `input` with the reprojected history; returns the stabilised frame (valid until the next call).
   * @param aircraft the player aircraft's root (moves with its own motion), or null
   */
  render(
    renderer: THREE.WebGLRenderer,
    input: THREE.Texture,
    depth: THREE.Texture,
    camera: THREE.PerspectiveCamera,
    aircraft: THREE.Object3D | null,
    draw: (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) => void,
  ): THREE.Texture {
    if (!this.enabled || this.targets.length === 0) {
      this.valid = false;
      return input;
    }
    const u = this.material.uniforms;
    camera.updateMatrixWorld();
    camera.matrixWorld.decompose(this.camPos, this.camQuat, _scale);
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
    const tan = new THREE.Vector2(tanY * camera.aspect, tanY);

    const cut = !this.valid || this.camPos.distanceTo(this.prevCamPos) > CUT_DISTANCE || this.camQuat.angleTo(this.prevCamQuat) > CUT_ANGLE;
    u.uAlpha.value = cut ? 1 : this.alpha;
    u.tCurrent.value = input;
    u.tDepth.value = depth;
    u.tHistory.value = this.targets[this.current].texture;
    u.uTanHalf.value.copy(tan);
    (u.uCamToWorld.value as THREE.Matrix3).setFromMatrix4(_rot.makeRotationFromQuaternion(this.camQuat));
    (u.uPrevWorldToCam.value as THREE.Matrix3).setFromMatrix4(_rot.makeRotationFromQuaternion(this.prevCamQuat)).transpose();
    u.uCamDelta.value.subVectors(this.camPos, this.prevCamPos);

    // Aircraft motion: current pose relative to the current camera, previous relative to the previous one.
    let acPos: THREE.Vector3 | null = null;
    if (aircraft) {
      aircraft.updateMatrixWorld();
      aircraft.matrixWorld.decompose(_pos, _quat, _scale);
      acPos = _pos.clone();
      const rot = (u.uAircraftRot.value as THREE.Matrix3).setFromMatrix4(_rot.makeRotationFromQuaternion(_quat));
      u.uAircraft.value.set(acPos.x - this.camPos.x, acPos.y - this.camPos.y, acPos.z - this.camPos.z, this.hasAircraft ? this.aircraftRadius : 0);
      u.uAircraftPrev.value.subVectors(this.prevAcPos, this.prevCamPos);
      (u.uAircraftPrevRot.value as THREE.Matrix3).copy(this.prevAcRot);
      this.prevAcRot.copy(rot);
      this.prevAcPos.copy(acPos);
      this.hasAircraft = true;
    } else {
      u.uAircraft.value.set(0, 0, 0, 0);
      this.hasAircraft = false;
    }
    u.uPrevTanHalf.value.copy(this.valid ? this.prevTan : tan);

    this.current ^= 1;
    const out = this.targets[this.current];
    draw(this.material, out);

    this.prevCamPos.copy(this.camPos);
    this.prevCamQuat.copy(this.camQuat);
    this.prevTan.copy(tan);
    this.valid = true;
    return out.texture;
  }

  private readonly prevTan = new THREE.Vector2();

  dispose(): void {
    for (const t of this.targets) t.dispose();
    this.material.dispose();
  }
}
