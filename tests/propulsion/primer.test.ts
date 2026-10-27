// The hand primer (EngineDef.primer): the Cessna 152 and the Piper PA-38. This file first pins that a type
// WITHOUT the member starts exactly as it did before the primer existed: a cold-and-dark start of the Cessna 172S,
// the Robinson R22 (which spreads the C152's engine and fuel system) and the R44 (which primes through its ignition
// key) traced step by step and reduced to a digest recorded on the tree before the primer was added.

import { describe, expect, it } from 'vitest';
import { setEngineControl } from '../../src/core/types';
import { Powerplant } from '../../src/physics/propulsion';
import { C172_POWERPLANT } from '../../src/physics/propulsion/c172Powerplant';
import type { PowerplantDef } from '../../src/physics/propulsion/defs';
import R22_DEFINITION from '../../src/aircraft/r22';
import R44_DEFINITION from '../../src/aircraft/r44';
import { DT, makeInput } from './helpers';

/** FNV-1a over the bytes of a list of doubles. */
function digest(values: readonly number[]): string {
  const bytes = new Uint8Array(new Float64Array(values).buffer);
  let h = 0x811c9dc5;
  for (let k = 0; k < bytes.length; k++) {
    h ^= bytes[k];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Cold and dark at `oat` K (or warm, just shut down): master on, magnetos BOTH, throttle cracked, mixture rich;
 * crank 6 s (the R44 with its ignition-key PRIME for the first 2 s), then 4 s with the starter released. Every
 * step's rpm, fuel flow, EGT, CHT and running flag go into the digest.
 */
function startTrace(def: PowerplantDef, oat: number, warm: boolean, keyPrime = false): { digest: string; running: boolean; rpm: number } {
  const sys = new Powerplant(def);
  sys.reset({ running: false, warm, tanks: sys.tankCapacities, oat });
  const input = makeInput({ controls: { masterBattery: true, throttle: 0.07, mixture: 1, magnetos: 3 } });
  input.atmosphere.temperature = oat;
  const values: number[] = [];
  const steps = Math.round(10 / DT);
  for (let k = 0; k < steps; k++) {
    setEngineControl(input.controls, 0, 'starter', k * DT < 6);
    if (keyPrime) input.controls.fuelPrime = k * DT < 2;
    sys.step(input);
    const e = sys.units[0].state;
    values.push(e.rpm, e.fuelFlow, e.egt, e.cht, e.running ? 1 : 0);
  }
  const e = sys.units[0].state;
  return { digest: digest(values), running: e.running, rpm: e.rpm };
}

describe('a type without a hand primer starts exactly as before', () => {
  it('Cessna 172S, R22 and R44: cold-and-dark and warm start traces are unchanged', () => {
    const traces = {
      c172Cold: startTrace(C172_POWERPLANT, 288.15, false),
      c172Freezing: startTrace(C172_POWERPLANT, 268.15, false),
      c172Warm: startTrace(C172_POWERPLANT, 288.15, true),
      r22Cold: startTrace(R22_DEFINITION.powerplant, 288.15, false),
      r22Freezing: startTrace(R22_DEFINITION.powerplant, 268.15, false),
      r22Warm: startTrace(R22_DEFINITION.powerplant, 288.15, true),
      r44Cold: startTrace(R44_DEFINITION.powerplant, 288.15, false, true),
    };
    const digests = Object.fromEntries(Object.entries(traces).map(([k, t]) => [k, t.digest]));
    expect(digests).toEqual(RECORDED);
    // And the traces are of engines that started.
    // And the fixed-wing bench traces are of engines that started (the R44 on this bench, without its rotor drive and
    // automatic pump logic exercised, does not: its trace pins the key PRIME path all the same).
    for (const [k, t] of Object.entries(traces)) if (k !== 'r44Cold') expect(t.running).toBe(true);
  });
});

/** Recorded on feat/poh-fixes a8d52dd, before the primer. */
const RECORDED: Record<string, string> = {
  c172Cold: '0118fa65', c172Freezing: '2e355f66', c172Warm: '1a201ae5',
  r22Cold: 'c07be81e', r22Freezing: '5ee5e0fb', r22Warm: '0e87644c',
  r44Cold: '9fe883cb',
};
