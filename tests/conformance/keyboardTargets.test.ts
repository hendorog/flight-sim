// The keyboard pilot's per-type targets (request D-D-c152-phys-01): the optional export KEYBOARD_PILOT_TARGETS of
// tests/conformance/targets/<id>.ts, which both the keyboardCircuit block and scripts/fly-keyboard.mjs fly with.

import { describe, expect, it } from 'vitest';
import { AIRCRAFT_IDS } from '../../src/core/types';
import { pilotTargets } from '../input/keyboardPilot';
import { keyboardPilotTargets } from './keyboardTargets';

describe('keyboard pilot targets of a type', () => {
  it('the Cessna 152 flies the circuit with its own tachometer settings', async () => {
    const t = await keyboardPilotTargets('c152');
    expect(t).toMatchObject({ powerDownwind: 2150, powerPattern: 1900, powerBase: 1500, powerFinal: 1680, powerMax: 2300 });
  });

  it('a type without the export (the Cessna 172S) flies the defaults of pilotTargets', async () => {
    expect(await keyboardPilotTargets('c172s')).toBeUndefined();
    expect(await keyboardPilotTargets('no-such-type')).toBeUndefined();
  });

  it('every export names only targets the pilot has, with finite values', async () => {
    const known = new Set(Object.keys(pilotTargets()));
    for (const id of AIRCRAFT_IDS) {
      const t = await keyboardPilotTargets(id);
      for (const [k, v] of Object.entries(t ?? {})) {
        expect(known.has(k), `${id}: ${k}`).toBe(true);
        if (typeof v === 'number') expect(Number.isFinite(v), `${id}: ${k}`).toBe(true);
      }
    }
  });
});
