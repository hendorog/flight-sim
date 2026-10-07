// Life in the valley beyond the airport fence: a small town on the gentlest ground within ~7 km, farmsteads
// scattered over the valley floor, and roads joining them to the airport access road. Everything is placed with
// the terrain height function passed in by the integrator and skips steep ground and water (height < 1 m).
//
// Buildings are instanced unit boxes and gable prisms scaled per instance; facades get a procedural window grid
// in the shader (dark glass by day, a random ~35% of windows lit warm at night).

import * as THREE from 'three';
import { AIRPORT, runwayCoords } from '../../core/world';
import { nedToThree } from '../../core/frames';
import { smoothstep } from '../../core/math';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cylGeo, GeometryBatch, placement, ribbonGeo } from './geom';
import { ACCESS_ROAD, localToNed } from './layout';
import { LIGHT_COLORS, LightKind, type LightSpec } from './lights';
import { rng } from './noise';
import { STREET_ILLUMINANCE, type SharedUniforms } from './shared';
import { SCENE_UNITS_PER_LUX } from '../../core/context';
import { computeBiome, coverShape, makeBiome, makeCoverShape } from '../terrain/biome';
import { makeSample, sampleTerrain } from '../terrain/heightfield';

/** Street-pool illuminance uniform at full night (scene units), used to normalise the night switch-on. */
const STREET_ILLUMINANCE_REF = STREET_ILLUMINANCE;

export type HeightFn = (north: number, east: number) => number;

const WATER_LEVEL = 1;
const MAX_BUILD_SLOPE = 0.12;
const MAX_ROAD_SLOPE = 0.2;

interface Placed {
  north: number;
  east: number;
  /** Rotation about vertical (three rotation.y). */
  rot: number;
  w: number;
  d: number;
  /** Wall height above the highest corner. */
  h: number;
  color: THREE.Color;
  roof?: { h: number; color: THREE.Color };
  /** Facade window grid (false for barns and sheds). */
  windows: boolean;
}

/** Keep clear of the airfield, its approach corridors and the traffic pattern's final legs. */
function nearAirport(north: number, east: number, margin: number): boolean {
  const { along, across } = runwayCoords(north, east);
  const hl = AIRPORT.runway.length / 2, fm = AIRPORT.flatMargin;
  if (Math.abs(along) < hl + fm + margin && Math.abs(across) < AIRPORT.runway.width / 2 + fm + margin) return true;
  return Math.abs(across) < 350 && Math.abs(along) < hl + 4500;
}

/** Built-up radius of the town (the street grid reaches up to ~0.94 of it, plus 40 m), m. */
export const TOWN_RADIUS = 700;

/**
 * Where the valley town is built for a given terrain: the flattest dry area on rings 3.4..7.6 km from the airport,
 * clear of the airfield and its approach paths (null if nowhere is flat enough). Deterministic and pure, so other
 * modules (e.g. terrain vegetation) can keep woodland off the town: everything lies within TOWN_RADIUS + 60 m.
 */
export function findTownSite(heightAt: HeightFn): { north: number; east: number; radius: number } | null {
  const slope = (n: number, e: number, s: number): number => {
    const hx = heightAt(n + s, e) - heightAt(n - s, e);
    const hy = heightAt(n, e + s) - heightAt(n, e - s);
    return Math.hypot(hx, hy) / (2 * s);
  };
  let best = { n: 0, e: 0, score: Infinity };
  for (let ring = 3400; ring <= 7600; ring += 700) {
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2 + ring * 0.001;
      const n = Math.cos(a) * ring, e = Math.sin(a) * ring;
      if (nearAirport(n, e, 1700)) continue;
      let s = 0, wet = 0;
      for (let j = 0; j < 9; j++) {
        const b = (j / 9) * Math.PI * 2;
        const rr = j === 0 ? 0 : 450;
        const pn = n + Math.cos(b) * rr, pe = e + Math.sin(b) * rr;
        s += slope(pn, pe, 40);
        if (heightAt(pn, pe) < WATER_LEVEL + 2) wet++;
      }
      const score = s / 9 + wet * 0.05 + ring / 200000;
      if (score < best.score) best = { n, e, score };
    }
  }
  return best.score < 0.1 ? { north: best.n, east: best.e, radius: TOWN_RADIUS } : null;
}

export interface ValleyResult {
  group: THREE.Group;
  lights: LightSpec[];
  materials: THREE.Material[];
  /** Textures owned by the valley (dispose with it). */
  textures: THREE.Texture[];
}

