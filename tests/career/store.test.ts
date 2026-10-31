// Proves the Career store, save validation and resume block (src/career/store.ts, validate.ts, block.ts): a full
// save (fleet, active job, last settlement, logbook) round-trips exactly; the previous good copy is kept in .prev
// and restores an unreadable save; quota, throwing and missing storages leave the career in memory ('memoryOnly')
// without throwing; unknown fields are dropped at every level, a bad fleet entry or logbook line is dropped and
// not the save, and an active job placed without a loading (or with its aircraft gone) is dropped to null; a job's
// committed charges (1c's contract addition) survive a reload; the schema guard rejects other schemas and opens a
// newer one read-only; export and import; the debounced save and flush; cstore= picks the right storage and guards
// sessionStorage; the store reports its kind; the block keeps only { v, jobId, aircraftUid, monitor }; the key is
// fs.career.v1 and nothing touches fs.training.v1.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateCareerBlock } from '../../src/career/block';
import { createCareer } from '../../src/career/create';
import { careerBackupKey, careerExportFileName, careerKv, CareerStore, migrateCareer, sessionKv } from '../../src/career/store';
import {
  CAREER_KEY, CAREER_PREV_KEY, CAREER_SAVE_DEBOUNCE_MS, type ActiveJob, type CareerSave, type JobFlightReport, type Settlement,
} from '../../src/career/types';
import { validateCareerSave } from '../../src/career/validate';
import type { KeyValueStore } from '../../src/sim/resume';
import { memoryStore } from '../../src/training/career/store';

/** Web Storage with a quota: setItem throws QuotaExceededError beyond `capacity` characters in total. */
class QuotaStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  constructor(public capacity: number) {}
  private used(except?: string): number {
    let n = 0;
    for (const [k, v] of this.data) if (k !== except) n += k.length + v.length;
    return n;
  }
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void {
    if (this.used(k) + k.length + v.length > this.capacity) {
      const e = new Error('quota') as Error & { name: string };
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.data.set(k, v);
  }
  removeItem(k: string): void { this.data.delete(k); }
}

/** A storage whose every access throws (a blocked or sandboxed page). */
const throwingStore: KeyValueStore = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('SecurityError'); },
  removeItem: () => { throw new Error('SecurityError'); },
};

const WEATHER = {
  windDirectionDeg: 250, windSpeedKt: 8, gustKt: 0, turbulence: 0.1, isaDeviation: 0, qnhHpa: 1013, cloudCover: 0.3,
  cloudBaseM: 1200, cloudTopM: 1800, visibilityM: 30000, timeOfDay: 10, dayOfYear: 160, cirrusCover: 0.2, precipType: 'none',
  storms: [{ northM: 1000, eastM: 2000, radiusM: 2000, topM: 9000, intensity: 0.5, motionDeg: 270, motionKt: 15 }],
};

function report(o: Partial<JobFlightReport> = {}): JobFlightReport {
  return {
    outcome: 'completed', atField: 'KELM', position: { north: 1000, east: 2000 }, elapsedMin: 42, blockS: 2400,
    airborneS: 1800, nightS: 0, landingsDay: 1, landingsNight: 0, takeoffs: 1,
    landing: { score: 82, sinkFpm: 240, bounces: 0, firstWheel: 'left', helicopter: false, onTarget: true, distAimFt: 120, centrelineM: 1.5 },
    comfort: { score: 91, deductions: { vertical: 3, lateral: 2, bank: 1, pitch: 0, descent: 0, stall: 0, landing: 3 } },
    maxG: 1.4, minG: 0.7, overspeedS: 0, stallWarningS: 0, fuelAtEndKg: 30, onApron: true, onRunway: false,
    waypointsDone: 0, waypointsTotal: 0, ...o,
  };
}

