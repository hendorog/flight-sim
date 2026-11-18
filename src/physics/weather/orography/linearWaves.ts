// Linear theory of stationary mountain waves in a layered atmosphere (Boussinesq, non-hydrostatic, no Coriolis),
// solved spectrally on a periodic nx x ny grid (x north, y east, spacing dx). Node-safe; pure function of its input.
//
// Terrain h = sum hhat exp(i(kx + ly)). In layer j (constant wind (U_j, V_j) and stability N_j) the displacement of
// a streamline is eta = A exp(i m z') + B exp(-i m z'), z' local to the layer, with the intrinsic frequency
// sigma_j = k U_j + l V_j - i nu (nu a Rayleigh damping, which also picks the radiating root) and
// m_j^2 = K^2 (N_j^2 / sigma_j^2 - 1), Im(m) > 0. The top layer carries only the upward (radiating or decaying)
// solution. At an interface eta and sigma^2 d(eta)/dz (the pressure) are continuous; the recursion runs from the top
// down and is normalised to eta(0) = hhat. A critical level (Re sigma changes sign between layers, or
// |Re sigma| < criticalSpeed K) absorbs the wave: the layer below it is treated as the top and the field above is 0.
// Fields: w = i Re(sigma) eta, (u, v) = i (k, l) (dw/dz) / K^2 (continuity). The mean (K = 0) and Nyquist modes are
// 0; wavelengths under minWavelength are removed, with a smooth taper up to 4/3 of it.
// Trapped lee waves come out of the layered solution (a Scorer parameter that falls with height); there is no
// separate model of them.

import { smoothstep } from '../../../core/math';
import { binIndex, fft2 } from './fft';

/** Most layers a background may have. */
export const MAX_WAVE_LAYERS = 12;

/** The background atmosphere: layers with constant wind and stability. */
export interface WaveLayers {
  count: number;
  /** Layer bottoms, m above the reference surface: bottom[0] = 0, strictly ascending. */
  bottom: Float64Array;
  /** Wind toward north and east, m/s. */
  U: Float64Array;
  V: Float64Array;
  /** Brunt-Vaisala frequency squared, 1/s^2. */
  N2: Float64Array;
}

export interface WaveOptions {
  /** Rayleigh damping, 1/s. */
  nu: number;
  /** Shortest wavelength kept, m (0 keeps all). */
  minWavelength: number;
  /** Wind component along the wave vector below which a layer is a critical level, m/s. */
  criticalSpeed: number;
}

/** Output field kinds. */
export const FIELD_ETA = 0;
export const FIELD_W = 1;
export const FIELD_U = 2;
export const FIELD_V = 3;

export function emptyWaveLayers(): WaveLayers {
  return {
    count: 0,
    bottom: new Float64Array(MAX_WAVE_LAYERS),
    U: new Float64Array(MAX_WAVE_LAYERS),
    V: new Float64Array(MAX_WAVE_LAYERS),
    N2: new Float64Array(MAX_WAVE_LAYERS),
  };
}

/**
 * The vertical structure of one Fourier mode: solve(k, l) runs the layer recursion for unit terrain amplitude,
 * at(z, out) gives eta and d(eta)/dz there (complex: out[0], out[1] = eta; out[2], out[3] = d eta/dz).
 */
export class ModeSolver {
  private readonly sr = new Float64Array(MAX_WAVE_LAYERS);
  private readonly mr = new Float64Array(MAX_WAVE_LAYERS);
  private readonly mi = new Float64Array(MAX_WAVE_LAYERS);
  private readonly ar = new Float64Array(MAX_WAVE_LAYERS);
  private readonly ai = new Float64Array(MAX_WAVE_LAYERS);
  private readonly br = new Float64Array(MAX_WAVE_LAYERS);
  private readonly bi = new Float64Array(MAX_WAVE_LAYERS);
  /** Height the local coordinate of each layer is measured from. */
  private readonly ref = new Float64Array(MAX_WAVE_LAYERS);
  /** Index of the layer carrying the radiating solution; -1 when the mode is 0. */
  top = -1;
  private layers: WaveLayers | null = null;

  /** Real part of sigma in layer j after solve(). */
  sigma(j: number): number {
    return this.sr[j];
  }

  /** Layer containing height z (z clamped to >= 0). */
  layerAt(z: number): number {
    const L = this.layers!;
    let j = L.count - 1;
    while (j > 0 && z < L.bottom[j]) j--;
    return j;
  }