export function buildValley(heightAt: HeightFn, shared: SharedUniforms, roadMaterial: THREE.Material, trackMaterial: THREE.Material): ValleyResult {
  const r = rng(4242);
  const slope = (n: number, e: number, s: number): number => {
    const hx = heightAt(n + s, e) - heightAt(n - s, e);
    const hy = heightAt(n, e + s) - heightAt(n, e - s);
    return Math.hypot(hx, hy) / (2 * s);
  };
  const buildable = (n: number, e: number): boolean => heightAt(n, e) > WATER_LEVEL + 1 && slope(n, e, 15) < MAX_BUILD_SLOPE;

  const town = findTownSite(heightAt);

  const placed: Placed[] = [];
  const lights: LightSpec[] = [];
  /** Base of every street-light pole (world, on the ground) and its height. */
  const poles: { p: THREE.Vector3; h: number }[] = [];
  const roads: THREE.Vector3[][] = [];
  /** Per road run: street lighting (see createRoadMaterial): [lit intensity scale, lamp phase, spacing, LED share]. */
  const roadInfo: [number, number, number, number][] = [];
  const addRoads = (runs: THREE.Vector3[][], lighting?: { origin: { n: number; e: number }; first: number; spacing: number; scale: number; led: boolean }) => {
    for (const run of runs) {
      roads.push(run);
      if (!lighting) {
        roadInfo.push([0, 0, 60, 0]);
        continue;
      }
      const d = Math.hypot(-run[0].z - lighting.origin.n, run[0].x - lighting.origin.e);
      roadInfo.push([lighting.scale, d - lighting.first, lighting.spacing, lighting.led ? 1 : 0]);
    }
  };
  const tracks: THREE.Vector3[][] = [];
  const houseWall = [0xe8e0d0, 0xd8cbb0, 0xc8c8c0, 0xb89a80, 0xe0d8c8, 0xa8b0b8, 0xd0b8a0];
  const roofCols = [0x5a3228, 0x3a3a3c, 0x6a4030, 0x4a4a50, 0x7a4a36];
  const pick = (list: number[]) => new THREE.Color(list[Math.floor(r() * list.length)]);
  const worldPoint = (n: number, e: number, lift: number) => nedToThree({ x: n, y: e, z: -(heightAt(n, e) + lift) });

  /** Sample a straight road between two NED points into drivable runs, breaking at water or cliffs; `clearOfAirport` also breaks it inside the airfield / approach keep-out. */
  const roadRuns = (a: { n: number; e: number }, b: { n: number; e: number }, step: number, clearOfAirport = false): THREE.Vector3[][] => {
    const len = Math.hypot(b.n - a.n, b.e - a.e);
    const steps = Math.max(1, Math.round(len / step));
    const runs: THREE.Vector3[][] = [];
    let cur: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const n = a.n + (b.n - a.n) * t, e = a.e + (b.e - a.e) * t;
      const ok = heightAt(n, e) > WATER_LEVEL + 0.5 && slope(n, e, step / 2) < MAX_ROAD_SLOPE && !(clearOfAirport && nearAirport(n, e, 100));
      if (ok) cur.push(worldPoint(n, e, ROAD_LIFT));
      if ((!ok || i === steps) && cur.length > 1) runs.push(cur);
      if (!ok) cur = [];
    }
    return runs;
  };
  const lamp = (n: number, e: number, h: number, color: THREE.Color, cd: number, param = 0.06, lens = 0.4) => {
    lights.push({ position: worldPoint(n, e, h), colorA: color, lens, cd, cdDay: 0, kind: LightKind.CutOff, param, height: h });
    poles.push({ p: worldPoint(n, e, 0), h });
  };

  let townInfo: { north: number; east: number; angle: number; radius: number } | null = null;
  if (town) {
    const angle = r() * Math.PI;
    townInfo = { north: town.north, east: town.east, angle, radius: TOWN_RADIUS };
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const toNE = (x: number, y: number) => ({ n: town.north + x * ca - y * sa, e: town.east + x * sa + y * ca });
    const R = TOWN_RADIUS, block = 90;
    const nK = Math.ceil(R / block);
    // Irregular town edge: the built-up radius varies with bearing (several harmonics), and blocks near it are
    // built up or not at random, so the edge is ragged rather than a circle or a rectangle of lights.
    const ph = [r() * 6.3, r() * 6.3, r() * 6.3, r() * 6.3];
    const edgeR = (x: number, y: number) => {
      const b = Math.atan2(y, x);
      return R * (0.64 + 0.13 * Math.sin(2 * b + ph[0]) + 0.1 * Math.sin(3 * b + ph[1]) + 0.06 * Math.sin(5 * b + ph[2]) + 0.04 * Math.sin(7 * b + ph[3]));
    };
    // Street grid: nominally 90 m, but each street is shifted by up to +-14 m (the town grew plot by plot); the
    // two k = 0 streets are the main streets through the centre.
    const shift = [0, 1].map(() => Array.from({ length: 2 * nK + 3 }, (_, i) => (i === nK + 1 ? 0 : (r() - 0.5) * 28)));
    const streetAt = (axis: number, k: number) => k * block + shift[axis][k + nK + 1];
    /** Index of the block (between streets k and k + 1) containing coordinate t along an axis. */
    const blockAt = (axis: number, t: number) => {
      let k = -nK - 1;
      while (k < nK && streetAt(axis, k + 1) <= t) k++;
      return k;
    };
    // Which blocks are built up: inside the ragged edge, thinning out over its outer 30 %, with ribbon development
    // along the two main streets a little beyond it; a few inner blocks are parks or playing fields (left dark).
    type BlockUse = 0 | 1 | 2; // empty, built up, park
    const use = new Map<number, BlockUse>();
    const bkey = (kx: number, ky: number) => (kx + 64) * 128 + ky + 64;
    for (let kx = -nK; kx < nK; kx++) {
      for (let ky = -nK; ky < nK; ky++) {
        const cx = (streetAt(0, kx) + streetAt(0, kx + 1)) / 2, cy = (streetAt(1, ky) + streetAt(1, ky + 1)) / 2;
        const dc = Math.hypot(cx, cy), f = dc / edgeR(cx, cy);
        const onMain = kx === -1 || kx === 0 || ky === -1 || ky === 0;
        let u: BlockUse = 0;
        if (f < 1) u = r() < 0.75 * smoothstep(0.7, 1, f) ? 0 : 1;
        else if (onMain && f < 1.35 && dc < 0.94 * R - 40) u = r() < 0.6 ? 1 : 0;
        if (u === 1 && dc > 200 && r() < 0.08) u = 2;
        use.set(bkey(kx, ky), u);
      }
    }
    const built = (kx: number, ky: number) => use.get(bkey(kx, ky)) === 1;
    for (let k = -nK; k <= nK; k++) {
      for (const axis of [0, 1]) {
        const c = streetAt(axis, k);
        // Streets run through the built-up blocks on either side; the main streets carry on beyond the town as lit
        // arterials for a few hundred metres.
        const main = k === 0;
        let lo = Infinity, hi = -Infinity;
        for (let j = -nK; j < nK; j++) {
          if (!(built(axis === 0 ? k - 1 : j, axis === 0 ? j : k - 1) || built(axis === 0 ? k : j, axis === 0 ? j : k))) continue;
          lo = Math.min(lo, streetAt(1 - axis, j) - 10);
          hi = Math.max(hi, streetAt(1 - axis, j + 1) + 10);
        }
        if (main) {
          const reach = (axis === 0 ? edgeR(c, 0) : edgeR(0, c)) + 260;
          lo = Math.min(lo, -reach);
          hi = Math.max(hi, reach);
        }
        if (!(hi - lo > 60)) continue;
        // Lighting by road class: brighter, closer-spaced lamps on the main and collector streets, dimmer and
        // sparser on residential streets (a few unlit, more so toward the edge of town); sodium on older streets,
        // 4000 K LED where re-lamped. Lamps stand only beside built-up blocks (and all along the main streets).
        const cls = main ? STREET_CLASSES.main : Math.abs(k) % 3 === 0 ? STREET_CLASSES.collector : STREET_CLASSES.residential;
        const outer = Math.min(1, Math.abs(c) / R);
        const lit = r() < cls.litShare * (1 - 0.6 * outer * outer * (cls === STREET_CLASSES.residential ? 1 : 0));
        const spacing = cls.spacing * (0.85 + 0.3 * r());
        const first = 6 + r() * (spacing - 6);
        const led = r() < cls.ledShare;
        const cd = cls.cd * (0.8 + 0.4 * r());
        const at = (t: number) => (axis === 0 ? toNE(c, t) : toNE(t, c));
        const litAt = (t: number) => {
          if (!lit) return false;
          if (main) return true;
          const j = blockAt(1 - axis, t);
          return axis === 0 ? built(k - 1, j) || built(k, j) : built(j, k - 1) || built(j, k);
        };
        // Split the street into lit and unlit stretches (the road material draws a lit stretch's pools all along).
        const origin = at(lo);
        const STEP = 10;
        let t0 = lo, state = litAt(lo + STEP / 2);
        for (let t = lo + STEP; ; t += STEP) {
          const end = t >= hi;
          const next = end ? state : litAt(t + STEP / 2);
          if (end || next !== state) {
            const te = Math.min(t, hi);
            addRoads(roadRuns(at(t0), at(te), 10, true), state ? { origin, first, spacing, scale: cd / STREET_REFERENCE_CD, led } : undefined);
            if (state) {
              const j0 = Math.ceil((t0 - lo - first) / spacing);
              for (let j = Math.max(j0, 0); lo + first + j * spacing < te - 5; j++) {
                const off = (j % 2 ? 1 : -1) * 4.5;
                const s = lo + first + j * spacing;
                const p = axis === 0 ? toNE(c + off, s) : toNE(s, c + off);
                if (!buildable(p.n, p.e) || nearAirport(p.n, p.e, 150)) continue;
                lamp(p.n, p.e, STREET_POLE, led ? LIGHT_COLORS.led4000 : LIGHT_COLORS.sodium, cd);
              }
            }
            t0 = te;
            state = next;
          }
          if (end) break;
        }
      }
    }
    // Buildings on lots around each built-up block's perimeter; denser and taller toward the centre.
    const litLots: { x: number; y: number; w: number; d: number }[] = [];
    for (let kx = -nK; kx < nK; kx++) {
      for (let ky = -nK; ky < nK; ky++) {
        if (!built(kx, ky)) continue;
        const x0 = streetAt(0, kx), x1 = streetAt(0, kx + 1), y0 = streetAt(1, ky), y1 = streetAt(1, ky + 1);
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, bw = x1 - x0, bh = y1 - y0;
        const dc = Math.hypot(cx, cy);
        const er = Math.max(edgeR(cx, cy), dc);
        const core = dc < 200;
        // A few core blocks are commercial: a floodlit car park in the middle of the block.
        if (core && r() < 0.35) litLots.push({ x: cx, y: cy, w: bw - 34, d: bh - 34 });
        const lot = core ? 22 : 18;
        for (let side = 0; side < 4; side++) {
          const len = side < 2 ? bw : bh;
          for (let t = -len / 2 + 12; t <= len / 2 - 12; t += lot) {
            if (r() > (core ? 0.95 : 0.9 - (dc / er) * 0.5)) continue;
            const inset = core ? 13 : 12;
            const lx = side < 2 ? t : (side === 2 ? -1 : 1) * (bw / 2 - inset);
            const ly = side < 2 ? (side === 0 ? -1 : 1) * (bh / 2 - inset) : t;
            const p = toNE(cx + lx, cy + ly);
            if (!buildable(p.n, p.e) || nearAirport(p.n, p.e, 150)) continue;
            const facing = angle + (side < 2 ? 0 : Math.PI / 2);
            if (core) {
              placed.push({ north: p.n, east: p.e, rot: facing, w: 16 + r() * 8, d: 12 + r() * 6, h: 3.4 * (2 + Math.floor(r() * 3)), color: pick([0xc8b8a0, 0xa89080, 0xd0d0c8, 0x9a8a7a, 0xb8a890]), windows: true });
            } else {
              const w = 9 + r() * 4, d = 8 + r() * 3;
              placed.push({ north: p.n, east: p.e, rot: facing, w, d, h: r() < 0.3 ? 5.6 : 3.0, color: pick(houseWall), roof: { h: 2 + r() * 1.5, color: pick(roofCols) }, windows: true });
            }
          }
        }
      }
    }
    // Commercial car parks: a grid of tall metal-halide / LED area lights, much brighter than the streets.
    for (const l of litLots) {
      for (const fx of [-0.3, 0.3]) {
        for (const fy of [-0.3, 0.3]) {
          const p = toNE(l.x + fx * l.w, l.y + fy * l.d);
          if (buildable(p.n, p.e)) lamp(p.n, p.e, 10, LIGHT_COLORS.metalHalide, 9000, 0.05, 0.5);
        }
      }
    }
    // Main road from the airport access road to the town edge.
    const gate = localToNed(ACCESS_ROAD.end.u, ACCESS_ROAD.end.v);
    const toTown = Math.atan2(gate.east - town.east, gate.north - town.north);
    const edge = { n: town.north + Math.cos(toTown) * (R - 50), e: town.east + Math.sin(toTown) * (R - 50) };
    // Dog-leg through a point beside the airfield so the road does not cut across the approach.
    const g2 = localToNed(ACCESS_ROAD.end.u, ACCESS_ROAD.end.v - 400);
    addRoads(roadRuns({ n: gate.north, e: gate.east }, { n: g2.north, e: g2.east }, 10));
    addRoads(roadRuns({ n: g2.north, e: g2.east }, edge, 10));
    // Through road across the valley.
    const far1 = toNE(-6000, 0), far2 = toNE(6000, 0);
    addRoads([...roadRuns(far1, toNE(-R + 30, 0), 12, true), ...roadRuns(toNE(R - 30, 0), far2, 12, true)]);
  }

  // --- Farmsteads on dry, gentle, open ground across the valley (not inside woodland, where the terrain
  // draws its canopy shell and trees over the buildings).
  const farms: { n: number; e: number }[] = [];
  const bSample = makeSample(), bShape = makeCoverShape(), bBiome = makeBiome();
  const wooded = (n: number, e: number): boolean => {
    for (const [dn, de] of [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40]]) {
      sampleTerrain(n + dn, e + de, bSample);
      coverShape(n + dn, e + de, bSample.ground, bShape);
      if (computeBiome(n + dn, e + de, bSample, bShape.up, bBiome, bShape.north).forest > 0.2) return true;
    }
    return false;
  };
  for (let k = 0; k < 400 && farms.length < 36; k++) {
    const dist = 1800 + r() * 8500, a = r() * Math.PI * 2;
    const n = Math.cos(a) * dist, e = Math.sin(a) * dist;
    if (nearAirport(n, e, 300)) continue;
    if (town && Math.hypot(n - town.north, e - town.east) < 1100) continue;
    if (farms.some((f) => Math.hypot(f.n - n, f.e - e) < 700)) continue;
    if (!buildable(n, e) || slope(n, e, 60) > 0.08 || wooded(n, e)) continue;
    farms.push({ n, e });
    const rot = r() * Math.PI;
    const c = Math.cos(rot), s = Math.sin(rot);
    const at = (x: number, y: number) => ({ north: n + x * c - y * s, east: e + x * s + y * c });
    placed.push({ ...at(0, 0), rot, w: 11, d: 9, h: 5.6, color: pick(houseWall), roof: { h: 2.6, color: pick(roofCols) }, windows: true });
    placed.push({ ...at(28, 6), rot, w: 16 + r() * 8, d: 12 + r() * 4, h: 6, color: new THREE.Color(r() < 0.5 ? 0x7a2a20 : 0x8a8a84), roof: { h: 4, color: new THREE.Color(0x4a4a4c) }, windows: false });
    if (r() < 0.7) placed.push({ ...at(24, -18), rot, w: 22, d: 10, h: 4.5, color: new THREE.Color(0x9a9a94), roof: { h: 1.5, color: new THREE.Color(0x5a5a5c) }, windows: false });
    // Farm track to the nearest road point within 1.5 km.
    let nearest: THREE.Vector3 | null = null, nd = 1500;
    const here = worldPoint(n, e, 0);
    for (const run of roads) for (const p of run) {
      const d = Math.hypot(p.x - here.x, p.z - here.z);
      if (d < nd) { nd = d; nearest = p; }
    }
    if (nearest) tracks.push(...roadRuns({ n: n + 8 * c, e: e + 8 * s }, { n: -nearest.z, e: nearest.x }, 10));
    lights.push({ position: worldPoint(at(8, 6).north, at(8, 6).east, 5), colorA: LIGHT_COLORS.window, lens: 0.3, cd: 1500, cdDay: 0, height: 5 });
  }

  const group = new THREE.Group();
  group.name = 'valley';
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const glowMap = townInfo ? townGlowMap(townInfo, lights, heightAt) : null;
  const built = buildingMeshes(placed, heightAt, shared, glowMap);
  group.add(...built.meshes);
  materials.push(...built.materials);
  if (roads.length) group.add(roadMesh(roads, 7, roadMaterial, heightAt, roadInfo));
  if (tracks.length) group.add(roadMesh(tracks, 4, trackMaterial, heightAt));

  // Street-light poles.
  const poleMesh = new THREE.InstancedMesh(new GeometryBatch().add(cylGeo(0.07, 0.1, 1, 6), placement(0, 0.5, 0), 0x8a8e92).build(), built.poleMaterial, Math.max(poles.length, 1));
  const m = new THREE.Matrix4();
  poles.forEach((pl, i) => poleMesh.setMatrixAt(i, m.makeScale(1, pl.h, 1).setPosition(pl.p)));
  poleMesh.count = poles.length;
  poleMesh.castShadow = true;
  poleMesh.name = 'valley-poles';
  group.add(poleMesh);
  if (glowMap) {
    const glow = townGlow(glowMap, heightAt, shared);
    group.add(glow);
    materials.push(glow.material as THREE.Material);
    textures.push(glowMap.texture);
  }
  return { group, lights, materials, textures };
}

