// Clipped hedges: the mature macrocarpa shelterbelts, kept trimmed into continuous walls with square sides and a
// flat top (placement.ts plantShelterbelts emits them as wall pieces per tree cell). Drawn as one instanced box per
// piece, sheared so its base and top follow the ground between the piece's ends, in a dense-foliage material:
// darker in the hollows and lighter where the clipped surface faces the sky, mottled at two scales, the fresh
// growth on the top a little paler. All the pieces of every loaded cell are drawn (a few hundred boxes), so a belt
// stays solid as far as the cells reach.

import * as THREE from 'three';
import { WALL_STRIDE, type TreeCellData } from './placement';

/** The hedge stands this far into the ground at its lower end, m (so it never shows a gap on a slope). */
const FOOT = 1;

export class HedgeWalls {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.BoxGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private capacity = 0;
  private readonly m = new THREE.Matrix4();

  constructor() {
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    // Unit box with its base at y = 0.
    this.geometry.translate(0, 0.5, 0);
    this.material = createHedgeMaterial();
    this.mesh = this.allocate(256);
  }

  private allocate(n: number): THREE.InstancedMesh {
    this.capacity = n;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, n);
    mesh.name = 'clipped-hedges';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  }

  /** Lay out the pieces of these cells. Returns the mesh to draw (a new one when the capacity had to grow). */
  rebuild(cells: Iterable<TreeCellData>): THREE.InstancedMesh {
    let n = 0;
    for (const c of cells) n += c.walls.length / WALL_STRIDE;
    let mesh = this.mesh;
    if (n > this.capacity) {
      mesh.dispose();
      let cap = this.capacity;
      while (cap < n) cap *= 2;
      mesh = this.allocate(cap);
      (this as { mesh: THREE.InstancedMesh }).mesh = mesh;
    }
    let i = 0;
    for (const c of cells) {
      const w = c.walls;
      for (let o = 0; o < w.length; o += WALL_STRIDE) {
        const [ea, na, ga, eb, nb, gb, h, wide] = [w[o], w[o + 1], w[o + 2], w[o + 3], w[o + 4], w[o + 5], w[o + 6], w[o + 7]];
        // World: x east, y up, z south. Box x along the piece (rising with the ground), y up, z across.
        const dx = eb - ea;
        const dz = -(nb - na);
        const len = Math.hypot(dx, dz) || 1;
        const ux = (-dz / len) * wide;
        const uz = (dx / len) * wide;
        this.m.set(dx, 0, ux, (ea + eb) / 2, gb - ga, h + FOOT, 0, (ga + gb) / 2 - FOOT, dz, 0, uz, -(na + nb) / 2, 0, 0, 0, 1);
        mesh.setMatrixAt(i++, this.m);
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Dense clipped foliage: dark green, mottled by world-position noise, the sky-facing top a little fresher. */
function createHedgeMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.008, 0.026, 0.006), roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHedgePos;\nvarying vec3 vHedgeN;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvHedgePos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\nvHedgeN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vHedgePos;
varying vec3 vHedgeN;
float hedgeHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hedgeNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hedgeHash(i), hedgeHash(i + vec3(1, 0, 0)), f.x), mix(hedgeHash(i + vec3(0, 1, 0)), hedgeHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hedgeHash(i + vec3(0, 0, 1)), hedgeHash(i + vec3(1, 0, 1)), f.x), mix(hedgeHash(i + vec3(0, 1, 1)), hedgeHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  // Mottling: clumps of a metre or two, and leafy speckle; the clipped top a little paler and yellower.
  float big = hedgeNoise(vHedgePos * 0.6);
  float fine = hedgeNoise(vHedgePos * 3.1);
  diffuseColor.rgb *= 0.65 + 0.5 * big + 0.35 * (fine - 0.5);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(1.15, 1.2, 0.95), smoothstep(0.6, 0.9, vHedgeN.y));
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  // Lumpy clipped surface: tilt the face normal by the noise gradient (in view space).
  vec3 p = vHedgePos * 1.3;
  float e = 0.35;
  vec3 g = vec3(hedgeNoise(p + vec3(e, 0, 0)) - hedgeNoise(p - vec3(e, 0, 0)), hedgeNoise(p + vec3(0, e, 0)) - hedgeNoise(p - vec3(0, e, 0)),
                hedgeNoise(p + vec3(0, 0, e)) - hedgeNoise(p - vec3(0, 0, e)));
  normal = normalize(normal - 0.6 * (mat3(viewMatrix) * g));
}`,
      );
  };
  mat.customProgramCacheKey = () => 'clipped-hedge-v1';
  return mat;
}
