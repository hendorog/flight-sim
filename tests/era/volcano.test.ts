// Deep Time, WP6: the Late Cretaceous stratovolcano (src/world/terrain/volcano.ts) is a pure additive term in
// naturalHeight. It must leave the hydrology, the river, the lakes, the approach corridors and the airfield exactly
// as they are; reach its specified summit; reach the tiles (worker path) exactly as the physics sees it; and its
// shader twin must agree with the CPU.
//
// Note on the plan's "within 15 km of the field centre": the cone (base radius 7 km) stands 17.6 km from the
// field, so its foot reaches to ~10.6 km of it and the cone can not be unchanged-to-15-km by construction. What
// is pinned instead is the clearance that matters: the river, every lake, both approach corridors to their full
// length and width, and the land within 11 km of the field (the airfield, the valley floor and the safari area).

import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { AIRPORT } from '../../src/core/world';
import { setEra } from '../../src/world/era/eraState';
import { CRETACEOUS } from '../../src/world/era/cretaceous';
import { computeBiome, makeBiome } from '../../src/world/terrain/biome';
import { hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import { buildHydrology, lakeRadius } from '../../src/world/terrain/hydrology';
import { createTerrainMaterial, type TerrainUniforms } from '../../src/world/terrain/terrainMaterial';
import type { TerrainTextures } from '../../src/world/terrain/textures';
import { buildTile } from '../../src/world/terrain/tileBuilder';
import { makeVolcanoMask, volcanoBound, volcanoCone, volcanoHeight, volcanoMask, VOLCANO_GLSL } from '../../src/world/terrain/volcano';

const V = CRETACEOUS.terrain.volcano!;
/** Same as heightfield.ts APPROACH_LENGTH. */
const APPROACH_LENGTH = 12000;

afterAll(() => {
  setEra('present');
});

/** Ground (sampleTerrain) at every point, in the given era. */
function grounds(era: 'present' | 'cretaceous', pts: Array<[number, number]>): Float64Array {
  setEra(era);
  const s = makeSample();
  const out = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i++) out[i] = sampleTerrain(pts[i][0], pts[i][1], s).ground;
  setEra('present');
  return out;
}

/** The largest |ground(cretaceous) - ground(present)| over the points, and where. */
function maxDelta(pts: Array<[number, number]>): { d: number; at: [number, number] | null } {
  const a = grounds('present', pts);
  const b = grounds('cretaceous', pts);
  let d = 0;
  let at: [number, number] | null = null;
  for (let i = 0; i < pts.length; i++) {
    const x = Math.abs(a[i] - b[i]);
    if (x > d) {
      d = x;
      at = pts[i];
    }
  }
  return { d, at };
}

/** NED of runway-frame coordinates (along the heading from the runway centre, across to its right). */
function fromRunway(along: number, across: number): [number, number] {
  const c = Math.cos(AIRPORT.runway.heading);
  const s = Math.sin(AIRPORT.runway.heading);
  return [AIRPORT.runway.center.north + along * c - across * s, AIRPORT.runway.center.east + along * s + across * c];
}

describe('the volcano spec', () => {
  it('is where the plan puts it: 17.6 km west of the field, clear of every lake and the river', () => {
    expect(V).toEqual({ north: 2000, east: -17500, baseRadius: 7000, summit: 2600, craterRadius: 400, craterDepth: 160 });
    const b = volcanoBound(V);
    for (const l of hydrology.lakes) expect(Math.hypot(l.north - V.north, l.east - V.east) - l.bound).toBeGreaterThan(b);
    const r = hydrology.river;
    for (let k = 0; k < r.north.length; k++) expect(Math.hypot(r.north[k] - V.north, r.east[k] - V.east)).toBeGreaterThan(b + 2400);
  });
});

