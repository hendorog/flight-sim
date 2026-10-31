// The CareerSystem (src/career/CareerSystem.ts) against a fake shell (a memory or session store, a recording
// startFrom that resets a real SimPhysics and emits the Career's 'reset' as the Simulator's does, a recording persist)
// and a real flight model. It proves: Accept saves the store and persists before the curtain, places the player cold
// at the origin's stand with the load sheet's mass and fuel, the GPS on the destination, the COM on the origin's and
// the destination's frequencies and the job's weather; a C172S then started, flown round a third field's circuit and
// shut down there stops the job; a refuel there charges that field's fuel and, once, its landing fee, carries the job
// time across the re-placement; flown round the destination's circuit it completes, settles (the flight number moved
// once, by settleJob), gives the player's weather back, sets the start field to the destination and the next board
// comes from there. Also: a shutdown at the origin before take-off decides nothing; Give up charges a stop's fee once;
// a type switch saves the job before setAircraft('career') and a new system booted into that type on the same store
// places it; resumeBlock() is null for 'mem' and 'session' stores, before placement and for another booted type, and
// a 'local' block resumes the monitor in a new system (no snapshot: re-placed, or lost once airborne); seed mismatch,
// a running lesson, a second job and select during a job are refused; a foreign reset abandons at the origin; a
// crash waits as a pending report until the crash dialog's Debrief settles it (the Career's actions chained before
// the school's); an abandonment on the ground names its field, one just after lift-off counts as after take-off
// even before the save has caught up; at boot a placed job of another type waits (grounded) or is lost (flown) but
// is left alone under an explicit start, and nothing is settled or placed in another world; the idle lease of a settlement that crosses midnight
// is its own debrief line and the lines add up to the cash change; Reposition dispatches the page's own offer at the
// page's default fuel; Shift+R asks before abandoning (confirmReset) and the menu link sees the job; testArrive
// completes the job at the destination's stand as a test; radioIdentity() gives the airframe's registration and "Fable 12" with the company callsign,
// null outside Career mode; the pages follow the system (accept closes, a settlement opens the debrief); and 200
// boards at seeds 0 and 7 through the real load sheet at required fuel, for every class-eligible type, are ok or
// blocked only by a fit code (the boards and the load sheet agree).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { careerBootPlan, type CareerBootUrl } from '../../src/career/boot';
import { CareerSystem, type CareerShell } from '../../src/career/CareerSystem';
import { landingFee } from '../../src/career/costs';
import { createCareer } from '../../src/career/create';
import { fieldStand } from '../../src/career/geo';
import { chainCrashActions, type CrashActionsHost } from '../../src/career/index';
import { boardFor } from '../../src/career/jobs';
import { loadSheet } from '../../src/career/loadsheet';
import { CAREER_PERF } from '../../src/career/perf';
import { fuelOnBoardKg } from '../../src/career/runtime/monitor';
import { CareerStore } from '../../src/career/store';
import {
  CAREER_AIRCRAFT_IDS, CLOCK_RULES, FIXED_WING_CLASS_ORDER, ROTORCRAFT_CLASS_ORDER, START_RULES,
  type CareerAircraftId, type CareerSave, type CareerStoreKind, type FleetAircraft, type JobOffer, type RatingId,
} from '../../src/career/types';
import { defaultFuelKg } from '../../src/career/ui/widgets';
import { createEventBus, type EventBus, type SimContext } from '../../src/core/context';
import { defaultWeather, type AircraftState, type ControlInputs, type WeatherSettings } from '../../src/core/types';
import { gpsTarget, setGpsTarget } from '../../src/instruments/dynamics/navigation';
import { HOME_GROUND, radioTuning, resetRadios } from '../../src/instruments/dynamics/radios';
import type { FlightSnapshot } from '../../src/sim/resume';
import { buildScenario, type Scenario } from '../../src/sim/scenarios';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { setStartField, startField } from '../../src/sim/startField';
import { memoryStore } from '../../src/training/career/store';
import type { CrashAction } from '../../src/ui/overlays';
import { airfields, HOME_AIRFIELD, type Airfield } from '../../src/world/airfields';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { installFakeDom } from '../ui/fakeDom';
import { CircuitPilot, FRAME_DT, shutDownPiston, startPiston, type PilotHost } from './headlessJob';

const LONG = 300_000;
const URL0: CareerBootUrl = { explicit: false, open: false, resume: null };
const CALM: Partial<WeatherSettings> = { windSpeedKt: 0, gustKt: 0, turbulence: 0, timeOfDay: 12 };

let defs: Partial<Record<CareerAircraftId, AircraftDefinition>> = {};
const def = (t: CareerAircraftId): AircraftDefinition => defs[t]!;

beforeAll(async () => {
  setEra('present');
  setWorldSeed(0);
  defs = { c152: await loadAircraft('c152'), c172s: await loadAircraft('c172s') };
});
afterAll(() => {
  setStartField(null);
  setGpsTarget(null);
  setWorldSeed(0);
  resetRadios();
  vi.unstubAllGlobals();
});

/** A store on a fresh memory KV, of the given kind (the KV is shared when passed, as across a reload). */
function storeOf(kind: CareerStoreKind, kv = memoryStore()): CareerStore {
  return new CareerStore(kv, kind);
}

