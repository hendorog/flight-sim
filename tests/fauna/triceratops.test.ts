// Triceratops (Deep Time inc 2, WP2): the ceratopsian body and pose (through the CPU mirror of the vertex stage),
// the 'face' reaction of the showcase group, that it is never ambient, and the fauna triangle budget with it in.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEventBus, type QualityLevel, type SimContext } from '../../src/core/context';
import { defaultWeather } from '../../src/core/types';
import { createWorldEnvironment } from '../../src/sim/worldEnvironment';
import { TRICERATOPS_GROUP } from '../../src/world/era/cretaceousAnchors';
import { eraById } from '../../src/world/era/registry';
import { makeSample, type TerrainSample } from '../../src/world/terrain/heightfield';
import { createFaunaSystem, type FaunaSystemImpl } from '../../src/world/fauna/FaunaSystem';
import { faunaVertexGLSL } from '../../src/world/fauna/faunaMaterial';
import { countingTerrain, makeSite, probeHabitatCell, type FaunaTerrain } from '../../src/world/fauna/habitat';
import { ALARM, HerdPool, REACTION_KIND, type AircraftView } from '../../src/world/fauna/herds';
import { PROFILES } from '../../src/world/fauna/profiles';
import { THREAT } from '../../src/world/fauna/reactions';
import { ROSTERS, SPECIES_REFERENCE_M } from '../../src/world/fauna/roster';
import { buildFaunaSpecies, FAUNA_SPECIES } from '../../src/world/fauna/species/index';
import { BONE, RIG } from '../../src/world/fauna/types';
import { CERATOPSIAN_GAIT } from '../../src/world/fauna/poses/ceratopsian';
import { ceratopsianLegs, ceratopsianPositions, footOff, legIK, legJoints } from './ceratopsianPoseMirror';
import type { PoseInput, V } from './poseMirror';

const DT = 1 / 60;
const DEG = Math.PI / 180;
const tri = buildFaunaSpecies('triceratops');
const LEGS = [BONE.legHL, BONE.legHR, BONE.legFL, BONE.legFR] as const;
const isLeg = (b: number): boolean => b >= BONE.legFL && b <= BONE.legHR;
const minY = (p: V[]): number => Math.min(...p.map((v) => v[1]));

describe('Triceratops body', () => {
  it('is an 8.5 m ceratopsian on rig 3, ~2.9 m at the hips, frill and horns on the head, the beak on the jaw', () => {
    expect(FAUNA_SPECIES.triceratops.rig).toBe('ceratopsian');
    expect(RIG[FAUNA_SPECIES.triceratops.rig]).toBe(3);
    expect(tri.lengthM).toBeCloseTo(8.5, 6);
    expect(SPECIES_REFERENCE_M.triceratops).toBeCloseTo(8.5, 6);
    const g = tri.lod0;
    const pos = g.getAttribute('position');
    const bone = g.getAttribute('aBone');
    let hipTop = 0;
    let headTop = 0;
    let jaw = 0;
    let headFront = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const b = bone.getX(i);
      if (Math.abs(x) < 0.4) hipTop = Math.max(hipTop, y);
      if (b === BONE.head) {
        headTop = Math.max(headTop, y);
        headFront = Math.max(headFront, x);
      }
      if (b === BONE.jaw) jaw++;
    }
    expect(hipTop).toBeGreaterThan(2.75);
    expect(hipTop).toBeLessThan(3.05);
    // The frill crest rises well above the skull (rigid on the head bone), the brow horns reach forward.
    expect(headTop).toBeGreaterThan(2.6);
    expect(headFront).toBeGreaterThan(4.4);
    expect(jaw).toBeGreaterThan(10);
  });

  it('keeps the frill disc on LOD2 and a rust frill against a darker grey-olive body', () => {
    const lod2 = tri.lod2;
    const pos = lod2.getAttribute('position');
    const bone = lod2.getAttribute('aBone');
    let frillHigh = 0;
    for (let i = 0; i < pos.count; i++) if (bone.getX(i) === BONE.head && pos.getY(i) > 2.5) frillHigh++;
    expect(frillHigh).toBeGreaterThan(0);
    // Mean colour of the frill (head vertices above the skull) vs the body's flanks: warmer and brighter.
    const g = tri.lod0;
    const p = g.getAttribute('position');
    const c = g.getAttribute('color');
    const b = g.getAttribute('aBone');
    const mean = (pick: (i: number) => boolean): number[] => {
      const s = [0, 0, 0];
      let n = 0;
      for (let i = 0; i < p.count; i++)
        if (pick(i)) {
          s[0] += c.getX(i);
          s[1] += c.getY(i);
          s[2] += c.getZ(i);
          n++;
        }
      return s.map((v) => v / n);
    };
    const frill = mean((i) => b.getX(i) === BONE.head && p.getY(i) > 2.35 && p.getX(i) < 3.2);
    const flank = mean((i) => (b.getX(i) === BONE.root || b.getX(i) === BONE.spine1) && p.getY(i) > 1.9);
    expect(frill[0]).toBeGreaterThan(flank[0] * 1.8);
    expect(frill[0] / frill[2]).toBeGreaterThan(1.6);
    expect(flank[0] / flank[2]).toBeLessThan(1.4);
  });

  it('emits a vertex stage with the IK pose and no wings', () => {
    const src = faunaVertexGLSL(3);
    expect(src).toContain('cLegIK');
    expect(src).not.toMatch(/NaN|undefined/);
  });
});

