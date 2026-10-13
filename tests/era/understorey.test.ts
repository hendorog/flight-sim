// Deep Time, increment 2 (WP6): the understorey speckle - cycad rosettes and fern clumps painted into the terrain
// splat (vegetation/understorey.ts). The CPU mirror of its density and cell hash, where it may and may not grow, and
// the GLSL as it lands in the terrain program's slot (the Cretaceous program text, through onBeforeCompile).

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { runwayCoords } from '../../src/core/world';
import { setEraOff } from '../../src/world/era/eraOff';
import { setEra } from '../../src/world/era/eraState';
import { RIVER_HERD_SITE } from '../../src/world/era/cretaceousAnchors';
import { coverShape, computeBiome, makeBiome, makeCoverShape } from '../../src/world/terrain/biome';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { hash2i } from '../../src/world/terrain/noise';
import { createTerrainMaterial, type TerrainUniforms } from '../../src/world/terrain/terrainMaterial';
import type { TerrainTextures } from '../../src/world/terrain/textures';
import {
  SPECKLE,
  UNDERSTOREY_HEAD_GLSL,
  UNDERSTOREY_SPECKLE_GLSL,
  speckleCell,
  speckleDensity,
  speckleDistanceFade,
  speckleGround,
  type SpeckleInputs,
} from '../../src/world/terrain/vegetation/understorey';

afterEach(() => {
  setEraOff(null);
  setEra('present');
});

const prairie = (o: Partial<SpeckleInputs> = {}): SpeckleInputs => ({ riverEdge: 600, forest: 0, up: 1, along: 3000, across: 3000, ...o });

