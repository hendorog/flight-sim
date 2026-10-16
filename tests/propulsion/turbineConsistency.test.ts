// The consistency rules of the turbine extras (tests/aircraft/consistency.ts): each one fires on a definition that
// breaks it and stays quiet on the type as built. The C208 is the carrier (the only turbine type before the PC-12).

import { describe, expect, it } from 'vitest';
import { DEG } from '../../src/core/math';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { aircraftSummary, loadAircraft, loadPresentation } from '../../src/aircraft/registry';
import type { EngineDef, PropellerDef } from '../../src/physics/propulsion/defs';
import { definitionInconsistencies } from '../aircraft/consistency';

type ConstantSpeed = Extract<PropellerDef['pitchControl'], { kind: 'constantSpeed' }>;

describe('turbine-extras consistency rules', () => {
  it('fire on a broken latch, cam, limiter, overspeed governor and schedule, and not on the C208 as built', async () => {
    const def = await loadAircraft('c208');
    const pres = await loadPresentation('c208');
    const summary = aircraftSummary('c208');
    const install = def.powerplant.engines[0];
    const pc = install.propeller.pitchControl as ConstantSpeed;
    const t = install.engine.turbine!;
    const withEngine = (engine: Partial<EngineDef>, pitch: Partial<ConstantSpeed> = {}): AircraftDefinition => ({
      ...def,
      powerplant: { ...def.powerplant, engines: [{ ...install, engine: { ...install.engine, ...engine }, propeller: { ...install.propeller, pitchControl: { ...pc, ...pitch } } }] },
    });
    const found = (d: AircraftDefinition) => definitionInconsistencies(d, pres, summary).join('\n');
    expect(found(def)).toBe('');
    expect(found(withEngine({ starterLatch: { cutoutNg: 0.9, cutoutSeconds: 80 } }))).toMatch(/latching starter \(engine 0\) cuts out between/);
    expect(found(withEngine({ starterLatch: { cutoutNg: 0.5, cutoutSeconds: 0 } }))).toMatch(/latching starter \(engine 0\) times out/);
    expect(found(withEngine({ turbine: { ...t, reversingCam: { maxReverseNg: 1.2, reverseNp: 0.95 } } }))).toMatch(/maximum reverse Ng between low idle and maxNg/);
    expect(found(withEngine({ turbine: { ...t, reversingCam: { maxReverseNg: 0.85, reverseNp: 1.02 } } }))).toMatch(/below the propeller governor's highest speed/);
    const limiter = { psi: 44.3, psiPerNm: 0.01, lapse: { altFt: [0, 12_000, 10_000], psi: [44.3, 41, 37] }, ngTaper: [1.0, 1.01] as const, taperPsi: 2.9 };
    expect(found(withEngine({ turbine: { ...t, torqueLimiter: limiter } }))).toMatch(/lapse altitudes ascending/);
    expect(found(withEngine({}, { governor: { ...pc.governor, overspeedRpm: 1800 } }))).toMatch(/overspeed governor \(engine 0\) 1800 rpm above the governed 1900 rpm/);
    expect(found(withEngine({}, { governor: { ...pc.governor, overspeedRpm: 2100 } }))).toMatch(/overspeed governor \(engine 0\) below the fuel topping governor/);
    const beta = { groundFine: 0, reverse: -10 * DEG, pitchOnlyTravel: 0.4, rate: 0.5, lowPitchSchedule: { lever: [0, 0.5, 0.4], angle: [15 * DEG, 18 * DEG, 20 * DEG] } };
    expect(found(withEngine({}, { beta, pitchNodes: [-10 * DEG, ...pc.pitchNodes] }))).toMatch(/low-pitch schedule \(engine 0\): lever ascending/);
  });
});
