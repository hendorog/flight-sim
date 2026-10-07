// CPU evaluation of the sky model (Hillaire 2020), a port of glsl/atmosphere.ts and glsl/luts.ts:
// transmittance and multiple-scattering tables plus direct integration of the in-scattered radiance.
// It gives the CPU the sky ambient (ctx.sky.skyColor) and horizon colour (hazeColor) without reading
// anything back from the GPU: in Chrome every WebGL read-back is a synchronous round trip to the GPU
// process that waits for its queue to drain (~20 ms under load), even behind a fence.
//
// Units as in the GPU code: km, 1/km, planet centre at the origin, +y up. Pure: runs in node too.

import { ATMOSPHERE_TOP_KM, EARTH_RADIUS_KM, SUN_ANGULAR_RADIUS, type AtmosphereParams } from './params';

const RB = EARTH_RADIUS_KM;
const RT = ATMOSPHERE_TOP_KM;
const H_TOP = Math.sqrt(RT * RT - RB * RB);
const T_W = 128;
const T_H = 48;
const MS_N = 32;
const INV_4PI = 1 / (4 * Math.PI);

/** Summary integration: polar bands of the upper hemisphere and azimuth samples per half circle (the
 * sky is symmetric about the vertical plane through the light). */
export const SUMMARY_BANDS = 8;
const AZ_HALF = 8;
const SKY_STEPS = 32;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

function distanceToTop(r: number, mu: number): number {
  return Math.max(0, -r * mu + Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + RT * RT)));
}
function distanceToGround(r: number, mu: number): number {
  return Math.max(0, -r * mu - Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + RB * RB)));
}
function rayHitsGround(r: number, mu: number): boolean {
  return mu < 0 && r * r * (mu * mu - 1) + RB * RB >= 0;
}
function planetShadow(r: number, mu: number): number {
  const sinHorizon = RB / r;
  const muHorizon = -Math.sqrt(Math.max(0, 1 - sinHorizon * sinHorizon));
  return smoothstep(-SUN_ANGULAR_RADIUS, SUN_ANGULAR_RADIUS, (mu - muHorizon) / sinHorizon);
}
function phaseRayleigh(c: number): number {
  return (3 / (16 * Math.PI)) * (1 + c * c);
}
function phaseMie(c: number, g: number): number {
  const k = ((3 / (8 * Math.PI)) * (1 - g * g)) / (2 + g * g);
  return (k * (1 + c * c)) / Math.pow(Math.max(1e-4, 1 + g * g - 2 * g * c), 1.5);
}

/** Per-frame sky summary: cosine-weighted radiance of each polar band and the horizon ring. */
export interface SkyBands {
  /** Mean radiance of band i (polar angle ((i + 0.5) / SUMMARY_BANDS) * 90 deg), linear RGB, 3 per band. */
  readonly band: Float64Array;
  /** Weight of band i in the cosine-weighted hemisphere mean (sums to 1). */
  readonly weight: Float64Array;
  /** Cosine of the polar angle (sine of the elevation) of band i. */
  readonly mu: Float64Array;
  /** Mean radiance of the horizontal ring, linear RGB. */
  readonly horizon: Float64Array;
}

export function createSkyBands(): SkyBands {
  const weight = new Float64Array(SUMMARY_BANDS);
  const mu = new Float64Array(SUMMARY_BANDS);
  for (let i = 0; i < SUMMARY_BANDS; i++) {
    const theta = ((i + 0.5) / SUMMARY_BANDS) * 0.5 * Math.PI;
    // Irradiance / PI: integral of L cos(theta) sin(theta) dtheta dphi / PI, midpoint rule as on the GPU.
    weight[i] = (Math.cos(theta) * Math.sin(theta) * (0.5 * Math.PI) / SUMMARY_BANDS) * 2;
    mu[i] = Math.cos(theta);
  }
  return { band: new Float64Array(3 * SUMMARY_BANDS), weight, mu, horizon: new Float64Array(3) };
}

export class CpuSky {
  private p: AtmosphereParams | null = null;
  private readonly trans = new Float32Array(T_W * T_H * 3);
  private readonly ms = new Float32Array(MS_N * MS_N * 3);
  private readonly t3 = new Float64Array(3);
  private readonly m3 = new Float64Array(3);
  private readonly acc = new Float64Array(3);