/** A new career at home (seed 0), cash and day as given; c172s first by default. */
function newSave(start: 'c152' | 'c172s' = 'c172s', over: Partial<CareerSave> = {}): CareerSave {
  return { ...createCareer({ pilotName: 'Test', companyName: 'Fable Air', callsign: '', start }, { seed: 0, licence: 'declared', authority: 'easa', homeCode: HOME_AIRFIELD.code, now: 0 }), ...over };
}

/** The fake shell around a real SimPhysics (see the header). */
class Host implements PilotHost {
  readonly physics: SimPhysics;
  readonly weather: WeatherSettings;
  readonly events: EventBus;
  readonly system: CareerSystem;
  readonly opts: { def: AircraftDefinition };
  /** Every save, persist, startFrom and setAircraft, in order. */
  readonly log: string[] = [];
  readonly startFroms: { sc: Scenario; lessonId: string; label: string }[] = [];
  readonly toasts: string[] = [];
  /** The store's raw save at each setAircraft call. */
  readonly savedAtSwitch: (CareerSave | null)[] = [];
  lesson = false;
  confirmAnswer = true;
  dt = 0;
  pilot: ((dt: number) => void) | null = null;

  constructor(readonly type: CareerAircraftId, readonly store: CareerStore, extra: Partial<CareerShell> = {}) {
    this.opts = { def: def(type) };
    this.weather = { ...defaultWeather(), ...CALM };
    this.events = createEventBus();
    this.physics = new SimPhysics({ weather: this.weather, events: this.events, aircraft: def(type) });
    const save = store.save.bind(store);
    store.save = (s) => {
      this.log.push('save');
      return save(s);
    };
    const shell: CareerShell = {
      physics: this.physics, weather: this.weather, store, aircraft: def(type), layer: null,
      startFrom: async (sc, o) => {
        this.log.push('startFrom');
        this.startFroms.push({ sc, ...o });
        this.physics.copilot = null;
        this.physics.resetTo(sc, this.weather);
        this.events.emit('reset', { scenario: sc.id, lessonId: o.lessonId });
      },
      setAircraft: (id, o) => {
        this.log.push(`setAircraft:${id}:${o.open}`);
        this.savedAtSwitch.push(storeOf('session', (store as unknown as { kv: ReturnType<typeof memoryStore> }).kv).load());
      },
      setHold: () => {},
      persist: () => this.log.push('persist'),
      frameSimDt: () => this.dt,
      toast: (t) => this.toasts.push(t),
      inLesson: () => this.lesson,
      confirm: (_t, yes) => {
        if (this.confirmAnswer) yes();
      },
      ...extra,
    };
    this.system = new CareerSystem(shell);
    this.system.init({ events: this.events } as unknown as SimContext);
  }

  get state(): AircraftState {
    return this.physics.state;
  }

  get controls(): ControlInputs {
    return this.physics.controls;
  }

  get save(): CareerSave {
    return this.system.save!;
  }

  frame(dt = FRAME_DT): void {
    this.pilot?.(dt);
    this.physics.step(dt);
    this.dt = dt;
    this.system.update();
    this.dt = 0;
  }

  run(seconds: number, until?: (h: PilotHost) => boolean): number {
    let t = 0;
    while (t < seconds - 1e-9) {
      this.frame();
      t += FRAME_DT;
      if (until?.(this)) break;
    }
    return t;
  }

  /** A Career re-placement lined up on `f`'s runway, engine running (taxiing is not scripted). */
  lineUp(f: Airfield): void {
    const j = this.save.active!;
    setStartField(f.kind === 'home' ? null : f.code);
    const sc = buildScenario('runway', this.physics.env, def(this.type));
    this.physics.resetTo({ ...sc, loading: j.loading!, ic: { ...sc.ic, fuelFraction: fuelOnBoardKg(this.state) / CAREER_PERF[this.type].usableFuelKg } }, this.weather);
    this.events.emit('reset', { scenario: 'runway', lessonId: `career:${j.offer.id}` });
  }

  /** Fly `f`'s circuit from lined up to a shutdown with the brake set; stops early when `until` holds. */
  circuit(f: Airfield, until: () => boolean): CircuitPilot {
    this.lineUp(f);
    Object.assign(this.weather, CALM);
    const pilot = new CircuitPilot(this, f);
    pilot.begin();
    this.pilot = (dt) => pilot.step(dt);
    this.run(900, () => until() || this.state.crashed);
    this.pilot = null;
    return pilot;
  }

  /** The log entries since `mark`. */
  since(mark: number): string[] {
    return this.log.slice(mark);
  }
}

/** A trainer or tourer offer on the home board (from day 1 on) to a sealed field, ok for `ac` at its default fuel. */
function findOffer(save: CareerSave, ac: FleetAircraft, fields: readonly Airfield[], pred: (o: JobOffer, dest: Airfield) => boolean): { offer: JobOffer; clockMin: number } {
  for (let day = 1; day < 40; day++) {
    const clockMin = day * 1440 + 8 * 60;
    const s = { ...save, clockMin };
    for (const o of boardFor(0, day, HOME_AIRFIELD.code, fields)) {
      if (o.destination.kind !== 'field' || o.kind === 'scenic') continue;
      const code = o.destination.code;
      const dest = fields.find((f) => f.code === code)!;
      if (!pred(o, dest)) continue;
      const probe = loadSheet(o, ac, ac.fuelKg, s, fields);
      if (loadSheet(o, ac, defaultFuelKg(probe, ac.fuelKg), s, fields).ok) return { offer: o, clockMin };
    }
  }
  throw new Error('no offer');
}

