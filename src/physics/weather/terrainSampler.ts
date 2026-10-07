// Terrain height as the air flow sees it: sampled on a coarse cached lattice and interpolated bilinearly, so
// the wind model's orographic lift and height-above-ground use a smooth surface (air flows over hills, not
// over every rock) and cost almost no terrain queries. The slope is a central difference across one lattice
// spacing of the interpolated surface, which keeps it continuous.

const SPACING = 40; // m
const MAX_CACHED = 65536;
/** Integer lattice indices are packed into one numeric key; offset keeps them positive (+/-1300 km). */
const OFFSET = 32768;

export interface TerrainSample {
  height: number;
  /** dh/dnorth, dh/deast. */
  slopeNorth: number;
  slopeEast: number;
}

export class SmoothedTerrain {
  private readonly nodes = new Map<number, number>();

  constructor(private readonly heightAt: (north: number, east: number) => number) {}

  sample(north: number, east: number, out: TerrainSample): TerrainSample {
    out.height = this.height(north, east);
    out.slopeNorth = (this.height(north + SPACING, east) - this.height(north - SPACING, east)) / (2 * SPACING);
    out.slopeEast = (this.height(north, east + SPACING) - this.height(north, east - SPACING)) / (2 * SPACING);
    return out;
  }

  private height(north: number, east: number): number {
    const x = north / SPACING;
    const y = east / SPACING;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const a = this.node(i, j);
    const b = this.node(i + 1, j);
    const c = this.node(i, j + 1);
    const d = this.node(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  private node(i: number, j: number): number {
    const key = (i + OFFSET) * 65536 + (j + OFFSET);
    let h = this.nodes.get(key);
    if (h === undefined) {
      if (this.nodes.size >= MAX_CACHED) this.nodes.clear();
      h = this.heightAt(i * SPACING, j * SPACING);
      this.nodes.set(key, h);
    }
    return h;
  }
}