/** Street-light pole height, m (the road material's light pools assume it). */
export const STREET_POLE = 7.5;
/** Luminous intensity the road material's STREET_ILLUMINANCE pools correspond to, cd. */
export const STREET_REFERENCE_CD = 8000;
/**
 * Street lighting by road class: peak intensity (cd), nominal spacing (m, lamps alternate sides), share of streets
 * lit at all and share re-lamped with 4000 K LEDs (the rest high-pressure sodium).
 */
export const STREET_CLASSES = {
  main: { cd: 12000, spacing: 34, litShare: 1, ledShare: 0.35 },
  collector: { cd: 9000, spacing: 45, litShare: 1, ledShare: 0.3 },
  residential: { cd: 4500, spacing: 58, litShare: 0.8, ledShare: 0.2 },
} as const;

/** Illuminance map of the town's street and area lighting (see townGlowMap), shared by the ground glow and the walls. */
interface GlowMap {
  texture: THREE.DataTexture;
  /** Town centre (north, east), cos and sin of the grid angle. */
  frame: THREE.Vector4;
  /** Half size of the mapped square, m. */
  half: number;
  /** Illuminance (luminance-weighted, scene units) at a town-local point, bilinear like the GPU. */
  at(x: number, y: number): number;
}

/** Texel size of the town illuminance map, m: fine enough for 20-30 m lamp pools, smooth under bilinear filtering. */
const GLOW_TEXEL = 4;
/** Ground reflectance for the town glow (yards, verges, gardens and car parks at night). */
const GLOW_RHO = 0.08;
/** Share of the horizontal illuminance reaching the street-facing walls. */
const WALL_SHARE = 0.5;

