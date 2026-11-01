// Proves the Career's job boards (src/career/jobs.ts) and their stream (src/career/rng.ts): a board is a pure
// function of (seed, day, origin) and another day or field gives another board; over 200 boards at seed 0 and 200
// at seed 7 every board has 6 to 9 offers with unique ids, the fixed classes (or the documented fallback) in slots
// 0-2, no destination at the origin (a scenic loop comes back to it), at most one mail run, every offer fits its
// reference type (the first of its class that fits) and every type of its class is ok or refused only by a fit code,
// the reference type's tanks hold the required fuel, payloads are within the documented ranges at both ends,
// positioning goes 25 NM or more where it can, every kind and class turns up, pay and deadline equal the documented formulas recomputed here, scenic loops are 15-35 NM with every turning point
// at least 2 NM from every field, weather and wind are in range, and about a fifth of the drawn slots are premium;
// no Math.random is used; and the base boards of seeds 0 and 7, days 1-3, every field, deep-equal
// tests/career/boards.golden.json (FS_CAREER_BAKE=1 writes it afresh after a deliberate change to the stream).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blockHours, burnKg, basePricePerKg, flightTimeMin, fuelPlan, windComponents } from '../../src/career/costs';
import { fitOffer, offerFuelPlan } from '../../src/career/fit';
import { bearingDeg, distanceM } from '../../src/career/geo';
import { BAG_KG, boardFor, PAYLOAD_RULES, POSITIONING_PREFER_NM } from '../../src/career/jobs';
import { CAREER_PERF } from '../../src/career/perf';
import { boardKey, careerRng, fnv1a32 } from '../../src/career/rng';
import {
  BOARD_RULES, CAREER_AIRCRAFT_IDS, CLASS_RULES, DEADLINE_RULES, OCCUPANT_KG, PAY_FLOOR, PAY_RULES, PREMIUM_RULES, WEATHER_PAY,
  type AircraftClass, type CareerAircraftId, type JobOffer,
} from '../../src/career/types';
import { NM } from '../../src/core/math';
import { setGpsTarget } from '../../src/instruments/dynamics/navigation';
import { setStartField } from '../../src/sim/startField';
import { airfields, type Airfield } from '../../src/world/airfields';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

// node:fs without the node type package (tests are type-checked with the DOM library only), as tests/golden has it.
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
  readFileSync(path: URL, encoding: 'utf8'): string;
  writeFileSync(path: URL, data: string): void;
};
const BAKE = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.FS_CAREER_BAKE;
const GOLDEN = new URL('./boards.golden.json', import.meta.url);

afterAll(() => {
  setStartField(null);
  setGpsTarget(null);
  setWorldSeed(0);
});

const typesOf = (cls: AircraftClass): CareerAircraftId[] => CAREER_AIRCRAFT_IDS.filter((t) => CAREER_PERF[t].cls === cls);
const uses = (t: CareerAircraftId, f: Airfield) => f.length >= CAREER_PERF[t].minRunwayM && (f.kind !== 'grass' || CAREER_PERF[t].grassOk);
const classBoth = (c: AircraftClass, a: Airfield, b: Airfield) => typesOf(c).some((t) => uses(t, a) && uses(t, b));
const FIT_CODES = new Set(['seats', 'stationLimit', 'overMtow', 'runwayShort', 'grass']);

/** 200 boards of a world: days 1, 2, ... at every field in turn until 200. */
function boards(seed: number): { day: number; origin: Airfield; fields: readonly Airfield[]; offers: JobOffer[] }[] {
  setWorldSeed(seed);
  const fields = airfields();
  const out: { day: number; origin: Airfield; fields: readonly Airfield[]; offers: JobOffer[] }[] = [];
  for (let day = 1; out.length < 200; day++) {
    for (const origin of fields) {
      if (out.length >= 200) break;
      // The base offers only: wave 4 appends its `-w` offers after them from its own stream.
      out.push({ day, origin, fields, offers: boardFor(seed, day, origin.code, fields).filter((o) => !/-w\d+$/.test(o.id)) });
    }
  }
  return out;
}

