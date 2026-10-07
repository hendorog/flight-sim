// The bake worker (render/aircraft/liveryWorker.ts) rebuilds the fuselage shapes, the window outlines and the
// cabin from the airframe definition it loads BY ID. What it bakes must be what the main thread would bake
// from the definition it holds, and the worker must not pull the flight model in with the definition.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AIRCRAFT_IDS } from '../../src/core/types';
import { loadAirframeVisual, loadPresentation } from '../../src/aircraft/registry';
import { C172S_VISUAL } from '../../src/aircraft/c172s/visual';
import type { AirframeVisualDef } from '../../src/aircraft/types';
import { cabinVisibility } from '../../src/render/aircraft/cabinLight';
import { createFuselageShapes } from '../../src/render/aircraft/fuselage';
import { Ring } from '../../src/render/aircraft/fuselageShape';
import { bakeFuselageData, makeWindowSdf } from '../../src/render/aircraft/livery';
import type { AircraftBakeRequest, AircraftBakeResult } from '../../src/render/aircraft/liveryWorker';

/** Every module under src/ by its path from there, as source text (for the import walk). */
const SOURCES = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true })).map(([path, text]) => [path.replace('../../src/', ''), text]),
);

/** The project modules a module loads when it is loaded: its static value imports, followed (dynamic imports apart). */
function staticClosure(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const code = SOURCES[file].replace(/\/\/[^\n]*/g, '');
  for (const m of code.matchAll(/^(?:import|export)\b([\w\s,{}*$]*?)\bfrom\s*'(\.[^']+)'/gm)) {
    if (/^\s*type\b/.test(m[1])) continue;
    const parts = file.split('/').slice(0, -1);
    for (const part of m[2].split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.') parts.push(part);
    }
    const path = parts.join('/');
    const target = [`${path}.ts`, `${path}/index.ts`].find((candidate) => candidate in SOURCES);
    if (target) staticClosure(target, seen);
  }
  return seen;
}

/** Checksum of the three lofts of a definition: every section on a grid of stations, and its ring. */
function shapeChecksum(def: AirframeVisualDef): number {
  const shapes = createFuselageShapes(def);
  const sdf = makeWindowSdf(def.glazing);
  const ring = new Ring();
  const p = { y: 0, z: 0 };
  let sum = 0;
  let n = 0;
  const add = (v: number): void => {
    sum += v * (1 + (n++ % 97) / 97);
  };
  for (const shape of [shapes.outer, shapes.glass, shapes.lining]) {
    for (let i = 0; i <= 120; i++) {
      const x = shape.x(i / 120);
      ring.set(shape.section(x));
      for (let k = 0; k < 24; k++) {
        ring.at(k / 24, p);
        add(x);
        add(p.y);
        add(p.z);
        add(sdf(x, p.y, p.z));
      }
    }
  }
  return sum;
}

/** Index of the first byte two buffers differ in, or -1 (33 MB of texels: not a job for a deep-equality matcher). */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** A canvas whose 2D context draws nothing (the registration lettering is then blank on both sides of the comparison). */
function blankCanvas(): unknown {
  const context = new Proxy(
    {
      measureText: (text: string) => ({ width: 10 * text.length }),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    } as Record<string | symbol, unknown>,
    { get: (t, key) => (key in t ? t[key] : () => undefined), set: () => true },
  );
  return { width: 300, height: 150, getContext: () => context };
}

