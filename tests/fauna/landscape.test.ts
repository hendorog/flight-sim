// Fauna across the landscape (Deep Time inc 2b, P1). Layer 1 (the Edmontosaurus waterside sites, probeHabitatCell)
// is frozen: tests/fixtures/faunaHabitatInc2.json holds every probeHabitatCell(ci, cj) result for ci, cj in
// [-15, 15) on the real Cretaceous terrain, recorded BEFORE any inc-2b edit.
//
// Re-capture (only with the pre-inc-2b code, never to make a change pass): CAPTURE_FAUNA_HABITAT_INC2=1 npx vitest
// run tests/fauna/landscape.test.ts
//
// Layer 2 (probeCell) and the roaming T. rex: every layer-2 site passes its predicate (re-evaluated here from
// sampleTerrain + computeBiome), keeps out of the safari's quiet zone and costs <= 40 reads per cell; abundance over
// +-30 km in animals (Edmontosaurus common, Triceratops uncommon, Alamosaurus rare); the FaunaSystem streams the right
// species at the verification points V1-V5, keeps its caps, places <= 2 roaming T. rexes beside prey herds and
// releases them with their herd; the scripted first minute is untouched; ambient Pteranodon kettles keep to water.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventBus, type QualityLevel, type SimContext } from '../../src/core/context';
import { defaultWeather } from '../../src/core/types';
import { createWorldEnvironment } from '../../src/sim/worldEnvironment';
import { SAFARI, SAFARI_FLIGHT, TREX_LAIR, safariAt, safariHeading } from '../../src/world/era/cretaceousAnchors';
import { setEra } from '../../src/world/era/eraState';
import { eraById } from '../../src/world/era/registry';
import { AMBIENT_REX_BRAIN, AMBIENT_REX_MAX, REX_RANGE_MIN, REX_RANGE_SPAN, createFaunaSystem, type FaunaSystemImpl } from '../../src/world/fauna/FaunaSystem';
import * as Anchors from '../../src/world/era/cretaceousAnchors';
import { SoloAgentPool } from '../../src/world/fauna/agents';
import { HerdPool, type AircraftView } from '../../src/world/fauna/herds';
import { THREAT } from '../../src/world/fauna/reactions';
import {
  CELL_READS,
  HABITAT_CELL,
  LAYER2,
  REX_QUIET_M,
  countingTerrain,
  inQuietZone,
  kettleEntry,
  layer2Entries,
  LAYER2_PROBES,
  SAMPLES_PER_PROBE,
  STREAM_PROBE_READS,
  layer2Random,
  layer3Random,
  makeSite,
  probeCell,
  probeCellExtra,
  rexDraw,
  probeHabitatCell,
  rexRandom,
  safariFootprintDist,
  uplandIndex,
  type FaunaTerrain,
} from '../../src/world/fauna/habitat';
import { FAUNA_PRESETS, MAX_AGENTS, MAX_HERDS, TERRAIN_CALLS_PER_FRAME } from '../../src/world/fauna/presets';
import { ROSTERS } from '../../src/world/fauna/roster';
import { TREX_STATE } from '../../src/world/fauna/species/tyrannosaurus.brain';
import { FAUNA_SPECIES_IDS, type FaunaSpeciesId } from '../../src/world/fauna/types';
import { computeBiome, makeBiome, treeLine } from '../../src/world/terrain/biome';
import { SEA_LEVEL, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';

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

// ---------------------------------------------------------------------------------------------------------------
// Layer 2: sites, predicates, abundance

interface Site {
  ci: number;
  cj: number;
  north: number;
  east: number;
  ground: number;
  size: number;
  entry: number;
  samples: number;
  /** Cell sub-slot: 0 probeCell (layers 1 and 2), 1 probeCellExtra (layer 3); absent = 0. */
  sub?: number;
}
/** Animal class of a site: the plains Edmontosaurus count as Edmontosaurus. */
const speciesOf = (entry: number): FaunaSpeciesId => roster.entries[entry].species;

/**
 * Every site over +-30 km: `all` holds layers 1-3, `layer2` the probeCell layer-2 sites, `layer3` the probeCellExtra
 * ones (fauna across the landscape); computed on first use, inside the tests (after setEra('cretaceous')).
 */
let survey: { all: Site[]; layer2: Site[]; layer3: Site[]; maxSamples: number; maxSamples3: number } | null = null;
const S = () => (survey ??= runSurvey());
function runSurvey() {
  const terrain = countingTerrain();
  const all: Site[] = [];
  let maxSamples = 0;
  for (let ci = -15; ci < 15; ci++) {
    for (let cj = -15; cj < 15; cj++) {
      const s = makeSite();
      const before = terrain.calls;
      const ok = probeCell(ci, cj, roster, terrain, s);
      expect(s.samples).toBe(terrain.calls - before);
      maxSamples = Math.max(maxSamples, s.samples);
      if (ok) all.push({ ...s });
    }
  }
  const layer3: Site[] = [];
  let maxSamples3 = 0;
  for (let ci = -15; ci < 15; ci++) {
    for (let cj = -15; cj < 15; cj++) {
      const s = makeSite();
      const before = terrain.calls;
      const ok = probeCellExtra(ci, cj, roster, terrain, s);
      expect(s.samples).toBe(terrain.calls - before);
      maxSamples3 = Math.max(maxSamples3, s.samples);
      if (ok) layer3.push({ ...s, sub: 1 });
    }
  }
  return { all: [...all, ...layer3], layer2: all.filter((s) => s.entry !== 0), layer3, maxSamples, maxSamples3 };
}

/** The predicate of a layer-2 site, re-evaluated independently from sampleTerrain + computeBiome. */
function predicate(site: Site): { ok: boolean; upland: number; forest: number } {
  const s = sampleTerrain(site.north, site.east, makeSample());
  const g = (n: number, e: number) => sampleTerrain(n, e, makeSample()).ground;
  const ge = (g(site.north, site.east + 30) - g(site.north, site.east - 30)) / 60;
  const gn = (g(site.north + 30, site.east) - g(site.north - 30, site.east)) / 60;
  const slope = Math.sqrt(ge * ge + gn * gn);
  const up = 1 / Math.sqrt(1 + ge * ge + gn * gn);
  const b = computeBiome(site.north, site.east, s, up, makeBiome(), -gn * up);
  const upland = uplandIndex(s.ground, up);
  // Shared with layer 1: not the airfield, its approaches, water, the bank, above the tree line; plus no sand / ash.
  const shared =
    s.airportBlend > 0.98 &&
    s.approach === 0 &&
    s.ground >= Math.max(s.standing, s.river) + 0.3 &&
    !(s.riverHalfWidth > 0 && s.riverDist < s.riverHalfWidth + 45) &&
    s.ground < treeLine(site.north, site.east) &&
    b.sand < 0.3;
  const kind = roster.entries[site.entry].habitat;
  let own = false;
  // (The height caps 900 / 1100 m: fauna across the landscape, AGENT choice; 450 / 700 m before.)
  if (kind === 'plain') own = slope < 0.15 && s.ground < 900 && b.forest < 0.3 && (b.moisture >= 0.5 || s.riverDist < 2000 || s.standing > SEA_LEVEL);
  else if (kind === 'open') own = slope < 0.15 && s.ground < 1100 && b.forest < 0.35;
  else if (kind === 'woodland') own = slope < 0.2 && s.ground > 120 && ((b.forest >= 0.08 && b.forest < 0.55) || (upland >= 0.3 && b.forest < 0.08));
  return { ok: shared && own, upland, forest: b.forest };
}

describe('layer 2 (plains Edmontosaurus, Triceratops, Alamosaurus)', () => {
  it('layer 1 is unchanged inside probeCell: every layer-1 site is the fixture site', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rows: Layer1Row[] };
    const layer1 = S().all.filter((s) => s.entry === 0 && !s.sub);
    expect(S().layer3.every((s) => s.entry !== 0)).toBe(true);
    const want = fixture.rows.filter((r) => r[2] === 1);
    expect(layer1.map((s) => [s.ci, s.cj, s.north, s.east, s.size])).toEqual(want.map((r) => [r[0], r[1], r[3], r[4], r[6]]));
    expect(layer2Entries(roster).map((i) => [speciesOf(i), roster.entries[i].habitat])).toEqual([
      ['triceratops', 'open'],
      ['alamosaurus', 'woodland'],
      ['edmontosaurus', 'plain'],
    ]);
  });

  it('every layer-2 site passes its own predicate, outside the quiet zone, within 40 reads a cell', () => {
    expect(S().layer2.length).toBeGreaterThan(40);
    expect(S().layer3.length).toBeGreaterThan(40);
    for (const site of [...S().layer2, ...S().layer3]) {
      expect(predicate(site).ok, `${speciesOf(site.entry)} at ${site.north.toFixed(0)}, ${site.east.toFixed(0)}`).toBe(true);
      expect(inQuietZone(site.north, site.east)).toBe(false);
      // In its own cell, its own group size.
      expect(Math.floor(site.north / HABITAT_CELL)).toBe(site.ci);
      expect(Math.floor(site.east / HABITAT_CELL)).toBe(site.cj);
      const e = roster.entries[site.entry];
      expect(site.size).toBeGreaterThanOrEqual(e.groupMin);
      expect(site.size).toBeLessThanOrEqual(e.groupMax);
    }
    expect(S().maxSamples).toBeLessThanOrEqual(CELL_READS);
    expect(S().maxSamples3).toBeLessThanOrEqual(LAYER2_PROBES * SAMPLES_PER_PROBE);
    // The quiet zone is real: the showcase anchors and the first-minute path are inside it.
    const p = safariAt(40);
    expect(inQuietZone(p.north, p.east)).toBe(true);
    expect(inQuietZone(TREX_LAIR.north, TREX_LAIR.east)).toBe(true);
  });

  it('is deterministic per cell, whatever the visiting order', () => {
    const terrain = countingTerrain();
    for (const s of [...S().layer2].reverse().slice(0, 30)) {
      const again = makeSite();
      expect(probeCell(s.ci, s.cj, roster, terrain, again)).toBe(true);
      expect({ ...again }).toEqual(s);
    }
    for (const s of [...S().layer3].reverse().slice(0, 30)) {
      const again = makeSite();
      expect(probeCellExtra(s.ci, s.cj, roster, terrain, again)).toBe(true);
      expect({ ...again, sub: 1 }).toEqual(s);
    }
    expect(layer3Random(3, -4, 7)).not.toBe(layer2Random(3, -4, 7));
    expect(layer3Random(3, -4, 7)).not.toBe(rexRandom(3, -4, 7));
    expect(layer2Random(3, -4, 7)).toBe(layer2Random(3, -4, 7));
    expect(layer2Random(3, -4, 7)).not.toBe(rexRandom(3, -4, 7));
  });

  it('abundance over +-30 km, in animals: Edmontosaurus >= 5x Triceratops >= 2.5x Alamosaurus', () => {
    const animals: Record<string, number> = {};
    const groups: Record<string, number> = {};
    for (const s of S().all) {
      const k = s.entry === 0 ? 'edmontosaurus (waterside)' : s.entry === 7 ? 'edmontosaurus (plains)' : speciesOf(s.entry);
      animals[k] = (animals[k] ?? 0) + s.size;
      groups[k] = (groups[k] ?? 0) + 1;
    }
    const edmo = (animals['edmontosaurus (waterside)'] ?? 0) + (animals['edmontosaurus (plains)'] ?? 0);
    const tri = animals.triceratops ?? 0;
    const ala = animals.alamosaurus ?? 0;
    // Layers 2 and 3: every Alamosaurus group the streaming places (layer 1 is the waterside Edmontosaurus).
    const alamo = [...S().layer2, ...S().layer3].filter((s) => speciesOf(s.entry) === 'alamosaurus');
    const alamoUp = alamo.filter((s) => {
      const p = predicate(s);
      return p.upland >= 0.2 || p.forest >= 0.15;
    }).length;
    const rexPrey = S().all.filter((s) => (speciesOf(s.entry) === 'edmontosaurus' || speciesOf(s.entry) === 'triceratops') && rexDraw(s.ci, s.cj, s.sub ?? 0, 0) < roster.entries[5].occupancy! && safariFootprintDist(s.north, s.east) >= REX_QUIET_M).length;
    console.log(`abundance +-30 km: groups ${JSON.stringify(groups)} animals ${JSON.stringify(animals)}; Alamosaurus upland/edge ${alamoUp}/${alamo.length}; T. rex-eligible prey herds ${rexPrey}`);
    expect(edmo).toBeGreaterThanOrEqual(5 * tri);
    expect(tri).toBeGreaterThanOrEqual(2.5 * ala);
    expect(groups.triceratops).toBeGreaterThanOrEqual(15);
    expect(alamo.length).toBeGreaterThanOrEqual(6);
    // 30 -> 60 groups once layer 3 is counted (fauna across the landscape, AGENT choice: measured 45 over layers 2+3);
    // the animal ratio above (Triceratops >= 2.5x Alamosaurus) keeps the sauropod the rarest herd animal.
    expect(alamo.length).toBeLessThanOrEqual(60);
    expect(alamoUp / alamo.length).toBeGreaterThanOrEqual(0.5);
    expect(rexPrey).toBeGreaterThanOrEqual(5);
    // 30 -> 60 with layer 3 and the denser layer 2 (fauna across the landscape, AGENT choice: measured 40; at most
    // AMBIENT_REX_MAX roam at once whatever this is, so the T. rex stays the rarest animal in sight).
    expect(rexPrey).toBeLessThanOrEqual(60);
  });

  it('each verification point V1-V5 has >= 2 species within 8 km, its named target among them', () => {
    for (const v of VPOINTS) {
      const near = S().all.filter((s) => Math.hypot(s.north - v.n, s.east - v.e) < 8000);
      const species = new Set(near.map((s) => speciesOf(s.entry)));
      expect(species.size, v.id).toBeGreaterThanOrEqual(2);
      expect(species.has(v.target), `${v.id} ${v.target}`).toBe(true);
    }
  });
});