describe('understorey speckle: CPU mirror', () => {
  it('the cell hash is deterministic, equals noise.ts hash2i, and keeps each plant and its shadow inside its cell', () => {
    // The same cell from any point inside it, and the same answer twice.
    const a = speckleCell(123.4, -987.6);
    const b = speckleCell(123.4, -987.6);
    expect(b).toEqual(a);
    const c = speckleCell(a.ix * SPECKLE.cellM + 0.01, a.iz * SPECKLE.cellM + SPECKLE.cellM - 0.01);
    expect(c).toEqual(a);
    // Pinned values (a change of salt or layout shows up here).
    const p = speckleCell(0.5, 0.5);
    expect([p.ix, p.iz, p.kind, p.twin]).toEqual([0, 0, hash2i(SPECKLE.saltC[0], SPECKLE.saltC[1]) & 1, (hash2i(SPECKLE.saltC[0], SPECKLE.saltC[1]) >>> 16) & 1]);
    expect(p.roll).toBe((hash2i(SPECKLE.saltA[0], SPECKLE.saltA[1]) & 0xffff) / 65536);
    let present = 0;
    let n = 0;
    for (let ix = -40; ix < 40; ix++)
      for (let iz = -40; iz < 40; iz++) {
        const q = speckleCell((ix + 0.5) * SPECKLE.cellM, (iz + 0.5) * SPECKLE.cellM);
        expect(q.ix).toBe(ix);
        expect(q.iz).toBe(iz);
        expect(q.r).toBeGreaterThanOrEqual(SPECKLE.rMinM);
        expect(q.r).toBeLessThanOrEqual(SPECKLE.rMaxM);
        const m = q.r + SPECKLE.shadowMaxM;
        for (const [cc, i0] of [[q.cx, ix], [q.cz, iz]] as const) {
          expect(cc - m).toBeGreaterThanOrEqual(i0 * SPECKLE.cellM - 1e-9);
          expect(cc + m).toBeLessThanOrEqual((i0 + 1) * SPECKLE.cellM + 1e-9);
        }
        n++;
        if (q.roll < 0.5 * SPECKLE.pMax) present++;
      }
    // The roll is uniform: about half the cells hold a plant at density 0.5.
    expect(present / n).toBeGreaterThan(0.4 * SPECKLE.pMax);
    expect(present / n).toBeLessThan(0.6 * SPECKLE.pMax);
  });

  it('the density is deterministic and higher near the river (and at forest margins) than on the prairie 600 m out', () => {
    expect(speckleDensity(prairie())).toBe(speckleDensity(prairie()));
    const far = speckleDensity(prairie({ riverEdge: 600 }));
    const near = speckleDensity(prairie({ riverEdge: 20 }));
    expect(far).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(far * 1.8);
    expect(speckleDensity(prairie({ forest: 0.25 }))).toBeGreaterThan(far * 1.5);
    // Deep in a stand the boost is gone (the forest layer covers the ground there anyway).
    expect(speckleDensity(prairie({ forest: 0.9 }))).toBeCloseTo(far, 9);
    // Patchy: the noises move it both ways.
    expect(speckleDensity(prairie({ patchA: 0.2, patchB: 0.8 }))).toBeGreaterThan(far);
    expect(speckleDensity(prairie({ patchA: 0.8, patchB: 0.2 }))).toBeLessThan(far);
  });

  it('on the real Cretaceous terrain: denser within 50 m of the river bank than on the floodplain 550-650 m out', () => {
    setEra('cretaceous');
    const s = makeSample();
    const bio = makeBiome();
    const shape = makeCoverShape();
    const sums = { near: [0, 0], far: [0, 0] };
    for (let dn = -3000; dn <= 3000; dn += 37)
      for (let de = -3000; de <= 3000; de += 37) {
        const n = RIVER_HERD_SITE.north + dn;
        const e = RIVER_HERD_SITE.east + de;
        sampleTerrain(n, e, s);
        if (!(s.riverHalfWidth > 1)) continue;
        const edge = s.riverDist - s.riverHalfWidth;
        const k = edge > 2 && edge < 50 ? 'near' : edge > 550 && edge < 650 ? 'far' : null;
        if (!k) continue;
        coverShape(n, e, s.ground, shape);
        computeBiome(n, e, s, shape.up, bio, shape.north);
        const rw = runwayCoords(n, e);
        sums[k][0] += speckleDensity({ riverEdge: edge, forest: bio.forest, up: shape.up, along: rw.along, across: rw.across, marsh: bio.marsh });
        sums[k][1]++;
      }
    expect(sums.near[1]).toBeGreaterThan(50);
    expect(sums.far[1]).toBeGreaterThan(50);
    expect(sums.near[0] / sums.near[1]).toBeGreaterThan((sums.far[0] / sums.far[1]) * 1.5);
  });

  it('zero on the strip and on slopes over 20 deg, whatever else boosts it', () => {
    const boosted = { riverEdge: 0, forest: 0.25, marsh: 1, patchA: 0, patchB: 1 };
    const L = 900 + SPECKLE.stripPadAlongM;
    const W = 15 + SPECKLE.stripPadAcrossM;
    for (const [along, across] of [[0, 0], [880, 14], [-900, -40], [L - 0.01, W - 0.01], [-L + 0.01, 0], [0, -W + 0.01]]) expect(speckleDensity(prairie({ ...boosted, along, across })), `${along},${across}`).toBe(0);
    // ... and back beyond the pads and the soft edge.
    expect(speckleDensity(prairie({ ...boosted, along: 0, across: W + SPECKLE.stripSoftM + 1 }))).toBeGreaterThan(0.5);
    for (const deg of [20, 20.5, 25, 35, 60]) expect(speckleDensity(prairie({ ...boosted, up: Math.cos((deg * Math.PI) / 180) })), `${deg} deg`).toBe(0);
    expect(speckleDensity(prairie({ ...boosted, up: Math.cos((19 * Math.PI) / 180) }))).toBeGreaterThan(0);
    expect(speckleDensity(prairie({ ...boosted, up: Math.cos((10 * Math.PI) / 180) }))).toBeGreaterThan(0.5);
    // None on the river banks or above the tree line.
    expect(speckleDensity(prairie({ ...boosted, bank: 1 }))).toBe(0);
    expect(speckleDensity(prairie({ ...boosted, alpine: 1 }))).toBe(0);
  });

  it('fades in from 150 m and out by 1500 m; the mud carries a share of the meadow', () => {
    expect(speckleDistanceFade(100)).toBe(0);
    expect(speckleDistanceFade(150)).toBe(0);
    expect(speckleDistanceFade(400)).toBe(1);
    expect(speckleDistanceFade(1000)).toBe(1);
    expect(speckleDistanceFade(1300)).toBeGreaterThan(0);
    expect(speckleDistanceFade(1500)).toBe(0);
    expect(speckleDistanceFade(5000)).toBe(0);
    expect(speckleGround(0, 1)).toBeCloseTo(SPECKLE.mudShare, 9);
    expect(speckleGround(0.3, 0)).toBeCloseTo(0.3, 9);
    expect(speckleGround(1, 1)).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------------ the GLSL slot

const textures = (): TerrainTextures =>
  ({ noise: new THREE.Texture(), albedo: new THREE.DataArrayTexture(), normal: new THREE.DataArrayTexture(), layerMeans: [0, 1, 2, 3].map(() => new THREE.Vector3()), ready: Promise.resolve(), dispose: () => {} }) as unknown as TerrainTextures;
const uniforms = (): TerrainUniforms =>
  ({ uMorph: { value: [] }, uSkirt: { value: [] }, uLodCenter: { value: new THREE.Vector3() }, uForestFade: { value: new THREE.Vector2() }, uCanopyKeep: { value: new THREE.Vector4() }, uViewPos: { value: new THREE.Vector3() } }) as unknown as TerrainUniforms;

/** The terrain fragment program as three would compile it (onBeforeCompile on ShaderLib.standard: a fake program). */
function fragment(): string {
  const mat = createTerrainMaterial(textures(), uniforms());
  const src = THREE.ShaderLib.standard;
  const shader = { uniforms: {} as Record<string, unknown>, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader };
  (mat.onBeforeCompile as unknown as (s: unknown, r: unknown) => void)(shader, null);
  return shader.fragmentShader;
}

/** Strip comments, for the brace / keyword checks. */
const code = (s: string): string => s.replace(/\/\/[^\n]*/g, '');

describe('understorey speckle: the GLSL in the terrain slot', () => {
  it('lands after the ground layers, before the edge shade, its helpers in the head; every name it reads is declared first', () => {
    setEra('cretaceous');
    const f = fragment();
    const at = f.indexOf(UNDERSTOREY_SPECKLE_GLSL);
    expect(at).toBeGreaterThan(0);
    expect(f.split(UNDERSTOREY_SPECKLE_GLSL).length).toBe(2);
    expect(at).toBeGreaterThan(f.lastIndexOf('addMat(acc, layerTop(', at));
    expect(at).toBeGreaterThan(f.indexOf('float landW'));
    expect(at + UNDERSTOREY_SPECKLE_GLSL.length).toBeLessThanOrEqual(f.indexOf('acc.albedo *= tEdgeShade;'));
    const head = f.indexOf(UNDERSTOREY_HEAD_GLSL);
    expect(head).toBeGreaterThan(0);
    expect(head).toBeLessThan(f.indexOf('void main()'));
    // The head is spliced before runwayLocal and the uniforms after it; it uses only hash / GLSL built-ins.
    expect(f.indexOf('uint hash2u(')).toBeLessThan(head);
    expect(code(UNDERSTOREY_HEAD_GLSL)).not.toMatch(/\b(runwayLocal|uRunway\w*|tXZ|acc)\b/);
    // Every splat name the body reads is declared before it (and tMudL only under STRIP_MUD).
    for (const name of ['tXZ', 'tDist', 'tUp', 'tBio', 'landW', 'tMarshW', 'tRiverBank', 'alpine', 'tSunW', 'nC', 'nD', 'acc']) {
      const decl = new RegExp(`\\b(float|vec2|vec3|vec4|Mat) ${name}\\b`).exec(f.slice(f.indexOf('void main()')));
      expect(decl, name).not.toBeNull();
      expect(f.indexOf('void main()') + (decl as RegExpExecArray).index, name).toBeLessThan(at);
    }
    expect(f.indexOf('float tMudL')).toBeLessThan(at);
    expect(UNDERSTOREY_SPECKLE_GLSL).toMatch(/#if STRIP_MUD\n {2}usG \+= [0-9.]+ \* tMudL;\n#endif/);
    expect(f.indexOf('vec2 runwayLocal(')).toBeLessThan(at);
  });

  it('is well formed: balanced braces and conditionals, no reserved words, no derivative inside a branch, constants from SPECKLE', () => {
    for (const g of [UNDERSTOREY_HEAD_GLSL, UNDERSTOREY_SPECKLE_GLSL]) {
      const c = code(g);
      expect(c.split('{').length).toBe(c.split('}').length);
      expect(c.split('(').length).toBe(c.split(')').length);
      expect(c.split('#if').length).toBe(c.split('#endif').length);
      // GLSL ES 3.00 reserved words that are tempting names.
      expect(c).not.toMatch(/\b(patch|sample|input|output|filter|common|partition|active|half|fixed|long|short|double|cast|namespace|using|class|union|enum|typedef|template|this|goto|inline|public|static|extern|external|interface|superp|sizeof)\b/);
    }
    // Derivatives in uniform control flow: the one dFdx/dFdy pair precedes the first branch.
    const body = code(UNDERSTOREY_SPECKLE_GLSL);
    expect(body.indexOf('dFdx(')).toBeGreaterThan(0);
    expect(body.indexOf('dFdx(')).toBeLessThan(body.indexOf('if ('));
    expect(body.split(/\bdFd[xy]\(|\bfwidth\(/).length).toBe(3);
    // The thresholds the tests above check on the CPU are the ones the GLSL uses.
    const lit = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(+n.toFixed(7)));
    for (const n of [SPECKLE.fadeIn0, SPECKLE.fadeIn1, SPECKLE.fadeOut0, SPECKLE.fadeOut1, SPECKLE.vis0, SPECKLE.vis1]) expect(UNDERSTOREY_SPECKLE_GLSL).toContain(lit(n));
    for (const n of [SPECKLE.slopeZeroUp, SPECKLE.slopeFullUp, SPECKLE.riverFullM, SPECKLE.riverReachM, SPECKLE.base, SPECKLE.river, SPECKLE.margin, 900 + SPECKLE.stripPadAlongM, 15 + SPECKLE.stripPadAcrossM, SPECKLE.stripSoftM]) expect(UNDERSTOREY_HEAD_GLSL).toContain(lit(n));
    expect(UNDERSTOREY_SPECKLE_GLSL).toContain(`hash2u(usK.x + ${SPECKLE.saltA[0]}, usK.y + ${SPECKLE.saltA[1]})`);
  });

  it('?eraoff=speckle and the present day leave it out', () => {
    setEra('cretaceous');
    setEraOff(['speckle']);
    const off = fragment();
    expect(off).not.toContain('usDensity');
    expect(off).not.toContain('usClump');
    setEraOff(null);
    expect(fragment()).toContain('usDensity(');
    setEra('present');
    const p = fragment();
    expect(p).not.toContain('usDensity');
    expect(p).not.toContain('Understorey');
  });
});