function activeJob(o: Partial<ActiveJob> = {}): ActiveJob {
  return {
    offer: {
      id: '1-HOME-0', kind: 'charter', day: 1, origin: 'HOME', destination: { kind: 'field', code: 'KELM' },
      client: 'Elmley Garden Centre', title: '1 passenger to Elmley', pax: 1,
      payload: [{ kind: 'passenger', label: 'Passenger 1', kg: 77 }, { kind: 'baggage', label: 'Bag', kg: 10 }],
      payloadKg: 87, distanceNm: 18.4, pay: 410, deadlineMin: 70, minClass: 'trainer', refType: 'c152', repRequired: 0,
      premium: false, weather: 'fair', windDirDeg: 240, windKt: 9,
    },
    aircraftUid: 'a1', type: 'c152', fuelKg: 60,
    loading: { payload: 164, payloadPosition: { x: 0.1, y: 0, z: 0.2 }, payloadDistribution: [{ fraction: 1, offset: { x: 0, y: 0.3, z: 0 } }] },
    items: [{ kind: 'passenger', label: 'Passenger 1', kg: 77, station: 'front' }, { kind: 'baggage', label: 'Bag', kg: 10, station: 'baggage' }],
    phase: 'airborne', placed: true, acceptedAtMin: 1920, elapsedBaseS: 0, elapsedS: 900,
    lastKnown: { north: 500, east: 600, onGround: false }, everAirborne: true, playerWeather: WEATHER as ActiveJob['playerWeather'],
    charges: { fuelUsd: 34, defuelCreditUsd: 0, stopFeesUsd: 12 },
    ...o,
  };
}

function settlement(): Settlement {
  return {
    offerId: '1-HOME-0', outcome: 'completed',
    lines: [{ id: 'base', label: 'Base pay', amount: 410 }, { id: 'landingFee', label: 'Landing fee', amount: -12 }],
    net: 398, repLines: [{ reason: 'Completed', delta: 2 }], repDelta: 2, cashAfter: 5398, repAfter: 22,
    rankBefore: 'junior', rankAfter: 'junior', aircraftAt: 'KELM', report: report(),
    logEntry: {
      id: 'L1', day: 1, clockMin: 1920, kind: 'job', type: 'c152', cls: 'trainer', registration: 'G-ABCD', from: 'HOME', to: 'KELM',
      jobKind: 'charter', jobId: '1-HOME-0', outcome: 'completed', blockS: 2400, airborneS: 1800, nightS: 0, landingsDay: 1,
      landingsNight: 0, net: 398, repDelta: 2, remarks: '',
    },
    summary: 'A safe flight. Good landing. Watch the descent.',
  };
}

