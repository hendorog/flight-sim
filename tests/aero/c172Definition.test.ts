// The Cessna 172S aerodynamic definition, pinned member by member: every strip of the wing and the tail (ends,
// frame, chord, area, section, controls with their flap constants and coverage), the fuselage stations, the
// parasite items, the struts and the stall sensor must be IDENTICAL to tests/aero/data/c172Definition.json,
// which was written from the tree as it stood before the definition's builders were reshaped (the fin's
// construction moved into strips.ts buildFin). The goldens pin what the model computes from the definition;
// this pins the definition itself, so a change shows as "the tip strip's area" and not as a moment in the
// ninth digit. Below it: what AeroModel reads of the definition's propeller station, and buildFin on a fin of
// round numbers.
//
// REGENERATE ONLY DELIBERATELY, after a change that is meant to alter the C172S geometry, and review the diff:
//   FS_AERO_CAPTURE=1 npx vitest run tests/aero/c172Definition.test.ts

import { describe, expect, it } from 'vitest';
import { C172 } from '../../src/core/c172';
import { AeroModel, createC172AeroDefinition } from '../../src/physics/aero';
import type { AircraftAeroDefinition } from '../../src/physics/aero/definition';
import { NACA_0012 } from '../../src/physics/aero/sections';
import { buildFin } from '../../src/physics/aero/strips';
import { makeInput } from './helpers';

/** node:fs, loaded at run time (the project builds without node's types). */
interface Fs {
  existsSync(path: URL): boolean;
  mkdirSync(path: URL, o: { recursive: boolean }): void;
  readFileSync(path: URL, encoding: 'utf8'): string;
  writeFileSync(path: URL, data: string): void;
}
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const DATA_DIR = new URL('./data/', import.meta.url);
const DATA = new URL('c172Definition.json', DATA_DIR);
const CAPTURE = env.FS_AERO_CAPTURE === '1';

/** The members that are pinned (the propeller station is checked against core/c172.ts below). */
const PINNED = ['referenceArea', 'referenceChord', 'referenceSpan', 'wing', 'tail', 'fuselage', 'dragItems', 'struts', 'stallWarning'] as const;

/**
 * A value as JSON keeps it without loss: finite numbers as they are (JSON.stringify writes the shortest text
 * that reads back as the same double), -0 and the non-finite numbers by name. A function is refused: it could
 * not be compared.
 */
function plain(v: unknown, path: string): unknown {
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : Number.isFinite(v) ? v : String(v);
  if (typeof v === 'function') throw new Error(`${path} is a function: the definition can no longer be pinned as data`);
  if (Array.isArray(v)) return v.map((x, i) => plain(x, `${path}[${i}]`));
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = plain(x, `${path}.${k}`);
    return out;
  }
  return v;
}

function record(): Record<string, unknown> {
  const def = createC172AeroDefinition();
  return Object.fromEntries(PINNED.map((k) => [k, plain(def[k], k)]));
}

describe('C172S aerodynamic definition', () => {
  it.runIf(CAPTURE)('capture (FS_AERO_CAPTURE=1): writes the reference instead of comparing', () => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA, `${JSON.stringify(record(), null, 1)}\n`);
  });

  describe.skipIf(CAPTURE)('against the capture', () => {
    const stored = fs.existsSync(DATA) ? (JSON.parse(fs.readFileSync(DATA, 'utf8')) as Record<string, unknown>) : {};
    const now = record();

    it('the capture exists and holds every pinned member', () => {
      expect(Object.keys(stored)).toEqual([...PINNED]);
    });

    it('the strip list is deep-equal: 22 wing strips, 9 tailplane strips, 5 fin strips', () => {
      const wing = now.wing as { surface: string }[], tail = now.tail as { surface: string }[];
      expect(wing.map((s) => s.surface)).toEqual(Array.from({ length: 22 }, () => 'wing'));
      expect(tail.map((s) => s.surface)).toEqual([...Array.from({ length: 9 }, () => 'hTail'), ...Array.from({ length: 5 }, () => 'vTail')]);
      // Strip by strip first, so a difference names its strip.
      for (const list of ['wing', 'tail'] as const) {
        const a = now[list] as unknown[], b = stored[list] as unknown[];
        expect(a.length, list).toBe(b.length);
        a.forEach((strip, i) => expect(strip, `${list}[${i}]`).toEqual(b[i]));
      }
      expect(now.wing).toEqual(stored.wing);
      expect(now.tail).toEqual(stored.tail);
    });

    it.each(PINNED.filter((k) => k !== 'wing' && k !== 'tail'))('%s is identical', (k) => {
      expect(now[k]).toEqual(stored[k]);
    });

    it('is the same text when written again (member order included)', () => {
      expect(`${JSON.stringify(now, null, 1)}\n`).toBe(fs.readFileSync(DATA, 'utf8'));
    });
  });

  it('carries the one propeller station of core/c172.ts', () => {
    const def = createC172AeroDefinition();
    expect(def.propellers).toEqual([{ hub: C172.prop.hub, radius: C172.prop.diameter / 2 }]);
    // Its own copy of the hub: a model must not be able to move the shared geometry.
    expect(def.propellers[0].hub).not.toBe(C172.prop.hub);
  });

  it('builds a fresh, equal definition on every call', () => {
    const a = createC172AeroDefinition(), b = createC172AeroDefinition();
    expect(a.wing).not.toBe(b.wing);
    expect(plain(a.wing, 'wing')).toEqual(plain(b.wing, 'wing'));
    expect(plain(a.tail, 'tail')).toEqual(plain(b.tail, 'tail'));
  });
});