/** The verification points (plan section 9): camera position (NED, MSL) and the shot's named target species. */
const VPOINTS: { id: string; n: number; e: number; alt: number; target: FaunaSpeciesId }[] = [
  { id: 'V1', n: -12900, e: -12600, alt: 420, target: 'edmontosaurus' },
  { id: 'V2', n: 10600, e: 4300, alt: 720, target: 'alamosaurus' },
  { id: 'V3', n: -17200, e: 4800, alt: 520, target: 'triceratops' },
  { id: 'V4', n: 4600, e: -7000, alt: 560, target: 'edmontosaurus' },
  { id: 'V5', n: -3800, e: 9800, alt: 460, target: 'triceratops' },
];
/** The densest streaming point (the river floodplain SW): the MAX_HERDS measurement. */
const DENSE = { id: 'SW', n: -15000, e: -14000, alt: 400, target: 'edmontosaurus' as FaunaSpeciesId };
/** A point where T. rex-eligible prey herds stream in at high (the far-east plains; rexRandom's salt decides where). */
const VREX = { id: 'VR', n: -15000, e: 21000, alt: 500 };

// ---------------------------------------------------------------------------------------------------------------
// The FaunaSystem streaming it

function spyTerrain(): FaunaTerrain & { total: number } {
  const real = countingTerrain();
  const t = {
    calls: 0,
    total: 0,
    sample(n: number, e: number, out: Parameters<FaunaTerrain['sample']>[2]) {
      t.calls++;
      t.total++;
      return real.sample(n, e, out);
    },
    height(n: number, e: number) {
      t.calls++;
      t.total++;
      return real.height(n, e);
    },
  };
  return t;
}