/** A host with a stored career on day `clock`, and the offer to accept. */
function hostWithOffer(type: 'c152' | 'c172s', kind: CareerStoreKind = 'mem', pred: (o: JobOffer, dest: Airfield) => boolean = (_o, d) => d.kind === 'sealed') {
  const fields = airfields();
  const base = newSave(type);
  const { offer, clockMin } = findOffer(base, base.fleet[0], fields, pred);
  const store = storeOf(kind);
  store.save({ ...base, clockMin });
  const h = new Host(type, store);
  const ac = h.save.fleet[0];
  const fuel = defaultFuelKg(loadSheet(offer, ac, ac.fuelKg, h.save, fields), ac.fuelKg);
  return { h, offer, fuel, fields, ac };
}

describe('CareerSystem: a job from accept to the next board', () => {
  it('accept, placement, a stop with a refuel, completion, settlement and the board at the destination', async () => {
    const fields = airfields();
    const sealed = fields.filter((f) => f.kind === 'sealed').sort((a, b) => b.length - a.length);
    const [D, S] = sealed;
    const { h, offer, fuel, ac } = hostWithOffer('c172s', 'mem', (o, d) => d.code === D.code && o.weather !== 'gusty');
    const sheet = loadSheet(offer, ac, fuel, h.save, fields);
    const cashBefore = h.save.cash;
    const flightNo = h.save.flightNo;

    // Accept: saved and persisted before the curtain, synchronously.
    const mark = h.log.length;
    const placed = h.system.accept(offer.id, ac.uid, fuel);
    expect(h.since(mark).slice(0, 3)).toEqual(['save', 'persist', 'save']);
    expect(h.since(mark)).toContain('startFrom');
    expect(h.since(mark).indexOf('persist')).toBeLessThan(h.since(mark).indexOf('startFrom'));
    expect(await placed).toBe('placed');
    const j = h.save.active!;
    expect(j.placed).toBe(true);
    expect(j.loading).not.toBeNull();
    expect(j.charges).toEqual({ fuelUsd: sheet.fuelCost, defuelCreditUsd: sheet.defuelCredit, stopFeesUsd: 0 });
    expect(h.save.taken).toContain(offer.id);
    expect(h.startFroms[0].lessonId).toBe(`career:${offer.id}`);
    expect(h.startFroms[0].label).toBe('Loading job');
    // Cold at the stand with the load sheet's mass and fuel.
    const stand = fieldStand(HOME_AIRFIELD);
    expect(Math.hypot(h.state.position.x - stand.north, h.state.position.y - stand.east)).toBeLessThan(5);
    expect(h.state.engine.running).toBe(false);
    expect(Math.abs(h.state.mass - sheet.takeoffKg)).toBeLessThan(0.1);
    expect(fuelOnBoardKg(h.state)).toBeCloseTo(fuel, 3);
    // The GPS, the radios and the job's weather.
    expect(gpsTarget().code).toBe(D.code);
    expect(radioTuning().com1).toEqual([HOME_GROUND, D.frequency]);
    expect(h.weather.windSpeedKt).toBe(offer.windKt);
    expect(h.weather.windDirectionDeg).toBe(offer.windDirDeg);
    expect(h.weather.timeOfDay).toBeCloseTo(8, 9);
    expect(h.system.destination()?.code).toBe(D.code);
    expect(h.system.resumeBlock()).toBeNull();   // a 'mem' store never writes one

    // Started, flown round S's circuit and shut down there: a stop.
    expect(startPiston(h)).toBeLessThan(10);
    h.circuit(S, () => h.save.active?.phase === 'stopped');
    expect(h.state.crashed).toBe(false);
    expect(h.save.active!.phase).toBe('stopped');
    expect(h.save.active!.stoppedAt).toBe(S.code);
    expect(h.save.active!.everAirborne).toBe(true);
    // The save holds the fuel aboard at the stop (a re-placement there puts back this, not the dispatch's).
    expect(h.save.active!.fuelKg).toBeCloseTo(fuelOnBoardKg(h.state), 6);
    expect(h.save.active!.fuelKg).toBeLessThan(fuel);

    // Refuel: S's price, S's landing fee (once), the job time carried across the re-placement.
    const before = h.system.jobMonitor!.elapsedS;
    const aboard = fuelOnBoardKg(h.state);
    const target = Math.min(CAREER_PERF.c172s.usableFuelKg, aboard + 40);
    const fuelUsdBefore = h.save.active!.charges!.fuelUsd;
    expect(await h.system.refuel(target)).toBe('placed');
    const after = h.save.active!;
    expect(after.phase).toBe('ground');
    expect(after.stoppedAt).toBeUndefined();
    expect(after.charges!.stopFeesUsd).toBe(landingFee('sealed', CAREER_PERF.c172s.mtowKg));
    expect(after.charges!.fuelUsd).toBeGreaterThan(fuelUsdBefore);
    expect(fuelOnBoardKg(h.state)).toBeCloseTo(target, 3);
    const stand2 = fieldStand(S);
    expect(Math.hypot(h.state.position.x - stand2.north, h.state.position.y - stand2.east)).toBeLessThan(5);
    expect(h.system.jobMonitor!.elapsedS).toBeCloseTo(before, 6);
    h.run(2);
    expect(h.system.jobMonitor!.elapsedS).toBeGreaterThan(before);

    // Started again, flown round D's circuit and shut down: completed and settled.
    expect(startPiston(h)).toBeLessThan(10);
    h.circuit(D, () => h.save.active === null);
    expect(h.state.crashed).toBe(false);
    const st = h.save.lastSettlement!;
    expect(st.outcome).toBe('completed');
    expect(st.aircraftAt).toBe(D.code);
    expect(h.save.active).toBeNull();
    expect(h.save.flightNo).toBe(flightNo + 1);
    expect(h.save.fleet[0].field).toBe(D.code);
    expect(startField()?.code).toBe(D.code);
    expect(st.lines.find((l) => l.id === 'landingFee')!.amount).toBe(-Math.round(landingFee('sealed', CAREER_PERF.c172s.mtowKg) * 2));
    expect(st.lines.reduce((a, l) => a + l.amount, 0)).toBe(h.save.cash - cashBefore);
    expect(h.weather.windSpeedKt).toBe(0);
    expect(h.system.board().every((o) => o.origin === D.code)).toBe(true);
    expect(h.system.board().length).toBeGreaterThan(0);
  }, LONG);
});

