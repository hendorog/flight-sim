// Airfield grass: 3D tufts on the mown grass inside the airport fence, within a few tens of metres of a low
// camera - the grass beside the runway is the first thing seen from the cockpit, and at grazing angles a
// flat texture cannot give it depth.
//
// Everything is placed on the GPU: the airfield is exactly flat (AIRPORT.elevation), so a fixed instance
// grid centred on the camera and anchored to world cells (each world cell always gets the same tuft, from
// an integer hash of the cell) needs no streaming. The vertex shader drops tufts on the pavement (the
// runway and the airport module's paved rectangles, with the same fillets), behind the apron (buildings,
// landside) and outside the fence; it leans them with the mowing passes the ground shader draws and sways
// them in the wind, and shrinks them away with distance.

import * as THREE from 'three';
import type { QualityLevel } from '../../../core/context';
import { AIRPORT } from '../../../core/world';
import { APRON_RECT, FENCE_RECT, FILLET_RADIUS, PAVED_RECTS, RUNWAY_HALF_LENGTH, RUNWAY_HALF_WIDTH } from '../../airport/layout';
import { HASH_GLSL } from '../glsl';
import { useVertexLogDepth } from './treeMaterials';

/** Grid cell (one tuft each), m, and the fade range per quality: [start, end] of the shrink-away, m. */
const CELL = 0.4;
const RANGE: Record<QualityLevel, number> = { low: 0, medium: 24, high: 34, ultra: 48 };
/** Tufts are drawn while the camera is this low over the field, m. */
const MAX_HEIGHT = 70;

