// The browser's orography source (src/sim/weather/orographyPrefetch.ts) against a stand-in worker: the solutions
// kept are least recently used, tiles the wind field still holds are not solved again, and the tiles get() asked
// for (another sampler's, e.g. a windsock's) stay queued when update() rebuilds the aircraft's list.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultWeather } from '../../src/core/types';
import { OrographyField, emptyOrographySample, setOrographySource } from '../../src/physics/weather/orography/orographyField';
import type { TileSolution } from '../../src/physics/weather/orography/tileSolve';
import { KEEP, OrographyPrefetch, type OrographyJob } from '../../src/sim/weather/orographyPrefetch';

class FakeWorker {
  readonly posted: unknown[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  postMessage(m: unknown): void {
    this.posted.push(m);
  }
  terminate(): void {}
}

beforeAll(() => vi.stubGlobal('Worker', FakeWorker));
afterAll(() => vi.unstubAllGlobals());

const solution = (ti: number, tj: number, key: string): TileSolution =>
  ({ ti, tj, key, mean: 0, base: 0, relaxDepth: 1500, fields: null, hEff: null, shelter: null, envelope: null, chanNN: null, chanNE: null, chanEE: null, ms: 1 }) as TileSolution;

function rig() {
  const pf = new OrographyPrefetch();
  const worker = (pf as unknown as { worker: FakeWorker }).worker;
  pf.setup({ kind: 'setup', era: 'present', seed: 0, town: null } as never);
  const jobs = () => worker.posted.filter((m): m is OrographyJob => (m as OrographyJob).kind === 'solve');
  let answered = 0;
  /** Answer every job posted so far (one at a time: each answer lets the next one out). */
  const answerAll = () => {
    while (answered < jobs().length) {
      const j = jobs()[answered++];
      worker.onmessage!({ data: { id: j.id, key: j.key, sol: solution(j.ti, j.tj, j.key), terrainMs: 0 } });
    }
  };
  return { pf, jobs, answerAll };
}

const ww = { windDirectionDeg: 270, windSpeedKt: 10, dayOfYear: 172, isaDeviation: 0 };

describe('orography prefetch', () => {
  it('keeps the KEEP most recently used solutions: a get() refreshes an entry', () => {
    const { pf, answerAll } = rig();
    for (let j = 0; j < KEEP; j++) pf.get(0, j, ww, 'k');
    answerAll();
    expect(pf.kept).toBe(KEEP);
    expect(pf.version).toBe(KEEP);
    // (0, 0) is read again; then an eleventh tile arrives: (0, 1), the least recently used, goes.
    expect(pf.get(0, 0, ww, 'k')).not.toBeNull();
    pf.get(0, KEEP, ww, 'k');
    answerAll();
    expect(pf.kept).toBe(KEEP);
    expect(pf.get(0, 0, ww, 'k')).not.toBeNull();
    expect(pf.get(0, 1, ww, 'k')).toBeNull();
  });

  it('a tile get() asked for stays queued when update() rebuilds the aircraft list', () => {
    const { pf, jobs, answerAll } = rig();
    const height = () => 0;
    const field = new OrographyField(height);
    field.update(defaultWeather(), 0);
    const key = field.waveKey!;
    // A windsock far away asks for two tiles: one goes to the worker, one waits.
    pf.get(9, 9, ww, key);
    pf.get(9, 10, ww, key);
    expect(jobs().map((j) => `${j.ti},${j.tj}`)).toEqual(['9,9']);
    // Frames go by with the aircraft at the origin.
    for (let i = 0; i < 5; i++) pf.update(field, 0, 0, 0, 0);
    answerAll();
    const order = jobs().map((j) => `${j.ti},${j.tj}`);
    expect(order[1]).toBe('9,10');
    expect(order).toContain('0,0');
  });

  it('update() does not queue a tile the wind field still holds, though this cache dropped it', () => {
    const { pf, jobs, answerAll } = rig();
    const height = () => 0;
    setOrographySource(height, pf);
    try {
      const field = new OrographyField(height);
      field.update(defaultWeather(), 0);
      const key = field.waveKey!;
      const out = emptyOrographySample();
      // The aircraft at the origin: tile (0, 0) only. It misses, is solved, and the field takes it.
      field.sample(0, 0, 1000, 0, out);
      answerAll();
      field.sample(0, 0, 1000, 0.1, out);
      expect(field.holds(0, 0, key)).toBe(true);
      // KEEP other tiles arrive (another sampler's): (0, 0) leaves this cache.
      for (let j = 1; j <= KEEP; j++) pf.get(3, j, ww, key);
      answerAll();
      const kept = (pf as unknown as { solutions: Map<string, TileSolution> }).solutions;
      expect([...kept.keys()].some((k) => k.startsWith('0,0:'))).toBe(false);
      // Frames with the aircraft at the origin: nothing is sent for (0, 0).
      const before = jobs().length;
      for (let i = 0; i < 3; i++) pf.update(field, 0, 0, 0, 0);
      answerAll();
      expect(jobs().length).toBe(before);
    } finally {
      setOrographySource(height, null);
    }
  });
});