/** A full save: two aircraft, an active job, a last settlement and logbook lines. */
function fullSave(o: Partial<CareerSave> = {}): CareerSave {
  const base = createCareer({ pilotName: 'Ann Pilot', companyName: 'Fable Air', callsign: '', start: 'c152' },
    { seed: 0, licence: 'declared', authority: 'easa', homeCode: 'HOME', now: 1_790_000_000_000 });
  return {
    ...base,
    cash: 5398, reputation: 22,
    ratings: ['sep', 'heli'],
    fleet: [base.fleet[0], { uid: 'a2', type: 'r22', tenure: 'owned', registration: 'G-HELI', field: 'HOME', fuelKg: 40, hours: 3.2, acquiredDay: 2, groundedUntilDay: 4 }],
    taken: ['1-HOME-0'],
    active: activeJob(),
    lastSettlement: settlement(),
    logbook: [settlement().logEntry, { ...settlement().logEntry, id: 'L2', kind: 'lease', remarks: 'Leased' }],
    flightNo: 3, ownNo: 2,
    ...o,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CareerStore: the save', () => {
  it('has no career until one is saved, then round-trips a full save exactly under fs.career.v1', () => {
    const kv = memoryStore();
    const store = new CareerStore(kv, 'mem');
    expect(store.load()).toBeNull();
    expect(store.current).toBeNull();
    const s = fullSave();
    expect(store.save(s)).toBe(true);
    expect(store.status).toBe('ok');
    expect([...kv.data.keys()]).toEqual([CAREER_KEY]);
    expect(CAREER_KEY).toBe('fs.career.v1');
    const back = new CareerStore(kv, 'mem');
    expect(back.load()).toEqual(s);
    expect(back.current).toEqual(s);
    expect(back.lastDropped).toEqual([]);
  });

  it('keeps the previous good value in .prev and restores it when the save is unreadable', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kv = memoryStore();
    const store = new CareerStore(kv, 'local');
    const a = fullSave({ cash: 100 });
    const b = fullSave({ cash: 200 });
    store.save(a);
    store.save(b);
    expect(JSON.parse(kv.getItem(CAREER_PREV_KEY)!)).toEqual(a);
    kv.setItem(CAREER_KEY, '{"format":"fs-career", trunc');
    const s2 = new CareerStore(kv, 'local');
    expect(s2.load()).toEqual(a);
    expect(s2.recoveredFromPrev).toBe(true);
    // The recovered copy is written back as the save.
    expect(JSON.parse(kv.getItem(CAREER_KEY)!)).toEqual(a);
  });

  it('never copies an unreadable stored value into .prev', () => {
    const kv = memoryStore();
    kv.setItem(CAREER_KEY, 'garbage');
    new CareerStore(kv).save(fullSave());
    expect(kv.getItem(CAREER_PREV_KEY)).toBeNull();
  });

  it('falls back to .prev when the top level is invalid, and to nothing when neither validates', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kv = memoryStore();
    const a = fullSave();
    kv.setItem(CAREER_PREV_KEY, JSON.stringify(a));
    kv.setItem(CAREER_KEY, JSON.stringify({ ...a, cash: 'lots' }));
    expect(new CareerStore(kv).load()).toEqual(a);
    kv.setItem(CAREER_PREV_KEY, 'x');
    kv.setItem(CAREER_KEY, JSON.stringify({ ...a, pilot: null }));
    expect(new CareerStore(kv).load()).toBeNull();
  });

  it('goes memory-only without throwing on a quota failure, and back to ok when a write fits', () => {
    const kv = new QuotaStore(100);
    const store = new CareerStore(kv);
    const s = fullSave();
    expect(() => store.save(s)).not.toThrow();
    expect(store.save(s)).toBe(false);
    expect(store.status).toBe('memoryOnly');
    expect(store.current).toEqual(s);
    expect(kv.data.size).toBe(0);
    kv.capacity = 1e7;
    expect(store.save(s)).toBe(true);
    expect(store.status).toBe('ok');
  });

  it('survives a storage whose every access throws, and one that is missing', () => {
    for (const kv of [throwingStore, null]) {
      const store = new CareerStore(kv);
      expect(() => store.load()).not.toThrow();
      expect(store.load()).toBeNull();
      const s = fullSave();
      expect(() => store.save(s)).not.toThrow();
      expect(store.status).toBe('memoryOnly');
      expect(store.current).toEqual(s);
      expect(() => store.reset()).not.toThrow();
      expect(() => { store.saveSoon(s); store.flush(); }).not.toThrow();
    }
  });

  it('goes memory-only when the write does not read back', () => {
    const kv = memoryStore();
    const liar: KeyValueStore = { getItem: (k) => kv.getItem(k), setItem: () => {}, removeItem: (k) => kv.removeItem(k) };
    const store = new CareerStore(liar);
    expect(store.save(fullSave())).toBe(false);
    expect(store.status).toBe('memoryOnly');
  });

  it('debounces saveSoon by 500 ms, and flush writes at once', () => {
    vi.useFakeTimers();
    const kv = memoryStore();
    const store = new CareerStore(kv);
    const s = fullSave();
    store.saveSoon(s);
    expect(store.current).toEqual(s);
    expect(kv.getItem(CAREER_KEY)).toBeNull();
    vi.advanceTimersByTime(CAREER_SAVE_DEBOUNCE_MS - 1);
    expect(kv.getItem(CAREER_KEY)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(JSON.parse(kv.getItem(CAREER_KEY)!)).toEqual(s);
    const t = fullSave({ cash: 1 });
    store.saveSoon(t);
    store.flush();
    expect(JSON.parse(kv.getItem(CAREER_KEY)!)).toEqual(t);
    // A save() cancels a pending saveSoon.
    store.saveSoon(fullSave({ cash: 2 }));
    store.save(fullSave({ cash: 3 }));
    vi.advanceTimersByTime(CAREER_SAVE_DEBOUNCE_MS * 2);
    expect(JSON.parse(kv.getItem(CAREER_KEY)!).cash).toBe(3);
  });

  it('reset removes the save, its previous copy and backups', () => {
    const kv = memoryStore();
    const store = new CareerStore(kv);
    store.save(fullSave());
    store.save(fullSave({ cash: 1 }));
    kv.setItem(careerBackupKey(0), '{}');
    store.reset();
    expect(kv.data.size).toBe(0);
    expect(store.current).toBeNull();
    expect(store.load()).toBeNull();
  });
});