function makeCtx(quality: QualityLevel, tod = 10) {
  const weather = { ...defaultWeather(), timeOfDay: tod, cloudCover: 0.35, windSpeedKt: 6 };
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400000);
  const state = { position: { x: 0, y: 0, z: -400 }, velocity: { x: 0, y: 50, z: 0 }, tas: 50, altitudeAGL: 400 };
  const ctx = { scene: new THREE.Scene(), camera, state, weather, env: createWorldEnvironment(weather), sky: { dayFactor: 1 }, simTime: 0, quality, events: createEventBus() };
  return ctx as unknown as SimContext & { state: typeof state; simTime: number };
}

/** Camera and aircraft at (n, e, alt), looking along hdg and down a little. */
function place(ctx: ReturnType<typeof makeCtx>, n: number, e: number, alt: number, hdg: number): void {
  ctx.state.position.x = n;
  ctx.state.position.y = e;
  ctx.state.position.z = -alt;
  ctx.state.velocity.x = 50 * Math.cos(hdg);
  ctx.state.velocity.y = 50 * Math.sin(hdg);
  ctx.camera.position.set(e, alt, -n);
  ctx.camera.lookAt(e + 1000 * Math.sin(hdg), alt - 150, -(n + 1000 * Math.cos(hdg)));
  ctx.camera.updateMatrixWorld();
}

function build(quality: QualityLevel) {
  const terrain = spyTerrain();
  const sys = createFaunaSystem(eraById('cretaceous'), { terrain }) as FaunaSystemImpl;
  const ctx = makeCtx(quality);
  sys.init(ctx);
  return { sys, ctx, terrain };
}

/** Run `seconds` at a fixed camera; the most terrain reads in one frame. */
function hold(sys: FaunaSystemImpl, ctx: ReturnType<typeof makeCtx>, terrain: { total: number }, n: number, e: number, alt: number, seconds: number, dt = 1 / 30): number {
  let maxReads = 0;
  for (let k = 0, frames = Math.round(seconds / dt); k < frames; k++) {
    ctx.simTime += dt;
    place(ctx, n, e, alt, (k * dt * 0.15) % (2 * Math.PI));
    const before = terrain.total;
    sys.update(dt, ctx);
    maxReads = Math.max(maxReads, terrain.total - before);
  }
  return maxReads;
}

const streamed = (sys: FaunaSystemImpl): number[] => {
  const out: number[] = [];
  for (let h = 0; h < MAX_HERDS; h++) if (sys.herds.active[h] && !sys.herds.pinned[h]) out.push(h);
  return out;
};