describe('livery worker', () => {
  const posted: { message: AircraftBakeResult; transfer?: unknown[] }[] = [];
  const workerSelf: { onmessage: ((e: { data: AircraftBakeRequest }) => void) | null; postMessage(message: AircraftBakeResult, transfer?: unknown[]): void } = {
    onmessage: null,
    postMessage: (message, transfer) => void posted.push({ message, transfer }),
  };

  beforeAll(() => {
    vi.stubGlobal('self', workerSelf);
    vi.stubGlobal('document', { createElement: () => blankCanvas() });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('loads nothing of an aircraft but the visual loader and the default airframe, and no flight model', () => {
    const loaded = [...staticClosure('render/aircraft/liveryWorker.ts')];
    expect(loaded).toContain('aircraft/visualLoader.ts');
    expect(loaded.filter((f) => f.startsWith('aircraft/')).sort()).toEqual(['aircraft/c172s/visual.ts', 'aircraft/visualLoader.ts']);
    expect(loaded.filter((f) => /^(physics|sim|instruments|input|audio|ui|training)\//.test(f))).toEqual([]);
    // The pure planform maths the definition is computed with reaches neither three.js nor an aircraft file.
    expect([...staticClosure('render/aircraft/planformMath.ts')]).toEqual(['render/aircraft/planformMath.ts']);
    expect(SOURCES['render/aircraft/planformMath.ts']).not.toMatch(/from 'three/);
    expect([...staticClosure('aircraft/c172s/visual.ts')].sort()).toEqual(['aircraft/c172s/visual.ts', 'core/c172.ts', 'core/math.ts', 'render/aircraft/planformMath.ts']);
  });

  it('the definition the worker loads by id gives the shapes of the one the main thread holds, for every type', async () => {
    for (const id of AIRCRAFT_IDS) {
      const workerSide = await loadAirframeVisual(id);
      const mainSide = (await loadPresentation(id)).visual;
      expect(workerSide.id, id).toBe(id);
      expect(shapeChecksum(workerSide), id).toBe(shapeChecksum(mainSide));
    }
    // The default arguments of the builders are that same Cessna 172S.
    expect(shapeChecksum(await loadAirframeVisual('c172s'))).toBe(shapeChecksum(C172S_VISUAL));
  });

  it('answers a request with the textures and the cabin occlusion the main thread bakes', async () => {
    await import('../../src/render/aircraft/liveryWorker');
    expect(workerSelf.onmessage).toBeTypeOf('function');
    const count = 240;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const doubleSided = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const a = i * 2.399963;
      positions.set([0.45 * Math.cos(a), -0.5 + (1.0 * i) / count, -0.9 + (2.8 * ((i * 7) % count)) / count], i * 3);
      const n = new THREE.Vector3(Math.sin(a * 1.3), Math.cos(a * 0.7), Math.sin(a * 0.4 + 1)).normalize();
      normals.set([n.x, n.y, n.z], i * 3);
      doubleSided[i] = i % 4 === 0 ? 1 : 0;
    }
    workerSelf.onmessage!({ data: { airframeId: 'c172s', cabin: { positions, normals, doubleSided } } });
    await vi.waitFor(() => expect(posted).toHaveLength(1), { timeout: 30_000 });
    const { message, transfer } = posted[0];
    expect(message.error).toBeUndefined();
    expect(transfer).toHaveLength(6);

    const shapes = createFuselageShapes();
    const main = bakeFuselageData(shapes.outer, shapes.glass, shapes.lining);
    for (const name of ['colour', 'detail', 'glass', 'lining'] as const) {
      expect(message.textures[name].width, name).toBe(main[name].width);
      expect(message.textures[name].height, name).toBe(main[name].height);
      expect(firstDifference(message.textures[name].data, main[name].data), name).toBe(-1);
    }
    const vis = cabinVisibility(positions, normals, doubleSided);
    expect(Array.from(message.cabinVis.vis)).toEqual(Array.from(vis.vis));
    expect(Array.from(message.cabinVis.cube)).toEqual(Array.from(vis.cube));
  }, 60_000);

  it('livery.accentBelow moves the accent line to the other side of the band (absent: above, as before)', async () => {
    const def = await loadAirframeVisual('c152');
    const shapes = createFuselageShapes(def);
    const bake = (accentBelow: boolean | undefined) => bakeFuselageData(shapes.outer, shapes.glass, shapes.lining, { ...def, livery: { ...def.livery, accentBelow } }).colour.data;
    const above = bake(undefined);
    expect(firstDifference(bake(false), above)).toBe(-1);
    expect(firstDifference(bake(true), above)).not.toBe(-1);
  }, 60_000);

  it('answers an unknown airframe with an error, so that the sender bakes itself', async () => {
    await import('../../src/render/aircraft/liveryWorker');
    posted.length = 0;
    workerSelf.onmessage!({ data: { airframeId: 'c172', cabin: { positions: new Float32Array(0), normals: new Float32Array(0), doubleSided: new Uint8Array(0) } } });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].message.error).toMatch(/unknown aircraft 'c172'/);
  });
});