describe('CareerStore: schema guard and migration', () => {
  it('rejects another format or schema 0 with no migration, writing the backup first', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kv = memoryStore();
    const old = JSON.stringify({ ...fullSave(), schema: 0 });
    kv.setItem(CAREER_KEY, old);
    expect(new CareerStore(kv).load()).toBeNull();
    expect(kv.getItem(careerBackupKey(0))).toBe(old);
    expect(() => migrateCareer({}, 0)).toThrow(/no migration/);
    expect(validateCareerSave({ ...fullSave(), format: 'fs-training' })).toBeNull();
    expect(validateCareerSave({ ...fullSave(), schema: 2 })).toBeNull();
  });

  it('opens a newer schema read-only and never overwrites it', () => {
    const kv = memoryStore();
    const newer = JSON.stringify({ ...fullSave(), schema: 2, future: true });
    kv.setItem(CAREER_KEY, newer);
    const store = new CareerStore(kv);
    const s = store.load();
    expect(s).not.toBeNull();
    expect(s!.schema).toBe(1);
    expect(store.status).toBe('readOnly');
    expect(store.save(s!)).toBe(false);
    expect(kv.getItem(CAREER_KEY)).toBe(newer);
  });
});

describe('validateCareerSave', () => {
  it('drops unknown fields at every level', () => {
    const s = fullSave() as unknown as Record<string, unknown> & CareerSave;
    const dirty = JSON.parse(JSON.stringify(s)) as Record<string, any>;
    dirty.extra = 1;
    dirty.pilot.age = 30;
    dirty.company.logo = 'x';
    dirty.fleet[0].colour = 'red';
    dirty.active.extra = 1;
    dirty.active.offer.extra = 1;
    dirty.active.offer.payload[0].extra = 1;
    dirty.active.offer.destination.extra = 1;
    dirty.active.loading.extra = 1;
    dirty.active.items[0].extra = 1;
    dirty.active.lastKnown.extra = 1;
    dirty.active.playerWeather.unknownKnob = 3;
    dirty.active.charges.extra = 1;
    dirty.lastSettlement.extra = 1;
    dirty.lastSettlement.report.extra = 1;
    dirty.lastSettlement.report.comfort.deductions.extra = 1;
    dirty.lastSettlement.report.landing.extra = 1;
    dirty.lastSettlement.logEntry.extra = 1;
    dirty.lastSettlement.lines[0].extra = 1;
    dirty.logbook[1].extra = 1;
    dirty.settings.extra = 1;
    const r = validateCareerSave(dirty);
    expect(r).not.toBeNull();
    expect(r!.save).toEqual(s);
    expect(r!.dropped).toEqual([]);
  });

  it('drops a bad fleet entry, a duplicate uid and a bad logbook line, not the save', () => {
    const s = fullSave({ active: null });
    const dirty = JSON.parse(JSON.stringify(s));
    dirty.fleet.push({ uid: 'a3', type: 'da42', tenure: 'leased', registration: 'G-XXXX', field: 'HOME', fuelKg: 1, hours: 0, acquiredDay: 1 });
    dirty.fleet.push({ ...dirty.fleet[0], registration: 'G-DUPE' });
    dirty.fleet.push('junk');
    dirty.logbook.push({ ...dirty.logbook[0], id: 'L3', blockS: -1 });
    dirty.logbook.push({ ...dirty.logbook[0] });
    const r = validateCareerSave(dirty)!;
    expect(r.save.fleet).toEqual(s.fleet);
    expect(r.save.logbook).toEqual(s.logbook);
    expect(r.save.cash).toBe(s.cash);
    expect(r.dropped).toEqual(expect.arrayContaining(['fleet[2]: invalid', 'fleet[4]: invalid', 'fleet[3]: duplicate uid a1', 'logbook[2]: invalid', 'logbook[3]: duplicate id L1']));
  });

  it('drops an active job placed without a loading to null, keeping the rest', () => {
    const r = validateCareerSave(JSON.parse(JSON.stringify(fullSave({ active: activeJob({ placed: true, loading: null }) }))))!;
    expect(r.save.active).toBeNull();
    expect(r.save.fleet).toHaveLength(2);
    expect(r.dropped).toContain('active: placed without a loading, dropped');
    // Unplaced with no loading is a job waiting for a type switch: kept.
    const waiting = activeJob({ placed: false, loading: null, phase: 'dispatched' });
    expect(validateCareerSave(JSON.parse(JSON.stringify(fullSave({ active: waiting }))))!.save.active).toEqual(waiting);
  });

  it('drops an active job whose aircraft is gone or of another type, or stopped with no field', () => {
    const gone = validateCareerSave(JSON.parse(JSON.stringify(fullSave({ active: activeJob({ aircraftUid: 'a9' }) }))))!;
    expect(gone.save.active).toBeNull();
    const other = validateCareerSave(JSON.parse(JSON.stringify(fullSave({ active: activeJob({ type: 'r22' }) }))))!;
    expect(other.save.active).toBeNull();
    const stopped = validateCareerSave(JSON.parse(JSON.stringify(fullSave({ active: activeJob({ phase: 'stopped' }) }))))!;
    expect(stopped.save.active).toBeNull();
    const held = activeJob({ phase: 'stopped', stoppedAt: 'KELM', pendingReport: report({ outcome: 'crashed', atField: null, landing: null, crashReason: 'Wing struck the ground' }) });
    expect(validateCareerSave(JSON.parse(JSON.stringify(fullSave({ active: held }))))!.save.active).toEqual(held);
  });

  it('keeps an active job\'s committed charges through a reload, and drops a job whose charges are malformed', () => {
    const kv = memoryStore();
    new CareerStore(kv).save(fullSave());
    expect(new CareerStore(kv).load()!.active!.charges).toEqual({ fuelUsd: 34, defuelCreditUsd: 0, stopFeesUsd: 12 });
    const bad = JSON.parse(JSON.stringify(fullSave()));
    bad.active.charges.fuelUsd = 'x';
    const r = validateCareerSave(bad)!;
    expect(r.save.active).toBeNull();
    expect(r.dropped).toContain('active: invalid charges, dropped');
    // A job without charges (before the CareerSystem records any) is kept without the field.
    const none = activeJob();
    delete none.charges;
    expect(validateCareerSave(JSON.parse(JSON.stringify(fullSave({ active: none }))))!.save.active).toEqual(none);
  });

  it('drops a malformed last settlement to null and repairs the selection, counters and settings', () => {
    const dirty = JSON.parse(JSON.stringify(fullSave())) as Record<string, any>;
    dirty.lastSettlement.report.comfort.deductions.stall = 'x';
    dirty.selectedUid = 'a9';
    dirty.flightNo = 0;
    dirty.ownNo = 1.5;
    dirty.settings = { companyCallsign: 'yes' };
    dirty.ratings = ['heli', 'jet'];
    dirty.reputation = 140;
    const r = validateCareerSave(dirty)!;
    expect(r.save.lastSettlement).toBeNull();
    expect(r.save.selectedUid).toBe('a1');
    expect(r.save.flightNo).toBe(1);
    expect(r.save.ownNo).toBe(1);
    expect(r.save.settings).toEqual({ companyCallsign: true });
    expect(r.save.ratings).toEqual(['sep', 'heli']);
    expect(r.save.reputation).toBe(100);
    expect(r.dropped.length).toBeGreaterThanOrEqual(7);
  });

  it('rejects the whole file only for a broken top level', () => {
    const s = fullSave();
    for (const bad of [null, [], 'x', { ...s, pilot: { name: 'A', licence: 'stolen' } }, { ...s, company: undefined },
      { ...s, seed: 'zero' }, { ...s, clockMin: Number.NaN }, { ...s, reputation: null }]) {
      expect(validateCareerSave(JSON.parse(JSON.stringify(bad ?? null)))).toBeNull();
    }
  });
});

