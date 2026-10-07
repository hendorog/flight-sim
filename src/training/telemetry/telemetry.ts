// Telemetry: the registry of named signals (section 2.3). Providers convert the SI flight-model state,
// the instrument readings and the controls into pilot units in one SignalFrame per run, mutated in place
// once per rendered frame. Telemetry itself owns the per-step signals (`step.*`, reset by markStep()) and a
// filtered rate per signal (time constant SignalDef.rateTau) for the coach's "already correcting" test.
// Later steps add providers (avionics 'xpdr', 'com') with addProvider; the engine never names them.
//
// Paused sim time (dt 0: pause, briefing, the curtain during a reposition) integrates nothing, and the rate
// filters re-seed their previous value from the frame instead of differentiating it: a teleport behind the
// curtain therefore never shows as a rate spike or a turn in step.turnDeg.

import { VAR_SIGNAL_PREFIX } from '../engine/refs';
import { wrap180 } from '../geo/angles';
import type { SignalDef, SignalFrame, SignalId, SignalProvider, TelemetrySources } from '../types';
import { defineSignals } from './providers/define';
import { createCoreProvider } from './providers/core';
import { createGeoProvider } from './providers/geo';
import { createNavProvider } from './providers/nav';
import { createTaxiProvider } from './providers/taxi';

/** Rate filter time constant for signals whose definition gives none, s. */
export const DEFAULT_RATE_TAU_S = 1;

/** The per-step signals Telemetry maintains itself (zeroed by markStep()). */
export const STEP_SIGNALS: readonly SignalDef[] = defineSignals([
  ['step.t', 'number', 's', 0, 'Sim time since step entry'],
  ['step.turnDeg', 'number', 'deg', 0, 'Signed heading change since step entry, + right (integrated, can exceed 360)'],
  ['step.altChangeFt', 'number', 'ft', 0, 'Altimeter change since step entry, + up'],
  ['step.maxBankAbsDeg', 'number', 'deg', 0, 'Largest bank either way since step entry'],
]);

interface RateFilter {
  prev: number;
  rate: number;
  tau: number;
  angle: boolean;
}

export class Telemetry {
  /** The run's frame: one object, mutated in place by sample(). */
  readonly frame: SignalFrame = {};

  private readonly providers: SignalProvider[] = [];
  private readonly defsById = new Map<SignalId, SignalDef>();
  private readonly rates = new Map<SignalId, RateFilter>();
  /** step.* state: the altimeter at step entry (NaN until the first sample after markStep) and the last heading. */
  private stepAlt0 = NaN;
  private lastHdg = NaN;

  /** Default providers: core, geo, nav and taxi (createCoreProvider/createGeoProvider/createNavProvider/createTaxiProvider). */
  constructor(providers?: readonly SignalProvider[]) {
    for (const d of STEP_SIGNALS) this.register(d);
    for (const p of providers ?? [createCoreProvider(), createGeoProvider(), createNavProvider(), createTaxiProvider()]) this.addProvider(p);
    this.markStep();
  }

  /** Register a provider; its signal ids must not collide with existing ones (throws). */
  addProvider(p: SignalProvider): void {
    for (const d of p.defs) {
      if (this.defsById.has(d.id)) throw new Error(`Telemetry: signal '${d.id}' of provider '${p.id}' is already defined`);
      if (d.id.startsWith(VAR_SIGNAL_PREFIX)) throw new Error(`Telemetry: '${VAR_SIGNAL_PREFIX}' is reserved for run variables ('${d.id}')`);
    }
    if (this.providers.some((q) => q.id === p.id)) throw new Error(`Telemetry: provider '${p.id}' is already registered`);
    this.providers.push(p);
    for (const d of p.defs) {
      this.register(d);
      this.frame[d.id] = d.kind === 'bool' ? false : d.kind === 'enum' ? '' : NaN;
    }
  }

  /** Definition of a signal, or undefined for an unknown id. */
  def(id: SignalId): SignalDef | undefined {
    return this.defsById.get(id);
  }

  /** Every registered signal definition (the linter checks lesson signal ids against these). */
  defs(): readonly SignalDef[] {
    return [...this.defsById.values()];
  }

  /** Sample every provider, update step.* and the filtered rates. `dt` is sim time (0 while paused). */
  sample(src: TelemetrySources, dt: number): SignalFrame {
    const f = this.frame;
    const h = dt > 0 && Number.isFinite(dt) ? dt : 0;
    for (const p of this.providers) p.sample(f, src, h);
    this.updateStep(h);
    this.updateRates(h);
    return f;
  }

  /** Step entry: zero step.t, step.turnDeg, step.altChangeFt, step.maxBankAbsDeg. */
  markStep(): void {
    const f = this.frame;
    f['step.t'] = 0;
    f['step.turnDeg'] = 0;
    f['step.altChangeFt'] = 0;
    f['step.maxBankAbsDeg'] = 0;
    const alt = f.altFt;
    this.stepAlt0 = typeof alt === 'number' ? alt : NaN;
  }

  /** Filtered d/dt of a numeric signal (per second, angles unwrapped); 0 for unknown or non-numeric ids. */
  rate(id: SignalId): number {
    return this.rates.get(id)?.rate ?? 0;
  }

  /**
   * Forget every value, rate and step reference (a new run on the same instance). Providers keep their own
   * state (the circuit leg, the nav sequence), so a new run normally builds a new Telemetry instead.
   */
  reset(): void {
    for (const d of this.defsById.values()) this.frame[d.id] = d.kind === 'bool' ? false : d.kind === 'enum' ? '' : NaN;
    for (const r of this.rates.values()) {
      r.prev = NaN;
      r.rate = 0;
    }
    this.lastHdg = NaN;
    this.markStep();
  }

  private register(d: SignalDef): void {
    this.defsById.set(d.id, d);
    if (d.kind === 'number' || d.kind === 'angle') {
      this.rates.set(d.id, { prev: NaN, rate: 0, tau: d.rateTau ?? DEFAULT_RATE_TAU_S, angle: d.kind === 'angle' });
    }
  }

  private updateStep(dt: number): void {
    const f = this.frame;
    const alt = f.altFt;
    const hdg = f.hdgTrueDeg;
    const bank = f.bankDeg;
    if (typeof alt === 'number' && Number.isNaN(this.stepAlt0)) this.stepAlt0 = alt;
    if (dt > 0) {
      f['step.t'] = (f['step.t'] as number) + dt;
      // The true heading, not the DG: a clearing turn counts the turn flown, whatever the gyro drift does.
      if (typeof hdg === 'number' && Number.isFinite(this.lastHdg)) f['step.turnDeg'] = (f['step.turnDeg'] as number) + wrap180(hdg - this.lastHdg);
      if (typeof bank === 'number' && Math.abs(bank) > (f['step.maxBankAbsDeg'] as number)) f['step.maxBankAbsDeg'] = Math.abs(bank);
    }
    this.lastHdg = typeof hdg === 'number' ? hdg : NaN;
    f['step.altChangeFt'] = typeof alt === 'number' ? alt - this.stepAlt0 : NaN;
  }

  private updateRates(dt: number): void {
    const f = this.frame;
    for (const [id, r] of this.rates) {
      const x = f[id];
      if (typeof x !== 'number' || Number.isNaN(x)) {
        r.prev = NaN;
        r.rate = 0;
        continue;
      }
      if (dt > 0 && !Number.isNaN(r.prev)) {
        const dx = r.angle ? wrap180(x - r.prev) : x - r.prev;
        r.rate += (dx / dt - r.rate) * (1 - Math.exp(-dt / r.tau));
      }
      r.prev = x;
    }
  }
}
