import { matrixPencil, type PencilResult } from './matrixPencil';
import { clamp } from '../../core/math';

/** Experimental forced-response front end. Fits a rolling ARX(2,2) model from
 * actual actuator/rate samples, then applies MPM to that model's impulse response.
 * This is input-output identification, NOT MPM of raw closed-loop output.
 * The model is SISO, so cross-axis motion/noise can bias it; adaptation is bounded.
 */
export class OnlinePencil {
  enabled = false;
  scale = 1;
  status = 'collecting';
  model: PencilResult | null = null;
  private samples: { y: number; u: number }[] = [];
  private time = 0;
  private inputSum = 0;
  private inputTime = 0;
  private count = 0;
  private reference = 0;
  private target = 1;
  reset(): void {
    this.samples = []; this.time = this.inputSum = this.inputTime = this.count = this.reference = 0;
    this.scale = this.target = 1; this.model = null; this.status = 'collecting';
  }
  update(dt: number, y: number, u: number): void {
    if (![dt, y, u].every(Number.isFinite) || dt <= 0) { this.reset(); this.status = 'invalid samples'; return; }
    this.scale += clamp((this.enabled ? this.target : 1)-this.scale, -0.02*dt, 0.02*dt);
    this.time += dt; this.inputSum += u*dt; this.inputTime += dt;
    if (this.time < 0.05-1e-9) return;
    // Supported simulation rates divide 20 Hz exactly. A different rate invalidates
    // the uniform-sampling assumption rather than silently fitting the wrong dt.
    if (Math.abs(this.time-0.05) > 1e-6) { this.reset(); this.status = 'unsupported sample rate'; return; }
    this.samples.push({ y, u: this.inputSum/this.inputTime });
    this.time = this.inputSum = this.inputTime = 0;
    if (this.samples.length > 160) this.samples.shift();
    if (++this.count%20 || this.samples.length < 160) return;
    this.fit();
  }
  private reject(reason: string): void { this.status = reason; this.model = null; this.target = 1; }
  private fit(): void {
    const data = this.samples;
    const records = data.slice(2).map((s, k) => ({ x: [data[k+1].y, data[k].y, s.u, data[k+1].u], y: s.y }));
    const train = records.slice(0, 120), check = records.slice(120);
    const means = [0, 1, 2, 3].map(j => train.reduce((sum, r) => sum+r.x[j], 0)/train.length);
    const meanY = train.reduce((sum, r) => sum+r.y, 0)/train.length;
    const scales = means.map((m, j) => Math.sqrt(train.reduce((sum, r) => sum+(r.x[j]-m)**2, 0)/train.length));
    if (Math.min(scales[2], scales[3]) < 0.003 || Math.min(scales[0], scales[1]) < 0.001)
      return this.reject('awaiting excitation');
    if (data.some(s => Math.abs(s.u) > 0.9)) return this.reject('actuator near limit');
    const matrix = Array.from({ length: 4 }, () => Array(5).fill(0) as number[]);
    for (const r of train) {
      const x = r.x.map((v, j) => (v-means[j])/scales[j]);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) matrix[i][j] += x[i]*x[j];
        matrix[i][4] += x[i]*(r.y-meanY);
      }
    }
    // Pivoted elimination, with a conditioning gate; do not fabricate a model
    // from a nearly constant actuator or redundant regressors.
    for (let i = 0; i < 4; i++) {
      let pivot = i;
      for (let j = i+1; j < 4; j++) if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
      if (Math.abs(matrix[pivot][i]) < 1e-5) return this.reject('ill-conditioned data');
      [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
      const divisor = matrix[i][i];
      for (let k = i; k <= 4; k++) matrix[i][k] /= divisor;
      for (let j = 0; j < 4; j++) if (j !== i) {
        const factor = matrix[j][i];
        for (let k = i; k <= 4; k++) matrix[j][k] -= factor*matrix[i][k];
      }
    }
    const coefficients = matrix.map((r, j) => r[4]/scales[j]);
    const bias = meanY-coefficients.reduce((sum, c, j) => sum+c*means[j], 0);
    const checkMean = check.reduce((sum, r) => sum+r.y, 0)/check.length;
    const error = check.reduce((sum, r) => sum+(r.y-bias-coefficients.reduce((v, c, j) => v+c*r.x[j], 0))**2, 0);
    const variance = check.reduce((sum, r) => sum+(r.y-checkMean)**2, 0);
    if (variance < 1e-6 || Math.sqrt(error/variance) > 0.15) return this.reject('prediction rejected');
    const [a1, a2, b1, b2] = coefficients;
    const impulse = [b1, a1*b1+b2];
    for (let i = 2; i < 80; i++) impulse.push(a1*impulse[i-1]+a2*impulse[i-2]);
    const model = matrixPencil(impulse, 0.05);
    if (!model || model.continuousPoles.some(p => p.re > -0.02 || p.re < -100) || model.retainedEnergy < 0.999)
      return this.reject('unresolved or unstable model');
    const authority = impulse.slice(0, 6).reduce((sum, v) => sum+v, 0);
    if (!Number.isFinite(authority) || authority <= 0.005) return this.reject('control authority rejected');
    this.reference ||= authority;
    this.target = clamp(this.reference/authority, 0.8, 1.2);
    this.model = model; this.status = this.enabled ? 'adapting' : 'observing';
  }
}