  /** Rebuild the tables for new atmosphere parameters (a no-op for the same object). ~20-40 ms. */
  setParams(p: AtmosphereParams): void {
    if (p === this.p) return;
    this.p = p;
    this.buildTransmittance();
    this.buildMultiScatter();
  }

  get params(): AtmosphereParams | null {
    return this.p;
  }

  private extinction(h: number, c: number): number {
    const p = this.p!;
    return (
      p.rayleighScattering[c] * Math.exp(-h / p.rayleighScaleHeight) +
      p.mieExtinction[c] * Math.exp(-h / p.mieScaleHeight) +
      p.ozoneAbsorption[c] * Math.max(0, 1 - Math.abs(h - 25) / 15)
    );
  }

  private buildTransmittance(): void {
    const STEPS = 40;
    for (let j = 0; j < T_H; j++) {
      const rho = (H_TOP * j) / (T_H - 1);
      const r = Math.sqrt(rho * rho + RB * RB);
      const dMin = RT - r;
      const dMax = rho + H_TOP;
      for (let i = 0; i < T_W; i++) {
        const d = dMin + (i / (T_W - 1)) * (dMax - dMin);
        const mu = d === 0 ? 1 : Math.min(1, Math.max(-1, (H_TOP * H_TOP - rho * rho - d * d) / (2 * r * d)));
        // Quadratically spaced segments, as on the GPU (glsl/luts.ts).
        const tMax = distanceToTop(r, mu);
        let o0 = 0;
        let o1 = 0;
        let o2 = 0;
        let tPrev = 0;
        for (let k = 0; k < STEPS; k++) {
          const u = (k + 1) / STEPS;
          const tNext = tMax * u * u;
          const dt = tNext - tPrev;
          const t = tPrev + 0.5 * dt;
          tPrev = tNext;
          const h = Math.sqrt(r * r + t * t + 2 * r * mu * t) - RB;
          o0 += this.extinction(h, 0) * dt;
          o1 += this.extinction(h, 1) * dt;
          o2 += this.extinction(h, 2) * dt;
        }
        const o = 3 * (j * T_W + i);
        this.trans[o] = Math.exp(-o0);
        this.trans[o + 1] = Math.exp(-o1);
        this.trans[o + 2] = Math.exp(-o2);
      }
    }
  }

  /** Transmittance from radius r to space along cos-zenith mu (planet excluded), into out[0..2]. */
  transmittance(r: number, mu: number, out: Float64Array): Float64Array {
    const rho = Math.sqrt(Math.max(0, r * r - RB * RB));
    const d = distanceToTop(r, mu);
    const dMin = RT - r;
    const dMax = rho + H_TOP;
    const x = Math.min(Math.max((d - dMin) / (dMax - dMin), 0), 1) * (T_W - 1);
    const y = Math.min(Math.max(rho / H_TOP, 0), 1) * (T_H - 1);
    return bilinear(this.trans, T_W, T_H, x, y, out);
  }

  private multiScatter(r: number, muL: number, out: Float64Array): Float64Array {
    const x = Math.min(Math.max(muL * 0.5 + 0.5, 0), 1) * (MS_N - 1);
    const y = Math.min(Math.max((r - RB) / (RT - RB), 0), 1) * (MS_N - 1);
    return bilinear(this.ms, MS_N, MS_N, x, y, out);
  }

