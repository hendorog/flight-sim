// Circuit legs (section 2.3; src/training/geo/circuit.ts): the rules at points of the left-hand circuit for
// 07, the scenarios' downwind and final flown by the autoflight, and a whole circuit flown with the keyboard
// pilot, classified frame by frame through the geo provider.

import { describe, expect, it } from 'vitest';
import { NM } from '../../src/core/math';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { classifyCircuitLeg } from '../../src/training/geo/circuit';
import { Telemetry } from '../../src/training/telemetry/telemetry';
import type { AircraftTypeDef, CircuitLeg, TelemetrySources } from '../../src/training/types';
import { localToNed } from '../../src/world/airport/layout';
import { createCircuitPilot, frame, makeRig } from '../input/keyboardPilot';

/** Classify a point given in the runway frame (along from the runway centre, across + right of 07). */
const at = (along: number, across: number, hdg: number, prev: CircuitLeg = 'none', onGround = false): CircuitLeg => {
  const p = localToNed(along, across);
  return classifyCircuitLeg(p.north, p.east, hdg, onGround, prev);
};

describe('classifyCircuitLeg rules', () => {
  it('ground wins over everything', () => {
    expect(at(0, 0, 70, 'final', true)).toBe('ground');
    expect(at(-3000, -900, 250, 'downwind', true)).toBe('ground');
  });

  it('final: aligned within 30 deg, short of the 07 threshold, |across| < 400 m', () => {
    for (const along of [-900 - 3 * 1852, -2500, -1000]) expect(at(along, 0, 70)).toBe('final');
    expect(at(-2000, 390, 100)).toBe('final');
    expect(at(-2000, -390, 40)).toBe('final');
    expect(at(-2000, 410, 70)).not.toBe('final');
    expect(at(-2000, 0, 101)).not.toBe('final');
    expect(at(-2000, 150, 30, 'final')).toBe('final'); // correcting an overshoot: 40 deg off, already on final
    expect(at(-2000, 150, 20, 'final')).not.toBe('final');
    // Over the runway a final continues (flare, low approach); without one it is the upwind climb-out.
    expect(at(-500, 3, 72, 'final')).toBe('final');
    expect(at(-500, 3, 72, 'ground')).toBe('upwind');
    expect(at(950, 3, 72, 'final')).toBe('upwind'); // past the far threshold
  });

  it('downwind: heading within 30 deg of 250, 500-2000 m on the left of 07', () => {
    for (const along of [2000, 900, 0, -900, -2500]) expect(at(along, -900, 250)).toBe('downwind');
    expect(at(0, -501, 280)).toBe('downwind');
    expect(at(0, -2000, 220)).toBe('downwind');
    expect(at(0, -450, 250)).not.toBe('downwind');
    expect(at(0, -2100, 250)).not.toBe('downwind');
    expect(at(0, 900, 250)).not.toBe('downwind'); // the dead side
    expect(at(0, -900, 70)).not.toBe('downwind');
  });

  it('base: heading within 40 deg of 160, beyond the near threshold', () => {
    expect(at(-2200, -600, 160)).toBe('base');
    expect(at(-2200, -100, 200)).toBe('base');
    expect(at(-2200, 200, 120)).toBe('base');
    expect(at(-800, -600, 160)).not.toBe('base');
  });

  it('crosswind: only after upwind, turned toward the downwind side, until downwind', () => {
    expect(at(1300, -100, 340, 'upwind')).toBe('crosswind');
    expect(at(1300, -100, 30, 'upwind')).toBe('crosswind'); // 40 deg into the turn
    expect(at(1300, -100, 50, 'upwind')).toBe('upwind'); // 20 deg: still upwind
    expect(at(1300, -300, 340, 'none')).not.toBe('crosswind');
    expect(at(1300, -450, 260, 'crosswind')).toBe('crosswind'); // rolling out inside 500 m
    expect(at(1300, -600, 260, 'crosswind')).toBe('downwind');
    expect(at(1300, 100, 120, 'upwind')).toBe('deadside'); // turned right instead
  });

  it('upwind: aligned, past the near threshold, |across| < 600 m', () => {
    expect(at(0, 0, 70)).toBe('upwind');
    expect(at(2500, -550, 100)).toBe('upwind');
    expect(at(2500, 650, 70)).not.toBe('upwind');
    expect(at(2500, 0, 250)).not.toBe('upwind');
  });

  it('a leg persists through the left turn onto the next one, not through a right turn', () => {
    expect(at(-1500, -900, 205, 'downwind')).toBe('downwind'); // 45 deg into the turn onto base
    expect(at(-2300, -100, 110, 'base')).toBe('base'); // 50 deg into the turn onto final, still beyond 30 deg
    expect(at(-1500, -900, 290, 'downwind')).toBe('none'); // turned right, away
    expect(at(-1500, -900, 205, 'none')).toBe('none');
    expect(at(-9000, -9000, 205, 'downwind')).toBe('none'); // far from the circuit
  });

  it('deadside: right of the runway within 1.5 NM; none elsewhere', () => {
    expect(at(900, 900, 250)).toBe('deadside');
    expect(at(0, 2700, 0)).toBe('deadside');
    expect(at(0, 2900, 0)).toBe('none');
    expect(at(0, -3000, 0)).toBe('none');
    expect(at(0, 0, NaN)).toBe('none');
  });
});