/** The planning ground speed recomputed from the offer: a leg's headwind component or half the wind on a loop. */
function gsOf(tas: number, o: JobOffer, fields: readonly Airfield[]): number {
  const from = fields.find((f) => f.code === o.origin)!;
  let head: number;
  if (o.waypoints) head = o.windKt * DEADLINE_RULES.loopWindFactor;
  else {
    const to = fields.find((f) => o.destination.kind === 'field' && f.code === o.destination.code)!;
    head = windComponents(bearingDeg(from, to), o.windDirDeg, o.windKt).headwind;
  }
  return Math.max(tas - head, tas * DEADLINE_RULES.minGsFraction);
}

describe('the board stream', () => {
  beforeAll(() => {
    setEra('present');
    setWorldSeed(0);
  });

  it('hashes with 32-bit FNV-1a and keys a board by seed, day and origin', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
    expect(boardKey(0, 3, 'KFBL')).toBe('0|3|KFBL');
    expect(boardKey(7, 3, 'KFBL', BOARD_RULES.wave4Salt)).toBe('7|3|KFBL|w4');
    const a = careerRng('x');
    const b = careerRng('x');
    for (let i = 0; i < 5; i++) expect(a.next()).toBe(b.next());
  });

  it('gives the same board for the same inputs and another board for another day or field', () => {
    const fields = airfields();
    const home = fields[0].code;
    const other = fields.find((f) => f.kind === 'sealed')!.code;
    expect(boardFor(0, 4, home, fields)).toEqual(boardFor(0, 4, home, fields));
    const strip = (b: JobOffer[]) => b.map(({ id: _id, day: _d, origin: _o, ...rest }) => rest);
    expect(strip(boardFor(0, 5, home, fields))).not.toEqual(strip(boardFor(0, 4, home, fields)));
    expect(strip(boardFor(0, 4, other, fields))).not.toEqual(strip(boardFor(0, 4, home, fields)));
    expect(strip(boardFor(1, 4, home, fields))).not.toEqual(strip(boardFor(0, 4, home, fields)));
  });

  it('uses no Math.random in the generator, the stream or the geometry', () => {
    for (const file of ['jobs.ts', 'rng.ts', 'geo.ts']) {
      const src = fs.readFileSync(new URL(`../../src/career/${file}`, import.meta.url), 'utf8');
      const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      expect(code, file).not.toMatch(/Math\.random/);
    }
  });
});

