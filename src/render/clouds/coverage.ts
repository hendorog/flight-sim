// Statistics of the cloud-coverage field (CPU side, shared with the tests).
//
// The two coverage fields of the weather map (noiseTextures.ts) are stored as normal scores: each field is
// histogram-equalised to its rank and the rank mapped through the inverse standard-normal CDF, z in
// [-Z_RANGE, Z_RANGE] stored as z / (2 Z_RANGE) + 0.5. The shader cross-fades the two fields with weights
// cos(a), sin(a), which keeps the sum a standard normal (the fields are independent), and maps it back
// through the normal CDF: the blended field stays uniformly distributed at every stage of the evolution, so
// thresholding it at (1 - f) always leaves the fraction f of the area inside the coverage mask. (A linear
// mix of two uniform fields is triangular: halfway through the cross-fade, 35 % cover shrank to 25 %.)

/** Normal scores are stored in [-Z_RANGE, Z_RANGE]. */
export const Z_RANGE = 3;

/** Standard-normal CDF (Abramowitz-Stegun 7.1.26 erf, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Inverse standard-normal CDF (Acklam's rational approximation, relative error < 1.2e-9). */
export function normalQuantile(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Replace channel `channel` of an RGBA8 image by the normal score of its rank: the stored value v in [0, 1]
 * decodes as z = (v - 0.5) * 2 Z_RANGE, a standard normal variate (clipped to +-Z_RANGE).
 */
export function equalizeToNormal(pixels: Uint8Array, channel: number): void {
  const hist = new Uint32Array(256);
  for (let i = channel; i < pixels.length; i += 4) hist[pixels[i]]++;
  const lut = new Uint8Array(256);
  const total = pixels.length / 4;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    const z = normalQuantile((acc + hist[v] * 0.5) / total);
    lut[v] = Math.round((Math.min(Math.max(z / (2 * Z_RANGE), -0.5), 0.5) + 0.5) * 255);
    acc += hist[v];
  }
  for (let i = channel; i < pixels.length; i += 4) pixels[i] = lut[pixels[i]];
}

/** The shader's cross-fade of two stored normal scores (0..1 each) into a uniform field value 0..1. */
export function blendFields(v0: number, v1: number, evolve: number): number {
  const a = evolve * Math.PI * 0.5;
  const z = (v0 - 0.5) * 2 * Z_RANGE * Math.cos(a) + (v1 - 0.5) * 2 * Z_RANGE * Math.sin(a);
  return normalCdf(z);
}

/** The cross-fade weights (cos a, sin a) for an evolution phase 0..1, as the shader's uEvolve uniform. */
export function evolveWeights<T extends { x: number; y: number }>(evolve: number, out: T): T {
  const a = evolve * Math.PI * 0.5;
  out.x = Math.cos(a) * 2 * Z_RANGE;
  out.y = Math.sin(a) * 2 * Z_RANGE;
  return out;
}

/**
 * GLSL twin of normalCdf / blendFields (tanh form of the normal CDF, |error| < 2e-4); w = evolveWeights().
 */
export const COVERAGE_GLSL = /* glsl */ `
float normalCdf(float z) { return 0.5 + 0.5 * tanh(0.7978845608 * (z + 0.044715 * z * z * z)); }
float blendFields(float v0, float v1, vec2 w) { return normalCdf(dot(vec2(v0, v1) - 0.5, w)); }
`;

/**
 * Coverage control x in [0, 2]: up to 1 it lowers the threshold on the coverage field (threshold = 1 - x);
 * beyond 1 the threshold is 0 and the gaps between the cells fill in (fill = 0.7 (x - 1)), merging them into
 * a deck.
 */
export function coverageControl<T extends { x: number; y: number }>(x: number, out: T): T {
  out.x = Math.max(1 - x, 0);
  out.y = Math.min(Math.max((x - 1) * 0.7, 0), 0.7);
  return out;
}

/**
 * Calibration: [coverage control x, cloud cover it gives] pairs. The cover of a row is derived from the
 * measured fraction of the ground under cloud f (cloud-shadow map with the sun overhead, transmittance below
 * 0.5, averaged over 9 x 40 km x 40 km; dev/clouds.html?coverCal=1, each with the cloud type of that
 * fraction as the cover) through f = c (0.88 + 0.12 c): an observer's sky fraction (oktas / 8) includes the
 * clouds' sunlit and shaded sides, so the ground actually under cloud is ~12 % less than the reported cover
 * for scattered cumulus, converging at overcast. Thresholding the field at exactly (1 - cover) covers less
 * than `cover`, because each cell's coverage ramps in from its rim and the 3D noise carves its flanks and
 * top. Re-measure whenever the density model changes. The deck closes completely from x ~1.7; the rows above
 * are pinned just below 1 so that cover 1 maps to the full control (the gaps between the cells filled, no thin
 * spots), not to the first control that measures closed.
 */
export const COVER_CALIBRATION: ReadonlyArray<readonly [number, number]> = [
  [0, 0.0],
  [0.05, 0.016],
  [0.1, 0.04],
  [0.2, 0.093],
  [0.3, 0.151],
  [0.4, 0.207],
  [0.5, 0.26],
  [0.6, 0.313],
  [0.7, 0.361],
  [0.8, 0.408],
  [0.9, 0.453],
  [1, 0.496],
  [1.1, 0.588],
  [1.2, 0.718],
  [1.3, 0.917],
  [1.4, 0.972],
  [1.5, 0.992],
  [1.6, 0.998],
  [1.7, 0.9985],
  [1.8, 0.999],
  [1.9, 0.9995],
  [2, 1],
];

/**
 * Coverage uniform (threshold, fill) for a requested cloud cover (the fraction of the sky overhead, i.e. of
 * the ground under cloud): inverts COVER_CALIBRATION by linear interpolation.
 */
export function coverageParams<T extends { x: number; y: number }>(cover: number, out: T): T {
  const c = Math.min(Math.max(cover, 0), 1);
  const t = COVER_CALIBRATION;
  let x = t[t.length - 1][0];
  for (let i = 1; i < t.length; i++) {
    const [x0, f0] = t[i - 1];
    const [x1, f1] = t[i];
    if (c <= f1) {
      x = f1 > f0 ? x0 + ((c - f0) / (f1 - f0)) * (x1 - x0) : x1;
      break;
    }
  }
  return coverageControl(x, out);
}
