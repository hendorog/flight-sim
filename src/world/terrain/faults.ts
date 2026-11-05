// A seeded world's fault lines (any seed but 0): a handful of long, nearly straight breaks through its mountain ranges
// where the ground on one side moved up against the other faster than its rivers could wear the step away. They are
// not drawn across the hills (no scarp this round): only where a channel crosses one does the drop show, as a fall of
// the fault's throw there with a short gorge below it (falls.ts). Pure JS, built at load from the world's seed.

import { seeded } from '../worldSeed';
import { rng } from '../airport/noise';
import { gnoise } from './noise';
import { DOMAIN_HALF } from './drainage';
import { macroAt, type Macro } from './seededLayout';

/** A fault line: its trace (points about FAULT_STEP apart), and the throw (the step's height, m) at each point. */
export interface Fault {
  north: Float64Array;
  east: Float64Array;
  throw: Float64Array;
}

/** How many faults a world has (at least, at most). */
const FAULT_COUNT = [8, 16] as const;
/** Length of a fault, m. */
const FAULT_LENGTH = [25000, 70000] as const;
/** Spacing of a fault's points, m. */
const FAULT_STEP = 1000;
/** Throw at a fault's middle, m (it tapers to nothing at its ends). */
const FAULT_THROW = [10, 45] as const;
/** A fault is centred where the alpine uplift (seededLayout.ts) is at least this: in a range. */
const FAULT_UPLIFT = 0.2;
/** Fault centres lie at least this far apart, m (the faults of a system are spread across its ranges). */
const FAULT_APART = 20000;
/** Faults of a world strike within this of its regional trend, rad (a fault system's breaks run roughly together). */
const FAULT_SPREAD = 0.35;

/** The faults of the current world (deterministic in its seed). */
export function buildFaults(): Fault[] {
  const r = rng(seeded(0xfa017));
  const count = FAULT_COUNT[0] + Math.floor(r() * (FAULT_COUNT[1] - FAULT_COUNT[0] + 1));
  const trend = r() * Math.PI;
  const m: Macro = { inland: 0, uplift: 0, foothill: 0, hilly: 0 };
  const out: Fault[] = [];
  const centres: Array<[number, number]> = [];
  for (let tries = 0; out.length < count && tries < 4000; tries++) {
    const cn = (r() * 2 - 1) * DOMAIN_HALF * 0.85;
    const ce = (r() * 2 - 1) * DOMAIN_HALF * 0.85;
    const a = r();
    const b = r();
    const c = r();
    macroAt(cn, ce, m);
    if (m.uplift < FAULT_UPLIFT || m.inland < 0) continue;
    if (centres.some(([n, e]) => Math.hypot(n - cn, e - ce) < FAULT_APART)) continue;
    centres.push([cn, ce]);
    const length = FAULT_LENGTH[0] + (FAULT_LENGTH[1] - FAULT_LENGTH[0]) * a;
    const strike = trend + (b * 2 - 1) * FAULT_SPREAD;
    const tmax = FAULT_THROW[0] + (FAULT_THROW[1] - FAULT_THROW[0]) * c;
    const k = Math.max(2, Math.round(length / FAULT_STEP));
    const north = new Float64Array(k + 1);
    const east = new Float64Array(k + 1);
    const thr = new Float64Array(k + 1);
    // From the centre both ways, the strike bending gently along the trace (a fault is nearly straight).
    const half = k >> 1;
    const phase = out.length * 13.7 + tries * 0.37;
    for (const dir of [1, -1]) {
      let n = cn;
      let e = ce;
      for (let j = 0; j <= (dir > 0 ? k - half : half); j++) {
        const idx = half + dir * j;
        north[idx] = n;
        east[idx] = e;
        const u = idx / k;
        // The throw: most in the middle, tapering to nothing at the tips, varying a little along the trace.
        thr[idx] = tmax * Math.pow(Math.sin(Math.PI * u), 0.6) * (0.8 + 0.2 * gnoise(u * 6 + phase, 3.3));
        const th = strike + 0.25 * gnoise((idx * FAULT_STEP) / 15000 + phase, 1.7);
        n += dir * Math.cos(th) * FAULT_STEP;
        e += dir * Math.sin(th) * FAULT_STEP;
      }
    }
    out.push({ north, east, throw: thr });
  }
  return out;
}

/** A channel's crossing of a fault: where along the channel (segment, parameter) and the fault's throw there. */
export interface FaultCrossing {
  seg: number;
  t: number;
  fault: number;
  throw: number;
}

/** Grid of the faults' segments, for finding where a channel crosses one. */
export class FaultIndex {
  private readonly cells = new Map<number, number[]>();
  constructor(readonly faults: ReadonlyArray<Fault>, private readonly cell = 2000) {
    faults.forEach((f, fi) => {
      for (let i = 0; i < f.north.length - 1; i++) {
        const n0 = Math.floor(Math.min(f.north[i], f.north[i + 1]) / cell);
        const n1 = Math.floor(Math.max(f.north[i], f.north[i + 1]) / cell);
        const e0 = Math.floor(Math.min(f.east[i], f.east[i + 1]) / cell);
        const e1 = Math.floor(Math.max(f.east[i], f.east[i + 1]) / cell);
        for (let a = n0; a <= n1; a++) {
          for (let b = e0; b <= e1; b++) {
            const k = (a + 32768) * 65536 + b + 32768;
            const l = this.cells.get(k);
            if (l) l.push(fi, i);
            else this.cells.set(k, [fi, i]);
          }
        }
      }
    });
  }

  /** Every crossing of the polyline (north, east) with a fault, in order along it (at most one per fault). */
  crossings(north: Float64Array, east: Float64Array): FaultCrossing[] {
    const out: FaultCrossing[] = [];
    if (this.cells.size === 0) return out;
    const seen = new Set<number>();
    const cell = this.cell;
    for (let i = 0; i < north.length - 1; i++) {
      const a = Math.floor(north[i] / cell);
      const b = Math.floor(east[i] / cell);
      const l = this.cells.get((a + 32768) * 65536 + b + 32768);
      const l2 = Math.floor(north[i + 1] / cell) !== a || Math.floor(east[i + 1] / cell) !== b ? this.cells.get((Math.floor(north[i + 1] / cell) + 32768) * 65536 + Math.floor(east[i + 1] / cell) + 32768) : undefined;
      for (const list of [l, l2]) {
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const fi = list[k];
          if (seen.has(fi)) continue;
          const f = this.faults[fi];
          const j = list[k + 1];
          // Segment i of the channel (p -> q) against segment j of the fault (r -> s).
          const px = east[i], py = north[i], qx = east[i + 1] - px, qy = north[i + 1] - py;
          const rx = f.east[j], ry = f.north[j], sx = f.east[j + 1] - rx, sy = f.north[j + 1] - ry;
          const den = qx * sy - qy * sx;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((rx - px) * sy - (ry - py) * sx) / den;
          const u = ((rx - px) * qy - (ry - py) * qx) / den;
          if (t < 0 || t >= 1 || u < 0 || u > 1) continue;
          seen.add(fi);
          out.push({ seg: i, t, fault: fi, throw: f.throw[j] + (f.throw[j + 1] - f.throw[j]) * u });
        }
      }
    }
    return out;
  }
}