  solve(k: number, l: number, L: WaveLayers, o: WaveOptions): boolean {
    this.layers = L;
    this.top = -1;
    const K2 = k * k + l * l;
    if (K2 === 0) return false;
    const K = Math.sqrt(K2);
    const n = L.count;
    const si = -o.nu;
    const thr = o.criticalSpeed * K;
    for (let j = 0; j < n; j++) this.sr[j] = k * L.U[j] + l * L.V[j];
    if (Math.abs(this.sr[0]) < thr) return false;
    let top = n - 1;
    for (let j = 1; j < n; j++) {
      if (Math.abs(this.sr[j]) < thr || this.sr[j] > 0 !== this.sr[j - 1] > 0) {
        top = j - 1;
        break;
      }
    }
    this.top = top;
    // Vertical wavenumbers: m^2 = K^2 (N^2 / sigma^2 - 1), the root with Im(m) >= 0. With nu > 0 the sign of Im(m^2)
    // (that of Re sigma) picks the branch. On the real axis (nu = 0, a propagating mode) the radiating root is the
    // one with sign(Re m) = sign(Re sigma): upward group velocity in both wind directions.
    for (let j = 0; j <= top; j++) {
      const sr = this.sr[j];
      const s2r = sr * sr - si * si;
      const s2i = 2 * sr * si;
      const d = s2r * s2r + s2i * s2i;
      const qr = K2 * ((L.N2[j] * s2r) / d - 1);
      const qi = K2 * ((-L.N2[j] * s2i) / d);
      const r = Math.hypot(qr, qi);
      let mr = Math.sqrt(Math.max(0, (r + qr) / 2));
      let mi = Math.sqrt(Math.max(0, (r - qr) / 2));
      if (qi < 0 || (qi === 0 && sr < 0)) mr = -mr;
      if (mi < 0) {
        mr = -mr;
        mi = -mi;
      }
      this.mr[j] = mr;
      this.mi[j] = mi;
    }
    // Top layer: eta = exp(i m (z - bottom)). E = eta, D = sigma^2 d(eta)/dz at the layer's bottom.
    this.ar[top] = 1;
    this.ai[top] = 0;
    this.br[top] = 0;
    this.bi[top] = 0;
    this.ref[top] = L.bottom[top];
    let Er = 1;
    let Ei = 0;
    // D = i sigma^2 m
    let s2r = this.sr[top] * this.sr[top] - si * si;
    let s2i = 2 * this.sr[top] * si;
    let pr = s2r * this.mr[top] - s2i * this.mi[top];
    let pi = s2r * this.mi[top] + s2i * this.mr[top];
    let Dr = -pi;
    let Di = pr;
    for (let j = top - 1; j >= 0; j--) {
      const sr = this.sr[j];
      s2r = sr * sr - si * si;
      s2i = 2 * sr * si;
      const mr = this.mr[j];
      const mi = this.mi[j];
      // c = i m sigma^2
      pr = s2r * mr - s2i * mi;
      pi = s2r * mi + s2i * mr;
      const cr = -pi;
      const ci = pr;
      // q = D / c
      const cd = cr * cr + ci * ci;
      const qr = (Dr * cr + Di * ci) / cd;
      const qi = (Di * cr - Dr * ci) / cd;
      const Ar = 0.5 * (Er + qr);
      const Ai = 0.5 * (Ei + qi);
      const Br = 0.5 * (Er - qr);
      const Bi = 0.5 * (Ei - qi);
      this.ar[j] = Ar;
      this.ai[j] = Ai;
      this.br[j] = Br;
      this.bi[j] = Bi;
      this.ref[j] = L.bottom[j + 1];
      // At the layer's bottom, z' = -thickness: e1 = exp(-i m t), e2 = exp(i m t).
      const t = L.bottom[j + 1] - L.bottom[j];
      const g1 = Math.exp(mi * t);
      const e1r = g1 * Math.cos(mr * t);
      const e1i = -g1 * Math.sin(mr * t);
      const g2 = Math.exp(-mi * t);
      const e2r = g2 * Math.cos(mr * t);
      const e2i = g2 * Math.sin(mr * t);
      const xr = Ar * e1r - Ai * e1i;
      const xi = Ar * e1i + Ai * e1r;
      const yr = Br * e2r - Bi * e2i;
      const yi = Br * e2i + Bi * e2r;
      Er = xr + yr;
      Ei = xi + yi;
      // D = c (x - y)
      const fr = xr - yr;
      const fi = xi - yi;
      Dr = cr * fr - ci * fi;
      Di = cr * fi + ci * fr;
    }
    // Normalise to eta(0) = 1.
    const e2 = Er * Er + Ei * Ei;
    if (!(e2 > 0) || !Number.isFinite(e2)) {
      this.top = -1;
      return false;
    }
    const nr = Er / e2;
    const ni = -Ei / e2;
    for (let j = 0; j <= top; j++) {
      const a = this.ar[j];
      const b = this.br[j];
      this.ar[j] = a * nr - this.ai[j] * ni;
      this.ai[j] = a * ni + this.ai[j] * nr;
      this.br[j] = b * nr - this.bi[j] * ni;
      this.bi[j] = b * ni + this.bi[j] * nr;
    }
    return true;
  }

