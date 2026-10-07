// Welch power-spectral-density estimate for the turbulence tests.

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const ai = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
      }
    }
  }
}

/**
 * One-sided PSD in angular wavenumber (units^2 per rad/m) of samples spaced `dx` metres apart, averaged over
 * Hann-windowed segments of length `segment` with 50 % overlap. Returns wavenumbers and densities for bins 1..segment/2-1.
 */
export function welchPsd(x: Float64Array, dx: number, segment: number): { k: number[]; psd: number[] } {
  const win = new Float64Array(segment);
  let wss = 0;
  for (let i = 0; i < segment; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / segment);
    wss += win[i] * win[i];
  }
  const acc = new Float64Array(segment / 2);
  let count = 0;
  for (let start = 0; start + segment <= x.length; start += segment / 2) {
    const re = new Float64Array(segment);
    const im = new Float64Array(segment);
    let mean = 0;
    for (let i = 0; i < segment; i++) mean += x[start + i];
    mean /= segment;
    for (let i = 0; i < segment; i++) re[i] = (x[start + i] - mean) * win[i];
    fft(re, im);
    for (let i = 1; i < segment / 2; i++) acc[i] += re[i] * re[i] + im[i] * im[i];
    count++;
  }
  // Two-sided periodogram |X|^2 dx / (sum w^2) per cycle/m, folded to one side (x2), converted to per rad/m (/2 pi).
  const scale = (2 * dx) / (wss * count) / (2 * Math.PI);
  const k: number[] = [];
  const psd: number[] = [];
  for (let i = 1; i < segment / 2; i++) {
    k.push((2 * Math.PI * i) / (segment * dx));
    psd.push(acc[i] * scale);
  }
  return { k, psd };
}