const GLOW_PARS = /* glsl */ `
uniform sampler2D uGlowTex;
uniform vec4 uGlowFrame;   // town centre north, east; cos, sin of the grid angle
uniform float uGlowHalf;
uniform float uGlowOn;     // night switch-on (0..1)
// Street-light illuminance (scene units, rgb) at a world position, from the town's illuminance map.
vec3 townIlluminance(vec3 w) {
  float dn = -w.z - uGlowFrame.x, de = w.x - uGlowFrame.y;
  vec2 t = vec2(dn * uGlowFrame.z + de * uGlowFrame.w, -dn * uGlowFrame.w + de * uGlowFrame.z);
  vec2 uv = (t + uGlowHalf) / (2.0 * uGlowHalf);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec3(0.0);
  return texture2D(uGlowTex, uv).rgb * uGlowOn;
}
`;

/**
 * The street and area lights' illuminance on the ground around them, precomputed on a GLOW_TEXEL grid over the
 * town (in its own street-grid frame) into a half-float texture, sampled with bilinear filtering: smooth pools
 * falling off within 20-30 m of each lamp, dark gaps between streets, no cell pattern.
 */
function townGlowMap(town: { north: number; east: number; angle: number; radius: number }, lights: LightSpec[], heightAt: HeightFn): GlowMap {
  const REACH = 90;
  // Street and area luminaires throw their peak intensity out at ~65 deg from the nadir; straight down they give
  // about a fifth of it (a 8000 cd lamp on a 7.5 m pole lights the road below to ~30 lux, as the road pools use).
  const DOWNWARD = (STREET_ILLUMINANCE / SCENE_UNITS_PER_LUX) / (STREET_REFERENCE_CD / (STREET_POLE * STREET_POLE));
  const half = town.radius + 300;
  const N = Math.ceil((2 * half) / GLOW_TEXEL);
  const ca = Math.cos(town.angle), sa = Math.sin(town.angle);
  // Lamps (CutOff kind only) in town coordinates, bucketed on a REACH grid.
  const lamps = lights.filter((l) => l.kind === LightKind.CutOff).map((l) => {
    const dn = -l.position.z - town.north, de = l.position.x - town.east;
    const lum = 0.2126 * l.colorA.r + 0.7152 * l.colorA.g + 0.0722 * l.colorA.b;
    const x = dn * ca + de * sa, y = -dn * sa + de * ca;
    return { x, y, h: Math.max(l.height ?? l.position.y - heightAt(-l.position.z, l.position.x), 1), cd: l.cd, up: l.param ?? 0, col: l.colorA.clone().multiplyScalar(1 / lum) };
  });
  const buckets = new Map<number, typeof lamps>();
  const key = (i: number, j: number) => (i + 512) * 1024 + j + 512;
  for (const l of lamps) {
    const k = key(Math.floor(l.x / REACH), Math.floor(l.y / REACH));
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(l);
  }
  const data = new Float32Array(N * N * 4);
  const lumMap = new Float32Array(N * N);
  for (let iy = 0; iy < N; iy++) {
    const y = -half + (iy + 0.5) * GLOW_TEXEL;
    for (let ix = 0; ix < N; ix++) {
      const x = -half + (ix + 0.5) * GLOW_TEXEL;
      const bi = Math.floor(x / REACH), bj = Math.floor(y / REACH);
      let r = 0, g = 0, b = 0;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const list = buckets.get(key(bi + di, bj + dj));
          if (!list) continue;
          for (const l of list) {
            const dx = x - l.x, dy = y - l.y;
            const d2 = dx * dx + dy * dy + l.h * l.h;
            if (d2 > REACH * REACH) continue;
            const down = l.h / Math.sqrt(d2);
            // Cut-off luminaire: full intensity downward, fading toward the horizon (as in lights.ts).
            const t = Math.min(1, Math.max(0, (down - 0.05) / 0.65));
            const gain = l.up + (1 - l.up) * t * t * (3 - 2 * t);
            const e = (l.cd * DOWNWARD * gain * down) / d2;
            r += l.col.r * e;
            g += l.col.g * e;
            b += l.col.b * e;
          }
        }
      }
      const o = (iy * N + ix) * 4;
      data[o] = r * SCENE_UNITS_PER_LUX;
      data[o + 1] = g * SCENE_UNITS_PER_LUX;
      data[o + 2] = b * SCENE_UNITS_PER_LUX;
      data[o + 3] = 1;
      lumMap[iy * N + ix] = (0.2126 * r + 0.7152 * g + 0.0722 * b) * SCENE_UNITS_PER_LUX;
    }
  }
  const half16 = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half16[i] = THREE.DataUtils.toHalfFloat(Math.min(data[i], 6e4));
  const texture = new THREE.DataTexture(half16, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const at = (x: number, y: number): number => {
    const fx = (x + half) / GLOW_TEXEL - 0.5, fy = (y + half) / GLOW_TEXEL - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const v = (i: number, j: number) => (i < 0 || j < 0 || i >= N || j >= N ? 0 : lumMap[j * N + i]);
    return (v(ix, iy) * (1 - tx) + v(ix + 1, iy) * tx) * (1 - ty) + (v(ix, iy + 1) * (1 - tx) + v(ix + 1, iy + 1) * tx) * ty;
  };
  return { texture, frame: new THREE.Vector4(town.north, town.east, ca, sa), half, at };
}