describe('CareerStore: export and import', () => {
  it('exports a wrapper that imports back to the same save, and accepts a bare save', () => {
    const kv = memoryStore();
    const store = new CareerStore(kv);
    const s = fullSave();
    const json = store.exportJson(s, 'test-build', new Date('2026-10-31T12:00:00Z'));
    const file = JSON.parse(json);
    expect(file).toMatchObject({ format: 'fs-career', version: 1, exportedAt: '2026-10-31T12:00:00.000Z', app: { build: 'test-build' } });
    expect(store.previewImport(json)).toEqual(s);
    expect(kv.data.size).toBe(0);   // a preview writes nothing
    const other = new CareerStore(memoryStore());
    expect(other.importJson(json)).toEqual(s);
    expect(other.load()).toEqual(s);
    expect(store.previewImport(JSON.stringify(s))).toEqual(s);
    expect(careerExportFileName(s, new Date('2026-10-31T12:00:00Z'))).toBe('fs-career-fable-air-2026-10-31.json');
  });

  it('refuses with a reason, writing nothing, files it cannot use', () => {
    const kv = memoryStore();
    const store = new CareerStore(kv);
    expect(() => store.importJson('{')).toThrow(/not valid JSON/);
    expect(() => store.importJson(JSON.stringify({ format: 'fs-training', data: {} }))).toThrow(/not a Career export/);
    expect(() => store.importJson(JSON.stringify({ format: 'fs-career', data: 3 }))).toThrow(/no career data/);
    expect(() => store.importJson(JSON.stringify({ format: 'fs-career', data: { ...fullSave(), schema: 9 } }))).toThrow(/newer version/);
    expect(() => store.importJson(JSON.stringify({ format: 'fs-career', data: { ...fullSave(), schema: 0 } }))).toThrow(/can't be upgraded/);
    expect(() => store.importJson(JSON.stringify({ format: 'fs-career', data: { ...fullSave(), cash: null } }))).toThrow(/damaged/);
    expect(kv.data.size).toBe(0);
  });
});

describe('cstore: the storage kind', () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  afterEach(() => {
    if (desc) Object.defineProperty(globalThis, 'sessionStorage', desc);
    else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  it('reports its kind', () => {
    for (const kind of ['local', 'mem', 'session'] as const) expect(new CareerStore(memoryStore(), kind).kind).toBe(kind);
    expect(new CareerStore(null).kind).toBe('local');
    expect(CareerStore.forKind('mem').kind).toBe('mem');
  });

  it('uses a fresh in-memory map for mem', () => {
    const a = careerKv('mem')!, b = careerKv('mem')!;
    a.setItem('k', 'v');
    expect(a.getItem('k')).toBe('v');
    expect(b.getItem('k')).toBeNull();
  });

  it('uses sessionStorage for session, and none where it is missing or throws on access', () => {
    const fake = memoryStore();
    Object.defineProperty(globalThis, 'sessionStorage', { value: fake, configurable: true, writable: true });
    expect(careerKv('session')).toBe(fake);
    const store = CareerStore.forKind('session');
    expect(store.save(fullSave())).toBe(true);
    expect(fake.data.has(CAREER_KEY)).toBe(true);

    Object.defineProperty(globalThis, 'sessionStorage', { get: () => { throw new Error('SecurityError'); }, configurable: true });
    expect(() => sessionKv()).not.toThrow();
    expect(careerKv('session')).toBeNull();
    const blocked = CareerStore.forKind('session');
    expect(blocked.save(fullSave())).toBe(false);
    expect(blocked.status).toBe('memoryOnly');

    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    expect(careerKv('session')).toBeNull();
  });

  it('guards a sessionStorage whose methods throw', () => {
    Object.defineProperty(globalThis, 'sessionStorage', { value: throwingStore, configurable: true, writable: true });
    const store = CareerStore.forKind('session');
    expect(() => store.load()).not.toThrow();
    expect(store.save(fullSave())).toBe(false);
    expect(store.status).toBe('memoryOnly');
  });
});

describe('validateCareerBlock', () => {
  it('keeps exactly v, jobId, aircraftUid and monitor, dropping an old block\'s loading', () => {
    const monitor = { phase: 'airborne', t: 12 };
    const b = validateCareerBlock({ v: 1, jobId: '1-HOME-0', aircraftUid: 'a1', monitor, loading: { payload: 77 }, extra: true });
    expect(b).toEqual({ v: 1, jobId: '1-HOME-0', aircraftUid: 'a1', monitor });
    expect(Object.keys(b!).sort()).toEqual(['aircraftUid', 'jobId', 'monitor', 'v']);
    expect(b!.monitor).toBe(monitor);
    expect(validateCareerBlock({ v: 1, jobId: 'j', aircraftUid: 'a1' })).toEqual({ v: 1, jobId: 'j', aircraftUid: 'a1', monitor: null });
  });

  it('rejects a missing or empty jobId or aircraftUid, and v other than 1', () => {
    for (const bad of [
      null, undefined, 'x', [], { jobId: 'j', aircraftUid: 'a1', monitor: null }, { v: 2, jobId: 'j', aircraftUid: 'a1' },
      { v: '1', jobId: 'j', aircraftUid: 'a1' }, { v: 1, aircraftUid: 'a1' }, { v: 1, jobId: '', aircraftUid: 'a1' },
      { v: 1, jobId: 'j' }, { v: 1, jobId: 'j', aircraftUid: '' }, { v: 1, jobId: 3, aircraftUid: 'a1' },
    ]) expect(validateCareerBlock(bad)).toBeNull();
  });
});

describe('isolation from the Flight School', () => {
  it('only ever writes fs.career.v1 keys, never fs.training.v1', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    const kv = memoryStore();
    const touched = new Set<string>();
    const spy: KeyValueStore = {
      getItem: (k) => { touched.add(k); return kv.getItem(k); },
      setItem: (k, v) => { touched.add(k); kv.setItem(k, v); },
      removeItem: (k) => { touched.add(k); kv.removeItem(k); },
    };
    const store = new CareerStore(spy, 'local');
    store.load();
    const s = store.create({ pilotName: 'Ann', companyName: 'Fable Air', callsign: '', start: 'c152' },
      { seed: 0, licence: 'school', authority: 'easa', homeCode: 'HOME', now: 0 });
    store.save(s);
    store.saveSoon(fullSave());
    vi.advanceTimersByTime(CAREER_SAVE_DEBOUNCE_MS);
    store.flush();
    const json = store.exportJson(fullSave(), 'b', new Date(0));
    store.importJson(json);
    kv.setItem(CAREER_KEY, 'broken');
    new CareerStore(spy).load();
    store.reset();
    expect(touched.size).toBeGreaterThan(0);
    for (const k of touched) {
      expect(k.startsWith('fs.career.v1')).toBe(true);
      expect(k.startsWith('fs.training.v1')).toBe(false);
    }
  });
});