  /** eta and d eta/dz at height z for unit terrain amplitude; returns the layer index used (-1: zero). */
  at(z: number, out: Float64Array): number {
    out[0] = out[1] = out[2] = out[3] = 0;
    if (this.top < 0) return -1;
    const j = this.layerAt(Math.max(0, z));
    if (j > this.top) return -1;
    const zz = Math.max(0, z) - this.ref[j];
    const mr = this.mr[j];
    const mi = this.mi[j];
    // e1 = exp(i m z'), e2 = exp(-i m z')
    const g1 = Math.exp(-mi * zz);
    const e1r = g1 * Math.cos(mr * zz);
    const e1i = g1 * Math.sin(mr * zz);
    let xr = this.ar[j] * e1r - this.ai[j] * e1i;
    let xi = this.ar[j] * e1i + this.ai[j] * e1r;
    let yr = 0;
    let yi = 0;
    if (this.br[j] !== 0 || this.bi[j] !== 0) {
      const g2 = Math.exp(mi * zz);
      const e2r = g2 * Math.cos(mr * zz);
      const e2i = -g2 * Math.sin(mr * zz);
      yr = this.br[j] * e2r - this.bi[j] * e2i;
      yi = this.br[j] * e2i + this.bi[j] * e2r;
    }
    out[0] = xr + yr;
    out[1] = xi + yi;
    // d eta/dz = i m (x - y)
    xr -= yr;
    xi -= yi;
    out[2] = -(mr * xi + mi * xr);
    out[3] = mr * xr - mi * xi;
    return j;
  }
}

/** One requested output: a field kind at a height, with an amplitude factor (the density scaling). */
export interface WaveRequest {
  /** Heights above the reference surface, m. */
  levels: Float64Array;
  /** Amplitude factor per level (sqrt(rho_ref / rho(z)) in the orography tiles; 1 in the analytic tests). */
  scale: Float64Array;
  /** Field kinds per level (FIELD_*), in output order. */
  kinds: readonly number[];
}

interface Scratch {
  size: number;
  re: Float64Array;
  im: Float64Array;
  hr: Float64Array;
  hi: Float64Array;
  /** Half-plane spectra of every output field, float32 (re, im interleaved). */
  spec: Float32Array;
}

let scratch: Scratch | null = null;

function scratchFor(nx: number, ny: number, fields: number): Scratch {
  const size = nx * ny;
  const specLen = fields * nx * (ny / 2) * 2;
  if (!scratch || scratch.size !== size || scratch.spec.length < specLen) {
    scratch = {
      size,
      re: new Float64Array(size),
      im: new Float64Array(size),
      hr: new Float64Array(size),
      hi: new Float64Array(size),
      spec: new Float32Array(specLen),
    };
  }
  return scratch;
}

/** Release the solver's scratch buffers (they are kept between solves of the same grid size). */
export function releaseWaveScratch(): void {
  scratch = null;
}

const _mode = new ModeSolver();
const _at = new Float64Array(4);

/**
 * Solve for the wave fields over terrain `h` (nx * ny, row-major, x = row = north, y = column = east, spacing dx).
 * For each level and kind, `emit(f, grid)` receives the real field (index f = level * kinds.length + kind index;
 * `grid` is a scratch nx * ny array valid only during the call). nx and ny must be powers of two.
 */