/** Uniforms binding a GlowMap (uGlowOn follows the street-light switch-on in uStreetColor). */
function glowUniforms(map: GlowMap, shared: SharedUniforms): Record<string, THREE.IUniform> {
  // uStreetColor carries the night switch-on (sodium unit colour x lux x night), updated by AirportSystem every
  // frame; read through a getter when three uploads the uniform.
  const c = shared.uStreetColor.value;
  const on = {
    get value(): number {
      return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / STREET_ILLUMINANCE_REF;
    },
  };
  return { uGlowTex: { value: map.texture }, uGlowFrame: { value: map.frame }, uGlowHalf: { value: map.half }, uGlowOn: on };
}

/**
 * Night glow of the lit town on the ground: the street and area lights' illuminance (townGlowMap) on yards, verges,
 * gardens and car parks, drawn additively as ground luminance L = rho E / pi over a mesh draped on the terrain
 * (12.5 m cells, only where some lamp reaches). Roads carry their own sharp pools (road material).
 */
function townGlow(map: GlowMap, heightAt: HeightFn, shared: SharedUniforms): THREE.Mesh {
  const CELL = 12.5;
  const half = map.half;
  const nV = Math.ceil((2 * half) / CELL) + 1;
  const { x: N0, y: E0, z: ca, w: sa } = map.frame;
  const pos = new Float32Array(nV * nV * 3);
  const lit = new Uint8Array(nV * nV);
  for (let iy = 0; iy < nV; iy++) {
    for (let ix = 0; ix < nV; ix++) {
      const x = -half + ix * CELL, y = -half + iy * CELL;
      const n = N0 + x * ca - y * sa, e = E0 + x * sa + y * ca;
      const w = nedToThree({ x: n, y: e, z: -(heightAt(n, e) + 0.3) });
      pos.set([w.x, w.y, w.z], (iy * nV + ix) * 3);
      // Lit if any lamp reaches within half a cell (the map is zero only beyond every lamp's reach).
      lit[iy * nV + ix] = map.at(x, y) + map.at(x + CELL / 2, y + CELL / 2) + map.at(x - CELL / 2, y - CELL / 2) > 0 ? 1 : 0;
    }
  }
  const index: number[] = [];
  for (let iy = 0; iy < nV - 1; iy++) {
    for (let ix = 0; ix < nV - 1; ix++) {
      const a = iy * nV + ix, b = a + 1, d = a + nV, e = d + 1;
      if (!(lit[a] | lit[b] | lit[d] | lit[e])) continue; // unlit cell
      index.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    uniforms: glowUniforms(map, shared),
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        mv.xyz *= 0.9975; // drawn over the terrain mesh whatever its tessellation (as the valley roads)
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${GLOW_PARS}
      varying vec3 vWorld;
      void main() {
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(townIlluminance(vWorld) * ${(GLOW_RHO / Math.PI).toExponential(6)}, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'valley-town-glow';
  mesh.renderOrder = 5;
  return mesh;
}

/** Lift of road surfaces above the terrain height, m. */
const ROAD_LIFT = 0.2;

/**
 * Ribbon along a run of centreline points (world space), each edge vertex draped on the terrain at its own
 * position, so roads across a side slope neither float on the downhill side nor sink on the uphill side.
 */
function drapedRibbon(run: THREE.Vector3[], width: number, heightAt: HeightFn): THREE.BufferGeometry {
  const g = ribbonGeo(run, width);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(-z, x) + ROAD_LIFT);
  }
  g.computeVertexNormals();
  return g;
}

/** All runs of one road class merged into a single mesh (one draw call). */
function roadMesh(runs: THREE.Vector3[][], width: number, material: THREE.Material, heightAt: HeightFn, info?: [number, number, number, number][]): THREE.Mesh {
  const parts = runs.map((run, i) => {
    const g = drapedRibbon(run, width, heightAt);
    const n = g.attributes.position.count;
    const street = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) street.set(info?.[i] ?? [0, 0, 60, 0], k * 4);
    g.setAttribute('aStreet', new THREE.BufferAttribute(street, 4));
    return g;
  });
  const mesh = new THREE.Mesh(mergeGeometries(parts), material);
  for (const p of parts) p.dispose();
  mesh.receiveShadow = true;
  mesh.name = width > 5 ? 'valley-roads' : 'valley-tracks';
  return mesh;
}

/** Unit gable prism: x, z in [-0.5, 0.5], y in [0, 1], ridge along z. Rendered double-sided. */
function gableGeometry(): THREE.BufferGeometry {
  const L = [-0.5, 0], T = [0, 1], R = [0.5, 0];
  const tri: number[] = [];
  for (const z of [0.5, -0.5]) tri.push(L[0], L[1], z, R[0], R[1], z, T[0], T[1], z); // gable ends
  for (const [a, b] of [[L, T], [T, R]]) tri.push(a[0], a[1], 0.5, b[0], b[1], 0.5, b[0], b[1], -0.5, a[0], a[1], 0.5, b[0], b[1], -0.5, a[0], a[1], -0.5);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Instanced walls (unit box, base at y = 0) and roofs. Each wall instance carries its sunken depth so the
 * window grid starts at ground level, and a random seed for which windows are lit.
 */
function buildingMeshes(placed: Placed[], heightAt: HeightFn, shared: SharedUniforms, glow: GlowMap | null) {
  const wallGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const n = placed.length;
  const info = new Float32Array(n * 3);
  const wallMat = windowedWallMaterial(shared, glow);
  const roofMat = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide });
  const poleMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 });
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, n);
  const roofs = new THREE.InstancedMesh(gableGeometry(), roofMat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let nr = 0;
  placed.forEach((b, i) => {
    const c = Math.cos(b.rot), sn = Math.sin(b.rot);
    let lo = Infinity, hi = -Infinity;
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const h = heightAt(b.north + (x * b.w / 2) * c - (y * b.d / 2) * sn, b.east + (x * b.w / 2) * sn + (y * b.d / 2) * c);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    const sink = 0.4 + (hi - lo);
    const base = nedToThree({ x: b.north, y: b.east, z: -(lo - 0.4) });
    q.setFromAxisAngle(up, -b.rot);
    m.compose(base, q, s.set(b.d, b.h + sink, b.w));
    walls.setMatrixAt(i, m);
    walls.setColorAt(i, b.color);
    info.set([sink, b.windows ? 1 : 0, (i * 0.6180339) % 1], i * 3);
    if (b.roof) {
      m.compose(base.clone().setY(base.y + b.h + sink), q, s.set(b.d + 0.7, b.roof.h, b.w + 0.7));
      roofs.setMatrixAt(nr, m);
      roofs.setColorAt(nr++, b.roof.color);
    }
  });
  roofs.count = nr;
  wallGeo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 3));
  for (const im of [walls, roofs]) {
    im.castShadow = im.receiveShadow = true;
    im.computeBoundingSphere();
  }
  walls.name = 'valley-walls';
  roofs.name = 'valley-roofs';
  return { meshes: [walls, roofs], materials: [wallMat, roofMat, poleMaterial], poleMaterial };
}