describe('CareerSystem: decisions on the ground', () => {
  it('a shutdown at the origin before take-off decides nothing', async () => {
    const { h, offer, fuel, ac } = hostWithOffer('c152');
    expect(await h.system.accept(offer.id, ac.uid, fuel)).toBe('placed');
    expect(Number.isFinite(startPiston(h))).toBe(true);
    h.run(10);
    shutDownPiston(h.controls);
    h.controls.parkingBrake = true;
    h.run(30);
    expect(h.save.active).not.toBeNull();
    expect(h.save.active!.phase).not.toBe('stopped');
    expect(h.save.lastSettlement).toBeNull();
  }, LONG);

  it('a foreign reset abandons the job at the origin; Abandon on the ground names its field', async () => {
    const { h, offer, fuel, ac } = hostWithOffer('c152');
    expect(await h.system.accept(offer.id, ac.uid, fuel)).toBe('placed');
    const rep = h.save.reputation;
    h.events.emit('reset', { scenario: 'runway' });
    const st = h.save.lastSettlement!;
    expect(st.outcome).toBe('abandoned');
    expect(st.report.atField).toBe(offer.origin);
    expect(st.aircraftAt).toBe(offer.origin);
    expect(h.save.reputation).toBe(rep - 2);
    expect(h.save.active).toBeNull();

    // Abandon (the strip) before any frame: the monitor's last position is unknown, the field is the origin's.
    const { h: h2, offer: o2, fuel: f2, ac: a2 } = hostWithOffer('c152');
    expect(await h2.system.accept(o2.id, a2.uid, f2)).toBe('placed');
    const mark = h2.log.length;
    expect(await h2.system.run({ kind: 'abandon' })).toBe('ok');
    expect(h2.since(mark).slice(0, 2)).toEqual(['save', 'persist']);
    expect(h2.save.lastSettlement!.report.atField).toBe(o2.origin);
  }, LONG);

  it('Give up at a stop charges that field’s landing fee once; Continue charges it once too', async () => {
    const fields = airfields();
    const S = fields.filter((f) => f.kind === 'grass')[0];
    for (const how of ['giveUp', 'continueJob'] as const) {
      const { h, offer, fuel, ac } = hostWithOffer('c152');
      expect(await h.system.accept(offer.id, ac.uid, fuel)).toBe('placed');
      // Held at S (the monitor's own state, as after a landing and shutdown there).
      const m = h.system.jobMonitor!;
      expect(m.restoreState({ ...m.exportState(), phase: 'stopped', stoppedAt: S.code, everAirborne: true })).toBe(true);
      h.save.active!.phase = 'stopped';
      h.save.active!.stoppedAt = S.code;
      h.save.active!.everAirborne = true;
      const fee = landingFee(S.kind, CAREER_PERF.c152.mtowKg);
      expect(await h.system.run({ kind: how })).toBe('ok');
      if (how === 'giveUp') {
        const st = h.save.lastSettlement!;
        expect(st.outcome).toBe('diverted');
        expect(st.aircraftAt).toBe(S.code);
        expect(st.lines.find((l) => l.id === 'landingFee')!.amount).toBe(-Math.round(fee));
      } else {
        expect(h.save.active!.charges!.stopFeesUsd).toBe(fee);
        expect(h.save.active!.phase).toBe('ground');
        h.run(1);
        expect(h.save.active!.charges!.stopFeesUsd).toBe(fee);
      }
    }
  }, LONG);

  it('a crash waits as a pending report until the crash dialog’s Debrief settles it', async () => {
    const { h, offer, fuel, ac } = hostWithOffer('c152');
    const host: CrashActionsHost = { crashActions: (r) => (r ? 'none' : null) };
    chainCrashActions(host, h.system);
    expect(host.crashActions!('x')).toBe('none');   // no job: the school's (here 'none') answers
    expect(await h.system.accept(offer.id, ac.uid, fuel)).toBe('placed');
    const actions = host.crashActions!('Test crash');
    expect(Array.isArray(actions)).toBe(true);
    h.events.emit('crash', { reason: 'Test crash' });
    const j = h.save.active!;
    expect(j.pendingReport?.outcome).toBe('crashed');
    expect(h.save.lastSettlement).toBeNull();
    const debrief = (actions as CrashAction[]).find((a) => a.label === 'Debrief')!;
    debrief.run();
    await Promise.resolve();
    const st = h.save.lastSettlement!;
    expect(st.outcome).toBe('crashed');
    expect(st.groundedUntilDay).toBeDefined();
    expect(h.save.active).toBeNull();
  }, LONG);
});

