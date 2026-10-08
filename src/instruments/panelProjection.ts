// Affine pixel-to-mesh mapping for a flat instrument face, including shaped console faces whose UV
// rectangle corners are empty space. Derive the basis from a real triangle, not imaginary corner vertices.
import * as THREE from 'three';

export function panelUvBasis(geometry: THREE.BufferGeometry): [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null {
  const pos = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  if (!pos || !uv) return null;
  const index = geometry.index;
  for (let t = 0; t + 2 < (index?.count ?? pos.count); t += 3) {
    const [a, b, c] = [t, t + 1, t + 2].map(i => index ? index.getX(i) : i);
    const u1 = uv.getX(b) - uv.getX(a), v1 = uv.getY(b) - uv.getY(a);
    const u2 = uv.getX(c) - uv.getX(a), v2 = uv.getY(c) - uv.getY(a);
    const det = u1 * v2 - u2 * v1;
    if (Math.abs(det) < 1e-8) continue;
    const origin = new THREE.Vector3().fromBufferAttribute(pos, a);
    const e1 = new THREE.Vector3().fromBufferAttribute(pos, b).sub(origin);
    const e2 = new THREE.Vector3().fromBufferAttribute(pos, c).sub(origin);
    const du = e1.clone().multiplyScalar(v2).addScaledVector(e2, -v1).divideScalar(det);
    const dv = e2.clone().multiplyScalar(u1).addScaledVector(e1, -u2).divideScalar(det);
    origin.addScaledVector(du, -uv.getX(a)).addScaledVector(dv, -uv.getY(a));
    return [origin, du, dv];
  }
  return null;
}
