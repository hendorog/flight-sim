// The Yale Bright Star Catalogue (5th revised edition, Hoffleit & Warren 1991; CDS V/50) as shipped in
// public/sky/stars/bsc5.bin (built by scripts/sky/stars-build.py; provenance in public/sky/stars/SOURCE.md), and the
// colours of its stars. Pure and node-safe: the decoder takes the file's bytes, nothing here touches the GPU.
//
// File layout (little endian): a 16-byte header (magic 'BSC5', uint32 version 1, uint32 record count, uint32
// epoch year 2000), then 12 bytes per HR number 1..count in HR order: float32 RA, float32 Dec (rad, J2000),
// int16 round(Vmag * 100), int16 round((B-V) * 1000). HR numbers without data carry Vmag = 32767, a missing B-V
// is 32767.

const MAGIC = 0x35435342; // 'BSC5' read as a little-endian uint32
const HEADER_BYTES = 16;
const RECORD_BYTES = 12;
const MISSING = 32767;

export interface StarCatalog {
  /** Number of stars (records with data). */
  readonly count: number;
  /** Harvard Revised (= Bright Star) number of each star. */
  readonly hr: Uint16Array;
  /** Right ascension and declination, rad, J2000. */
  readonly ra: Float32Array;
  readonly dec: Float32Array;
  /** Visual magnitude. */
  readonly vmag: Float32Array;
  /** B-V colour index, NaN where the catalogue has none. */
  readonly bv: Float32Array;
}

/** Decode bsc5.bin; throws on a file that is not one. */
export function decodeStarCatalog(buffer: ArrayBuffer): StarCatalog {
  const view = new DataView(buffer);
  if (buffer.byteLength < HEADER_BYTES || view.getUint32(0, true) !== MAGIC) throw new Error('bsc5.bin: bad magic');
  if (view.getUint32(4, true) !== 1) throw new Error('bsc5.bin: unknown version');
  const records = view.getUint32(8, true);
  if (buffer.byteLength !== HEADER_BYTES + records * RECORD_BYTES) throw new Error('bsc5.bin: bad length');
  let count = 0;
  for (let i = 0; i < records; i++) if (view.getInt16(HEADER_BYTES + i * RECORD_BYTES + 8, true) !== MISSING) count++;
  const cat = {
    count,
    hr: new Uint16Array(count),
    ra: new Float32Array(count),
    dec: new Float32Array(count),
    vmag: new Float32Array(count),
    bv: new Float32Array(count),
  };
  let n = 0;
  for (let i = 0; i < records; i++) {
    const o = HEADER_BYTES + i * RECORD_BYTES;
    const v = view.getInt16(o + 8, true);
    if (v === MISSING) continue;
    const bv = view.getInt16(o + 10, true);
    cat.hr[n] = i + 1;
    cat.ra[n] = view.getFloat32(o, true);
    cat.dec[n] = view.getFloat32(o + 4, true);
    cat.vmag[n] = v / 100;
    cat.bv[n] = bv === MISSING ? NaN : bv / 1000;
    n++;
  }
  return cat;
}

/** Index of the star with Bright Star number `hr`, or -1. */
export function starIndexByHR(cat: StarCatalog, hr: number): number {
  // Records are in HR order with a few gaps: start at hr - 1 and walk back.
  for (let i = Math.min(hr - 1, cat.count - 1); i >= 0; i--) {
    if (cat.hr[i] === hr) return i;
    if (cat.hr[i] < hr) break;
  }
  return -1;
}

/** J2000 equatorial unit vector (x = RA 0h, z = north celestial pole) of RA/Dec in rad, into `out`. */
export function equatorialVector(ra: number, dec: number, out: number[] | Float32Array = [0, 0, 0], offset = 0): number[] | Float32Array {
  const c = Math.cos(dec);
  out[offset] = c * Math.cos(ra);
  out[offset + 1] = c * Math.sin(ra);
  out[offset + 2] = Math.sin(dec);
  return out;
}

/** Effective temperature, K, from B-V (Ballesteros 2012, EPL 97 34008), as the NASA SVS star maps use. */
export function bvToTemperature(bv: number): number {
  const b = Math.min(Math.max(bv, -0.4), 2.0);
  return 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
}

/**
 * Linear-sRGB colour of a blackbody at `kelvin` (Planckian locus, Kim et al. 2002 cubic fit, 1667..25 000 K; CIE
 * XYZ -> linear sRGB, D65 white), negative channels clipped, normalised to luminance 1, into `out`.
 */
export function blackbodyRgb(kelvin: number, out: number[] = [0, 0, 0]): number[] {
  const t = Math.min(Math.max(kelvin, 1667), 25000);
  const t1 = 1e3 / t;
  const x =
    t <= 4000
      ? -0.2661239 * t1 ** 3 - 0.2343589 * t1 ** 2 + 0.8776956 * t1 + 0.17991
      : -3.0258469 * t1 ** 3 + 2.1070379 * t1 ** 2 + 0.2226347 * t1 + 0.24039;
  const y =
    t <= 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : t <= 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  const X = x / y;
  const Z = (1 - x - y) / y;
  const r = Math.max(0, 3.2406 * X - 1.5372 - 0.4986 * Z);
  const g = Math.max(0, -0.9689 * X + 1.8758 + 0.0415 * Z);
  const b = Math.max(0, 0.0557 * X - 0.204 + 1.057 * Z);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  out[0] = r / lum;
  out[1] = g / lum;
  out[2] = b / lum;
  return out;
}

/**
 * Share of a star's blackbody saturation kept (agent choice): the eye sees star colours as pale tints, and a full
 * blackbody colour makes the reddest M giants look orange-red; 0.75 keeps Betelgeuse and Antares clearly orange
 * and Rigel/Spica blue-white.
 */
export const STAR_SATURATION = 0.75;

/** Displayed linear-sRGB colour (luminance 1) of a star with colour index `bv`; NaN (no B-V) is white. */
export function starColour(bv: number, out: number[] = [0, 0, 0]): number[] {
  if (!Number.isFinite(bv)) {
    out[0] = out[1] = out[2] = 1;
    return out;
  }
  blackbodyRgb(bvToTemperature(bv), out);
  // Mixing toward (1, 1, 1) keeps luminance 1.
  for (let i = 0; i < 3; i++) out[i] = 1 + STAR_SATURATION * (out[i] - 1);
  return out;
}
