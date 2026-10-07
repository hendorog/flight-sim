// Small discrete-time filters shared by the instrument models. All are exact discretisations, so they
// stay stable for any step size (the panel runs at the render rate, tests use large steps).

/** One step of a first-order lag toward `target` with time constant `tau` (s). */
export function lagStep(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/**
 * Damped second-order follower: models a mass on a spring in a viscous fluid, e.g. the inclinometer
 * ball in its kerosene-filled tube. Sub-steps internally so large dt stays stable.
 */
export class SecondOrder {
  value: number;
  private rate = 0;

  constructor(
    private readonly omega: number,
    private readonly zeta: number,
    initial = 0,
  ) {
    this.value = initial;
  }

  reset(value: number): void {
    this.value = value;
    this.rate = 0;
  }

  step(dt: number, target: number): number {
    const maxStep = 0.25 / this.omega;
    const n = Math.max(1, Math.ceil(dt / maxStep));
    const h = dt / n;
    const w2 = this.omega * this.omega;
    const c = 2 * this.zeta * this.omega;
    for (let i = 0; i < n; i++) {
      // Semi-implicit Euler: update velocity first, then position.
      this.rate += (w2 * (target - this.value) - c * this.rate) * h;
      this.value += this.rate * h;
    }
    return this.value;
  }
}