for (const seed of [0, 7]) {
  describe(`200 boards at seed ${seed}`, () => {
    beforeAll(() => setEra('present'));
    let all: ReturnType<typeof boards> = [];
    beforeAll(() => {
      all = boards(seed);
    });

    it('have 6 to 9 offers with unique ids in slot order', () => {
      expect(all.length).toBe(200);
      const ids = new Set<string>();
      for (const b of all) {
        expect(b.offers.length).toBeGreaterThanOrEqual(6);
        expect(b.offers.length).toBeLessThanOrEqual(9);
        b.offers.forEach((o, i) => {
          expect(o.id).toBe(`${b.day}-${b.origin.code}-${i}`);
          expect(o.day).toBe(b.day);
          expect(o.origin).toBe(b.origin.code);
          ids.add(o.id);
        });
      }
      expect(ids.size).toBe(all.reduce((s, b) => s + b.offers.length, 0));
    });

    it('give slots 0 to 2 their fixed classes, or the cheapest class able to use the field', () => {
      const cheapest = [...new Set(CAREER_AIRCRAFT_IDS.map((t) => CAREER_PERF[t].cls))].sort(
        (a, b) => Math.min(...typesOf(a).map((t) => CAREER_PERF[t].leaseHourly)) - Math.min(...typesOf(b).map((t) => CAREER_PERF[t].leaseHourly)),
      );
      for (const b of all) {
        const others = b.fields.filter((f) => f !== b.origin);
        for (let i = 0; i < 3; i++) {
          const o = b.offers[i];
          const able = (c: AircraftClass) => (o.kind === 'scenic' ? c !== 'twin' && classBoth(c, b.origin, b.origin) : others.some((f) => classBoth(c, b.origin, f)));
          const want = BOARD_RULES.fixedSlots[i];
          expect(o.minClass).toBe(able(want) ? want : cheapest.find(able));
          expect(o.premium).toBe(false);
        }
      }
    });

    it('never send an offer to its origin, except a scenic loop that comes back to it', () => {
      for (const b of all) {
        for (const o of b.offers) {
          expect(o.destination.kind).toBe('field');
          const dest = o.destination.kind === 'field' ? o.destination.code : '';
          if (o.kind === 'scenic') {
            expect(dest).toBe(o.origin);
            expect(o.waypoints!.length).toBeGreaterThanOrEqual(2);
          } else {
            expect(dest).not.toBe(o.origin);
            expect(o.waypoints).toBeUndefined();
            const to = b.fields.find((f) => f.code === dest)!;
            expect(o.distanceNm).toBeCloseTo(Math.round((distanceM(b.origin, to) / NM) * 10) / 10, 9);
            expect(classBoth(o.minClass, b.origin, to)).toBe(true);
          }
        }
      }
    });

    it('have at most one mail run per board', () => {
      for (const b of all) expect(b.offers.filter((o) => o.kind === 'mail').length).toBeLessThanOrEqual(1);
    });

    it('send a positioning flight 25 NM or more whenever a field that far is open to it', () => {
      for (const b of all) {
        b.offers.forEach((o, i) => {
          if (o.kind !== 'positioning' || o.destination.kind !== 'field') return;
          const code = o.destination.code;
          const to = b.fields.find((f) => f.code === code)!;
          // Slots 0-2 choose among the fields their class can use; later slots among every other field.
          const open = b.fields.filter((f) => f !== b.origin && (i >= BOARD_RULES.fixedSlots.length || classBoth(o.minClass, b.origin, f)));
          if (open.some((f) => distanceM(b.origin, f) / NM >= POSITIONING_PREFER_NM)) {
            expect(distanceM(b.origin, to) / NM, o.id).toBeGreaterThanOrEqual(POSITIONING_PREFER_NM);
          }
        });
      }
    });

    it('offer every base kind and every class, and give a heli charter of two or more passengers to the R44', () => {
      const kinds = new Set(all.flatMap((b) => b.offers.map((o) => o.kind)));
      for (const k of ['charter', 'freight', 'mail', 'scenic', 'positioning']) expect(kinds.has(k as JobOffer['kind'])).toBe(true);
      const classes = new Set(all.flatMap((b) => b.offers.map((o) => o.minClass)));
      for (const c of Object.keys(CLASS_RULES)) expect(classes.has(c as AircraftClass)).toBe(true);
      for (const b of all) {
        for (const o of b.offers) if (o.kind === 'charter' && o.minClass === 'heli' && o.pax >= 2) expect(o.refType).toBe('r44');
      }
    });

    it('need no more fuel than the reference type’s tanks hold (the load sheet’s fuelOverCapacity never blocks it)', () => {
      for (const b of all) {
        for (const o of b.offers) {
          expect(offerFuelPlan(o, o.refType, b.fields).requiredKg, o.id).toBeLessThanOrEqual(CAREER_PERF[o.refType].usableFuelKg);
        }
      }
    });

    it('fit their reference type, the first of the class that fits, and every type of the class is ok or refused by a fit code', () => {
      for (const b of all) {
        for (const o of b.offers) {
          const types = typesOf(o.minClass);
          expect(CAREER_PERF[o.refType].cls).toBe(o.minClass);
          expect(fitOffer(o, o.refType, b.fields)).toBeNull();
          for (const t of types.slice(0, types.indexOf(o.refType))) expect(fitOffer(o, t, b.fields)).not.toBeNull();
          for (const t of types) {
            const code = fitOffer(o, t, b.fields);
            if (code !== null) expect(FIT_CODES.has(code)).toBe(true);
          }
        }
      }
    });

    it('carry payloads of the documented sizes and sums', () => {
      for (const b of all) {
        for (const o of b.offers) {
          expect(o.payloadKg).toBe(o.payload.reduce((s, p) => s + p.kg, 0));
          expect(o.pax).toBe(o.payload.filter((p) => p.kind === 'passenger').length);
          for (const p of o.payload) expect(Number.isInteger(p.kg) && p.kg > 0).toBe(true);
          // The real worlds' fields are close enough that no load is trimmed, so every range holds at both ends.
          if (o.kind === 'charter' || o.kind === 'scenic') {
            const r = PAYLOAD_RULES[o.kind][o.minClass]!;
            expect(o.pax).toBeGreaterThanOrEqual(r[0]);
            expect(o.pax).toBeLessThanOrEqual(r[1]);
            for (const p of o.payload.filter((x) => x.kind === 'passenger')) expect(p.kg).toBe(OCCUPANT_KG);
            const bags = o.payload.filter((x) => x.kind === 'baggage');
            const bagKg = o.minClass === 'trainer' ? BAG_KG.trainer : BAG_KG.other;
            if (o.minClass === 'trainer') expect(bags.length).toBeLessThanOrEqual(o.pax);
            else expect(bags.length).toBe(o.pax);
            for (const bag of bags) {
              expect(bag.kg).toBeGreaterThanOrEqual(Math.max(1, bagKg[0]));
              expect(bag.kg).toBeLessThanOrEqual(bagKg[1]);
            }
            expect(o.payload.length).toBe(o.pax + bags.length);
          } else if (o.kind === 'freight' || o.kind === 'mail') {
            const r = PAYLOAD_RULES[o.kind][o.minClass]!;
            expect(o.payload.every((p) => p.kind === o.kind)).toBe(true);
            expect(o.payloadKg).toBeLessThanOrEqual(r[1]);
            expect(o.payloadKg).toBeGreaterThanOrEqual(r[0]);
            expect(o.pax).toBe(0);
          } else {
            expect(o.payload.length).toBe(0);
          }
          expect(o.kind === 'scenic' && o.minClass === 'twin').toBe(false);
        }
      }
    });

    it('pay the larger of the formula and the floor, rounded to $5, and allow the documented deadline', () => {
      for (const b of all) {
        for (const o of b.offers) {
          const r = PAY_RULES[o.kind];
          const cargo = o.payload.filter((p) => p.kind === 'freight' || p.kind === 'mail').reduce((s, p) => s + p.kg, 0);
          const tier: number = o.premium ? (o.repRequired === PREMIUM_RULES.repRequired[1] ? 1 : 0) : -1;
          const premiumMult = tier >= 0 ? PREMIUM_RULES.payMult[tier] : 1;
          const formula = (r.base + r.perNm * o.distanceNm + r.perPax * o.pax + r.perKg * cargo)
            * CLASS_RULES[o.minClass].payMult * WEATHER_PAY[o.weather].mult * premiumMult;
          const ref = CAREER_PERF[o.refType];
          const gs = gsOf(ref.cruiseTasKt, o, b.fields);
          const block = blockHours(flightTimeMin(o.distanceNm, gs), ref.cls);
          const fuel = burnKg(fuelPlan(ref, o.distanceNm, gs)) * basePricePerKg(ref.fuel);
          const floor = Math.round(PAY_FLOOR.costFactor * (block * ref.leaseHourly + fuel) * r.floorPremium);
          expect(o.pay).toBe(Math.round(Math.max(formula, floor) / 5) * 5);
          expect(o.pay).toBeGreaterThan(0);

          const cls = CLASS_RULES[o.minClass];
          const raw = cls.taxiMin + ((60 * o.distanceNm) / gsOf(cls.refTasKt, o, b.fields)) * r.deadlineSlack + DEADLINE_RULES.marginMin;
          expect(o.deadlineMin % 5).toBe(0);
          expect(o.deadlineMin).toBeGreaterThanOrEqual(raw - 1e-9);
          expect(o.deadlineMin).toBeLessThan(raw + 5);

          const rep = cls.rep + r.rep;
          expect(o.repRequired).toBe(tier >= 0 ? Math.max(rep, PREMIUM_RULES.repRequired[tier]) : rep);
        }
      }
    });

    it('fly scenic loops of 15 to 35 NM with every turning point at least 2 NM from every field', () => {
      let scenic = 0;
      for (const b of all) {
        for (const o of b.offers.filter((x) => x.kind === 'scenic')) {
          scenic++;
          expect(o.distanceNm).toBeGreaterThanOrEqual(BOARD_RULES.scenicMinNm);
          expect(o.distanceNm).toBeLessThanOrEqual(BOARD_RULES.scenicMaxNm);
          const pts = [b.origin, ...o.waypoints!, b.origin];
          let len = 0;
          for (let i = 1; i < pts.length; i++) len += distanceM(pts[i - 1], pts[i]);
          expect(len / NM).toBeCloseTo(o.distanceNm, 6);
          for (const w of o.waypoints!) {
            expect(w.radiusM).toBe(BOARD_RULES.scenicRadiusM);
            expect(w.maxAglFt).toBe(BOARD_RULES.scenicMaxAglFt);
            expect(w.name).toMatch(/^Point [ABC], \d+ NM (north|south|east|west|north-east|north-west|south-east|south-west)$/);
            for (const f of b.fields) expect(distanceM(f, w)).toBeGreaterThanOrEqual(BOARD_RULES.scenicFieldClearM);
          }
        }
      }
      expect(scenic).toBeGreaterThan(50);
    });

    it('draw valid weather and winds', () => {
      for (const b of all) {
        for (const o of b.offers) {
          const w = WEATHER_PAY[o.weather];
          expect(w).toBeDefined();
          expect(Number.isInteger(o.windDirDeg) && o.windDirDeg >= 0 && o.windDirDeg <= 359).toBe(true);
          expect(Number.isInteger(o.windKt)).toBe(true);
          expect(o.windKt).toBeGreaterThanOrEqual(w.windKt[0]);
          expect(o.windKt).toBeLessThanOrEqual(w.windKt[1]);
        }
      }
    });

    it('make about a fifth of the drawn slots premium', () => {
      let drawn = 0;
      let premium = 0;
      for (const b of all) {
        for (const o of b.offers.slice(BOARD_RULES.fixedSlots.length)) {
          drawn++;
          if (o.premium) premium++;
        }
      }
      expect(premium / drawn).toBeGreaterThanOrEqual(0.1);
      expect(premium / drawn).toBeLessThanOrEqual(0.3);
    });
  });
}

