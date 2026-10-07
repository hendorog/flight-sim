// Canvas plumbing for the panel artwork: offscreen canvases, fonts and a deterministic random source so
// the procedural wear looks the same on every load.

export type Ctx2D = CanvasRenderingContext2D;

/**
 * Instrument lettering: a DIN-like condensed grotesque, which is what Cessna/Sigma-Tek dials use. The stack
 * falls back through common system condensed faces; no web font is loaded (no network at runtime).
 */
export const DIAL_FONT = `Bahnschrift, "DIN Alternate", "DIN Condensed", "Roboto Condensed", "Arial Narrow", "Nimbus Sans Narrow", "DejaVu Sans Condensed", Arial, sans-serif`;
/** Placard / switch-label lettering. */
export const LABEL_FONT = `"Arial Narrow", "Nimbus Sans Narrow", Bahnschrift, "Roboto Condensed", "DejaVu Sans Condensed", Arial, sans-serif`;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return c;
}

export function context2d(c: HTMLCanvasElement): Ctx2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return g;
}

/** Mulberry32: tiny deterministic PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Grain overlay: a canvas of mid-grey value noise at two octaves, meant to be composited with 'overlay'
 * or low alpha to break up flat fills (crinkle paint, anodising, matte dial paint).
 */
export function noiseCanvas(w: number, h: number, seed: number, amount: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const g = context2d(c);
  const img = g.createImageData(c.width, c.height);
  const rand = rng(seed);
  // Coarse octave on a 4 px lattice, bilinearly interpolated, plus per-pixel fine grain.
  const cw = Math.ceil(c.width / 4) + 2;
  const ch = Math.ceil(c.height / 4) + 2;
  const coarse = new Float32Array(cw * ch);
  for (let i = 0; i < coarse.length; i++) coarse[i] = rand() - 0.5;
  const d = img.data;
  for (let y = 0; y < c.height; y++) {
    const fy = y / 4;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < c.width; x++) {
      const fx = x / 4;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const a = coarse[y0 * cw + x0] * (1 - tx) + coarse[y0 * cw + x0 + 1] * tx;
      const b = coarse[(y0 + 1) * cw + x0] * (1 - tx) + coarse[(y0 + 1) * cw + x0 + 1] * tx;
      const v = 128 + ((a * (1 - ty) + b * ty) * 0.6 + (rand() - 0.5) * 0.9) * amount * 255;
      const i = (y * c.width + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