  private buildMultiScatter(): void {
    const p = this.p!;
    const STEPS = 20;
    const t3 = this.t3;
    for (let j = 0; j < MS_N; j++) {
      const r = RB + Math.max(j / (MS_N - 1), 1e-4) * (RT - RB);
      for (let i = 0; i < MS_N; i++) {
        const muL = (i / (MS_N - 1)) * 2 - 1;
        const lx = Math.sqrt(Math.max(0, 1 - muL * muL));
        const lum = [0, 0, 0];
        const fms = [0, 0, 0];
        for (let a = 0; a < 8; a++) {
          for (let b = 0; b < 8; b++) {
            const cosT = 1 - (2 * (b + 0.5)) / 8;
            const sinT = Math.sqrt(1 - cosT * cosT);
            const phi = (2 * Math.PI * (a + 0.5)) / 8;
            const dx = sinT * Math.cos(phi);
            const dy = cosT;
            const ground = rayHitsGround(r, dy);
            const tMax = ground ? distanceToGround(r, dy) : distanceToTop(r, dy);
            const thr = [1, 1, 1];
            let tPrev = 0;
            for (let k = 0; k < STEPS; k++) {
              const u = (k + 1) / STEPS;
              const tNext = tMax * u * u;
              const dt = tNext - tPrev;
              const t = tPrev + 0.3 * dt;
              tPrev = tNext;
              const px = dx * t;
              const py = r + dy * t;
              const pz = sinT * Math.sin(phi) * t;
              const pr = Math.sqrt(px * px + py * py + pz * pz);
              const h = pr - RB;
              const dR = Math.exp(-h / p.rayleighScaleHeight);
              const dM = Math.exp(-h / p.mieScaleHeight);
              const dO = Math.max(0, 1 - Math.abs(h - 25) / 15);
              const pMuL = (px * lx + py * muL) / pr;
              this.transmittance(pr, pMuL, t3);
              const shadow = planetShadow(pr, pMuL);
              for (let c = 0; c < 3; c++) {
                const scat = p.rayleighScattering[c] * dR + p.mieScattering[c] * dM;
                const ext = Math.max(p.rayleighScattering[c] * dR + p.mieExtinction[c] * dM + p.ozoneAbsorption[c] * dO, 1e-9);
                const s = scat * t3[c] * shadow * INV_4PI;
                const stepT = Math.exp(-ext * dt);
                lum[c] += (thr[c] * (s - s * stepT)) / ext;
                fms[c] += (thr[c] * (scat - scat * stepT)) / ext;
                thr[c] *= stepT;
              }
            }
            if (ground) {
              const gx = dx * tMax;
              const gy = r + dy * tMax;
              const gz = sinT * Math.sin(phi) * tMax;
              const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
              const nl = (gx * lx + gy * muL) / gl;
              this.transmittance(RB, nl, t3);
              for (let c = 0; c < 3; c++) lum[c] += (thr[c] * t3[c] * Math.max(nl, 0) * p.groundAlbedo[c]) / Math.PI;
            }
          }
        }
        const o = 3 * (j * MS_N + i);
        for (let c = 0; c < 3; c++) this.ms[o + c] = lum[c] / 64 / (1 - fms[c] / 64);
      }
    }
  }

  /**
   * In-scattered radiance toward (dx, dy, dz) from a camera at radius r, lit by one light with direction
   * (lx, ly, 0) and top-of-atmosphere illuminance e; ADDS scale x radiance into out[0..2].
   */
  private addRadiance(r: number, dx: number, dy: number, dz: number, lx: number, ly: number, e: ArrayLike<number>, scale: number, out: Float64Array): void {
    const p = this.p!;
    const tMax = rayHitsGround(r, dy) ? distanceToGround(r, dy) : distanceToTop(r, dy);
    const c0 = dx * lx + dy * ly;
    const pr0 = phaseRayleigh(c0);
    const pm0 = phaseMie(c0, p.mieG);
    const t3 = this.t3;
    const m3 = this.m3;
    let th0 = 1;
    let th1 = 1;
    let th2 = 1;
    let tPrev = 0;
    for (let k = 0; k < SKY_STEPS; k++) {
      // Quadratically spaced segments, as integrateScattering on the GPU.
      const u = (k + 1) / SKY_STEPS;
      const tNext = tMax * u * u;
      const dt = tNext - tPrev;
      const t = tPrev + 0.3 * dt;
      tPrev = tNext;
      const px = dx * t;
      const py = r + dy * t;
      const pz = dz * t;
      const pr = Math.sqrt(px * px + py * py + pz * pz);
      const h = pr - RB;
      const dR = Math.exp(-h / p.rayleighScaleHeight);
      const dM = Math.exp(-h / p.mieScaleHeight);
      const dO = Math.max(0, 1 - Math.abs(h - 25) / 15);
      const muL = (px * lx + py * ly) / pr;
      this.transmittance(pr, muL, t3);
      const shadow = planetShadow(pr, muL);
      this.multiScatter(pr, muL, m3);
      for (let c = 0; c < 3; c++) {
        const sR = p.rayleighScattering[c] * dR;
        const sM = p.mieScattering[c] * dM;
        const ext = Math.max(sR + p.mieExtinction[c] * dM + p.ozoneAbsorption[c] * dO, 1e-9);
        const s = e[c] * (t3[c] * shadow * (sR * pr0 + sM * pm0) + m3[c] * (sR + sM));
        const stepT = Math.exp(-ext * dt);
        const th = c === 0 ? th0 : c === 1 ? th1 : th2;
        out[c] += (scale * th * (s - s * stepT)) / ext;
        if (c === 0) th0 *= stepT;
        else if (c === 1) th1 *= stepT;
        else th2 *= stepT;
      }
    }
  }