describe('CareerSystem: the shell’s links', () => {
  it('Shift+R asks first: no keeps the job, yes abandons it and resets; the menu link sees the job', async () => {
    const { h, offer, fuel, ac } = hostWithOffer('c152');
    let resets = 0;
    expect(h.system.confirmReset(() => resets++)).toBe(false);   // no job: the caller resets as usual
    expect(await h.system.accept(offer.id, ac.uid, fuel)).toBe('placed');
    expect(h.system.menuLink.jobActive()).toBe(true);
    h.confirmAnswer = false;
    expect(h.system.confirmReset(() => resets++)).toBe(true);
    expect([resets, h.save.active?.offer.id]).toEqual([0, offer.id]);
    h.confirmAnswer = true;
    expect(h.system.confirmReset(() => resets++)).toBe(true);
    expect(resets).toBe(1);
    expect(h.save.active).toBeNull();
    expect(h.save.lastSettlement!.outcome).toBe('abandoned');
    expect(h.system.menuLink.jobActive()).toBe(false);
    expect(h.system.modalLink.screenOpen()).toBe(false);
  }, LONG);

  it('testArrive (memory store) stands the aircraft at the destination and completes the job as a test', async () => {
    const { h, offer, fuel, ac } = hostWithOffer('c152');
    expect(await h.system.accept(offer.id, ac.uid, fuel)).toBe('placed');
    expect(await h.system.testArrive()).toBe('ok');
    const st = h.save.lastSettlement!;
    const dest = (offer.destination as { code: string }).code;
    expect(st.outcome).toBe('completed');
    expect(st.aircraftAt).toBe(dest);
    expect(st.report.test).toBe(true);
    expect(st.logEntry.remarks).toContain('(test)');
    const stand = fieldStand(airfields().find((f) => f.code === dest)!);
    expect(Math.hypot(h.state.position.x - stand.north, h.state.position.y - stand.east)).toBeLessThan(5);
    expect(startField()?.code).toBe(dest);
  }, LONG);
});

describe('CareerSystem: refusals', () => {
  it('refuses another world seed, a running lesson, a second job and select during a job', async () => {
    const { h, offer, fuel, ac } = hostWithOffer('c152');
    h.lesson = true;
    expect(await h.system.accept(offer.id, ac.uid, fuel)).toBe('Finish or end the lesson first');
    expect(h.system.radioIdentity()).toBeNull();
    h.lesson = false;
    expect(await h.system.accept(offer.id, ac.uid, fuel)).toBe('placed');
    const other = h.system.board().find((o) => o.id !== offer.id)!;
    expect(await h.system.accept(other.id, ac.uid, fuel)).toMatch(/One job at a time/);
    expect(await h.system.run({ kind: 'select', uid: ac.uid })).toMatch(/job/);
    expect(await h.system.run({ kind: 'rest' })).toMatch(/Finish or abandon/);

    const store = storeOf('mem');
    store.save(newSave('c152', { seed: 7 }));
    const h7 = new Host('c152', store);
    expect(h7.system.board()).toEqual([]);
    expect(await h7.system.accept(offer.id, 'a1', fuel)).toMatch(/world seed 7/);
  }, LONG);
});

