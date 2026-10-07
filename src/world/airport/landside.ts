// Perimeter fence, car park, access road and parked cars (airport-local frame).

import * as THREE from 'three';
import { boxGeo, cylGeo, GeometryBatch, placement, ribbonGeo } from './geom';
import { ACCESS_ROAD, BUILDINGS, CAR_BAY_WIDTH, CAR_PARK, CAR_PARK_ROWS, FENCE_RECT } from './layout';
import { rng } from './noise';
import { forInstancing, type MaterialSet } from './materials';

const FENCE_HEIGHT = 2.4;
const POST_SPACING = 3;

/** Chain-link mesh: 50 mm diamonds of 4 mm galvanised wire. Texture spans 0.1 m; alpha is the wire coverage. */
function chainLinkTexture(anisotropy: number): THREE.DataTexture {
  const n = 128;
  const data = new Uint8Array(n * n * 4);
  const wire = 4 / 100 * n / 2; // half wire width in texels (tile = 100 mm)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // Distance to the two diagonal wire families, period n / 2 texels.
      const p = n / 2;
      const d1 = Math.abs((((x + y) % p) + p) % p - p / 2) / Math.SQRT2;
      const d2 = Math.abs((((x - y) % p) + p) % p - p / 2) / Math.SQRT2;
      const a = Math.max(0, Math.min(1, wire + 0.5 - Math.min(d1, d2)));
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, n, n);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.repeat.set(10, 10);
  t.needsUpdate = true;
  return t;
}

/** Fence polyline (local u, v) with a pedestrian gate behind the terminal. */
function fenceRuns(): [number, number][][] {
  const f = FENCE_RECT;
  const term = BUILDINGS.find((b) => b.kind === 'terminal')!;
  const gate0 = (term.u0 + term.u1) / 2 - 3, gate1 = gate0 + 6;
  return [
    [[gate1, f.v0], [f.u1, f.v0], [f.u1, f.v1], [f.u0, f.v1], [f.u0, f.v0], [gate0, f.v0]],
  ];
}

export interface Landside {
  meshes: THREE.Object3D[];
  dispose(): void;
}

export function createLandside(mats: MaterialSet, anisotropy: number, carParkMaterial: THREE.Material, roadMaterial: THREE.Material): Landside {
  const meshes: THREE.Object3D[] = [];
  const chain = chainLinkTexture(anisotropy);

  // Fence fabric (translucent chain link), posts, top rail and barbed wire.
  const fabric: THREE.Vector3[] = [];
  const postPositions: THREE.Vector3[] = [];
  const wire = new GeometryBatch();
  for (const run of fenceRuns()) {
    for (let i = 0; i < run.length - 1; i++) {
      const [u0, v0] = run[i], [u1, v1] = run[i + 1];
      const len = Math.hypot(u1 - u0, v1 - v0);
      const n = Math.max(1, Math.round(len / POST_SPACING));
      for (let k = 0; k <= n; k++) {
        if (k === n && i < run.length - 2) continue;
        const t = k / n;
        postPositions.push(new THREE.Vector3(v0 + (v1 - v0) * t, 0, -(u0 + (u1 - u0) * t)));
      }
      fabric.push(new THREE.Vector3(v0, 0, -u0), new THREE.Vector3(v1, 0, -u1));
      const mid = new THREE.Vector3((v0 + v1) / 2, 0, -(u0 + u1) / 2);
      const ang = Math.atan2(v1 - v0, -(u1 - u0)); // rotation about y taking +z to the run direction
      for (const [h, r] of [[FENCE_HEIGHT, 0.025], [FENCE_HEIGHT + 0.15, 0.004], [FENCE_HEIGHT + 0.3, 0.004], [FENCE_HEIGHT + 0.45, 0.004]] as const) {
        wire.add(cylGeo(r, r, len, 4, true), placement(mid.x, h, mid.z, ang, Math.PI / 2), 0xa0a4a8);
      }
    }
  }
  const wireMesh = new THREE.Mesh(wire.build(), mats.steel);
  wireMesh.castShadow = true;
  meshes.push(wireMesh);

  const fabricPos: number[] = [], fabricUv: number[] = [];
  let dist = 0;
  for (let i = 0; i < fabric.length; i += 2) {
    const a = fabric[i], b = fabric[i + 1];
    const len = a.distanceTo(b);
    const quad = [[a, 0, 0], [b, len, 0], [b, len, 1], [a, 0, 1]] as const;
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const [p, d, h] = quad[k];
      fabricPos.push(p.x, h * FENCE_HEIGHT, p.z);
      fabricUv.push(dist + d, h * FENCE_HEIGHT);
    }
    dist += len;
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(fabricPos, 3));
  fg.setAttribute('uv', new THREE.Float32BufferAttribute(fabricUv, 2));
  fg.computeVertexNormals();
  const fabricMesh = new THREE.Mesh(
    fg,
    new THREE.MeshStandardMaterial({
      color: 0x9aa0a4,
      metalness: 0.6,
      roughness: 0.5,
      alphaMap: chain,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // One draw with both faces: a transparent DoubleSide material otherwise draws back then front faces,
      // flipping material.side (and bumping its version / program key) twice every frame.
      forceSinglePass: true,
    }),
  );
  fabricMesh.material.name = 'fence-fabric';
  fabricMesh.name = 'fence-fabric';
  meshes.push(fabricMesh);

  const postGeo = new GeometryBatch().add(cylGeo(0.035, 0.035, FENCE_HEIGHT + 0.5, 6), undefined, 0xa0a4a8).build();
  const posts = new THREE.InstancedMesh(postGeo, forInstancing(mats.steel), postPositions.length);
  const m = new THREE.Matrix4();
  postPositions.forEach((p, i) => posts.setMatrixAt(i, m.makeTranslation(p.x, (FENCE_HEIGHT + 0.5) / 2, p.z)));
  posts.castShadow = true;
  posts.name = 'fence-posts';
  meshes.push(posts);

  // Car park surface with a kerb, and the access road to the edge of the airfield.
  const cp = new THREE.PlaneGeometry(CAR_PARK.v1 - CAR_PARK.v0, CAR_PARK.u1 - CAR_PARK.u0).rotateX(-Math.PI / 2);
  cp.translate((CAR_PARK.v0 + CAR_PARK.v1) / 2, 0.04, -(CAR_PARK.u0 + CAR_PARK.u1) / 2);
  // uv = local (u, v) for the bay markings
  const cpPos = cp.attributes.position as THREE.BufferAttribute;
  const cpUv = cp.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < cpPos.count; i++) cpUv.setXY(i, -cpPos.getZ(i), cpPos.getX(i));
  const carPark = new THREE.Mesh(cp, carParkMaterial);
  carPark.receiveShadow = true;
  carPark.name = 'car-park';
  meshes.push(carPark);
  const kerb = new GeometryBatch();
  const cw = CAR_PARK.u1 - CAR_PARK.u0, cd = CAR_PARK.v1 - CAR_PARK.v0;
  const ccu = (CAR_PARK.u0 + CAR_PARK.u1) / 2, ccv = (CAR_PARK.v0 + CAR_PARK.v1) / 2;
  kerb.add(boxGeo(0.25, 0.15, cw), placement(CAR_PARK.v1, 0.075, -ccu), 0xb8b4ac);
  kerb.add(boxGeo(cd, 0.15, 0.25), placement(ccv, 0.075, -CAR_PARK.u0), 0xb8b4ac);
  kerb.add(boxGeo(cd, 0.15, 0.25), placement(ccv, 0.075, -CAR_PARK.u1), 0xb8b4ac);
  const kerbMesh = new THREE.Mesh(kerb.build(), mats.concrete);
  kerbMesh.receiveShadow = true;
  meshes.push(kerbMesh);

  const road = new THREE.Mesh(
    ribbonGeo(
      Array.from({ length: 8 }, (_, i) => {
        const t = i / 7;
        return new THREE.Vector3(ACCESS_ROAD.start.v + (ACCESS_ROAD.end.v - ACCESS_ROAD.start.v) * t, 0.03, -(ACCESS_ROAD.start.u + (ACCESS_ROAD.end.u - ACCESS_ROAD.start.u) * t));
      }),
      ACCESS_ROAD.width,
    ),
    roadMaterial,
  );
  road.receiveShadow = true;
  road.name = 'access-road';
  meshes.push(road);

  meshes.push(...parkedCars(mats));
  return {
    meshes,
    dispose: () => chain.dispose(),
  };
}

