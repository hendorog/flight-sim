// Radix-2 complex FFT on separate real and imaginary Float64Arrays, in place, and its 2-D form on a row-major
// nx x ny grid (index i * ny + j). Node-safe; the twiddle and bit-reversal tables are cached per length.
// Forward: X_k = sum_n x_n exp(-2 pi i k n / N); inverse with exp(+...) and the 1/N factor.

interface Plan {
  n: number;
  cos: Float64Array;
  sin: Float64Array;
  rev: Uint32Array;
}

const plans = new Map<number, Plan>();

function plan(n: number): Plan {
  let p = plans.get(n);
  if (p) return p;
  if (n < 1 || (n & (n - 1)) !== 0) throw new Error(`fft: length ${n} is not a power of two`);
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    rev[i] = j;
  }
  p = { n, cos, sin, rev };
  plans.set(n, p);
  return p;
}

/** One 1-D transform of n points starting at `off` with `stride`; `sign` -1 forward, +1 inverse (unscaled). */
function fft1(re: Float64Array, im: Float64Array, off: number, stride: number, p: Plan, sign: number): void {
  const n = p.n;
  const rev = p.rev;
  for (let i = 1; i < n; i++) {
    const j = rev[i];
    if (i < j) {
      const a = off + i * stride;
      const b = off + j * stride;
      let t = re[a];
      re[a] = re[b];
      re[b] = t;
      t = im[a];
      im[a] = im[b];
      im[b] = t;
    }
  }
  const cos = p.cos;
  const sin = p.sin;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * step];
        const s = sign * sin[k * step];
        const a = off + (i + k) * stride;
        const b = a + half * stride;
        const xr = re[b] * c - im[b] * s;
        const xi = re[b] * s + im[b] * c;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/** In-place 1-D FFT of the whole arrays (length a power of two). `inverse` applies the 1/N factor. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const p = plan(re.length);
  fft1(re, im, 0, 1, p, inverse ? 1 : -1);
  if (inverse) {
    const s = 1 / re.length;
    for (let i = 0; i < re.length; i++) {
      re[i] *= s;
      im[i] *= s;
    }
  }
}

/** In-place 2-D FFT of an nx x ny row-major grid (both powers of two). `inverse` applies the 1/(nx ny) factor. */
export function fft2(re: Float64Array, im: Float64Array, nx: number, ny: number, inverse = false): void {
  const sign = inverse ? 1 : -1;
  const py = plan(ny);
  for (let i = 0; i < nx; i++) fft1(re, im, i * ny, 1, py, sign);
  const px = plan(nx);
  for (let j = 0; j < ny; j++) fft1(re, im, j, ny, px, sign);
  if (inverse) {
    const s = 1 / (nx * ny);
    for (let i = 0; i < nx * ny; i++) {
      re[i] *= s;
      im[i] *= s;
    }
  }
}

/** Signed wavenumber index of FFT bin p of n: p for p < n/2, p - n above (the Nyquist bin n/2 reads as -n/2). */
export function binIndex(p: number, n: number): number {
  return p < n / 2 ? p : p - n;
}