export function solveWaveGrid(
  nx: number,
  ny: number,
  dx: number,
  h: Float64Array,
  layers: WaveLayers,
  req: WaveRequest,
  o: WaveOptions,
  emit: (f: number, grid: Float64Array) => void,
): void {
  const nk = req.kinds.length;
  const nf = req.levels.length * nk;
  const s = scratchFor(nx, ny, nf);
  const { hr, hi, re, im, spec } = s;
  hr.set(h);
  hi.fill(0);
  fft2(hr, hi, nx, ny);
  const half = ny / 2;
  const modes = nx * half;
  spec.fill(0, 0, nf * modes * 2);
  const kmin = o.minWavelength > 0 ? (2 * Math.PI) / ((4 / 3) * o.minWavelength) : Infinity;
  const kmax = o.minWavelength > 0 ? (2 * Math.PI) / o.minWavelength : Infinity;
  const dkx = (2 * Math.PI) / (nx * dx);
  const dky = (2 * Math.PI) / (ny * dx);
  // Half plane: columns q in [0, ny/2) (q = ny/2 is the Nyquist column, 0); in column 0 only rows p <= nx/2.
  for (let p = 0; p < nx; p++) {
    if (p === nx / 2) continue;
    const k = binIndex(p, nx) * dkx;
    for (let q = 0; q < half; q++) {
      if (q === 0 && p > nx / 2) continue;
      const l = q * dky;
      const K = Math.hypot(k, l);
      if (K === 0) continue;
      const taper = o.minWavelength > 0 ? 1 - smoothstep(kmin, kmax, K) : 1;
      if (taper === 0) continue;
      const idx = p * ny + q;
      const h0r = hr[idx] * taper;
      const h0i = hi[idx] * taper;
      if (h0r === 0 && h0i === 0) continue;
      if (!_mode.solve(k, l, layers, o)) continue;
      const K2 = K * K;
      const mIdx = p * half + q;
      for (let li = 0; li < req.levels.length; li++) {
        const j = _mode.at(req.levels[li], _at);
        if (j < 0) continue;
        const sc = req.scale[li];
        // eta and eta' times hhat
        const er = (_at[0] * h0r - _at[1] * h0i) * sc;
        const ei = (_at[0] * h0i + _at[1] * h0r) * sc;
        const dr = (_at[2] * h0r - _at[3] * h0i) * sc;
        const di = (_at[2] * h0i + _at[3] * h0r) * sc;
        const sr = _mode.sigma(j);
        for (let ki = 0; ki < nk; ki++) {
          const kind = req.kinds[ki];
          let vr: number;
          let vi: number;
          if (kind === FIELD_ETA) {
            vr = er;
            vi = ei;
          } else if (kind === FIELD_W) {
            // i sigma eta
            vr = -sr * ei;
            vi = sr * er;
          } else {
            // (u, v) = i (k, l) (i sigma eta') / K^2 = -(k, l) sigma eta' / K^2
            const c = (-(kind === FIELD_U ? k : l) * sr) / K2;
            vr = c * dr;
            vi = c * di;
          }
          const o2 = ((li * nk + ki) * modes + mIdx) * 2;
          spec[o2] = vr;
          spec[o2 + 1] = vi;
        }
      }
    }
  }
  // Inverse transforms, two real fields per complex transform: S = A + i B, with the conjugate-symmetric partner
  // S(-k) = conj(A(k)) + i conj(B(k)).
  for (let f = 0; f < nf; f += 2) {
    const g = f + 1 < nf ? f + 1 : -1;
    re.fill(0);
    im.fill(0);
    for (let p = 0; p < nx; p++) {
      if (p === nx / 2) continue;
      for (let q = 0; q < half; q++) {
        if (q === 0 && p > nx / 2) continue;
        const mIdx = p * half + q;
        const oa = (f * modes + mIdx) * 2;
        const ar = spec[oa];
        const ai = spec[oa + 1];
        let br = 0;
        let bi = 0;
        if (g >= 0) {
          const ob = (g * modes + mIdx) * 2;
          br = spec[ob];
          bi = spec[ob + 1];
        }
        if (ar === 0 && ai === 0 && br === 0 && bi === 0) continue;
        const idx = p * ny + q;
        re[idx] = ar - bi;
        im[idx] = ai + br;
        const pp = p === 0 ? 0 : nx - p;
        const qq = q === 0 ? 0 : ny - q;
        if (pp === p && qq === q) continue;
        const jdx = pp * ny + qq;
        re[jdx] = ar + bi;
        im[jdx] = br - ai;
      }
    }
    fft2(re, im, nx, ny, true);
    emit(f, re);
    if (g >= 0) emit(g, im);
  }
}