describe('AeroModel built from a definition', () => {
  const slipstream = { origin: { ...C172.prop.hub }, radius: 0.75, inducedVelocity: 8, swirlRate: 9.6 };
  const input = () => makeInput({ V: 30, alphaDeg: 8, betaDeg: 3, slipstream });
  const run = (model: AeroModel) => ({ out: model.compute(input()), inflow: { ...model.propellerInflow }, tail: model.tailplaneAlpha() });

  it('reads propellers[0]', () => {
    const reference = run(new AeroModel(undefined, { quasiSteady: true }));
    expect(run(new AeroModel(createC172AeroDefinition(), { quasiSteady: true }))).toEqual(reference);

    // A smaller disc moves the 0.7-radius points the inflow is averaged over, and narrows the jet.
    const small = createC172AeroDefinition();
    small.propellers[0].radius = 0.6;
    const moved = run(new AeroModel(small, { quasiSteady: true }));
    expect(moved.inflow.z).not.toBe(reference.inflow.z);
    expect(moved.out.moment.y).not.toBe(reference.out.moment.y);
  });

  it('propellerInflow is one object for the life of the model', () => {
    const model = new AeroModel();
    const inflow = model.propellerInflow;
    model.compute(input());
    model.reset();
    model.compute(input());
    expect(model.propellerInflow).toBe(inflow);
    expect(Math.abs(inflow.z)).toBeGreaterThan(0.1);
  });

  it('refuses a definition without a propeller station', () => {
    // Through a cast: `propellers` is required by the type, a definition read from elsewhere may still lack it.
    const def = createC172AeroDefinition() as Partial<AircraftAeroDefinition>;
    delete def.propellers;
    expect(() => new AeroModel(def as AircraftAeroDefinition)).toThrow(/names no propeller/);
    expect(() => new AeroModel({ ...createC172AeroDefinition(), propellers: [] })).toThrow(/names no propeller/);
  });
});

describe('buildFin', () => {
  const fin = () =>
    buildFin({
      section: NACA_0012,
      base: { x: -4, z: -0.2 },
      tip: { x: -4.6, z: -1.4 },
      rootChord: 1.2,
      tipChord: 0.6,
      axisZ: 0.05,
      edges: [0.4, 0.8],
      controls: [{ source: 'rudder', gain: 1, geometry: { kind: 'plain', chordFraction: 0.4 }, from: 0, to: 1.45 }],
      cd90: 1.2,
      skinFactor: 1,
    });

  it('continues the panel from the base down to the body axis and no further', () => {
    const strips = fin();
    // One strip inside the body, then the three between the base, the two edges and the tip.
    expect(strips).toHaveLength(4);
    expect(strips.every((s) => s.surface === 'vTail' && s.side === 0 && !s.carryover && !s.bodySection)).toBe(true);
    // Bound vortices run from the upper end to the lower: strip 0 ends on the axis, the last begins at the tip.
    expect(strips[0].b.z).toBeCloseTo(0.05, 12);
    expect(strips[0].a.z).toBeCloseTo(-0.2, 12);
    expect(strips[0].a.x).toBeCloseTo(-4, 12);
    expect(strips[3].a.z).toBeCloseTo(-1.4, 12);
    expect(strips[3].a.x).toBeCloseTo(-4.6, 12);
    expect(strips.map((s) => s.span)).toEqual([0.125, 0.25 + 0.2, 0.25 + 0.6, 0.25 + 0.5 * (0.8 + 1.2)].map((v) => expect.closeTo(v, 12)));
    for (const s of strips) expect(s.a.y === 0 && s.b.y === 0 && s.liftSlopeFactor === 1).toBe(true);
  });

  it('tapers linearly from the root chord at the base to the tip chord, extrapolated below the base', () => {
    const strips = fin();
    // Chord at a height h above the base: 1.2 - 0.5 h (0.6 at the tip, 1.2 m above); strip chords are the means.
    const chordAt = (h: number) => 1.2 - 0.5 * h;
    expect(strips[0].chord).toBeCloseTo(0.5 * (chordAt(-0.25) + chordAt(0)), 12);
    expect(strips[1].chord).toBeCloseTo(0.5 * (chordAt(0) + chordAt(0.4)), 12);
    expect(strips[3].chord).toBeCloseTo(0.5 * (chordAt(0.8) + chordAt(1.2)), 12);
    expect(strips.reduce((sum, s) => sum + s.area, 0)).toBeCloseTo(0.5 * (chordAt(-0.25) + chordAt(1.2)) * 1.45, 12);
    // The rudder covers every strip (its end ramps lie at the panel's ends).
    expect(strips.every((s) => s.controls.length === 1 && s.controls[0].source === 'rudder')).toBe(true);
  });
});
