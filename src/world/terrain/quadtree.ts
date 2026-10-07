// CDLOD node selection (Strugar 2009). Pure logic, no three.js.
//
// A node of level l is split into its four children when the camera is within range(l-1) of it, where
// range(l) = rangeFactor * size(l). Vertices of a level-l node morph toward the parent lattice over the
// last part of range(l). Distances are measured as sqrt(horizontal^2 + dz^2), with dz the camera height
// above the local terrain maximum and constant per frame; the vertex shader uses the same metric, so a
// vertex is never closer than the bounding box distance used for selection. With the morph window
// starting at (0.5 + 1.5/rangeFactor) * range, a node always meets a coarser neighbour fully morphed and
// that neighbour has not started morphing, so the two edges coincide exactly (no cracks).
//
// Node (level, ix, iz) covers east [ix*size, (ix+1)*size], north [iz*size, (iz+1)*size].

export interface LodSettings {
  /** Quads per node side (power of two). */
  grid: number;
  /** Size of a level-0 node, m. */
  leafSize: number;
  /** Level of the root nodes; roots tile the plane. */
  rootLevel: number;
  /** range(level) = rangeFactor * size(level). Larger = more detail. */
  rangeFactor: number;
  /** Nodes whose bounding box is farther than this are not drawn, m. */
  maxDistance: number;
}

export interface LodView {
  east: number;
  north: number;
  /** Camera height above the highest terrain nearby (>= 0), m. */
  dz: number;
}

export interface NodeRef {
  key: number;
  level: number;
  ix: number;
  iz: number;
  /** Distance from the camera to the node's bounding box (LOD metric), m. */
  dist: number;
}

/**
 * Recycles NodeRef objects across selections (no per-frame allocation). The refs a selection returns are
 * valid until the next selection with the same pool.
 */
export class NodeRefPool {
  private readonly items: NodeRef[] = [];
  private used = 0;

  reset(): void {
    this.used = 0;
  }

  get(key: number, level: number, ix: number, iz: number, dist: number): NodeRef {
    let r = this.items[this.used];
    if (!r) this.items.push((r = { key, level, ix, iz, dist }));
    else {
      r.key = key;
      r.level = level;
      r.ix = ix;
      r.iz = iz;
      r.dist = dist;
    }
    this.used++;
    return r;
  }
}

const newRef = (key: number, level: number, ix: number, iz: number, dist: number): NodeRef => ({ key, level, ix, iz, dist });

/** Children are requested this much before they are needed, as a fraction of the split range. */
const PREFETCH = 1.25;

const KEY_OFFSET = 1 << 19;
const KEY_SPAN = 1 << 20;
const SMALL = 4096;
/**
 * Unique numeric key of a node (level < 16, |ix|, |iz| < 2^19). Within 4096 nodes of the origin on every
 * level (over 500 km) the key is a small integer (30 bits), which V8 keeps unboxed: the selection computes
 * thousands per frame, and larger keys would each allocate a heap number. Farther out it is a distinct
 * double above 2^31.
 */
export const nodeKey = (level: number, ix: number, iz: number): number =>
  ix >= -SMALL && ix < SMALL && iz >= -SMALL && iz < SMALL
    ? (level << 26) | ((ix + SMALL) << 13) | (iz + SMALL)
    : 2147483648 + (level * KEY_SPAN + ix + KEY_OFFSET) * KEY_SPAN + iz + KEY_OFFSET;

export const nodeSize = (s: LodSettings, level: number): number => s.leafSize * 2 ** level;

export const lodRange = (s: LodSettings, level: number): number => s.rangeFactor * nodeSize(s, level);

/** Geomorph window of a level: [start, end] distances, m. */
export function morphWindow(s: LodSettings, level: number): [number, number] {
  const r = lodRange(s, level);
  return [r * (0.5 + 1.5 / s.rangeFactor), r * 0.985];
}

function boxDistance(s: LodSettings, v: LodView, level: number, ix: number, iz: number): number {
  const size = nodeSize(s, level);
  const e0 = ix * size;
  const n0 = iz * size;
  const de = v.east < e0 ? e0 - v.east : v.east > e0 + size ? v.east - e0 - size : 0;
  const dn = v.north < n0 ? n0 - v.north : v.north > n0 + size ? v.north - n0 - size : 0;
  return Math.sqrt(de * de + dn * dn + v.dz * v.dz);
}

/**
 * Select the nodes to draw this frame.
 * @param isReady  whether a node's mesh exists
 * @param draw     receives the nodes to render (all ready)
 * @param want     receives missing nodes that should be built, with their distance as priority
 * @param keep     receives every ready node in use (drawn or an ancestor), to protect it from eviction
 *                 (a Set, or anything with add(); keys may be added more than once)
 * @param pool     recycles the NodeRef objects (they then stay valid only until the next selection)
 */
export function selectNodes(
  s: LodSettings,
  v: LodView,
  isReady: (key: number) => boolean,
  draw: NodeRef[],
  want: NodeRef[],
  keep: { add(key: number): unknown },
  pool?: NodeRefPool,
): void {
  pool?.reset();
  const ref = pool ? (key: number, level: number, ix: number, iz: number, dist: number) => pool.get(key, level, ix, iz, dist) : newRef;
  const rootSize = nodeSize(s, s.rootLevel);
  const ix0 = Math.floor((v.east - s.maxDistance) / rootSize);
  const ix1 = Math.floor((v.east + s.maxDistance) / rootSize);
  const iz0 = Math.floor((v.north - s.maxDistance) / rootSize);
  const iz1 = Math.floor((v.north + s.maxDistance) / rootSize);

  const visit = (level: number, ix: number, iz: number, dist: number): void => {
    const key = nodeKey(level, ix, iz);
    keep.add(key);
    if (level > 0) {
      const split = lodRange(s, level - 1);
      if (dist < split * PREFETCH) {
        // First pass: are all children in range built? Request the missing ones.
        let allReady = true;
        for (let c = 0; c < 4; c++) {
          const cx = ix * 2 + (c & 1);
          const cz = iz * 2 + (c >> 1);
          const cd = boxDistance(s, v, level - 1, cx, cz);
          if (cd > s.maxDistance) continue;
          const ckey = nodeKey(level - 1, cx, cz);
          if (isReady(ckey)) {
            // Built children are in use (drawn, or prefetched for the split): protect them from eviction,
            // otherwise prefetched nodes beyond the spare budget are evicted and rebuilt forever.
            keep.add(ckey);
            continue;
          }
          allReady = false;
          // Prefetched children (not needed yet) queue behind everything that is needed now.
          want.push(ref(ckey, level - 1, cx, cz, dist < split ? cd : cd + split));
        }
        if (dist < split && allReady) {
          for (let c = 0; c < 4; c++) {
            const cx = ix * 2 + (c & 1);
            const cz = iz * 2 + (c >> 1);
            const cd = boxDistance(s, v, level - 1, cx, cz);
            if (cd <= s.maxDistance) visit(level - 1, cx, cz, cd);
          }
          return;
        }
      }
    }
    draw.push(ref(key, level, ix, iz, dist));
  };

  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const d = boxDistance(s, v, s.rootLevel, ix, iz);
      if (d > s.maxDistance) continue;
      const key = nodeKey(s.rootLevel, ix, iz);
      if (isReady(key)) visit(s.rootLevel, ix, iz, d);
      else want.push(ref(key, s.rootLevel, ix, iz, 0));
    }
  }
}