describe('CareerSystem: type switch, resume block and boot', () => {
  it('saves the job before setAircraft(career) and a new system booted into that type places it', async () => {
    const fields = airfields();
    const kv = memoryStore();
    const store = storeOf('session', kv);
    // A C152 career that also leases a C172S at home; the C152 is booted.
    const base = newSave('c152');
    const c172: FleetAircraft = { ...base.fleet[0], uid: 'a2', type: 'c172s', registration: 'G-TEST', fuelKg: CAREER_PERF.c172s.deliveryFuelKg };
    const { offer, clockMin } = findOffer(base, c172, fields, (_o, d) => d.kind !== 'home');
    store.save({ ...base, clockMin, fleet: [...base.fleet, c172], selectedUid: 'a2' });
    const h = new Host('c152', store);
    const fuel = defaultFuelKg(loadSheet(offer, c172, c172.fuelKg, h.save, fields), c172.fuelKg);
    expect(await h.system.accept(offer.id, 'a2', fuel)).toBe('reloading');
    expect(h.log.at(-1)).toBe('setAircraft:c172s:career');
    const atSwitch = h.savedAtSwitch[0]!;
    expect(atSwitch.active?.offer.id).toBe(offer.id);
    expect(atSwitch.active?.placed).toBe(false);
    expect(atSwitch.active?.loading).toBeNull();
    expect(h.system.resumeBlock()).toBeNull();
    expect(h.startFroms).toEqual([]);

    // The reload: the same store, the C172S booted.
    const store2 = storeOf('session', kv);
    const saved = store2.load();
    const plan = careerBootPlan(saved, null, 'c172s', { ...URL0, open: true }, 'session');
    expect(plan.action).toBe('place');
    const h2 = new Host('c172s', store2);
    await h2.system.afterBoot({ resumed: null, plan });
    expect(h2.startFroms.length).toBe(1);
    expect(h2.save.active!.placed).toBe(true);
    expect(h2.save.active!.loading).not.toBeNull();
    expect(h2.system.resumeBlock()).toBeNull();   // 'session' never writes one
    const sheet = loadSheet(offer, c172, fuel, saved!, fields);
    expect(Math.abs(h2.state.mass - sheet.takeoffKg)).toBeLessThan(0.1);

    // With the memory store a type switch is refused.
    const mem = storeOf('mem');
    mem.save({ ...base, clockMin, fleet: [...base.fleet, c172], selectedUid: 'a2' });
    const h3 = new Host('c152', mem);
    expect(await h3.system.accept(offer.id, 'a2', fuel)).toMatch(/memory only/);
    expect(h3.save.active).toBeNull();
  }, LONG);

  it('a local store writes the block once placed; a new system resumes the monitor from it, or falls back', async () => {
    const kv = memoryStore();
    const { offer, fuel, ac, fields } = hostWithOffer('c152');
    const base = newSave('c152');
    const { clockMin } = findOffer(base, base.fleet[0], fields, (o) => o.id === offer.id);
    const store = storeOf('local', kv);
    store.save({ ...base, clockMin });
    const h = new Host('c152', store);
    expect(await h.system.accept(offer.id, ac.uid, fuel)).toBe('placed');
    expect(Number.isFinite(startPiston(h))).toBe(true);
    h.run(3);
    const block = h.system.resumeBlock()!;
    expect(block.jobId).toBe(offer.id);
    expect(block.aircraftUid).toBe('a1');
    // Not for another booted type.
    const other = new Host('c172s', storeOf('local', kv));
    other.system.store.load();
    expect(other.system.resumeBlock()).toBeNull();

    // Resumed: the monitor carries on from the block.
    const store2 = storeOf('local', kv);
    const saved = store2.load();
    const snap = { career: block } as unknown as FlightSnapshot;
    const plan = careerBootPlan(saved, snap, 'c152', URL0, 'local');
    expect(plan).toMatchObject({ action: 'resume', deleteBlock: false, resumeParam: true });
    const h2 = new Host('c152', store2);
    await h2.system.afterBoot({ resumed: snap, plan });
    expect(h2.startFroms).toEqual([]);
    expect(h2.system.jobMonitor!.elapsedS).toBeCloseTo(h.system.jobMonitor!.elapsedS, 9);
    expect(h2.system.jobMonitor!.phase).toBe('ground');

    // Nothing resumed: never airborne, placed again.
    const h3 = new Host('c152', storeOf('local', kv));
    h3.system.store.load();
    await h3.system.afterBoot({ resumed: null, plan: careerBootPlan(h3.save, null, 'c152', URL0, 'local') });
    expect(h3.startFroms.length).toBe(1);
    expect(h3.save.active!.placed).toBe(true);

    // Nothing resumed after flying: lost.
    const flown = storeOf('local', kv);
    const s = flown.load()!;
    flown.save({ ...s, active: { ...s.active!, everAirborne: true, phase: 'airborne', lastKnown: { north: 3000, east: 2000, onGround: false } } });
    const h4 = new Host('c152', storeOf('local', kv));
    h4.system.store.load();
    await h4.system.afterBoot({ resumed: null, plan: careerBootPlan(h4.save, null, 'c152', URL0, 'local') });
    expect(h4.save.lastSettlement!.outcome).toBe('lost');
    expect(h4.save.active).toBeNull();
    expect(h4.startFroms).toEqual([]);
  }, LONG);
});

