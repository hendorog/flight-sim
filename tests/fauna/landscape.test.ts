// Fauna across the landscape (Deep Time inc 2b, P1). Layer 1 (the Edmontosaurus waterside sites, probeHabitatCell)
// is frozen: tests/fixtures/faunaHabitatInc2.json holds every probeHabitatCell(ci, cj) result for ci, cj in
// [-15, 15) on the real Cretaceous terrain, recorded BEFORE any inc-2b edit.
//
// Re-capture (only with the pre-inc-2b code, never to make a change pass): CAPTURE_FAUNA_HABITAT_INC2=1 npx vitest
// run tests/fauna/landscape.test.ts

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setEra } from '../../src/world/era/eraState';
import { countingTerrain, makeSite, probeHabitatCell } from '../../src/world/fauna/habitat';
import { ROSTERS } from '../../src/world/fauna/roster';

// node:fs at run time (the project type-checks tests without node's types, as presentGuard does).
interface Fs {
  readFileSync(path: URL, encoding: 'utf8'): string;
  writeFileSync(path: URL, data: string): void;
}
const { readFileSync, writeFileSync } = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
const FIXTURE = new URL('../fixtures/faunaHabitatInc2.json', import.meta.url);
const CAPTURE = !!(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.CAPTURE_FAUNA_HABITAT_INC2;

beforeAll(() => {
  setEra('cretaceous');
});
afterAll(() => {
  setEra('present');
});

const roster = ROSTERS.cretaceous;
const FIX_MIN = -15;
const FIX_MAX = 15;

type Layer1Row = [ci: number, cj: number, ok: 0 | 1, north: number, east: number, ground: number, size: number, entry: number, samples: number];

/** Every layer-1 result over the fixture square (full precision: the probe is deterministic). */
function layer1Rows(): Layer1Row[] {
  const terrain = countingTerrain();
  const rows: Layer1Row[] = [];
  for (let ci = FIX_MIN; ci < FIX_MAX; ci++) {
    for (let cj = FIX_MIN; cj < FIX_MAX; cj++) {
      const s = makeSite();
      const ok = probeHabitatCell(ci, cj, roster, terrain, s);
      rows.push(ok ? [ci, cj, 1, s.north, s.east, s.ground, s.size, s.entry, s.samples] : [ci, cj, 0, 0, 0, 0, 0, s.entry, s.samples]);
    }
  }
  return rows;
}

describe('layer 1 (Edmontosaurus waterside sites) frozen', () => {
  it('probeHabitatCell matches the pre-inc-2b fixture exactly', () => {
    const rows = layer1Rows();
    if (CAPTURE) {
      writeFileSync(FIXTURE, JSON.stringify({ note: 'probeHabitatCell(ci, cj) for ci, cj in [-15, 15), recorded before Deep Time inc 2b (feat/deep-time-2 4f85c4f). Never recapture to make a change pass.', fields: ['ci', 'cj', 'ok', 'north', 'east', 'ground', 'size', 'entry', 'samples'], rows }, null, 0) + '\n');
    }
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rows: Layer1Row[] };
    expect(rows.length).toBe((FIX_MAX - FIX_MIN) ** 2);
    expect(rows).toEqual(fixture.rows);
  });
});
