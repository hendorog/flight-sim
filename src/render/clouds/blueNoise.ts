// Tileable 64x64 blue-noise dither texture built with Ulichney's void-and-cluster algorithm (1993) at
// start-up (~20 ms). Used to jitter ray-march start offsets: blue noise spreads the error into high
// spatial frequencies, which the temporal filter and the upsampler then remove almost completely.

import * as THREE from 'three';

const SIZE = 64;
const N = SIZE * SIZE;
const SIGMA = 1.5;
const RADIUS = 6;

/** Deterministic PRNG (mulberry32) so the texture is identical on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class EnergyField {
  readonly energy = new Float32Array(N);
  private readonly kernel: Float32Array;

  constructor() {
    const w = 2 * RADIUS + 1;
    this.kernel = new Float32Array(w * w);
    for (let y = -RADIUS; y <= RADIUS; y++)
      for (let x = -RADIUS; x <= RADIUS; x++)
        this.kernel[(y + RADIUS) * w + x + RADIUS] = Math.exp(-(x * x + y * y) / (2 * SIGMA * SIGMA));
  }

  /** Add (sign = 1) or remove (sign = -1) a point's Gaussian footprint, wrapping toroidally. */
  splat(index: number, sign: number): void {
    const px = index % SIZE;
    const py = (index / SIZE) | 0;
    const w = 2 * RADIUS + 1;
    for (let y = -RADIUS; y <= RADIUS; y++) {
      const row = ((py + y + SIZE) % SIZE) * SIZE;
      for (let x = -RADIUS; x <= RADIUS; x++) {
        this.energy[row + ((px + x + SIZE) % SIZE)] += sign * this.kernel[(y + RADIUS) * w + x + RADIUS];
      }
    }
  }

  /** Index of the highest-energy set pixel (tightest cluster) or lowest-energy unset pixel (largest void). */
  extreme(bits: Uint8Array, wantSet: boolean): number {
    let best = -1;
    let bestE = wantSet ? -Infinity : Infinity;
    for (let i = 0; i < N; i++) {
      if ((bits[i] === 1) !== wantSet) continue;
      const e = this.energy[i];
      if (wantSet ? e > bestE : e < bestE) {
        bestE = e;
        best = i;
      }
    }
    return best;
  }
}

function voidAndCluster(): Uint8Array {
  const rand = mulberry32(0x5eed);
  const bits = new Uint8Array(N);
  const field = new EnergyField();
  const initial = Math.floor(N / 10);
  for (let placed = 0; placed < initial; ) {
    const i = Math.floor(rand() * N);
    if (bits[i]) continue;
    bits[i] = 1;
    field.splat(i, 1);
    placed++;
  }
  // Relax the initial pattern: move the tightest cluster into the largest void until stable.
  for (let iter = 0; iter < N; iter++) {
    const cluster = field.extreme(bits, true);
    bits[cluster] = 0;
    field.splat(cluster, -1);
    const hole = field.extreme(bits, false);
    bits[hole] = 1;
    field.splat(hole, 1);
    if (hole === cluster) break;
  }

  const rank = new Uint32Array(N);
  // Phase 1: rank the prototype's points by repeatedly removing the tightest cluster.
  const proto = bits.slice();
  const protoEnergy = field.energy.slice();
  for (let r = initial - 1; r >= 0; r--) {
    const cluster = field.extreme(bits, true);
    bits[cluster] = 0;
    field.splat(cluster, -1);
    rank[cluster] = r;
  }
  // Phases 2 and 3: from the prototype, fill the largest void until every pixel is ranked.
  bits.set(proto);
  field.energy.set(protoEnergy);
  for (let r = initial; r < N; r++) {
    const hole = field.extreme(bits, false);
    bits[hole] = 1;
    field.splat(hole, 1);
    rank[hole] = r;
  }

  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = Math.floor(((rank[i] + 0.5) / N) * 256);
  return out;
}

export function createBlueNoiseTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(voidAndCluster(), SIZE, SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export const BLUE_NOISE_SIZE = SIZE;