function bladeAtlas(): THREE.DataTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  let seed = 1234567;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const srgb = (v: number): number => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  // Blades rooted along the bottom, tapering and bending; tips lighter and yellower (drying cut ends).
  for (let k = 0; k < 70; k++) {
    const x0 = S * (0.08 + 0.84 * rnd());
    const h = S * (0.45 + 0.53 * rnd());
    const bend = (rnd() - 0.5) * S * 0.35;
    const w = 2.5 + 3 * rnd();
    const v = 0.75 + 0.5 * rnd();
    const dry = rnd() < 0.2 ? 1 : 0;
    const steps = 12;
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      const px = (t: number): number => x0 + bend * t * t;
      const py = (t: number): number => S - t * h;
      const tip = t1;
      const r = (0.045 + 0.03 * tip + 0.04 * dry) * v;
      const gg = (0.085 + 0.02 * tip + 0.01 * dry) * v;
      const b = (0.028 + 0.004 * tip) * v;
      g.strokeStyle = `rgb(${srgb(r)},${srgb(gg)},${srgb(b)})`;
      g.lineWidth = w * (1 - 0.85 * t0);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(px(t0), py(t0));
      g.lineTo(px(t1), py(t1));
      g.stroke();
    }
  }
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  // Colour dilation (see foliageTexture.ts) so filtering never darkens the blade edges.
  let r = 0;
  let gg = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 128) {
      r += d[i];
      gg += d[i + 1];
      b += d[i + 2];
      n++;
    }
  }
  const flipped = new Uint8Array(d.length);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const o = ((S - 1 - y) * S + x) * 4;
      const clear = d[i + 3] < 8;
      flipped[o] = clear ? r / n : d[i];
      flipped[o + 1] = clear ? gg / n : d[i + 1];
      flipped[o + 2] = clear ? b / n : d[i + 2];
      flipped[o + 3] = clear ? 0 : d[i + 3];
    }
  }
  const tex = new THREE.DataTexture(flipped, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** One tuft: three crossed cards, 1 x 1 (scaled per instance), normals leaning up so it shades like turf. */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI) / 3;
    const cx = Math.cos(a) * 0.5;
    const cz = Math.sin(a) * 0.5;
    const base = pos.length / 3;
    const n = [-Math.sin(a) * 0.35, 1, Math.cos(a) * 0.35];
    for (const [x, y, z, u, v] of [
      [-cx, 0, -cz, 0, 0],
      [cx, 0, cz, 1, 0],
      [cx, 1, cz, 1, 1],
      [-cx, 1, -cz, 0, 1],
    ]) {
      pos.push(x, y, z);
      nrm.push(...n);
      uv.push(u, v);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const RECTS = [{ u0: -RUNWAY_HALF_LENGTH, u1: RUNWAY_HALF_LENGTH, v0: -RUNWAY_HALF_WIDTH, v1: RUNWAY_HALF_WIDTH }, ...PAVED_RECTS];

const VERTEX_HEAD = /* glsl */ `
${HASH_GLSL}
uniform ivec2 uGridOrigin;
uniform int uGridSize;
uniform float uRange;
uniform float uTime;
uniform vec4 uRunwayAxis;
uniform vec4 uPaved[${RECTS.length}];
varying float vTip;
varying float vTone;
float rectSD(vec2 p, vec4 r) {
  vec2 d = max(vec2(r.x - p.x, r.z - p.y), vec2(p.x - r.y, p.y - r.w));
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sminF(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
`;

const VERTEX_BEGIN = /* glsl */ `
int gi = gl_InstanceID % uGridSize;
int gj = gl_InstanceID / uGridSize;
ivec2 cellI = uGridOrigin + ivec2(gi, gj);
uint h0 = hash2u(cellI.x, cellI.y);
float r1 = float(h0 & 0xffffu) / 65535.0;
float r2 = float(h0 >> 16) / 65535.0;
uint h1 = hash2u(cellI.y + 7919, cellI.x - 104729);
float r3 = float(h1 & 0xffffu) / 65535.0;
float r4 = float(h1 >> 16) / 65535.0;
// World position (three.js x = east, z = -north) of this cell's tuft.
vec2 wp = (vec2(cellI) + vec2(r1, r2)) * ${CELL.toFixed(3)};
// Runway coordinates (as runwayCoords() in core/world.ts).
float de = wp.x - uRunwayAxis.x;
float dn = -wp.y - uRunwayAxis.y;
vec2 rw = vec2(dn * uRunwayAxis.z + de * uRunwayAxis.w, -dn * uRunwayAxis.w + de * uRunwayAxis.z);
// Off the pavement (with a margin for edge lights and the paint), inside the fence, not behind the apron.
float paved = rectSD(rw, uPaved[0]);
for (int k = 1; k < ${RECTS.length}; k++) paved = sminF(paved, rectSD(rw, uPaved[k]), ${FILLET_RADIUS.toFixed(1)});
bool keep = paved > 1.2 + 0.8 * r3
  && rw.x > ${(FENCE_RECT.u0 + 3).toFixed(1)} && rw.x < ${(FENCE_RECT.u1 - 3).toFixed(1)}
  && rw.y > ${(APRON_RECT.v0 - 2).toFixed(1)} && rw.y < ${(FENCE_RECT.v1 - 3).toFixed(1)};
float dist = distance(vec3(wp.x, ${AIRPORT.elevation.toFixed(1)}, wp.y), cameraPosition);
// Shrink away with distance (no popping), and a little shorter where the strip is cut shortest.
float size = (1.0 - smoothstep(uRange * 0.6, uRange, dist)) * (0.75 + 0.5 * r4);
float strip = 1.0 - smoothstep(60.0, 85.0, abs(rw.y));
float height = (0.22 - 0.08 * strip) * size;
float width = 0.5 * size;
float yaw = r3 * 6.2831853;
float c = cos(yaw), s = sin(yaw);
vec3 p = position * vec3(width, height, width);
p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
// Lean: with the mowing pass (alternate directions, as the ground shader's stripes), and a slow sway.
float pass = mod(floor(rw.y / 5.5), 2.0) * 2.0 - 1.0;
vec2 axis = vec2(uRunwayAxis.w, -uRunwayAxis.z);
float t = position.y;
vec2 lean = axis * pass * 0.35 + 0.18 * vec2(sin(uTime * 1.7 + r1 * 30.0 + wp.x * 0.3), cos(uTime * 1.3 + r2 * 30.0 + wp.y * 0.3));
p.xz += lean * t * t * height;
vec3 transformed = p + vec3(wp.x, ${AIRPORT.elevation.toFixed(2)}, wp.y);
if (!keep || size <= 0.0) transformed = vec3(0.0, -1e6, 0.0);
vTip = t;
vTone = 0.85 + 0.3 * r4;
`;

export class AirfieldGrass {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly atlas: THREE.DataTexture;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly uniforms = {
    uGridOrigin: { value: new THREE.Vector2(0, 0) },
    uGridSize: { value: 1 },
    uRange: { value: RANGE.high },
    uTime: { value: 0 },
    uRunwayAxis: {
      value: new THREE.Vector4(AIRPORT.runway.center.east, AIRPORT.runway.center.north, Math.cos(AIRPORT.runway.heading), Math.sin(AIRPORT.runway.heading)),
    },
    uPaved: { value: RECTS.map((r) => new THREE.Vector4(r.u0, r.u1, r.v0, r.v1)) },
  };
  private range = RANGE.high;

  constructor() {
    this.atlas = bladeAtlas();
    const base = tuftGeometry();
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = base.index;
    for (const [k, a] of Object.entries(base.attributes)) this.geometry.setAttribute(k, a);
    this.material = new THREE.MeshStandardMaterial({ map: this.atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
    this.material.name = 'airfield-grass';
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      // ivec2 uniforms: three uploads a Vector2 to an ivec2 as integers.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
        .replace('#include <begin_vertex>', VERTEX_BEGIN);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vTip;\nvarying float vTone;')
        // Blades are darker in the base of the tuft (self-shadowed), toned per tuft.
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vTone * mix(0.7, 1.1, vTip);')
        // Shade like the turf around it: undo the back-face flip and lean the normal up.
        .replace(
          '#include <normal_fragment_begin>',
          '#include <normal_fragment_begin>\nnormal *= faceDirection;\nnormal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, 0.6));',
        )
        .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularF90 = 0.3;');
      useVertexLogDepth(shader);
    };
    this.material.customProgramCacheKey = () => 'airfield-grass-v2';
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'airfield-grass';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.renderOrder = 1;
    this.setQuality('high');
  }

  setQuality(q: QualityLevel): void {
    this.range = RANGE[q];
    const n = Math.ceil((2 * this.range) / CELL);
    this.uniforms.uGridSize.value = n;
    this.uniforms.uRange.value = this.range;
    this.geometry.instanceCount = n * n;
    this.material.alphaToCoverage = q !== 'low';
    this.material.needsUpdate = true;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.uniforms.uTime.value += dt;
    const p = camera.position;
    // Only while low over the airfield (the fence box grown by the range).
    const u = runwayU(p);
    const near =
      this.range > 0 &&
      p.y - AIRPORT.elevation < MAX_HEIGHT &&
      u.along > FENCE_RECT.u0 - this.range &&
      u.along < FENCE_RECT.u1 + this.range &&
      u.across > FENCE_RECT.v0 - this.range &&
      u.across < FENCE_RECT.v1 + this.range;
    this.mesh.visible = near;
    if (!near) return;
    const n = this.uniforms.uGridSize.value;
    this.uniforms.uGridOrigin.value.set(Math.floor(p.x / CELL) - (n >> 1), Math.floor(p.z / CELL) - (n >> 1));
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.atlas.dispose();
  }
}

function runwayU(p: THREE.Vector3): { along: number; across: number } {
  const dn = -p.z - AIRPORT.runway.center.north;
  const de = p.x - AIRPORT.runway.center.east;
  const c = Math.cos(AIRPORT.runway.heading);
  const s = Math.sin(AIRPORT.runway.heading);
  return { along: dn * c + de * s, across: -dn * s + de * c };
}