describe('CareerSystem: boot follow-ups', () => {
  /** A stored c152 career with a placed job of `type` and the given state. */
  function placedJob(type: CareerAircraftId, over: Partial<NonNullable<CareerSave['active']>> = {}, seed = 0): CareerStore {
    const base = newSave(type === 'c152' ? 'c152' : 'c172s', { seed });
    const offer = boardFor(0, 1, HOME_AIRFIELD.code, airfields())[0];
    const store = storeOf('local');
    store.save({
      ...base, clockMin: CLOCK_RULES.startMin,
      active: {
        offer, aircraftUid: 'a1', type, fuelKg: 40, loading: null, items: [], phase: 'ground', placed: true,
        acceptedAtMin: CLOCK_RULES.startMin, elapsedBaseS: 0, elapsedS: 600, lastKnown: { north: 2000, east: 1000, onGround: false },
        everAirborne: false, playerWeather: defaultWeather(), charges: { fuelUsd: 0, defuelCreditUsd: 0, stopFeesUsd: 0 }, ...over,
      },
    });
    return store;
  }

  it('a placed job of another type: grounded, it waits unplaced; flown, it is lost; under an explicit start, untouched', async () => {
    const grounded = new Host('c152', placedJob('c172s'));
    await grounded.system.afterBoot({ resumed: null, plan: careerBootPlan(grounded.save, null, 'c152', URL0, 'local') });
    expect(grounded.save.active!.placed).toBe(false);
    expect(grounded.save.lastSettlement).toBeNull();

    const flown = new Host('c152', placedJob('c172s', { everAirborne: true, phase: 'airborne' }));
    await flown.system.afterBoot({ resumed: null, plan: careerBootPlan(flown.save, null, 'c152', URL0, 'local') });
    expect(flown.save.active).toBeNull();
    expect(flown.save.lastSettlement!.outcome).toBe('lost');

    const x = new Host('c152', placedJob('c172s', { everAirborne: true, phase: 'airborne' }));
    const plan = careerBootPlan(x.save, null, 'c152', { ...URL0, explicit: true }, 'local');
    await x.system.afterBoot({ resumed: null, plan });
    expect(x.save.active!.placed).toBe(true);
    expect(x.save.lastSettlement).toBeNull();
  });

  it('a job parked at a stop comes back held at the stop with its fuel; an orphan is not re-placed during a lesson', async () => {
    const S = airfields().filter((f) => f.kind === 'sealed')[0];
    // Accepted again (automation), a parked job that has flown is refused: its stop and progress are kept.
    const parked = new Host('c152', placedJob('c172s', { placed: false, phase: 'stopped', stoppedAt: S.code, everAirborne: true, fuelKg: 17 }));
    const pj = parked.save.active!;
    expect(await parked.system.accept(pj.offer.id, parked.save.fleet[0].uid, 30)).toMatch(/One job at a time/);
    expect(parked.save.active).toEqual(pj);
    const h = new Host('c152', placedJob('c152', { placed: false, phase: 'stopped', stoppedAt: S.code, everAirborne: true, fuelKg: 17 }));
    await h.system.afterBoot({ resumed: null, plan: careerBootPlan(h.save, null, 'c152', URL0, 'local') });
    const stand = fieldStand(S);
    expect(h.save.active!.placed).toBe(true);
    expect(h.save.active!.phase).toBe('stopped');
    expect(h.system.jobMonitor!.phase).toBe('stopped');
    expect(Math.hypot(h.state.position.x - stand.north, h.state.position.y - stand.east)).toBeLessThan(5);
    expect(fuelOnBoardKg(h.state)).toBeCloseTo(17, 3);

    // A placed job nobody watches (an explicit start booted past it): opening the hub mid-lesson leaves it be.
    const x = new Host('c152', placedJob('c152'));
    await x.system.afterBoot({ resumed: null, plan: careerBootPlan(x.save, null, 'c152', { ...URL0, explicit: true }, 'local') });
    x.lesson = true;
    x.system.open('hub');
    expect(x.startFroms).toEqual([]);
    x.lesson = false;
    x.system.open('hub');
    await Promise.resolve();
    expect(x.startFroms.length).toBe(1);
  });

  it('in another world nothing is settled, parked or placed', async () => {
    const h = new Host('c152', placedJob('c152', { everAirborne: true, phase: 'airborne' }, 7));
    const plan = careerBootPlan(h.save, null, 'c152', { ...URL0, worldSeed: 0, open: true }, 'local');
    await h.system.afterBoot({ resumed: null, plan });
    h.system.open('hub');
    expect(h.save.active!.placed).toBe(true);
    expect(h.save.lastSettlement).toBeNull();
    expect(h.startFroms).toEqual([]);
    expect(h.system.abandonJob(true)).toBeNull();
  });

  it('a foreign reset just after lift-off settles as abandoned after take-off, though the save had not caught up', async () => {
    const { h, offer, fuel, ac } = hostWithOffer('c152');
    expect(await h.system.accept(offer.id, ac.uid, fuel)).toBe('placed');
    const m = h.system.jobMonitor!;
    expect(m.restoreState({ ...m.exportState(), phase: 'airborne', everAirborne: true, lastKnown: { north: 1500, east: 900, onGround: false } })).toBe(true);
    expect(h.save.active!.everAirborne).toBe(false);
    const rep = h.save.reputation;
    h.events.emit('reset', { scenario: 'runway' });
    const st = h.save.lastSettlement!;
    expect(st.outcome).toBe('abandoned');
    expect(st.lines.some((l) => l.id === 'recovery')).toBe(true);
    expect(h.save.reputation).toBe(rep - 5);
  }, LONG);
});

describe('CareerSystem: money and identity', () => {
  it('the idle lease of a settlement that crosses midnight is its own line; the lines add up to the cash change', async () => {
    const store = storeOf('mem');
    const base = newSave('c152');
    const offer = boardFor(0, 1, HOME_AIRFIELD.code, airfields())[0];
    const s: CareerSave = {
      ...base, clockMin: 1440 + 17 * 60 + 50,
      active: {
        offer, aircraftUid: 'a1', type: 'c152', fuelKg: 40, loading: null, items: [], phase: 'ground', placed: true,
        acceptedAtMin: 1440 + 17 * 60 + 50, elapsedBaseS: 0, elapsedS: 7 * 3600, lastKnown: { north: 0, east: 0, onGround: true },
        everAirborne: false, playerWeather: defaultWeather(), charges: { fuelUsd: 0, defuelCreditUsd: 0, stopFeesUsd: 0 },
      },
    };
    store.save(s);
    const h = new Host('c152', store);
    const cashBefore = h.save.cash;
    h.system.abandonJob(true);
    const st = h.save.lastSettlement!;
    const idle = st.lines.find((l) => l.id === 'leaseIdle')!;
    expect(idle.label).toBe('Idle lease');
    expect(idle.amount).toBe(-Math.round(START_RULES.leaseIdleHoursPerDay * CAREER_PERF.c152.leaseHourly));
    expect(st.lines.reduce((a, l) => a + l.amount, 0)).toBe(h.save.cash - cashBefore);
    expect(st.net).toBe(h.save.cash - cashBefore);
    expect(st.logEntry.net).toBe(st.net - idle.amount);
  });

  it('Reposition dispatches the page’s own offer at the page’s default fuel', async () => {
    const store = storeOf('mem');
    store.save({ ...newSave('c152'), clockMin: CLOCK_RULES.startMin });
    const h = new Host('c152', store);
    const to = airfields().find((f) => f.kind === 'sealed')!.code;
    const ownNo = h.save.ownNo;
    expect(await h.system.reposition(to)).toBe('placed');
    const j = h.save.active!;
    expect(j.offer.id).toBe(`1-${HOME_AIRFIELD.code}-own${ownNo}`);
    expect(j.offer.kind).toBe('positioning');
    expect(h.save.ownNo).toBe(ownNo + 1);
    expect(h.save.taken).not.toContain(j.offer.id);
    const ac = newSave('c152').fleet[0];
    const probe = loadSheet(j.offer, ac, ac.fuelKg, { ...newSave('c152'), clockMin: CLOCK_RULES.startMin }, airfields());
    expect(j.fuelKg).toBe(defaultFuelKg(probe, ac.fuelKg));
  }, LONG);

  it('radioIdentity gives the airframe and the company callsign in Career mode, null outside it', () => {
    const store = storeOf('mem');
    const s0 = newSave('c152', { flightNo: 12 });
    const s = { ...s0, settings: { ...s0.settings, companyCallsign: false } };
    store.save(s);
    const h = new Host('c152', store);
    expect(h.system.radioIdentity()).toEqual({ registration: s.fleet[0].registration, icaoType: 'C152', callsign: null });
    store.save({ ...s, settings: { ...s.settings, companyCallsign: true } });
    expect(h.system.radioIdentity()!.callsign).toBe('Fable 12');
    store.save({ ...s, inCareer: false });
    expect(h.system.radioIdentity()).toBeNull();
    expect(new Host('c172s', storeOf('mem')).system.radioIdentity()).toBeNull();
  });
});

