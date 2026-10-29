// Probe: how long buildValley takes (the town, farms, villages, bridges), seed 0.
import { it } from 'vitest';
import * as THREE from 'three';
import { buildValley } from '../../src/world/airport/valley';
import { createSharedUniforms } from '../../src/world/airport/shared';
import { terrainHeight } from '../../src/world/terrain/heightfield';

it('valley build time', () => {
  const m = new THREE.MeshBasicMaterial();
  const t0 = performance.now();
  const v = buildValley(terrainHeight, createSharedUniforms(), m, m);
  console.log(`buildValley: ${(performance.now() - t0).toFixed(0)} ms, ${v.lights.length} lights`);
}, 120000);
