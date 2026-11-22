// Probe: what a seeded world's water meshes cost to build on the main thread (ribbons, falls) and how big they are, with
// the running water on and off (water.ts setWaterFlow).
//   npx vitest run --config scripts/probes/vitest.config.ts waterGeoCost --silent=false --disable-console-intercept
import { it } from 'vitest';
import { createFallGeometries, createRiverNetworkGeometries, setWaterFlow } from '../../src/world/terrain/water';
import { setWorldSeed } from '../../src/world/worldSeed';
it('water geometry cost', () => {
  for (const seed of [1, 42, 777777]) {
    setWorldSeed(seed);
    for (const on of [false, true, false, true]) {
      setWaterFlow(on);
      let t = performance.now();
      const small: Array<{ build(): unknown }> = [];
      const rib = createRiverNetworkGeometries(small as never);
      const tr = performance.now() - t;
      let tsb = performance.now();
      const sg = small.map((c) => c.build()).filter(Boolean) as never[];
      tsb = performance.now() - tsb;
      t = performance.now();
      const f = createFallGeometries();
      const tf = performance.now() - t;
      const verts = (gs: { getAttribute(n: string): { count: number } }[]): number => gs.reduce((a, g) => a + g.getAttribute('position').count, 0);
      const bytes = (gs: { attributes: Record<string, { array: ArrayLike<number> & { byteLength: number } }> }[]): number => gs.reduce((a, g) => a + Object.values(g.attributes).reduce((b, at) => b + at.array.byteLength, 0), 0);
      console.log(`seed ${seed} flow ${on ? 1 : 0}: ribbons ${tr.toFixed(1)} ms ${rib.length} chunks ${verts(rib)} verts ${(bytes(rib as never) / 1e6).toFixed(2)} MB; narrow streams (near the viewer only) ${small.length} chunks ${verts(sg)} verts ${(bytes(sg) / 1e6).toFixed(2)} MB, all built ${tsb.toFixed(0)} ms; falls ${tf.toFixed(1)} ms ${f.sheets.length}+${f.spray.length} chunks ${verts(f.sheets)}+${verts(f.spray)} verts ${((bytes(f.sheets as never) + bytes(f.spray as never)) / 1e6).toFixed(2)} MB`);
    }
  }
  setWaterFlow(true);
});
