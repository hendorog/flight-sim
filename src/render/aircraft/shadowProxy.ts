// Shadow casting for the aircraft through a few merged depth-only proxies.
//
// The visible aircraft is ~90 meshes, split by material and by moving part. For the shadow maps the
// material does not matter (every opaque caster renders with the same depth material), so drawing each of
// them into every shadow cascade wastes hundreds of draw calls per frame. Instead, the casting meshes that
// move together are merged into one position-only proxy per rigid part: one for the whole static airframe,
// one per moving group (landing-gear axles, nose-gear slider, yokes...). The originals stop casting.
//
// A proxy must not appear in the main view. Its onBeforeRender (main pass only) empties its draw range, so
// the renderer skips the draw; onBeforeShadow (shadow pass only) restores it.
//
// Meshes that keep casting themselves: alpha-tested ones (the skin's window openings let the sun into the
// cabin), transparent ones, deforming geometry (gear legs) and any mesh that is itself animated.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface ShadowRig {
  /** Nodes whose transform changes at run time; each gets its own proxy for the casters beneath it. */
  moving: Iterable<THREE.Object3D>;
  /** Casting meshes left as they are (deforming or individually posed geometry). */
  keep?: Iterable<THREE.Mesh>;
  /** Meshes that should not cast at all (hidden from the sun, or too small to matter). */
  none?: Iterable<THREE.Mesh>;
}

const proxyMaterial = new THREE.MeshBasicMaterial({ name: 'shadowProxy', colorWrite: false, depthWrite: false });

function hideFromMainPass(this: THREE.Mesh): void {
  this.geometry.setDrawRange(0, 0);
}

function showInShadowPass(this: THREE.Mesh): void {
  this.geometry.setDrawRange(0, Infinity);
}

/** Position-only, indexed copy of a mesh geometry transformed by `m`. */
function positionsOnly(src: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position').clone());
  if (src.index) g.setIndex(src.index.clone());
  else {
    const n = src.getAttribute('position').count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return g.applyMatrix4(m);
}

/**
 * Replace the casters under `root` by merged proxies (see the file comment). Returns the proxies created,
 * keyed by the node they are attached to (root or a moving node).
 */
export function buildShadowProxies(root: THREE.Object3D, rig: ShadowRig): Map<THREE.Object3D, THREE.Mesh> {
  const moving = new Set(rig.moving);
  const keep = new Set(rig.keep ?? []);
  for (const m of rig.none ?? []) m.castShadow = false;
  root.updateMatrixWorld(true);
  const sets = new Map<THREE.Object3D, THREE.Mesh[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.castShadow || keep.has(mesh) || moving.has(mesh)) return;
    const mat = mesh.material;
    if (Array.isArray(mat) || !mat.visible || mat.transparent || mat.alphaTest > 0 || (mat as THREE.MeshStandardMaterial).alphaMap) return;
    let anchor = mesh.parent!;
    while (anchor !== root && !moving.has(anchor)) anchor = anchor.parent!;
    let list = sets.get(anchor);
    if (!list) sets.set(anchor, (list = []));
    list.push(mesh);
  });

  const proxies = new Map<THREE.Object3D, THREE.Mesh>();
  const inv = new THREE.Matrix4();
  const rel = new THREE.Matrix4();
  for (const [anchor, meshes] of sets) {
    // A single mesh gains nothing from a proxy: it keeps casting itself.
    if (meshes.length < 2) continue;
    inv.copy(anchor.matrixWorld).invert();
    const parts = meshes.map((m) => positionsOnly(m.geometry, rel.multiplyMatrices(inv, m.matrixWorld)));
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const proxy = new THREE.Mesh(merged, proxyMaterial);
    proxy.name = `shadowProxy:${anchor.name || anchor.type}`;
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    proxy.onBeforeRender = hideFromMainPass;
    proxy.onBeforeShadow = showInShadowPass;
    anchor.add(proxy);
    for (const m of meshes) m.castShadow = false;
    proxies.set(anchor, proxy);
  }
  return proxies;
}