describe('FaunaSystem streaming across the landscape', () => {
  for (const quality of ['high', 'ultra'] as const) {
    for (const v of [...VPOINTS, DENSE]) {
      it(`${v.id} at ${quality}: the right species, caps, roaming T. rexes beside their herds, released with them`, () => {
        const { sys, ctx, terrain } = build(quality);
        const H = sys.herds;
        const A = sys.agents;
        const maxReads = hold(sys, ctx, terrain, v.n, v.e, v.alt, 40);
        expect(maxReads).toBeLessThanOrEqual(TERRAIN_CALLS_PER_FRAME);
        expect(sys.debug.errors).toBe(0);
        // Every streamed herd carries its roster entry's species (inc 2 streamed everything as Edmontosaurus).
        const seen = new Set<FaunaSpeciesId>();
        for (const h of streamed(sys)) {
          const sp = speciesOf(H.entry[h]);
          expect(FAUNA_SPECIES_IDS[H.species[h]]).toBe(sp);
          expect(H.roam[h]).toBe(H.entry[h] === 0 ? 0 : 1);
          seen.add(sp);
        }
        expect(seen.has('edmontosaurus')).toBe(true);
        expect(seen.has('triceratops')).toBe(true);
        // Caps: every site within 5 km of the camera has its herd (eviction makes room for near sites).
        expect(H.count()).toBeLessThanOrEqual(MAX_HERDS);
        const near = S().all.filter((s) => Math.hypot(s.north - v.n, s.east - v.e) < 5000);
        const keys = new Set(streamed(sys).map((h) => H.key[h]));
        for (const s of near) expect(keys.has((s.ci + 32768) * 65536 + (s.cj + 32768) + (s.sub ?? 0) * 4294967296), `${speciesOf(s.entry)} site ${s.ci},${s.cj} sub ${s.sub ?? 0}`).toBe(true);
        // Roaming T. rexes: at most AMBIENT_REX_MAX, never in the showcase slot, beside an unpinned herd's home.
        let amb = 0;
        for (let i = 0; i < A.capacity; i++) {
          if (!sys.ambientAgent[i]) continue;
          amb++;
          expect(i).toBeGreaterThan(0);
          expect(A.active[i]).toBe(1);
          const h = sys.agentHerd[i];
          expect(H.active[h]).toBe(1);
          expect(H.pinned[h]).toBe(0);
          expect(H.key[h]).toBe(sys.agentHerdKey[i]);
          const r = Math.hypot(A.homeN[i] - H.homeN[h], A.homeE[i] - H.homeE[h]);
          expect(r).toBeGreaterThanOrEqual(REX_RANGE_MIN - 1e-6);
          expect(r).toBeLessThanOrEqual(REX_RANGE_MIN + REX_RANGE_SPAN + 1e-6);
          expect(safariFootprintDist(A.homeN[i], A.homeE[i])).toBeGreaterThanOrEqual(REX_QUIET_M - REX_RANGE_MIN - REX_RANGE_SPAN);
          expect(safariFootprintDist(H.homeN[h], H.homeE[h])).toBeGreaterThanOrEqual(REX_QUIET_M);
        }
        expect(amb).toBeLessThanOrEqual(AMBIENT_REX_MAX);
        expect(A.count()).toBeLessThanOrEqual(MAX_AGENTS - 1);
        // The showcase T. rex keeps slot 0.
        expect(Math.hypot(A.homeN[0] - TREX_LAIR.north, A.homeE[0] - TREX_LAIR.east)).toBeLessThan(2);
        console.log(`${v.id} ${quality}: ${streamed(sys).length} streamed herds (${[...seen].join(', ')}), ${amb} roaming T. rex, ${sys.debug.evictions} evictions, max reads ${maxReads}`);
        // 25 km away, the herds and their T. rexes are released.
        const before = streamed(sys).map((h) => H.key[h]);
        hold(sys, ctx, terrain, v.n + 25000, v.e, 900, 3);
        const after = new Set(streamed(sys).map((h) => H.key[h]));
        for (const k of before) expect(after.has(k)).toBe(false);
        for (let i = 0; i < A.capacity; i++) {
          if (!sys.ambientAgent[i]) continue;
          expect(Math.hypot(A.n[i] - v.n, A.e[i] - v.e)).toBeGreaterThan(15000);
        }
        expect(A.active[0]).toBe(1);
      });
    }
  }

  it(`roaming T. rexes at ${VREX.id} (far-east plains, high): beside their prey herds, released with them`, () => {
    const { sys, ctx, terrain } = build('high');
    const H = sys.herds;
    const A = sys.agents;
    hold(sys, ctx, terrain, VREX.n, VREX.e, VREX.alt, 40);
    const rex: number[] = [];
    for (let i = 0; i < A.capacity; i++) if (sys.ambientAgent[i]) rex.push(i);
    console.log(`${VREX.id} high: roaming T. rex ${rex.map((i) => `${A.n[i].toFixed(0)},${A.e[i].toFixed(0)} by ${speciesOf(H.entry[sys.agentHerd[i]])} herd ${Math.hypot(A.homeN[i] - H.homeN[sys.agentHerd[i]], A.homeE[i] - H.homeE[sys.agentHerd[i]]).toFixed(0)} m`).join('; ')}`);
    expect(rex.length).toBeGreaterThanOrEqual(1);
    expect(rex.length).toBeLessThanOrEqual(AMBIENT_REX_MAX);
    for (const i of rex) {
      const h = sys.agentHerd[i];
      expect(i).toBeGreaterThan(0);
      expect(H.pinned[h]).toBe(0);
      const sp = speciesOf(H.entry[h]);
      expect(sp === 'edmontosaurus' || sp === 'triceratops').toBe(true);
      const r = Math.hypot(A.homeN[i] - H.homeN[h], A.homeE[i] - H.homeE[h]);
      expect(r).toBeGreaterThanOrEqual(REX_RANGE_MIN - 1e-6);
      expect(r).toBeLessThanOrEqual(REX_RANGE_MIN + REX_RANGE_SPAN + 1e-6);
      expect(safariFootprintDist(H.homeN[h], H.homeE[h])).toBeGreaterThanOrEqual(REX_QUIET_M);
      // Its own deterministic seed (per cell), the showcase species and entry.
      expect(A.speciesId(i)).toBe('tyrannosaurus');
      expect(roster.entries[A.entry[i]].habitat).toBe('nearHerd');
    }
    // A herd slot reused by another herd (as eviction does) takes its T. rex with it at the next stream tick.
    const i0 = rex[0];
    const h0 = sys.agentHerd[i0];
    const home0 = A.homeN[i0];
    const oldKey = sys.agentHerdKey[i0];
    // (A layer-2 herd's slot is reused by the next layer-2 spawn: those take the highest free slot.)
    const bg = H.background[h0] === 1;
    H.release(h0);
    expect(H.spawn({ north: H.homeN[h0] + 50, east: H.homeE[h0], ground: H.cH[h0], size: 5, entry: 3, scale: 1, variant: 0, seed: 1, heading: 0, pinned: false, species: 'triceratops', background: bg }, 12345)).toBe(h0);
    hold(sys, ctx, terrain, VREX.n, VREX.e, VREX.alt, 0.3);
    // (Released; the slot may already hold a new T. rex placed for another herd.)
    expect(A.active[i0] === 0 || A.homeN[i0] !== home0).toBe(true);
    for (let i = 0; i < A.capacity; i++) {
      if (!sys.ambientAgent[i]) continue;
      expect(H.key[sys.agentHerd[i]]).toBe(sys.agentHerdKey[i]);
      expect(sys.agentHerdKey[i]).not.toBe(oldKey);
    }
    H.release(h0);
    // 25 km away: every streamed herd and every roaming T. rex is released; the showcase T. rex stays.
    hold(sys, ctx, terrain, VREX.n + 25000, VREX.e, 900, 3);
    for (let i = 0; i < A.capacity; i++) {
      if (!sys.ambientAgent[i]) continue;
      expect(Math.hypot(A.n[i] - VREX.n, A.e[i] - VREX.e)).toBeGreaterThan(15000);
    }
    for (const h of streamed(sys)) expect(Math.hypot(H.homeN[h] - VREX.n, H.homeE[h] - VREX.e)).toBeGreaterThan(15000);
    expect(A.active[0]).toBe(1);
  });

  it('when the herd slots are full, a near site evicts the farthest unpinned herd', () => {
    const { sys, ctx, terrain } = build('ultra');
    const H = sys.herds;
    const v = VPOINTS[0];
    // Fill every free slot with small unpinned herds 10.5 km out (inside the release radius at ultra).
    let k = 0;
    while (H.count() < MAX_HERDS) {
      const a = (k / 24) * 2 * Math.PI;
      H.spawn({ north: v.n + 10500 * Math.cos(a), east: v.e + 10500 * Math.sin(a), ground: 100, size: 3, entry: 3, scale: 1, variant: 0, seed: 9000 + k, heading: 0, pinned: false, species: 'triceratops' }, -1);
      k++;
    }
    hold(sys, ctx, terrain, v.n, v.e, v.alt, 30);
    expect(sys.debug.evictions).toBeGreaterThan(0);
    const keys = new Set(streamed(sys).map((h) => H.key[h]));
    // (Sub-slot 0 sites: a layer-3 site never evicts a sub-0 herd, only a farther layer-3 one.)
    const near = S().all.filter((s) => !s.sub && Math.hypot(s.north - v.n, s.east - v.e) < 5000);
    expect(near.length).toBeGreaterThan(3);
    for (const s of near) expect(keys.has((s.ci + 32768) * 65536 + (s.cj + 32768))).toBe(true);
  });

  it('steady-state streaming does not allocate', () => {
    const { sys, ctx, terrain } = build('high');
    hold(sys, ctx, terrain, VPOINTS[0].n, VPOINTS[0].e, VPOINTS[0].alt, 30);
    const proc = (globalThis as unknown as { process: { memoryUsage(): { heapUsed: number } } }).process;
    // No thermals (no ambient kettle draws): the stream's own loops, sweep and T. rex search.
    (ctx as unknown as { env: unknown }).env = undefined;
    const stream = (sys as unknown as { stream(c: SimContext, n: number, e: number): void }).stream.bind(sys);
    const fn = () => stream(ctx, VPOINTS[0].n, VPOINTS[0].e);
    for (let k = 0; k < 20000; k++) fn();
    const runs: number[] = [];
    for (let r = 0; r < 7; r++) {
      const a = proc.memoryUsage().heapUsed;
      for (let k = 0; k < 2000; k++) fn();
      runs.push((proc.memoryUsage().heapUsed - a) / 2000);
    }
    runs.sort((x, y) => x - y);
    expect(runs[3]).toBeLessThan(8);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The scripted first minute is untouched

const AT = { north: 0, east: 0, alt: 0 };
function bootSafari(quality: QualityLevel) {
  const ctx = makeCtx(quality, SAFARI.tod);
  const terrain = spyTerrain();
  const sys = createFaunaSystem(eraById('cretaceous'), { terrain }) as FaunaSystemImpl;
  flyTo(ctx, 0);
  sys.init(ctx);
  return { sys, ctx };
}
function flyTo(ctx: ReturnType<typeof makeCtx>, t: number): void {
  safariAt(t, AT);
  const hd = safariHeading();
  ctx.state.position.x = AT.north;
  ctx.state.position.y = AT.east;
  ctx.state.position.z = -AT.alt;
  ctx.state.velocity.x = SAFARI_FLIGHT.groundSpeed * Math.cos(hd);
  ctx.state.velocity.y = SAFARI_FLIGHT.groundSpeed * Math.sin(hd);
  ctx.camera.position.set(AT.east, AT.alt, -AT.north);
  ctx.camera.lookAt(AT.east + 1000 * Math.sin(hd), AT.alt - 100, -(AT.north + 1000 * Math.cos(hd)));
  ctx.camera.updateMatrixWorld();
}

describe('the first minute', () => {
  /** Fly the safari's first 75 s; per sampled frame, the roaming T. rexes' states and positions. */
  function runFirstMinute(quality: QualityLevel) {
    const { sys, ctx } = bootSafari(quality);
    const H = sys.herds;
    const A = sys.agents;
    const dt = 1 / 30;
    const ambient: { t: number; state: number; foot: number }[] = [];
    let charged = false;
    let quietBreach = 0;
    let slot0 = true;
    /** Frames where the river herd's external threat came from somewhere other than the showcase T. rex (slot 0). */
    let foreignThreat = 0;
    for (let f = 1; f <= 75 * 30; f++) {
      ctx.simTime = f * dt;
      flyTo(ctx, f * dt);
      sys.update(dt, ctx);
      if (A.state[0] === TREX_STATE.charge) charged = true;
      const rh = sys.riverHerd;
      if (rh >= 0 && H.active[rh] && H.extLevel[rh] !== THREAT.none && Math.hypot(H.extN[rh] - A.n[0], H.extE[rh] - A.e[0]) > 50) foreignThreat++;
      if (f % 15) continue;
      for (let h = 0; h < MAX_HERDS; h++) if (H.active[h] && !H.pinned[h] && H.entry[h] !== 0 && inQuietZone(H.homeN[h], H.homeE[h])) quietBreach++;
      for (let i = 0; i < A.capacity; i++) if (sys.ambientAgent[i]) ambient.push({ t: f * dt, state: A.state[i], foot: safariFootprintDist(A.n[i], A.e[i]) });
      if (sys.ambientAgent[0] || Math.hypot(A.homeN[0] - TREX_LAIR.north, A.homeE[0] - TREX_LAIR.east) >= 2) slot0 = false;
    }
    return { sys, ambient, charged, quietBreach, slot0, foreignThreat };
  }
  const runs = new Map<QualityLevel, ReturnType<typeof runFirstMinute>>();
  const run = (q: QualityLevel) => {
    if (!runs.has(q)) runs.set(q, runFirstMinute(q));
    return runs.get(q)!;
  };

  for (const quality of ['high', 'ultra'] as const) {
    it(`${quality}: no layer-2 herd in the quiet zone, no roaming T. rex near the footprint, the showcase T. rex in slot 0 and charging`, () => {
      const r = run(quality);
      console.log(`first minute ${quality}: roaming T. rex samples ${r.ambient.length} (first at ${r.ambient[0]?.t.toFixed(1) ?? '-'} s), herds ${r.sys.herds.count()}`);
      expect(r.quietBreach).toBe(0);
      for (const a of r.ambient) expect(a.foot).toBeGreaterThanOrEqual(REX_QUIET_M - REX_RANGE_MIN - REX_RANGE_SPAN);
      expect(r.slot0).toBe(true);
      expect(r.charged).toBe(true);
    });

    // A roaming T. rex runs AMBIENT_REX_BRAIN (ctx.riverHerd masked to -1), so it never sees the river herd: with
    // the inc-2 brain it stays in LURK; with the generalised brain it shadows its own unpinned prey, far from here.
    // (Unmasked, the inc-2 brain made the roaming T. rex placed at ultra, ~22 s and 8.4 km from the footprint, stalk
    // the river herd from kilometres away and break up the scripted stampede.)
    it(`${quality}: no roaming T. rex leaves LURK in the first 75 s; only the showcase T. rex threatens the river herd`, () => {
      const r = run(quality);
      for (const a of r.ambient) expect(a.state, `roaming T. rex at ${a.t.toFixed(1)} s`).toBe(TREX_STATE.lurk);
      expect(r.foreignThreat).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Ambient kettles keep the Pteranodon near water

describe('ambient kettle species by water', () => {
  it('near water the Pteranodon share is >= 2x the far share', () => {
    const flyers: number[] = [];
    roster.entries.forEach((e, i) => e.role === 'flyer' && e.ambient !== false && e.weight > 0 && flyers.push(i));
    const share = (near: boolean): number => {
      let p = 0;
      for (let k = 0; k < 400; k++) if (speciesOf(kettleEntry(roster, flyers, (k + 0.5) / 400, near)) === 'pteranodon') p++;
      return p / 400;
    };
    const near = share(true);
    const far = share(false);
    console.log(`Pteranodon kettle share near water ${near.toFixed(3)}, far ${far.toFixed(3)}`);
    expect(far).toBeGreaterThan(0);
    expect(near).toBeGreaterThanOrEqual(2 * far);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A roaming T. rex never sees the river herd

describe('AMBIENT_REX_BRAIN', () => {
  it('masks ctx.riverHerd: beside a pinned river herd with the aircraft over it, it stays in LURK and sends no threat', () => {
    const terrain = countingTerrain();
    const herds = new HerdPool();
    const pool = new SoloAgentPool(herds, terrain, Anchors);
    const n0 = VREX.n;
    const e0 = VREX.e;
    const g = terrain.sample(n0, e0, makeSample()).ground;
    const rh = herds.spawn({ north: n0, east: e0, ground: g, size: 20, entry: 0, scale: 1, variant: 0, seed: 0x5eed, heading: 0, pinned: true, species: 'edmontosaurus' }, -1);
    expect(rh).toBeGreaterThanOrEqual(0);
    const i = pool.spawn({ species: 'tyrannosaurus', entry: 2, north: n0 + 380, east: e0, ground: g, heading: Math.PI, scale: 1, variant: 0, seed: 0x7e3a12 }, AMBIENT_REX_BRAIN);
    expect(i).toBeGreaterThanOrEqual(0);
    const ac: AircraftView = { n: n0, e: e0, alt: g + 150, vN: 0, vE: 50, vD: 0, tas: 50 };
    const dt = 1 / 30;
    for (let k = 0; k < 30 * 30; k++) {
      terrain.calls = 0;
      pool.step(dt, ac, terrain, rh);
      expect(pool.state[i]).toBe(TREX_STATE.lurk);
      expect(herds.extLevel[rh]).toBe(THREAT.none);
      // Restored after every step (the scripted agent in the same pass still sees it).
      expect(pool.context().riverHerd).toBe(rh);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Eviction scan: an ineligible candidate does not end it

describe('eviction when the herd slots are full', () => {
  it('a site not near enough to evict for is skipped; a nearer site later in the ring walk still evicts', () => {
    const { sys, ctx } = build('ultra');
    const H = sys.herds;
    const p = sys as unknown as {
      cells: { find(k: number): number; keys: Float64Array; status: Uint8Array; n: Float64Array; e: Float64Array; ground: Float64Array; size: Uint8Array; entry: Int16Array; herd: Int16Array; used: number };
      stream(ctx: SimContext, camN: number, camE: number): void;
    };
    // The camera at the middle of cell (ci0, cj0), far from the safari.
    const ci0 = Math.floor(VREX.n / HABITAT_CELL);
    const cj0 = Math.floor(VREX.e / HABITAT_CELL);
    const camN = (ci0 + 0.5) * HABITAT_CELL;
    const camE = (cj0 + 0.5) * HABITAT_CELL;
    place(ctx, camN, camE, 500, 0);
    // Every free herd slot: small unpinned herds 4.5 km out (the farthest one sets farD).
    let k = 0;
    while (H.count() < MAX_HERDS) {
      const a = (k / 24) * 2 * Math.PI;
      H.spawn({ north: camN + 4500 * Math.cos(a), east: camE + 4500 * Math.sin(a), ground: 100, size: 3, entry: 0, scale: 1, variant: 0, seed: 7000 + k, heading: 0, pinned: false, species: 'edmontosaurus' }, -1);
      k++;
    }
    // Every cell in range known and empty, except two sites: the ring walk meets (ci0-1, cj0-1) first, its site 3960
    // m out (not EVICT_MARGIN nearer than 4.5 km), then (ci0, cj0+1), its site 1050 m out.
    const C = p.cells;
    const key = (ci: number, cj: number) => (ci + 32768) * 65536 + (cj + 32768);
    const rings = Math.ceil(10000 / HABITAT_CELL) + 1;
    for (let di = -rings; di <= rings; di++)
      for (let dj = -rings; dj <= rings; dj++) {
        const kk = key(ci0 + di, cj0 + dj);
        const slot = C.find(kk);
        C.keys[slot] = kk;
        C.status[slot] = 1;
        C.herd[slot] = -1;
        C.used++;
      }
    const site = (ci: number, cj: number, n: number, e: number): number => {
      const slot = C.find(key(ci, cj));
      C.status[slot] = 2;
      C.n[slot] = n;
      C.e[slot] = e;
      C.ground[slot] = 100;
      C.size[slot] = 5;
      C.entry[slot] = 0;
      C.herd[slot] = -1;
      return slot;
    };
    const farSlot = site(ci0 - 1, cj0 - 1, camN - 2800, camE - 2800);
    const nearSlot = site(ci0, cj0 + 1, camN, camE + 1050);
    const ev0 = sys.debug.evictions;
    p.stream(ctx as unknown as SimContext, camN, camE);
    expect(sys.debug.evictions).toBe(ev0 + 1);
    expect(C.herd[nearSlot]).toBeGreaterThanOrEqual(0);
    expect(C.herd[farSlot]).toBe(-1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Roaming T. rex placement: a spawn point fixed by the cell, the next herd when one is in sight, inside the radius

describe('roaming T. rex placement (placeRex)', () => {
  type Placer = {
    placeRex(camN: number, camE: number): boolean;
    sweepAmbientAgents(camN: number, camE: number, R: number): void;
    frustum: THREE.Frustum;
    preset: { activeRadius: number };
  };
  const key = (ci: number, cj: number) => (ci + 32768) * 65536 + (cj + 32768);
  /** A fresh system with the real layer-1/2 herds of the given cells, unpinned, streamed as stream() would. */
  function withHerds(cells: [number, number][]) {
    const { sys, ctx } = build('high');
    const H = sys.herds;
    for (let h = 0; h < MAX_HERDS; h++) H.release(h);
    for (let i = 0; i < sys.agents.capacity; i++) sys.agents.release(i);
    const sites = cells.map(([ci, cj]) => {
      const s = makeSite();
      expect(probeCell(ci, cj, roster, countingTerrain(), s), `cell (${ci}, ${cj}) has a site`).toBe(true);
      expect(rexRandom(ci, cj, 0), `cell (${ci}, ${cj}) draws a T. rex`).toBeLessThan(roster.entries.find((e) => e.habitat === 'nearHerd')!.occupancy!);
      const h = H.spawn({ north: s.north, east: s.east, ground: s.ground, size: 12, entry: s.entry, scale: 1, variant: 0, seed: 99, heading: 0, pinned: false, species: 'edmontosaurus' }, key(ci, cj));
      return { ...s, h, ci, cj };
    });
    return { sys, ctx, p: sys as unknown as Placer, sites };
  }
  /** The last-frame view: the camera at (n, e, alt) looking at (ln, le, lh). */
  function look(p: Placer, n: number, e: number, alt: number, ln: number, le: number, lh: number): void {
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400000);
    cam.position.set(e, alt, -n);
    cam.lookAt(le, lh, -ln);
    cam.updateMatrixWorld();
    p.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  }
  const spot = (ci: number, cj: number) => ({ r: REX_RANGE_MIN + REX_RANGE_SPAN * rexRandom(ci, cj, 1), b: 2 * Math.PI * rexRandom(ci, cj, 2) });

  it('the spawn point is the same whichever way the camera looks; in sight it waits, it does not move', () => {
    const placed: { n: number; e: number }[] = [];
    let deferred = 0;
    for (const dir of [1, -1]) {
      const { sys, p, sites } = withHerds([[-7, 10]]);
      const s = sites[0];
      const { r, b } = spot(-7, 10);
      // Standing on the herd, looking toward (dir 1) or away from (dir -1) its drawn bearing.
      look(p, s.north, s.east, s.ground + 30, s.north + dir * r * Math.cos(b), s.east + dir * r * Math.sin(b), s.ground + 4);
      const ok = p.placeRex(s.north, s.east);
      deferred += ok ? 0 : 1;
      if (!ok) {
        // In sight: nothing placed; once the camera turns away it appears where it would have.
        expect(sys.agents.count()).toBe(0);
        look(p, s.north, s.east, s.ground + 30, s.north - dir * r * Math.cos(b), s.east - dir * r * Math.sin(b), s.ground + 4);
        expect(p.placeRex(s.north, s.east)).toBe(true);
      }
      const i = sys.agentHerd.findIndex((h) => h === s.h);
      expect(i).toBeGreaterThanOrEqual(0);
      placed.push({ n: sys.agents.n[i], e: sys.agents.e[i] });
    }
    expect(deferred).toBe(1);
    expect(placed[1].n).toBe(placed[0].n);
    expect(placed[1].e).toBe(placed[0].e);
  });

  it('a nearer herd whose T. rex would appear in sight does not block one beside a farther herd', () => {
    const { sys, p, sites } = withHerds([
      [-7, 10],
      [-10, 10],
    ]);
    const [near, far] = sites;
    const camN = -15000;
    const camE = 21000;
    expect(Math.hypot(near.north - camN, near.east - camE)).toBeLessThan(Math.hypot(far.north - camN, far.east - camE));
    const { r, b } = spot(-7, 10);
    const sn = near.north + r * Math.cos(b);
    const se = near.east + r * Math.sin(b);
    expect(Math.hypot(sn - camN, se - camE)).toBeLessThan(2500);
    look(p, camN, camE, 500, sn, se, near.ground);
    expect(p.placeRex(camN, camE)).toBe(true);
    expect(sys.agents.count()).toBe(1);
    const i = sys.ambientAgent.indexOf(1);
    expect(sys.agentHerd[i]).toBe(far.h);
    // The nearer herd gets its T. rex once its spot is out of view, at the point drawn for its cell.
    look(p, camN, camE, 500, camN - 1000 * Math.cos(b), camE - 1000 * Math.sin(b), 0);
    expect(p.placeRex(camN, camE)).toBe(true);
    const j = sys.agentHerd.findIndex((h, k) => h === near.h && sys.ambientAgent[k] === 1);
    expect(j).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(sys.agents.n[j] - near.north, sys.agents.e[j] - near.east)).toBeCloseTo(r, 6);
  });

  it('never places a T. rex outside the active radius: no release-and-respawn churn at the retain edge', () => {
    const { sys, p, sites } = withHerds([[-7, 10]]);
    const s = sites[0];
    const R = p.preset.activeRadius;
    const { r, b } = spot(-7, 10);
    // The herd 1.14 R out (retained: the release is at 1.15 R), its T. rex's drawn point on the far side of it.
    const camN = s.north - 1.14 * R * Math.cos(b);
    const camE = s.east - 1.14 * R * Math.sin(b);
    look(p, camN, camE, 5000, camN, camE, 0);
    let placed = 0;
    for (let k = 0; k < 4; k++) {
      p.sweepAmbientAgents(camN, camE, R);
      if (p.placeRex(camN, camE)) placed++;
      for (let i = 0; i < sys.agents.capacity; i++) if (sys.ambientAgent[i]) expect(Math.hypot(sys.agents.n[i] - camN, sys.agents.e[i] - camE)).toBeLessThanOrEqual(R);
    }
    expect(Math.hypot(s.north + r * Math.cos(b) - camN, s.east + r * Math.sin(b) - camE)).toBeGreaterThan(R);
    expect(placed).toBe(0);
    // Nearer, the same herd's T. rex is placed once and stays (no churn).
    const nearN = s.north - 0.8 * R * Math.cos(b);
    const nearE = s.east - 0.8 * R * Math.sin(b);
    placed = 0;
    for (let k = 0; k < 4; k++) {
      p.sweepAmbientAgents(nearN, nearE, R);
      if (p.placeRex(nearN, nearE)) placed++;
    }
    expect(placed).toBe(1);
    expect(sys.debug.ambientRex).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Fauna across the landscape (AGENT choices): layer 3 streams, flyers away from the start at the dusk boot

describe('fauna across the landscape', () => {
  it('layer-3 herds stream in beside the sub-0 ones, keyed by sub-slot, background-scheduled', () => {
    const { sys, ctx, terrain } = build('high');
    const H = sys.herds;
    hold(sys, ctx, terrain, VPOINTS[2].n, VPOINTS[2].e, VPOINTS[2].alt, 40);
    let l3 = 0;
    for (const h of streamed(sys)) {
      if (H.key[h] < 4294967296) continue;
      l3++;
      expect(H.background[h]).toBe(1);
      expect(H.entry[h]).not.toBe(0);
    }
    expect(l3).toBeGreaterThan(0);
    expect(sys.debug.errors).toBe(0);
  });

  for (const quality of ['low', 'medium'] as const) {
    it(`${quality}, the tod-20 dusk boot (no thermals): flyers away from the start once the opening is over`, () => {
      const terrain = spyTerrain();
      const sys = createFaunaSystem(eraById('cretaceous'), { terrain }) as FaunaSystemImpl;
      const ctx = makeCtx(quality, 20);
      (ctx as unknown as { sky: { dayFactor: number } }).sky.dayFactor = 0.38;
      place(ctx, 0, 0, 400, 0);
      sys.init(ctx);
      // The opening: nothing ambient is added at dusk, and the showcase flyers stay put.
      const showcase = sys.flyers.count();
      hold(sys, ctx, terrain, 0, 0, 400, 20);
      expect(sys.flyers.count()).toBe(showcase);
      // Then 20 km east, after the opening: the showcase flyers are released and ambient kettles circle nearby.
      ctx.simTime = 130;
      hold(sys, ctx, terrain, 0, 20000, 600, 30);
      const F = sys.flyers;
      let near = 0;
      for (let i = 0; i < F.capacity; i++) if (F.active[i] && Math.hypot(F.n[i], F.e[i] - 20000) < 8000) near++;
      expect(near).toBeGreaterThanOrEqual(2);
      expect(F.count()).toBeLessThanOrEqual(FAUNA_PRESETS[quality].flyers);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Review fixes (fauna across the landscape; AGENT choices)

describe('streaming review fixes', () => {
  it('the habitat probes of one stream tick stay within STREAM_PROBE_READS (both layers), the frame within its cap', () => {
    for (const quality of ['high', 'ultra'] as const) {
      const { sys, ctx, terrain } = build(quality);
      let maxProbe = 0;
      let maxFrame = 0;
      for (let k = 0, frames = 30 * 30; k < frames; k++) {
        ctx.simTime += 1 / 30;
        place(ctx, DENSE.n, DENSE.e, DENSE.alt, (k / 30) * 0.15);
        sys.debug.probeReads = 0;
        const before = terrain.total;
        sys.update(1 / 30, ctx);
        maxProbe = Math.max(maxProbe, sys.debug.probeReads);
        maxFrame = Math.max(maxFrame, terrain.total - before);
      }
      expect(STREAM_PROBE_READS).toBe(CELL_READS + LAYER2_PROBES * SAMPLES_PER_PROBE);
      expect(maxProbe).toBeGreaterThan(0);
      expect(maxProbe).toBeLessThanOrEqual(STREAM_PROBE_READS);
      expect(maxFrame).toBeLessThanOrEqual(TERRAIN_CALLS_PER_FRAME);
      expect(sys.debug.errors).toBe(0);
    }
  });

  it('a reset after the showcase flyers were released for ambient kettles puts every one of them back', () => {
    for (const quality of ['high', 'ultra'] as const) {
      const { sys, ctx, terrain } = build(quality);
      const flags = (sys as unknown as { showcaseFlyer: Uint8Array }).showcaseFlyer;
      const showcase = (): number => flags.reduce((a, b) => a + b, 0);
      const at0 = showcase();
      expect(at0).toBeGreaterThan(0);
      // Past SHOWCASE_FLYER_HOLD_S, then 90 s 20 km east: the showcase flyers go, ambient kettles fill the pool.
      ctx.simTime = 130;
      hold(sys, ctx, terrain, 0, 20000, 600, 90);
      expect(showcase()).toBe(0);
      ctx.events.emit('reset', { scenario: 'cruise' } as never);
      expect(showcase(), quality).toBe(at0);
      expect(sys.flyers.count()).toBeLessThanOrEqual(FAUNA_PRESETS[quality].flyers);
      expect(sys.debug.errors).toBe(0);
    }
  });

  it('a layer-3 site that would not fit after the eviction evicts nothing', () => {
    const { sys } = build('high');
    const H = sys.herds;
    const C = (sys as unknown as { cells: { find(k: number): number; keys: Float64Array; status: Uint8Array; used: number; n: Float64Array; e: Float64Array; ground: Float64Array; size: Uint8Array; entry: Int8Array; herd: Int16Array } }).cells;
    for (let h = 0; h < H.capacity; h++) if (H.active[h]) H.release(h);
    const spawn = (n: number, key: number, bg: boolean): number =>
      H.spawn({ north: n, east: 0, ground: 100, size: 3, entry: 3, scale: 1, variant: 0, seed: 1, heading: 0, pinned: false, species: 'triceratops', background: bg }, key);
    // 35 sub-slot-0 herds (over the layer-3 slot reserve) and one layer-3 herd 7 km out.
    for (let h = 0; h < 35; h++) spawn(500, h + 100, false);
    const old = spawn(7000, 4294967296 + 1234, true);
    // Every cell around known (no probes), one layer-3 site 1 km out: nearer by far more than EVICT_MARGIN.
    for (let sub = 0; sub < 2; sub++)
      for (let i = -6; i <= 6; i++)
        for (let j = -6; j <= 6; j++) {
          const key = (i + 32768) * 65536 + (j + 32768) + sub * 4294967296;
          const sl = C.find(key);
          if (C.status[sl] !== 0) continue;
          C.keys[sl] = key;
          C.status[sl] = 1;
          C.used++;
        }
    const sl = C.find(32768 * 65536 + 32768 + 4294967296);
    C.status[sl] = 2;
    C.n[sl] = 1000;
    C.e[sl] = 0;
    C.ground[sl] = 100;
    C.size[sl] = 3;
    C.entry[sl] = 3;
    C.herd[sl] = -1;
    const before = H.count();
    (sys as unknown as { stream(ctx: SimContext, n: number, e: number): void }).stream(makeCtx('high'), 0, 0);
    expect(H.count()).toBe(before);
    expect(H.active[old]).toBe(1);
    expect(C.herd[sl]).toBe(-1);
    expect(sys.debug.evictions).toBe(0);
  });
});