describe('ceratopsian pose (CPU mirror)', () => {
  it('the IK returns the rest leg for the rest target and reaches a moved target', () => {
    for (const hind of [true, false]) {
      const [H, K, A] = legJoints(hind);
      const rest = legIK(H, K, A, A);
      for (const a of rest) expect(Math.abs(a)).toBeLessThan(1e-6);
      const ik = legIK(H, K, A, [A[0] + 0.5, A[1] + 0.2]);
      // Forward kinematics: thigh rotated by a, shin by a + k.
      const rot = (v: [number, number], t: number): [number, number] => [Math.cos(t) * v[0] - Math.sin(t) * v[1], Math.sin(t) * v[0] + Math.cos(t) * v[1]];
      const k2 = rot([K[0] - H[0], K[1] - H[1]], ik[0]);
      const a2 = rot([A[0] - K[0], A[1] - K[1]], ik[0] + ik[1]);
      expect(H[0] + k2[0] + a2[0]).toBeCloseTo(A[0] + 0.5, 4);
      expect(H[1] + k2[1] + a2[1]).toBeCloseTo(A[1] + 0.2, 4);
      // The foot stays flat: hip + knee + ankle = 0.
      expect(ik[0] + ik[1] + ik[2]).toBeCloseTo(0, 9);
    }
  });

  it('stands at rest on the ground with every leg straight down (gait 0)', () => {
    const rest = ceratopsianPositions(tri, tri.lod1, { phase: 0.3, gaitBlend: 0, flap: 0 }, isLeg);
    expect(Math.abs(minY(rest) - minY(rest))).toBe(0);
    expect(minY(rest)).toBeGreaterThan(-0.03);
    expect(minY(rest)).toBeLessThan(0.05);
    expect(ceratopsianLegs({ phase: 0.3, gaitBlend: 0, flap: 0 }).drop).toBe(0);
  });

  // SOLE SLIP. A foot is planted for the stance window of its cycle (u < duty; footOff). Its ground-frame
  // velocity there is the body's speed plus the foot's body-frame velocity: the body moves `speed` forward while
  // the herd advances the phase by speed * dt / stride (herds.ts). Measured on the posed sole vertices of each leg
  // (rest height < 0.1 m) through the full vertex stage (IK, sub-joints, skin, the body drop), at every 1/200 of
  // the cycle inside the window, for all four legs.
  const slip = (gaitBlend: number, speed: number): { max: number; sink: number; floatMax: number; samples: number } => {
    const run = Math.min(1, Math.max(0, gaitBlend - 1));
    const stride = CERATOPSIAN_GAIT.strideWalk + (CERATOPSIAN_GAIT.strideRun - CERATOPSIAN_GAIT.strideWalk) * run;
    const duty = CERATOPSIAN_GAIT.dutyWalk + (CERATOPSIAN_GAIT.dutyTrot - CERATOPSIAN_GAIT.dutyWalk) * run;
    const oF = CERATOPSIAN_GAIT.foreLagWalk * (1 - run);
    const g = tri.lod0;
    const pos = g.getAttribute('position');
    const boneA = g.getAttribute('aBone');
    const N = 200;
    const dPhase = 1 / N;
    const dt = (dPhase * stride) / speed;
    const mean = (p: V[]): V => p.reduce((m, v) => [m[0] + v[0] / p.length, m[1] + v[1] / p.length, m[2] + v[2] / p.length] as V, [0, 0, 0] as V);
    let max = 0;
    let sink = 0;
    let floatMax = 0;
    let samples = 0;
    for (const leg of LEGS) {
      // This leg's vertices in skinPositions order, and which of them are the sole.
      const sole: boolean[] = [];
      for (let i = 0; i < pos.count; i++) if (boneA.getX(i) === leg) sole.push(pos.getY(i) < 0.1);
      expect(sole.filter(Boolean).length).toBeGreaterThan(3);
      const at = (ph: number): V[] => ceratopsianPositions(tri, g, { phase: ph, gaitBlend, flap: 0 }, (b) => b === leg).filter((_, j) => sole[j]);
      const off = leg === BONE.legHL ? 0 : leg === BONE.legHR ? 0.5 : leg === BONE.legFR ? oF : 0.5 + oF;
      const legU = (ph: number): number => ph + off - Math.floor(ph + off);
      for (let s = 0; s < N; s++) {
        const ph = s / N;
        const cur = at(ph);
        sink = Math.min(sink, minY(cur));
        const u = legU(ph);
        const u1 = legU(ph + dPhase);
        // Both samples inside the stance window (not across the wrap).
        if (!(u < duty && u1 < duty && u1 > u)) continue;
        floatMax = Math.max(floatMax, minY(cur));
        const a = mean(cur);
        const b = mean(at(ph + dPhase));
        // Ground frame: the body has moved speed * dt forward (+x) meanwhile.
        max = Math.max(max, Math.hypot(b[0] + speed * dt - a[0], b[1] - a[1], b[2] - a[2]) / dt);
        samples++;
      }
    }
    return { max, sink, floatMax, samples };
  };

  it.each([
    ['walk', 1, PROFILES.triceratops.speed.walk],
    ['walk-trot blend', 1.5, 4],
    ['trot', 2, PROFILES.triceratops.speed.run],
  ])('%s: the planted feet slip < 0.15 m/s, sit on the ground, and no foot sinks', (_name, gaitBlend, speed) => {
    const r = slip(gaitBlend as number, speed as number);
    console.log(`ceratopsian ${_name}: max planted-foot slip ${r.max.toFixed(4)} m/s over ${r.samples} samples, lowest foot ${r.sink.toFixed(3)} m, highest planted ${r.floatMax.toFixed(3)} m`);
    expect(r.samples).toBeGreaterThan(100);
    expect(r.max).toBeLessThan(0.15);
    expect(r.sink).toBeGreaterThan(-0.05);
    expect(r.floatMax).toBeLessThan(0.05);
  });

  it('the stance stride matches the herd: foot travel over the stance = stride x duty', () => {
    for (const [S, d] of [
      [CERATOPSIAN_GAIT.strideWalk, CERATOPSIAN_GAIT.dutyWalk],
      [CERATOPSIAN_GAIT.strideRun, CERATOPSIAN_GAIT.dutyTrot],
    ]) {
      expect(footOff(0, d, S, 0.2)[0] - footOff(d - 1e-9, d, S, 0.2)[0]).toBeCloseTo(S * d, 6);
      // The swing ends where the stance starts.
      expect(footOff(1 - 1e-9, d, S, 0.2)[0]).toBeCloseTo(footOff(0, d, S, 0.2)[0], 5);
    }
    expect(PROFILES.triceratops.strideM.walk).toBe(CERATOPSIAN_GAIT.strideWalk);
    expect(PROFILES.triceratops.strideM.run).toBe(CERATOPSIAN_GAIT.strideRun);
  });

  it('the trot moves diagonal pairs together; the walk staggers them', () => {
    const trot = ceratopsianLegs({ phase: 0.1, gaitBlend: 2, flap: 0 });
    expect(trot.off[BONE.legHL][0]).toBeCloseTo(trot.off[BONE.legFR][0], 9);
    expect(trot.off[BONE.legHR][0]).toBeCloseTo(trot.off[BONE.legFL][0], 9);
    const walk = ceratopsianLegs({ phase: 0.1, gaitBlend: 1, flap: 0 });
    expect(Math.abs(walk.off[BONE.legHL][0] - walk.off[BONE.legFR][0])).toBeGreaterThan(0.1);
  });

  const headLow = (inp: PoseInput): number => minY(ceratopsianPositions(tri, tri.lod1, inp, (b) => b === BONE.head || b === BONE.jaw));
  // The beak tip: the loft's forward-most rest vertex (horns excluded: they sit higher), tracked by index.
  const beakTip = (inp: PoseInput): V => {
    const g = tri.lod0;
    const pos = g.getAttribute('position');
    const boneA = g.getAttribute('aBone');
    const idx: number[] = [];
    let best = -1;
    for (let i = 0; i < pos.count; i++) {
      const b = boneA.getX(i);
      if (b !== BONE.head && b !== BONE.jaw) continue;
      if (pos.getY(i) < 1.3 && (best < 0 || pos.getX(i) > pos.getX(idx[best]))) best = idx.length;
      idx.push(i);
    }
    return ceratopsianPositions(tri, g, inp, (b) => b === BONE.head || b === BONE.jaw)[best];
  };

  it('grazes with the beak near the ground (not in it), and faces with the head and horns lowered', () => {
    for (const time of [0, 1.3, 2.7, 4.1, 9]) {
      const graze: PoseInput = { phase: 0, gaitBlend: 0, flap: 0, time };
      expect(headLow(graze)).toBeGreaterThan(-0.03);
      expect(headLow(graze)).toBeLessThan(0.45);
      const face: PoseInput = { phase: 0, gaitBlend: 0, flap: 1, time };
      expect(headLow(face)).toBeGreaterThan(0);
    }
    const stand = beakTip({ phase: 0, gaitBlend: 1, flap: 0, time: 0 });
    const face = beakTip({ phase: 0, gaitBlend: 0, flap: 1, time: 0 });
    // Facing: the beak lower than when walking (the head tipped down, the frill presented).
    expect(face[1]).toBeLessThan(stand[1] - 0.2);
  });
});