/** A generic car: body, cabin, dark glass and tyres, 4.5 x 1.8 m. Nose toward -z. */
function carGeometries(): { body: THREE.BufferGeometry; dark: THREE.BufferGeometry } {
  const body = new GeometryBatch()
    .add(boxGeo(1.8, 0.7, 4.5), placement(0, 0.6, 0))
    .add(boxGeo(1.6, 0.55, 2.4), placement(0, 1.2, 0.3));
  const dark = new GeometryBatch().add(boxGeo(1.62, 0.42, 2.2), placement(0, 1.18, 0.3));
  for (const [x, z] of [[-0.8, -1.4], [0.8, -1.4], [-0.8, 1.45], [0.8, 1.45]]) {
    dark.add(cylGeo(0.32, 0.32, 0.22, 12), placement(x, 0.32, z, 0, 0, Math.PI / 2));
  }
  return { body: body.build(), dark: dark.build() };
}

const CAR_COLORS = [0xd8d8d8, 0x1a1a1a, 0x8a8f94, 0x7a1f1f, 0x1f3a6a, 0xe8e8e4, 0x3a4a3a, 0xa0a4a8, 0x5a3a2a];

function parkedCars(mats: MaterialSet): THREE.InstancedMesh[] {
  const r = rng(2024);
  const slots: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const nBays = Math.floor((CAR_PARK.u1 - CAR_PARK.u0 - 1) / CAR_BAY_WIDTH);
  for (const row of CAR_PARK_ROWS) {
    for (let k = 0; k < nBays; k++) {
      if (r() > 0.62) continue;
      const u = CAR_PARK.u0 + (k + 0.5) * CAR_BAY_WIDTH;
      const v = CAR_PARK.v0 + (row.v0 + row.v1) / 2 + (r() - 0.5) * 0.3;
      // nose toward +v (local +x) when facing 1
      const rot = row.facing > 0 ? -Math.PI / 2 : Math.PI / 2;
      slots.push(placement(v, 0.04, -u, rot + (r() - 0.5) * 0.06));
      colors.push(new THREE.Color(CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]));
    }
  }
  const g = carGeometries();
  const body = new THREE.InstancedMesh(g.body, forInstancing(mats.paint), slots.length);
  const dark = new THREE.InstancedMesh(g.dark, forInstancing(mats.rubber), slots.length);
  slots.forEach((mtx, i) => {
    body.setMatrixAt(i, mtx);
    body.setColorAt(i, colors[i]);
    dark.setMatrixAt(i, mtx);
    dark.setColorAt(i, new THREE.Color(0x202326));
  });
  for (const im of [body, dark]) {
    im.castShadow = im.receiveShadow = true;
    im.name = 'cars';
  }
  return [body, dark];
}