describe('a board in a world of distant fields', () => {
  /** A synthetic sealed field 1,500 m long. */
  const far = (code: string, north: number, east: number, kind: Airfield['kind'] = 'sealed'): Airfield => ({
    code, name: `${code} Aerodrome`, kind, north, east, elevation: 100, heading: 0, ids: ['18', '36'], length: 1500, width: 23,
    flatMargin: 50, blend: 100, approachLength: 1000, circuit: 'left', frequency: 123.5, apronAlong: 0,
  });
  const fields = [far('HOME', 0, 0, 'home'), far('AWAY', 150 * NM, 0)];

  it('trims a load no type of the class can carry that far until the reference type takes it', () => {
    let trimmed = 0;
    for (let day = 1; day <= 60; day++) {
      for (const o of boardFor(3, day, 'HOME', fields)) {
        expect(fitOffer(o, o.refType, fields)).toBeNull();
        if (o.kind === 'charter' && o.minClass === 'tourer' && o.pax < 3) trimmed++;
      }
    }
    // A full C172S (three passengers and bags) is over MTOW with the fuel for 150 NM: some tourer charters were trimmed.
    expect(trimmed).toBeGreaterThan(0);
  });
});

describe('the golden boards', () => {
  it('deep-equal boards.golden.json for seeds 0 and 7, days 1 to 3, every field (base offers only)', () => {
    setEra('present');
    const fresh: { seed: number; fields: string[]; boards: Record<string, JobOffer[]> }[] = [];
    for (const seed of [0, 7]) {
      setWorldSeed(seed);
      const fields = airfields();
      const entry = { seed, fields: fields.map((f) => f.code), boards: {} as Record<string, JobOffer[]> };
      for (let day = 1; day <= 3; day++) {
        for (const f of fields) {
          // The base stream only: wave 4 appends `-w` offers from its own stream and must leave these unchanged.
          entry.boards[`${day}-${f.code}`] = boardFor(seed, day, f.code, fields).filter((o) => !/-w\d+$/.test(o.id));
        }
      }
      fresh.push(entry);
    }
    setWorldSeed(0);
    if (BAKE) {
      // One offer per line keeps the file small and its diffs readable.
      const text = fresh.map((e) => `{"seed":${e.seed},"fields":${JSON.stringify(e.fields)},"boards":{\n${Object.entries(e.boards)
        .map(([k, offers]) => `${JSON.stringify(k)}:[\n${offers.map((o) => JSON.stringify(o)).join(',\n')}\n]`).join(',\n')}\n}}`);
      fs.writeFileSync(GOLDEN, `[\n${text.join(',\n')}\n]\n`);
      return;
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) as typeof fresh;
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(golden);
  });
});