// --------------------------------------------------------------------------------------------- behaviour

const G0 = 100;
function flat(): FaunaTerrain {
  const t = {
    calls: 0,
    sample(_n: number, _e: number, out: TerrainSample): TerrainSample {
      t.calls++;
      Object.assign(out, makeSample());
      out.ground = G0;
      out.standing = -1000;
      return out;
    },
    height(): number {
      t.calls++;
      return G0;
    },
  };
  return t;
}

function group(size = 7): { pool: HerdPool; h: number; terrain: FaunaTerrain } {
  const pool = new HerdPool();
  const h = pool.spawn({ north: 0, east: 0, ground: G0, size, entry: 0, scale: 1, variant: 0, seed: 0x7c1e7a, heading: 105 * DEG, pinned: true, species: 'triceratops' }, -1);
  const terrain = flat();
  for (let k = 0; k < 120; k++) pool.step(DT, null, terrain, 10000, 0, 0);
  return { pool, h, terrain };
}
const members = (pool: HerdPool, h: number): number[] => Array.from({ length: pool.size[h] }, (_, k) => h * pool.memberCap + k);
const angleTo = (pool: HerdPool, i: number, n: number, e: number): number => Math.abs(((pool.yaw[i] - Math.atan2(e - pool.mE[i], n - pool.mN[i]) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);

describe('Triceratops reaction (face)', () => {
  it.each([0, 60, 135, 200, 290])('under setExternalThreat from bearing %s deg, >= 70 %% end within 35 deg of the source and none runs', (brg) => {
    const { pool, h, terrain } = group();
    expect(pool.kind[h]).toBe(REACTION_KIND.face);
    // The T. rex stops ~280 m off: beyond predatorFleeRange from the group's edge.
    const R = 280;
    const sn = R * Math.cos(brg * DEG);
    const se = R * Math.sin(brg * DEG);
    expect(R - pool.herdRadius(h)).toBeGreaterThan(PROFILES.triceratops.reaction.predatorFleeRange);
    pool.setExternalThreat(h, sn, se, 0, 0, pool.time + 20, THREAT.flee);
    let vmax = 0;
    const ids = members(pool, h);
    for (let k = 0; k < 60 * 10; k++) {
      pool.step(DT, null, terrain, 10000, 0, 0);
      for (const i of ids) vmax = Math.max(vmax, pool.speed[i]);
    }
    expect(pool.react[h]).toBe(ALARM.face);
    const facing = ids.filter((i) => angleTo(pool, i, sn, se) < 35 * DEG).length;
    expect(facing / ids.length).toBeGreaterThanOrEqual(0.7);
    // None runs (gait 2 starts at runFrom = 2 m/s); they barely shuffle.
    expect(vmax).toBeLessThan(PROFILES.triceratops.formation.runFrom);
    for (const i of ids) expect(pool.alert[i]).toBeGreaterThan(0.9);
  });

  it('under an aircraft low pass it faces rather than flees, then calms within 15-30 s + the alert hold', () => {
    const { pool, h, terrain } = group();
    const ids = members(pool, h);
    // 60 m above the group at 50 m/s, straight over its centre, from 1500 m west.
    const ac: AircraftView = { n: 0, e: -1500, alt: G0 + 60, vN: 0, vE: 50, vD: 0, tas: 50 };
    let faced = false;
    let vmax = 0;
    const c0 = pool.herdCentroid(h, { north: 0, east: 0, ground: 0 });
    for (let k = 0; k < 60 * 40; k++) {
      ac.e += ac.vE * DT;
      pool.step(DT, ac, terrain, 10000, ac.n, ac.e);
      if (pool.fleeing[h]) {
        expect(pool.react[h]).toBe(ALARM.face);
        faced = true;
      }
      for (const i of ids) vmax = Math.max(vmax, pool.speed[i]);
      // While the aircraft closes, the alarmed members turn to it.
      if (ac.e > -260 && ac.e < -200) {
        const turned = ids.filter((i) => pool.time >= pool.fleeT0[i] && angleTo(pool, i, ac.n, ac.e) < 60 * DEG).length;
        if (ac.e > -205) expect(turned).toBeGreaterThanOrEqual(5);
      }
    }
    expect(faced).toBe(true);
    expect(vmax).toBeLessThan(PROFILES.triceratops.formation.runFrom);
    const c1 = pool.herdCentroid(h, { north: 0, east: 0, ground: 0 });
    expect(Math.hypot(c1.north - c0.north, c1.east - c0.east)).toBeLessThan(10);
    // 40 s after the pass started (the pass is over ~32 s in): calm again.
    for (let k = 0; k < 60 * 30; k++) pool.step(DT, null, terrain, 10000, 0, 0);
    expect(pool.fleeing[h]).toBe(0);
  });
});

describe('Triceratops placement', () => {
  it('probeHabitatCell never yields Triceratops (the roster entry is not ambient)', () => {
    const roster = ROSTERS.cretaceous;
    const idx = roster.entries.findIndex((e) => e.species === 'triceratops');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(roster.entries[idx].ambient).toBe(false);
    const terrain = countingTerrain();
    const site = makeSite();
    let found = 0;
    for (let ci = -12; ci <= 12; ci++)
      for (let cj = -12; cj <= 12; cj++) {
        if (!probeHabitatCell(ci, cj, roster, terrain, site)) continue;
        found++;
        expect(roster.entries[site.entry].species).not.toBe('triceratops');
      }
    expect(found).toBeGreaterThan(5);
  });
});

describe('Triceratops in the fauna budget', () => {
  function makeCtx(quality: QualityLevel) {
    const weather = { ...defaultWeather(), timeOfDay: 18.6, cloudCover: 0.35, windSpeedKt: 6 };
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400000);
    const state = { position: { x: 0, y: 0, z: -400 }, velocity: { x: 0, y: 50, z: 0 }, tas: 50, altitudeAGL: 150 };
    const ctx = { scene: new THREE.Scene(), camera, state, weather, env: createWorldEnvironment(weather), sky: { dayFactor: 1 }, simTime: 0, quality, events: createEventBus() };
    return ctx as unknown as SimContext & { state: typeof state; simTime: number };
  }
  const place = (ctx: ReturnType<typeof makeCtx>, n: number, e: number, alt: number, tn: number, te: number, th: number): void => {
    ctx.state.position.x = n;
    ctx.state.position.y = e;
    ctx.state.position.z = -alt;
    ctx.camera.position.set(e, alt, -n);
    ctx.camera.lookAt(te, th, -tn);
    ctx.camera.updateMatrixWorld();
  };

  // The plan's triangle budget is on the HIGH preset (ultra's LOD0 pool alone is 200k, plus the LOD1 bodies).
  it.each(['high'] as QualityLevel[])('the mixed populate (showcase + river herd + extra Triceratops groups) stays <= 200k fauna tris (%s)', (quality) => {
    const sys = createFaunaSystem(eraById('cretaceous'), { terrain: countingTerrain() }) as FaunaSystemImpl;
    const ctx = makeCtx(quality);
    sys.init(ctx);
    const H = sys.herds;
    const tg = sys.showcaseHerds.find((h) => ROSTERS.cretaceous.entries[H.entry[h]].species === 'triceratops')!;
    expect(H.size[tg]).toBe(7);
    // Mix: more Triceratops groups and Edmontosaurus herds around the showcase group.
    const triEntry = H.entry[tg];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * 2 * Math.PI;
      H.spawn({ north: TRICERATOPS_GROUP.north + 150 * Math.cos(a), east: TRICERATOPS_GROUP.east + 150 * Math.sin(a), ground: TRICERATOPS_GROUP.ground, size: 12, entry: triEntry, scale: 1, variant: 0, seed: 300 + k, heading: a, pinned: true, species: 'triceratops' }, -1);
    }
    for (let k = 0; k < 4; k++) {
      H.spawn({ north: TRICERATOPS_GROUP.north - 250 + 120 * k, east: TRICERATOPS_GROUP.east + 250, ground: TRICERATOPS_GROUP.ground, size: 60, entry: 0, scale: 1, variant: 0, seed: 500 + k, heading: 0, pinned: true }, -1);
    }
    let maxTris = 0;
    for (let k = 0; k < 240; k++) {
      ctx.simTime += DT;
      const a = k / 60;
      // Low over the groups, looking at them (most bodies near: the LOD0 pool is what holds the line).
      place(ctx, TRICERATOPS_GROUP.north - 300 + 40 * Math.sin(a), TRICERATOPS_GROUP.east - 200, TRICERATOPS_GROUP.ground + 80, TRICERATOPS_GROUP.north, TRICERATOPS_GROUP.east, TRICERATOPS_GROUP.ground);
      sys.update(DT, ctx);
      maxTris = Math.max(maxTris, sys.stats.tris);
    }
    expect(sys.stats.visible).toBeGreaterThan(100);
    expect(maxTris).toBeGreaterThan(0);
    expect(maxTris).toBeLessThanOrEqual(200_000);
  });
});
