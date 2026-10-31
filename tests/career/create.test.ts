// Proves the new-career factory (src/career/create.ts): a new save starts on day 1 at 08:00 at the home field with
// the starting cash and reputation, the single-engine piston rating and one leased aircraft ('a1') of the chosen
// type, registered by registrationFor under the school's authority and delivered with half tanks; the names are
// tidied with defaults for empty ones; the callsign word defaults to the company's first word; the save validates
// with nothing dropped and survives a JSON round trip unchanged; and the store's create() writes nothing.

import { describe, expect, it } from 'vitest';
import {
  createCareer, defaultCallsign, DEFAULT_COMPANY_NAME, DEFAULT_PILOT_NAME, normaliseCallsign, type CareerCreateContext,
} from '../../src/career/create';
import { CAREER_PERF } from '../../src/career/perf';
import { registrationFor } from '../../src/career/registration';
import { CareerStore } from '../../src/career/store';
import { CLOCK_RULES, START_RULES } from '../../src/career/types';
import { validateCareerSave } from '../../src/career/validate';
import { memoryStore } from '../../src/training/career/store';

const CTX: CareerCreateContext = { seed: 7, licence: 'school', authority: 'easa', homeCode: 'HOME', now: 1_790_000_000_000 };

describe('createCareer', () => {
  it('starts on day 1 at 08:00 at the home field with the starting cash, reputation and rating', () => {
    const s = createCareer({ pilotName: 'Ann Pilot', companyName: 'Fable Air Services', callsign: '', start: 'c152' }, CTX);
    expect(s.format).toBe('fs-career');
    expect(s.schema).toBe(1);
    expect(s.seed).toBe(7);
    expect(s.clockMin).toBe(CLOCK_RULES.startMin);
    expect(Math.floor(s.clockMin / 1440)).toBe(1);
    expect(s.clockMin % 1440).toBe(8 * 60);
    expect(s.cash).toBe(START_RULES.cash);
    expect(s.cash).toBe(5000);
    expect(s.reputation).toBe(START_RULES.reputation);
    expect(s.ratings).toEqual(['sep']);
    expect(s.pilot).toEqual({ name: 'Ann Pilot', licence: 'school' });
    expect(s.company).toEqual({ name: 'Fable Air Services', callsign: 'Fable' });
    expect(s.inCareer).toBe(true);
    expect(s.active).toBeNull();
    expect(s.lastSettlement).toBeNull();
    expect(s.logbook).toEqual([]);
    expect(s.taken).toEqual([]);
    expect(s.flightNo).toBe(1);
    expect(s.ownNo).toBe(1);
    expect(s.createdAt).toBe(CTX.now);
    expect(s.updatedAt).toBe(CTX.now);
  });

  it('leases the chosen first aircraft at the home field with half tanks and its own registration', () => {
    for (const start of ['c152', 'c172s'] as const) {
      for (const authority of ['easa', 'faa'] as const) {
        const s = createCareer({ pilotName: 'A', companyName: 'B', callsign: 'C', start }, { ...CTX, authority });
        expect(s.fleet).toEqual([{
          uid: 'a1', type: start, tenure: 'leased', registration: registrationFor('a1', authority), field: 'HOME',
          fuelKg: CAREER_PERF[start].deliveryFuelKg, hours: 0, acquiredDay: 1,
        }]);
        expect(s.fleet[0].fuelKg).toBeCloseTo(CAREER_PERF[start].usableFuelKg / 2, 6);
        expect(s.selectedUid).toBe('a1');
      }
    }
    expect(createCareer({ pilotName: 'A', companyName: 'B', callsign: '', start: 'c152' }, CTX).fleet[0].registration).toMatch(/^G-[A-Z]{4}$/);
    expect(createCareer({ pilotName: 'A', companyName: 'B', callsign: '', start: 'c152' }, { ...CTX, authority: 'faa' }).fleet[0].registration)
      .toMatch(/^N[1-9][0-9]{2}[A-Z]{2}$/);
  });

  it('tidies the names and falls back to the defaults when they are empty', () => {
    const s = createCareer({ pilotName: '   ', companyName: '  ', callsign: ' ', start: 'c152' }, CTX);
    expect(s.pilot.name).toBe(DEFAULT_PILOT_NAME);
    expect(s.company.name).toBe(DEFAULT_COMPANY_NAME);
    expect(s.company.callsign).toBe(defaultCallsign(DEFAULT_COMPANY_NAME));
    const t = createCareer({ pilotName: '  Jo   Bloggs ', companyName: ' north   star  aviation ', callsign: '', start: 'c152' }, CTX);
    expect(t.pilot.name).toBe('Jo Bloggs');
    expect(t.company.name).toBe('north star aviation');
    expect(t.company.callsign).toBe('North');
  });

  it('derives the callsign word from the first word with letters, and tidies a typed one the same way', () => {
    expect(defaultCallsign('Fable Air')).toBe('Fable');
    expect(defaultCallsign('123 skyways ltd')).toBe('Skyways');
    expect(defaultCallsign("o'neill air")).toBe('Oneill');
    expect(defaultCallsign('---')).toBe('Fable');
    expect(normaliseCallsign('  speedbird  two', 'Fable Air')).toBe('Speedbird');
    expect(normaliseCallsign('42', 'Kestrel Aviation')).toBe('Kestrel');
    expect(createCareer({ pilotName: 'A', companyName: 'Fable Air', callsign: 'redwing', start: 'c152' }, CTX).company.callsign).toBe('Redwing');
  });

  it('makes a save that validates with nothing dropped and survives a JSON round trip unchanged', () => {
    const s = createCareer({ pilotName: 'Ann', companyName: 'Fable Air', callsign: '', start: 'c172s' }, { ...CTX, licence: 'declared' });
    const r = validateCareerSave(JSON.parse(JSON.stringify(s)));
    expect(r).not.toBeNull();
    expect(r!.dropped).toEqual([]);
    expect(r!.save).toEqual(s);
  });

  it('is deterministic: the same form and context give the same save', () => {
    const form = { pilotName: 'Ann', companyName: 'Fable Air', callsign: '', start: 'c152' as const };
    expect(createCareer(form, CTX)).toEqual(createCareer(form, CTX));
  });

  it('writes nothing through the store until save', () => {
    const kv = memoryStore();
    const store = new CareerStore(kv, 'mem');
    const s = store.create({ pilotName: 'Ann', companyName: 'Fable Air', callsign: '', start: 'c152' }, CTX);
    expect(kv.data.size).toBe(0);
    expect(store.save(s)).toBe(true);
    expect(new CareerStore(kv, 'mem').load()).toEqual(s);
  });
});
