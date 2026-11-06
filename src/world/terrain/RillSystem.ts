// Streams the hillside rills (rills.ts, built per patch in the terrain workers) into a texture array the ground shader
// reads (rillShader.ts): the RILL_SLOTS_SIDE² patches around the viewer, each in the layer its patch coordinates
// select (so a patch never moves once loaded), nearest first and only while the terrain leaves a worker free. A layer is
// marked empty the moment its patch is no longer wanted, so the shader never draws one patch's rills in another's place.
// One layer is uploaded per frame at most (about 1 MB). A seeded world only (TerrainSystem creates it when rillsOn()).

import * as THREE from 'three';
import type { WorkerPool } from './workerPool';
import { RILL_PATCH, RILL_TEX, type RillPatchData, type RillStats } from './rills';
import { RILL_SLOTS, RILL_SLOTS_SIDE, RILL_UNIFORMS } from './rillShader';

/** Most patch jobs in flight at once (tiles and trees go first). */
const MAX_INFLIGHT = 2;
/** The worker the patches are built on while it has room (the last: the one tiles go to least; it keeps the raster
 * blocks the patches share, rills.ts). */
const RILL_WORKER = -1;
/** Patch results kept after they leave the held set (flying back over them costs nothing), patches. */
const KEEP = 24;

const keyOf = (pi: number, pj: number): string => `${pi},${pj}`;
const slotOf = (pi: number, pj: number): number => {
  const m = (v: number): number => ((v % RILL_SLOTS_SIDE) + RILL_SLOTS_SIDE) % RILL_SLOTS_SIDE;
  return m(pi) + RILL_SLOTS_SIDE * m(pj);
};

export class RillSystem {
  private readonly texture: THREE.DataArrayTexture;
  /** Results by patch (most recently wanted last). */
  private readonly done = new Map<string, RillPatchData>();
  private readonly inflight = new Set<string>();
  /** The patch each slot shows (null: none yet) and whether its layer holds it. */
  private readonly shown: Array<{ pi: number; pj: number; loaded: boolean } | null> = Array.from({ length: RILL_SLOTS }, () => null);
  private generation = 0;
  private lastPi = NaN;
  private lastPj = NaN;
  /** Diagnostics: patches built, mean worker time per patch (ms: total, sampling the ground) and share of the window
   * sampled (the rest came from the worker's block cache), last upload's main-thread time (ms), uploads, km traced. */
  readonly stats = { patches: 0, workerMs: 0, groundMs: 0, sampledShare: 0, uploadMs: 0, uploads: 0, km: 0 };

  constructor(private readonly pool: WorkerPool) {
    const data = new Uint8Array(RILL_TEX * RILL_TEX * 4 * RILL_SLOTS);
    this.texture = new THREE.DataArrayTexture(data, RILL_TEX, RILL_TEX, RILL_SLOTS);
    this.texture.format = THREE.RGBAFormat;
    this.texture.type = THREE.UnsignedByteType;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    // (Not uploaded until the first patch arrives: then only that layer is sent, the rest allocated as zeros.)
    RILL_UNIFORMS.tRills.value = this.texture;
    for (const k of RILL_UNIFORMS.uRillKey.value) k.set(1e6, 1e6, 0, 0);
  }

  update(camera: THREE.Camera): void {
    const east = camera.position.x;
    const north = -camera.position.z;
    const pi0 = Math.round(east / RILL_PATCH) - RILL_SLOTS_SIDE / 2;
    const pj0 = Math.round(north / RILL_PATCH) - RILL_SLOTS_SIDE / 2;
    if (pi0 !== this.lastPi || pj0 !== this.lastPj) {
      this.lastPi = pi0;
      this.lastPj = pj0;
      // The held set changed: slots now wanted for another patch are emptied at once.
      for (let dj = 0; dj < RILL_SLOTS_SIDE; dj++)
        for (let di = 0; di < RILL_SLOTS_SIDE; di++) {
          const pi = pi0 + di;
          const pj = pj0 + dj;
          const s = slotOf(pi, pj);
          const cur = this.shown[s];
          if (cur && cur.pi === pi && cur.pj === pj) continue;
          this.shown[s] = { pi, pj, loaded: false };
          RILL_UNIFORMS.uRillKey.value[s].set(pi, pj, 0, 0);
        }
    }
    // Upload one finished patch (nearest first), then ask for the nearest missing one.
    let upload = -1;
    let uploadD = Infinity;
    let want: { pi: number; pj: number } | null = null;
    let wantD = Infinity;
    for (let s = 0; s < RILL_SLOTS; s++) {
      const sh = this.shown[s];
      if (!sh || sh.loaded) continue;
      const d = Math.hypot((sh.pi + 0.5) * RILL_PATCH - east, (sh.pj + 0.5) * RILL_PATCH - north);
      const k = keyOf(sh.pi, sh.pj);
      if (this.done.has(k)) {
        if (d < uploadD) {
          uploadD = d;
          upload = s;
        }
      } else if (!this.inflight.has(k) && d < wantD) {
        wantD = d;
        want = sh;
      }
    }
    if (upload >= 0) this.show(upload);
    // (One at a time on a small pool, a laptop's: the tiles keep the rest.)
    const most = this.pool.size <= 3 ? 1 : MAX_INFLIGHT;
    if (want && this.inflight.size < most && this.pool.freeSlots >= 2) this.request(want.pi, want.pj);
  }

  private show(s: number): void {
    const sh = this.shown[s]!;
    const k = keyOf(sh.pi, sh.pj);
    const res = this.done.get(k)!;
    // Most recently used last.
    this.done.delete(k);
    this.done.set(k, res);
    sh.loaded = true;
    if (!res.texels) {
      RILL_UNIFORMS.uRillKey.value[s].set(sh.pi, sh.pj, 0, 0);
      return;
    }
    const t0 = performance.now();
    const data = this.texture.image.data as Uint8Array;
    data.set(res.texels, s * RILL_TEX * RILL_TEX * 4);
    this.texture.addLayerUpdate(s);
    this.texture.needsUpdate = true;
    RILL_UNIFORMS.uRillKey.value[s].set(sh.pi, sh.pj, 1, 0);
    this.stats.uploadMs = performance.now() - t0;
    this.stats.uploads++;
  }

  private request(pi: number, pj: number): void {
    const k = keyOf(pi, pj);
    this.inflight.add(k);
    const gen = this.generation;
    this.pool
      .run({ kind: 'rills', req: { pi, pj } }, RILL_WORKER)
      .then((r) => {
        if (gen !== this.generation) return;
        this.inflight.delete(k);
        const res = r as RillPatchData;
        this.done.set(k, res);
        this.account(res.stats);
        while (this.done.size > KEEP + RILL_SLOTS) {
          const oldest = this.done.keys().next().value as string;
          this.done.delete(oldest);
        }
      })
      .catch(() => undefined);
  }

  private account(s: RillStats): void {
    const n = ++this.stats.patches;
    const total = s.msGround + s.msTrace + s.msLines + s.msRaster;
    this.stats.workerMs += (total - this.stats.workerMs) / n;
    this.stats.groundMs += (s.msGround - this.stats.groundMs) / n;
    this.stats.sampledShare += (s.sampled / Math.max(1, s.cells) - this.stats.sampledShare) / n;
    this.stats.km += s.km;
  }

  dispose(): void {
    this.generation++;
    this.texture.dispose();
    RILL_UNIFORMS.tRills.value = null;
    for (const k of RILL_UNIFORMS.uRillKey.value) k.set(1e6, 1e6, 0, 0);
  }
}
