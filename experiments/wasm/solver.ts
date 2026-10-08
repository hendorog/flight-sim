// Experimental f64 port of src/physics/aero/linalg.ts. Raw offsets avoid a managed
// object boundary. Retain the original LINPACK pivot convention and threshold.
export function factor(n: i32, a: usize, piv: usize): i32 {
  for (let k = 0; k < n; k++) {
    let p = k;
    let best = Math.abs(load<f64>(a + ((k * n + k) << 3)));
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(load<f64>(a + ((i * n + k) << 3)));
      if (v > best) { best = v; p = i; }
    }
    if (!(best > 1e-12)) return 0;
    store<i32>(piv + (k << 2), p);
    if (p != k) {
      for (let j = k; j < n; j++) {
        const x = a + ((k * n + j) << 3);
        const y = a + ((p * n + j) << 3);
        const t = load<f64>(x);
        store<f64>(x, load<f64>(y));
        store<f64>(y, t);
      }
    }
    const inv = 1 / load<f64>(a + ((k * n + k) << 3));
    for (let i = k + 1; i < n; i++) {
      const f = load<f64>(a + ((i * n + k) << 3)) * inv;
      store<f64>(a + ((i * n + k) << 3), f);
      if (f == 0) continue;
      for (let j = k + 1; j < n; j++) {
        const x = a + ((i * n + j) << 3);
        store<f64>(x, load<f64>(x) - f * load<f64>(a + ((k * n + j) << 3)));
      }
    }
  }
  return 1;
}

export function solve(n: i32, a: usize, piv: usize, b: usize): void {
  for (let k = 0; k < n; k++) {
    const p = load<i32>(piv + (k << 2));
    if (p != k) {
      const t = load<f64>(b + (k << 3));
      store<f64>(b + (k << 3), load<f64>(b + (p << 3)));
      store<f64>(b + (p << 3), t);
    }
    const bk = load<f64>(b + (k << 3));
    if (bk != 0) {
      for (let i = k + 1; i < n; i++) {
        const x = b + (i << 3);
        store<f64>(x, load<f64>(x) - load<f64>(a + ((i * n + k) << 3)) * bk);
      }
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = load<f64>(b + (i << 3));
    for (let j = i + 1; j < n; j++) s -= load<f64>(a + ((i * n + j) << 3)) * load<f64>(b + (j << 3));
    store<f64>(b + (i << 3), s / load<f64>(a + ((i * n + i) << 3)));
  }
}