  /**
   * Radiance of the clear sky toward a direction (unit, +y up) for a camera at altitude altKm, lit by one
   * light (unit direction, top-of-atmosphere illuminance rgb). Into out[0..2].
   */
  radiance(altKm: number, dir: readonly [number, number, number], light: readonly [number, number, number], e: ArrayLike<number>, out: Float64Array): Float64Array {
    out.fill(0);
    const r = RB + Math.max(altKm, 0.002);
    // Rotate about y so the light lies in the x-y plane, as the sky-view LUT does.
    const lh = Math.hypot(light[0], light[2]);
    const dh = Math.hypot(dir[0], dir[2]);
    const cosAz = lh > 1e-9 && dh > 1e-9 ? (dir[0] * light[0] + dir[2] * light[2]) / (lh * dh) : 1;
    const sinAz = Math.sqrt(Math.max(0, 1 - cosAz * cosAz));
    this.addRadiance(r, dh * cosAz, dir[1], dh * sinAz, Math.sqrt(Math.max(0, 1 - light[1] * light[1])), light[1], e, 1, out);
    return out;
  }

  /**
   * ADD the sky lit by one light (sine of elevation `lightMu`, top-of-atmosphere illuminance `e`) seen
   * from altitude altKm into `bands`: per-band mean radiance over azimuth, and the horizontal ring.
   */
  addSummary(altKm: number, lightMu: number, e: ArrayLike<number>, bands: SkyBands): void {
    for (let i = 0; i <= SUMMARY_BANDS; i++) this.addSummaryRing(altKm, lightMu, e, bands, i);
  }

  /** One ring of addSummary: band `ring` (0..SUMMARY_BANDS-1) or the horizon (SUMMARY_BANDS). */
  addSummaryRing(altKm: number, lightMu: number, e: ArrayLike<number>, bands: SkyBands, ring: number): void {
    const r = RB + Math.max(altKm, 0.002);
    const ly = Math.min(Math.max(lightMu, -1), 1);
    const lx = Math.sqrt(Math.max(0, 1 - ly * ly));
    const acc = this.acc;
    const horizon = ring >= SUMMARY_BANDS;
    const theta = horizon ? 0.5 * Math.PI : ((ring + 0.5) / SUMMARY_BANDS) * 0.5 * Math.PI;
    const st = Math.sin(theta);
    const ct = horizon ? 0 : Math.cos(theta);
    acc.fill(0);
    for (let j = 0; j < AZ_HALF; j++) {
      const phi = ((j + 0.5) / (2 * AZ_HALF)) * 2 * Math.PI;
      this.addRadiance(r, st * Math.cos(phi), ct, st * Math.sin(phi), lx, ly, e, 1 / AZ_HALF, acc);
    }
    const out = horizon ? bands.horizon : bands.band;
    const o = horizon ? 0 : 3 * ring;
    out[o] += acc[0];
    out[o + 1] += acc[1];
    out[o + 2] += acc[2];
  }
}

function bilinear(table: Float32Array, w: number, h: number, x: number, y: number, out: Float64Array): Float64Array {
  const x0 = Math.min(Math.floor(x), w - 2);
  const y0 = Math.min(Math.floor(y), h - 2);
  const fx = x - x0;
  const fy = y - y0;
  const a = 3 * (y0 * w + x0);
  const b = a + 3;
  const c = a + 3 * w;
  const d = c + 3;
  for (let k = 0; k < 3; k++) {
    const top = table[a + k] + (table[b + k] - table[a + k]) * fx;
    const bot = table[c + k] + (table[d + k] - table[c + k]) * fx;
    out[k] = top + (bot - top) * fy;
  }
  return out;
}