describe('the volcano leaves the water and the airfield alone', () => {
  it('buildHydrology(naturalHeight) in the Cretaceous deep-equals the present hydrology', () => {
    setEra('cretaceous');
    const h = buildHydrology(naturalHeight);
    setEra('present');
    expect(h.lakes).toEqual(hydrology.lakes);
    expect(h.river).toEqual(hydrology.river);
  });

  it('|dh| < 0.5 m along the whole river, out to 80 m either side', () => {
    const r = hydrology.river;
    const pts: Array<[number, number]> = [];
    for (let k = 1; k < r.north.length - 1; k++) {
      const tn = r.north[k + 1] - r.north[k - 1];
      const te = r.east[k + 1] - r.east[k - 1];
      const l = Math.hypot(tn, te) || 1;
      for (const off of [-80, -40, 0, 40, 80]) pts.push([r.north[k] - (te * off) / l, r.east[k] + (tn * off) / l]);
    }
    expect(maxDelta(pts).d).toBeLessThan(0.5);
  });

  it('|dh| < 0.5 m on every lake rim ray, out to the lake bound', () => {
    const pts: Array<[number, number]> = [];
    for (const lake of hydrology.lakes) {
      for (let a = 0; a < 72; a++) {
        const ang = (a / 72) * Math.PI * 2;
        for (let d = 0; d <= lake.bound; d += lake.bound / 40) pts.push([lake.north + d * Math.cos(ang), lake.east + d * Math.sin(ang)]);
      }
      // The rim itself (lakeRadius 1) is among them; check the rays reach it.
      expect(lakeRadius(lake, lake.north + lake.bound, lake.east)).toBeGreaterThan(1);
    }
    expect(maxDelta(pts).d).toBeLessThan(0.5);
  });

  it('|dh| < 0.5 m over both approach corridors, their full length and influence width', () => {
    const half = AIRPORT.runway.length / 2;
    const pts: Array<[number, number]> = [];
    for (const dir of [-1, 1])
      for (let beyond = 0; beyond <= APPROACH_LENGTH; beyond += 150) {
        const halfW = 1.8 * (300 + 0.12 * beyond);
        for (let k = -12; k <= 12; k++) pts.push(fromRunway(dir * (half + beyond), (k / 12) * halfW));
      }
    expect(maxDelta(pts).d).toBeLessThan(0.5);
  });

  it('|dh| < 0.5 m within 11 km of the field (the airfield, the valley and the safari area)', () => {
    const pts: Array<[number, number]> = [];
    const R = 11000;
    for (let n = -R; n <= R; n += 200) for (let e = -R; e <= R; e += 200) if (n * n + e * e <= R * R) pts.push([n, e]);
    expect(maxDelta(pts).d).toBeLessThan(0.5);
  });

  it('beyond the bound the land is exactly as it was', () => {
    const b = volcanoBound(V);
    const pts: Array<[number, number]> = [];
    for (let a = 0; a < 360; a += 3) {
      const ang = (a * Math.PI) / 180;
      for (const d of [b + 1, b + 500, b + 3000]) pts.push([V.north + d * Math.cos(ang), V.east + d * Math.sin(ang)]);
    }
    expect(maxDelta(pts).d).toBe(0);
  });
});

describe('the cone', () => {
  it('its rim is within +-60 m of the specified summit, its crater floor about craterDepth below', () => {
    setEra('cretaceous');
    let rim = -Infinity;
    for (let a = 0; a < 360; a += 2) {
      const ang = (a * Math.PI) / 180;
      rim = Math.max(rim, naturalHeight(V.north + V.craterRadius * Math.cos(ang), V.east + V.craterRadius * Math.sin(ang)));
    }
    const floor = naturalHeight(V.north, V.east);
    let top = -Infinity;
    for (let n = -1500; n <= 1500; n += 25) for (let e = -1500; e <= 1500; e += 25) top = Math.max(top, naturalHeight(V.north + n, V.east + e));
    setEra('present');
    expect(Math.abs(rim - V.summit)).toBeLessThan(60);
    expect(Math.abs(top - V.summit)).toBeLessThan(60);
    expect(Math.abs(floor - (V.summit - V.craterDepth))).toBeLessThan(40);
  });

  it('stands proud of the land: concave flanks, a continuous rim, below the land at its foot', () => {
    // Mean profile over all directions: monotonic from the rim to the foot.
    let prev = Infinity;
    for (let r = V.craterRadius; r <= V.baseRadius * 0.9; r += 300) {
      let sum = 0;
      for (let a = 0; a < 360; a += 5) sum += volcanoHeight(V.north + r * Math.cos((a * Math.PI) / 180), V.east + r * Math.sin((a * Math.PI) / 180), V);
      const mean = sum / 72;
      expect(mean).toBeLessThan(prev);
      prev = mean;
    }
    // No step at the crater rim.
    for (let a = 0; a < 360; a += 10) {
      const ang = (a * Math.PI) / 180;
      const inner = volcanoHeight(V.north + (V.craterRadius - 0.01) * Math.cos(ang), V.east + (V.craterRadius - 0.01) * Math.sin(ang), V);
      const outer = volcanoHeight(V.north + (V.craterRadius + 0.01) * Math.cos(ang), V.east + (V.craterRadius + 0.01) * Math.sin(ang), V);
      expect(Math.abs(inner - outer)).toBeLessThan(0.05);
    }
    expect(volcanoHeight(V.north, V.east + V.baseRadius * 1.2, V)).toBeLessThan(0);
  });

  it('is in the tiles exactly as the physics samples it (worker path)', () => {
    setEra('cretaceous');
    const req = { level: 4, ix: Math.floor(V.east / 2048), iz: Math.floor(V.north / 2048), grid: 32, leafSize: 128 };
    const t = buildTile(req);
    const s = makeSample();
    const sp = 2048 / 32;
    let peak = -Infinity;
    for (let j = 0; j <= 32; j++)
      for (let i = 0; i <= 32; i++) {
        const v = j * 33 + i;
        const h = sampleTerrain(req.iz * 2048 + j * sp, req.ix * 2048 + i * sp, s).ground;
        expect(t.positions[v * 3 + 1]).toBe(Math.fround(h));
        peak = Math.max(peak, h);
      }
    setEra('present');
    expect(peak).toBeGreaterThan(1500);
  });
});

