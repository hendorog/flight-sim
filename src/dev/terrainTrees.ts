// Tree gallery: the four species as near meshes (left) and as impostors (right), on a flat
// ground, for inspecting models, impostor baking and lighting.
//   dev/terraintrees.html?tod=10&dist=40&h=18&lod=0   (lod=1 shows the reduced far-LOD meshes; cam=n,e,alt
//   and look=n,e,alt as in the other harness pages, else a view from the ground at the trees)
//   dev/terraintrees.html?era=cretaceous   another era's four species (harness.ts sets the era); without h=, each
//   at the middle of its height range (flora/index.ts)
import * as THREE from 'three';
import { createFoliageAtlas } from '../world/terrain/vegetation/foliageTexture';
import { bakeImpostors } from '../world/terrain/vegetation/impostors';
import { SPECIES_COUNT, TREE_STRIDE } from '../world/terrain/vegetation/placement';
import { createImpostorMaterial, createNearTreeMaterial, type TreeUniforms } from '../world/terrain/vegetation/treeMaterials';
import { createTreeGeometries } from '../world/terrain/vegetation/treeModels';
import { AIRPORT } from '../core/world';
import { era, isPresent } from '../world/era/eraState';
import { FLORA } from '../world/terrain/vegetation/flora';
import { runHarness } from './harness';

const params = new URLSearchParams(location.search);
const dist = Number(params.get('dist') ?? 40);
const height = Number(params.get('h') ?? 18);
const lod = params.get('lod') === '1' ? 1 : 0;
/** Height of species s in the gallery: h= for all, or (another era, no h=) the middle of its range. */
const heightOf = (s: number): number => {
  if (isPresent() || params.has('h')) return height;
  const [lo, hi] = FLORA[era().flora].slots[s].height;
  return (lo + hi) / 2;
};

const makeUniforms = (fade: THREE.Vector4): TreeUniforms => ({
  uTime: { value: 0 },
  uFade: { value: fade },
  uDensityRange: { value: 1e6 },
  uViewPos: { value: new THREE.Vector3() },
  uShadowRange: { value: 1e6 },
  // LOD 0 everywhere, or (lod=1) the reduced meshes everywhere.
  uLodFade: { value: lod ? new THREE.Vector2(0, 1e-3) : new THREE.Vector2(1e6, 2e6) },
  uForestFar: { value: new THREE.Vector2(fade.z, fade.w) },
  uNearOpen: { value: new THREE.Vector2(fade.x, fade.y) },
  uFrame: { value: 0 },
});

function instances(base: THREE.BufferGeometry, rows: number[][]): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  for (const [k, a] of Object.entries(base.attributes)) g.setAttribute(k, a);
  const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(rows.flat()), TREE_STRIDE);
  g.setAttribute('aInstA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  g.setAttribute('aInstB', new THREE.InterleavedBufferAttribute(buf, 2, 4));
  g.instanceCount = rows.length;
  return g;
}

void runHarness({
  subsystems: [
    {
      init(ctx) {
        const y = AIRPORT.elevation;
        // Default view: from the ground, looking north at the row of trees (cam= / look= override it).
        if (!params.has('cam')) {
          ctx.camera.position.set(0, y + height * 0.45, 0);
          ctx.camera.lookAt(0, y + height * 0.45, -dist);
        }
        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: 0x3d5226, roughness: 1 }),
        );
        ground.position.y = y;
        ground.receiveShadow = true;
        ctx.scene.add(ground);
        ctx.scene.traverse((o) => {
          if (o instanceof THREE.DirectionalLight) {
            o.castShadow = true;
            o.shadow.mapSize.set(2048, 2048);
            const c = o.shadow.camera;
            c.left = c.bottom = -120;
            c.right = c.top = 120;
            o.position.copy(ctx.sky.sunDir).multiplyScalar(500).add(new THREE.Vector3(0, y, -dist));
            o.target.position.set(0, y, -dist);
            o.target.updateMatrixWorld();
          }
        });
        const foliage = createFoliageAtlas(ctx.renderer);
        const geos = createTreeGeometries();
        const meshGeos = createTreeGeometries(lod);
        const atlas = bakeImpostors(ctx.renderer, geos, foliage);
        const nearMat = createNearTreeMaterial(foliage, makeUniforms(new THREE.Vector4(1e6, 2e6, 1e6, 2e6)), lod);
        const impMat = createImpostorMaterial(atlas.albedo, atlas.normal, makeUniforms(new THREE.Vector4(0, 1e-3, 1e6, 2e6)));
        const spacing = height * 1.1;
        // Meshes on the left, impostors on the right, all at north = dist.
        for (let s = 0; s < SPECIES_COUNT; s++) {
          const east = (s - 4) * spacing;
          const mesh = new THREE.Mesh(instances(meshGeos[s], [[east, y, dist, heightOf(s), 0.3 * s, s + 0.5]]), nearMat);
          mesh.frustumCulled = false;
          mesh.castShadow = true;
          ctx.scene.add(mesh);
        }
        const rows: number[][] = [];
        for (let s = 0; s < SPECIES_COUNT; s++) rows.push([(s + 1) * spacing, y, dist, heightOf(s), 0.3 * s, s + 0.5]);
        const imp = new THREE.Mesh(instances(new THREE.PlaneGeometry(2, 2), rows), impMat);
        imp.frustumCulled = false;
        ctx.scene.add(imp);
      },
      update() {},
    },
  ],
});