describe('CareerSystem: the pages follow the system', () => {
  it('create opens the hub, Accept closes the pages, a settlement opens the debrief', async () => {
    installFakeDom();
    const layer = document.createElement('div');
    const h = new Host('c152', storeOf('mem'), { layer, unlock: true });
    const ui = h.system.pages!;
    h.system.open('hub');
    expect(ui.page()).toBe('create');
    expect(await h.system.run({ kind: 'create', pilotName: 'A', companyName: 'Fable Air', callsign: '', start: 'c152' })).toBe('ok');
    expect(ui.page()).toBe('hub');
    expect(ui.getModel().board.length).toBeGreaterThan(0);
    const fields = airfields();
    const ac = h.save.fleet[0];
    const offer = ui.getModel().board.find((o) => loadSheet(o, ac, defaultFuelKg(loadSheet(o, ac, ac.fuelKg, h.save, fields), ac.fuelKg), h.save, fields).ok)!;
    const fuel = defaultFuelKg(loadSheet(offer, ac, ac.fuelKg, h.save, fields), ac.fuelKg);
    expect(await h.system.run({ kind: 'accept', offerId: offer.id, uid: ac.uid, fuelKg: fuel })).toBe('placed');
    expect(ui.screenOpen()).toBe(false);
    expect(await h.system.run({ kind: 'abandon' })).toBe('ok');
    expect(ui.page()).toBe('debrief');
    vi.unstubAllGlobals();
  });
});

describe('CareerSystem: boards and load sheets agree', () => {
  const FIT = new Set(['seats', 'stationLimit', 'overMtow', 'runwayShort', 'grass']);
  const ALL_RATINGS: RatingId[] = ['sep', 'mep', 'turbine', 'heli'];
  for (const seed of [0, 7]) {
    it(`200 boards at seed ${seed}: every class-eligible type at required fuel is ok or refused only by a fit code`, () => {
      setWorldSeed(seed);
      try {
        const fields = airfields();
        let n = 0;
        let sheets = 0;
        for (let day = 1; n < 200; day++) {
          for (const origin of fields) {
            if (n >= 200) break;
            n++;
            const fleet: FleetAircraft[] = CAREER_AIRCRAFT_IDS.map((t, i) => ({
              uid: `a${i + 1}`, type: t, tenure: 'owned', registration: `G-T${i}`, field: origin.code, fuelKg: 0, hours: 0, acquiredDay: 0,
            }));
            const save = newSave('c152', { seed, clockMin: day * 1440 + 10 * 60, reputation: 100, cash: 1e7, ratings: ALL_RATINGS, fleet });
            for (const o of boardFor(seed, day, origin.code, fields)) {
              const order: readonly string[] = (FIXED_WING_CLASS_ORDER as readonly string[]).includes(o.minClass) ? FIXED_WING_CLASS_ORDER : ROTORCRAFT_CLASS_ORDER;
              for (const ac of fleet) {
                const cls = CAREER_PERF[ac.type].cls;
                if (!order.includes(cls) || order.indexOf(cls) < order.indexOf(o.minClass)) continue;
                const probe = loadSheet(o, ac, 0, save, fields);
                const sheet = loadSheet(o, ac, probe.requiredFuelKg, save, fields);
                sheets++;
                const blocks = sheet.warnings.filter((w) => w.severity === 'block').map((w) => w.code);
                expect(blocks.filter((c) => !FIT.has(c)), `${o.id} ${ac.type}`).toEqual([]);
                expect(sheet.ok).toBe(blocks.length === 0);
              }
            }
          }
        }
        expect(sheets).toBeGreaterThan(2000);
      } finally {
        setWorldSeed(0);
      }
    });
  }
});