/** Wall material with the procedural window grid; needs the per-instance aInfo attribute (sink, windows, seed). */
function windowedWallMaterial(shared: SharedUniforms, glow: GlowMap | null): THREE.MeshStandardMaterial {
  const wallMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const glowU = glow ? glowUniforms(glow, shared) : null;
  wallMat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = shared.uNight;
    if (glowU) Object.assign(shader.uniforms, glowU);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aInfo;\nvarying vec3 vFacade;\nflat varying float vSeed;\nvarying vec3 vTownWorld;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTownWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
        vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        // facade coordinates in metres: horizontal along the wall, height above ground; z = 1 on walls with windows
        float horiz = abs(normal.x) > 0.5 ? position.z * sc.z : position.x * sc.x;
        vFacade = vec3(horiz, position.y * sc.y - aInfo.x, abs(normal.y) < 0.5 ? aInfo.y : 0.0);
        vSeed = aInfo.z;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uNight;\nvarying vec3 vFacade;\nflat varying float vSeed;\nvarying vec3 vTownWorld;\n${glow ? GLOW_PARS : ''}
float hashW(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float win = 0.0, lit = 0.0;
        if (vFacade.z > 0.5 && vFacade.y > 0.6) {
          vec2 cell = floor(vec2(vFacade.x / 3.0, vFacade.y / 2.8));
          vec2 f = vec2(fract(vFacade.x / 3.0), fract(vFacade.y / 2.8));
          vec2 fw = fwidth(vFacade.xy) / vec2(3.0, 2.8);
          win = (smoothstep(0.28 - fw.x, 0.28 + fw.x, f.x) - smoothstep(0.72 - fw.x, 0.72 + fw.x, f.x))
              * (smoothstep(0.3 - fw.y, 0.3 + fw.y, f.y) - smoothstep(0.8 - fw.y, 0.8 + fw.y, f.y));
          lit = step(hashW(cell + vSeed * 97.0), 0.35);
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.04, 0.05), win);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.15, win);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n// Lit windows ~12 cd/m^2 (curtained homes), scene units.\ntotalEmissiveRadiance += vec3(1.25, 0.8, 0.38) * (1.2 * win * lit * uNight);${
        glow
          ? `
// Street lighting on the facades (about half the ground illuminance on the walls; flat roofs, level with or above
// the cut-off lamps, get little).
totalEmissiveRadiance += diffuseColor.rgb * RECIPROCAL_PI * townIlluminance(vTownWorld) * (abs(inverseTransformDirection(normal, viewMatrix).y) < 0.5 ? ${WALL_SHARE.toFixed(2)} : 0.15);`
          : ''
      }`);
  };
  wallMat.customProgramCacheKey = () => (glow ? 'airport-valley-walls-lit' : 'airport-valley-walls');
  return wallMat;
}