describe('the look', () => {
  it('ash on the upper cone kills the woods there, and nothing of it beyond the reach', () => {
    setEra('cretaceous');
    const s = makeSample();
    const b = makeBiome();
    const m = makeVolcanoMask();
    sampleTerrain(V.north + 900, V.east + 300, s);
    computeBiome(V.north + 900, V.east + 300, s, 0.9, b, 0);
    expect(b.sand).toBeGreaterThan(0.9);
    expect(b.forest).toBe(0);
    expect(volcanoMask(V.north, V.east + V.baseRadius * 1.2, V, m).ash).toBe(0);
    expect(m.cone).toBe(0);
    setEra('present');
  });

  it('the GLSL cone weight is the CPU volcanoCone (thresholds parsed from the emitted text)', () => {
    const m = /volcanoCone\(float rN\) \{ return 1\.0 - smoothstep\(([\d.]+), ([\d.]+), rN\); \}/.exec(VOLCANO_GLSL);
    expect(m).not.toBeNull();
    const e0 = Number(m![1]);
    const e1 = Number(m![2]);
    const ss = (x: number): number => {
      const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
      return t * t * (3 - 2 * t);
    };
    for (let r = 0; r <= 1.5; r += 0.01) expect(1 - ss(r)).toBeCloseTo(volcanoCone(r), 6);
  });

  it('the terrain material gets the VOLCANO define and the uVolcano uniform only outside the present day', () => {
    const textures = {
      noise: new THREE.Texture(),
      albedo: new THREE.DataArrayTexture(),
      normal: new THREE.DataArrayTexture(),
      layerMeans: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
      ready: Promise.resolve(),
      dispose: () => {},
    } as unknown as TerrainTextures;
    const uniforms = (): TerrainUniforms =>
      ({
        uMorph: { value: [] },
        uSkirt: { value: [] },
        uLodCenter: { value: new THREE.Vector3() },
        uForestFade: { value: new THREE.Vector2() },
        uCanopyKeep: { value: new THREE.Vector4() },
        uViewPos: { value: new THREE.Vector3() },
      }) as unknown as TerrainUniforms;
    const build = (era: 'present' | 'cretaceous') => {
      setEra(era);
      const u = uniforms();
      const mat = createTerrainMaterial(textures, u);
      const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
      (mat.onBeforeCompile as unknown as (s: typeof shader, r: unknown) => void)(shader, null);
      setEra('present');
      return { mat, shader, u: u as unknown as Record<string, { value: unknown }> };
    };
    const p = build('present');
    expect(p.mat.defines?.VOLCANO).toBeUndefined();
    expect(p.u.uVolcano).toBeUndefined();
    expect(p.shader.fragmentShader).not.toContain('volcano');
    const c = build('cretaceous');
    expect(c.mat.defines?.VOLCANO).toBe(1);
    expect((c.shader.uniforms.uVolcano.value as THREE.Vector4).toArray()).toEqual([V.east, V.north, V.baseRadius, V.craterRadius]);
    for (const tag of ['float volcanoCone(', 'float tVolc = volcanoCone(', 'ledge *= 1.0 - tVolc;', 'float ashW = sandW', 'float crater = ']) expect(c.shader.fragmentShader).toContain(tag);
  });
});