// ---- flown --------------------------------------------------------------------------------------------------

const AIRCRAFT = { id: 'test', vspeeds: {}, settings: {} } as unknown as AircraftTypeDef;
const CALM: Partial<WeatherSettings> = { windSpeedKt: 0, gustKt: 0, turbulence: 0 };

function telemetryFor(p: SimPhysics, w: WeatherSettings): { tel: Telemetry; src: TelemetrySources } {
  const tel = new Telemetry();
  const src: TelemetrySources = {
    state: p.state, controls: p.controls, readings: null, weather: w, env: p.env, aircraft: AIRCRAFT,
    studentInput: false, timeScale: 1, route: null,
  };
  return { tel, src };
}

/** Consecutive legs with their durations (s). */
function runs(samples: { t: number; leg: CircuitLeg }[]): { leg: CircuitLeg; s: number }[] {
  const out: { leg: CircuitLeg; s: number; t0: number }[] = [];
  for (const x of samples) {
    const last = out[out.length - 1];
    if (last && last.leg === x.leg) last.s = x.t - last.t0;
    else out.push({ leg: x.leg, s: 0, t0: x.t });
  }
  return out.map(({ leg, s }) => ({ leg, s }));
}

describe('scenarios flown by the autoflight', () => {
  it("the downwind scenario's leg reads downwind for a minute", () => {
    const w = { ...defaultWeather(), ...CALM };
    const p = new SimPhysics({ weather: w });
    p.reset('downwind', w);
    p.setAutoflight(true, true);
    const { tel, src } = telemetryFor(p, w);
    const legs = new Set<string>();
    for (let i = 0; i < 60 * 10; i++) {
      p.step(0.1);
      legs.add(tel.sample(src, 0.1).circuitLeg as string);
    }
    expect([...legs]).toEqual(['downwind']);
  }, 30000);

  it('the final scenario reads final all the way down, then ground', () => {
    const w = { ...defaultWeather(), ...CALM };
    const p = new SimPhysics({ weather: w });
    p.reset('final', w);
    p.setAutoflight(true, true);
    const { tel, src } = telemetryFor(p, w);
    const samples: { t: number; leg: CircuitLeg }[] = [];
    for (let t = 0; t < 200 && p.autoflight.phase !== 'parked' && p.autoflight.phase !== 'stopped'; t += 0.1) {
      p.step(0.1);
      samples.push({ t, leg: tel.sample(src, 0.1).circuitLeg as CircuitLeg });
    }
    expect(runs(samples).map((r) => r.leg)).toEqual(['final', 'ground']);
  }, 30000);
});

describe('a whole circuit flown with the keyboard pilot', () => {
  it('reads ground, upwind, crosswind, downwind, base, final, ground in order', () => {
    const r = makeRig(CALM);
    const pilot = createCircuitPilot(r.input, r.physics.renderState, r.physics.controls, r.ctx.events);
    const { tel, src } = telemetryFor(r.physics, r.weather);
    const samples: { t: number; leg: CircuitLeg; phase: string; offsetNm: number; bank: number }[] = [];
    let t = 0;
    for (; t < 900; t += 1 / 60) {
      pilot.tick(t);
      frame(r);
      const f = tel.sample(src, 1 / 60);
      samples.push({ t, leg: f.circuitLeg as CircuitLeg, phase: pilot.phase, offsetNm: f.downwindOffsetNm as number, bank: f.bankDeg as number });
      if (pilot.observe()) break;
    }
    expect(r.physics.state.crashed).toBe(false);
    expect(pilot.phase).toBe('stopped');
    const seq = runs(samples);
    // Every leg of the circuit appears once, in order, with no 'none' gaps (turns keep the leg).
    expect(seq.map((x) => x.leg)).toEqual(['ground', 'upwind', 'crosswind', 'downwind', 'base', 'final', 'ground']);
    const dur = Object.fromEntries(seq.map((x) => [x.leg, x.s]));
    expect(dur.downwind).toBeGreaterThan(60);
    expect(dur.base).toBeGreaterThan(15);
    expect(dur.final).toBeGreaterThan(30);
    // The pilot's own phase names agree with the classification where the leg is flown wings level (its
    // phases switch at the start of each turn, the legs at the end of it).
    const agree = (phase: string, leg: CircuitLeg): number => {
      const xs = samples.filter((x) => x.phase === phase && Math.abs(x.bank) < 5);
      return xs.filter((x) => x.leg === leg).length / xs.length;
    };
    expect(agree('downwind', 'downwind')).toBeGreaterThan(0.9);
    expect(agree('final', 'final')).toBeGreaterThan(0.9);
    // The pilot flies its downwind 900 m out: downwindOffsetNm reads it.
    const dw = samples.filter((x) => x.leg === 'downwind').map((x) => x.offsetNm);
    expect(Math.min(...dw)).toBeGreaterThan(0.27);
    expect(Math.max(...dw)).toBeLessThan(1.08);
    expect(dw.reduce((a, b) => a + b, 0) / dw.length).toBeCloseTo(900 / NM, 1);
  }, 120000);
});

